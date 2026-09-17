# One entry point for the three packages. Each keeps its own package.json,
# lockfile and suite; this file only spells out the commands in one place.
# Every target names the package it touches; only *-all spans them.
#
#   make install-plugin | install-backend | install-frontend | install-all
#   make test-plugin    | test-backend    | test-frontend    | test-all
#   make build-plugin                                          build plugin/dist (the hook bundles)
#   make build-frontend                                        build frontend/dist
#   make run-backend                                           install backend deps, then start the API on CT_API_PORT (8787); serves frontend/dist if built; CT_HARVEST_BQ_TABLE=project:dataset.table loads every harvested slice into BigQuery, and without it nothing is uploaded (read at start-up, so changing it needs a restart)
#   make run-frontend                                          build the frontend, then run-backend
#   make dev-frontend                                          vite dev server (run `make run-backend` in another terminal)
#   make clean-frontend | clean-all
#   make version                                                print the VERSION file
#   make check                                                  preflight: the build tools, then the six external tools the backend drives
#   make check-release                                          compare VERSION against the newest app-v* tag on origin
#   make update                                                 move this install to the newest app-v* tag, then reinstall
#   make install                                                install backend deps, and build the frontend when its sources are present
#   make start                                                  run the already-installed backend (no install step)
#   .env                                                        local, git-ignored values read by every target above (see .env.example)

SHELL := /bin/bash
.DEFAULT_GOAL := help

PACKAGES := plugin backend frontend

# Local, machine-specific values: the BigQuery destination above all, which
# names a real GCP project this public repository must not carry. The leading
# dash is what makes the file optional — a clone with no .env builds the same.
-include .env

CT_API_PORT ?= 8787

# Probe for #385's pull request: a root-level touch, to see whether the frontend
# suite fails on main itself. This branch is thrown away.
HARVEST_VARIABLE := CT_HARVEST_BQ_TABLE

.PHONY: help install-all test-all clean-all \
        $(addprefix install-,$(PACKAGES)) $(addprefix test-,$(PACKAGES)) \
        build-plugin build-frontend run-backend run-frontend dev-frontend clean-frontend \
        version check check-release install start update

help:
	@grep -E '^#   make' Makefile | sed 's/^#   //'

install-all: $(addprefix install-,$(PACKAGES))

# npm ci needs a lockfile; a package that has none yet falls back to npm install.
$(addprefix install-,$(PACKAGES)): install-%:
	@if [ -f $*/package-lock.json ]; then npm ci --prefix $*; else npm install --prefix $*; fi

test-all: $(addprefix test-,$(PACKAGES))

$(addprefix test-,$(PACKAGES)): test-%:
	npm test --prefix $* --if-present

build-plugin:
	npm run build --prefix plugin

build-frontend:
	npm run build --prefix frontend --if-present

run-backend: install-backend
	CT_API_PORT=$(CT_API_PORT) CLAUDE_CONFIG_DIR=$(CLAUDE_CONFIG_DIR) CT_HARVEST_BQ_TABLE=$(CT_HARVEST_BQ_TABLE) node backend/src/infrastructure/ct-api.ts

run-frontend: install-frontend build-frontend run-backend

dev-frontend: install-frontend
	npm run dev --prefix frontend --if-present

clean-frontend:
	rm -rf frontend/dist frontend/node_modules

clean-all: clean-frontend
	rm -rf plugin/node_modules backend/node_modules

version:
	@cat VERSION

# bq and gcloud are asked for only when CT_HARVEST_BQ_TABLE is set, because that
# is exactly when the backend asks for them: survey-external-tools.ts consults
# MetricsDelivery.demands before letting a missing bq hold readiness back, and
# MetricsDelivery.enabled is `destination !== null`. A preflight stricter than the
# product would fail a default install over a tool nothing was going to use.
#
# This target answers one question only: is every binary on PATH. It never asks
# whether a credential works, because that is not knowable from here — gh, acli
# and bq answer to a login, and cmux answers only while its app is running. The
# backend measures those at GET /external-tools once it is up, and that endpoint,
# not this one, is what says a setup is finished.
#
# Two classes, both required. The build tools are what the install itself needs.
# The six external tools are the binaries the backend drives; the authority on
# which six, and on what is asked of each, is probed-tool-sessions.ts, and the
# backend answers `"ready": false` on GET /external-tools while one is missing.
# ssh and gcloud are not a seventh and eighth tool: they are how git and bq are
# probed. A missing binary fails this target either way — the split is what it
# costs you, not whether it counts.
check:
	@node_needed="24.12"; \
	fail_required=""; \
	line() { printf "  %-10s %-8s %s\n" "$$1" "$$2" "$$3"; }; \
	ge_version() { [ "$$(printf '%s\n%s\n' "$$1" "$$2" | sort -V | head -n1)" = "$$1" ]; }; \
	echo "control-tower $$(cat VERSION) — preflight"; \
	echo ""; \
	echo "build tools — what the install itself needs"; \
	if command -v node >/dev/null 2>&1; then \
	  node_v=$$(node --version | sed 's/^v//'); \
	  if ge_version "$$node_needed" "$$node_v"; then \
	    line node ok "v$$node_v (needs >= $$node_needed)"; \
	  else \
	    line node missing "v$$node_v (needs >= $$node_needed)"; \
	    fail_required="$$fail_required node"; \
	  fi; \
	else \
	  line node missing "not on PATH"; \
	  fail_required="$$fail_required node"; \
	fi; \
	if command -v npm >/dev/null 2>&1; then \
	  line npm ok "$$(npm --version)"; \
	else \
	  line npm missing "not on PATH"; \
	  fail_required="$$fail_required npm"; \
	fi; \
	if command -v git >/dev/null 2>&1; then \
	  line git ok "$$(command -v git)"; \
	else \
	  line git missing "not on PATH"; \
	  fail_required="$$fail_required git"; \
	fi; \
	if command -v python3 >/dev/null 2>&1; then \
	  line python3 ok "$$(python3 --version | sed 's/^Python //')"; \
	else \
	  line python3 missing "node-gyp needs it"; \
	  fail_required="$$fail_required python3"; \
	fi; \
	if [ "$$(uname -s)" = "Darwin" ]; then \
	  if xcode_path=$$(xcode-select -p 2>/dev/null); then \
	    line toolchain ok "$$xcode_path"; \
	  else \
	    line toolchain missing "run: xcode-select --install"; \
	    fail_required="$$fail_required toolchain"; \
	  fi; \
	elif command -v c++ >/dev/null 2>&1; then \
	  line toolchain ok "$$(command -v c++)"; \
	elif command -v g++ >/dev/null 2>&1; then \
	  line toolchain ok "$$(command -v g++)"; \
	else \
	  line toolchain missing "install a C++ toolchain (e.g. g++)"; \
	  fail_required="$$fail_required toolchain"; \
	fi; \
	echo ""; \
	echo "external tools — git is the sixth, reported above; bq only with $(HARVEST_VARIABLE)"; \
	external() { \
	  if command -v "$$1" >/dev/null 2>&1; then line "$$1" ok "$$(command -v "$$1")"; \
	  else line "$$1" missing "$$2"; fail_required="$$fail_required $$1"; fi; \
	}; \
	external gh "GitHub issues and pull requests will not sync"; \
	external acli "the Jira user stories will not load"; \
	external claude "plan agents will not have an implementer to run"; \
	external cmux "plan agents will not have a session to launch into"; \
	if [ -n "$(CT_HARVEST_BQ_TABLE)" ]; then \
	  external bq "no harvested slice will leave its row in the ledger"; \
	else \
	  line bq skipped "not needed: $(HARVEST_VARIABLE) is unset"; \
	fi; \
	echo ""; \
	echo "probes — how two of those six are checked, not tools of their own"; \
	external ssh "git's access to GitHub cannot be probed"; \
	if [ -n "$(CT_HARVEST_BQ_TABLE)" ]; then \
	  external gcloud "bq's credential cannot be probed"; \
	else \
	  line gcloud skipped "only probes bq"; \
	fi; \
	echo ""; \
	if [ -n "$$fail_required" ]; then \
	  echo "result: not ready —$$fail_required"; \
	  exit 1; \
	else \
	  echo "result: every binary present — this checks PATH only, never a credential"; \
	fi

# Shared by check-release and update: resolves the newest app-v<major>.<minor>.<patch>
# tag on the origin remote. An install is a clone, so origin is correct and a fork
# keeps working. Reads git ls-remote --tags, not a hardcoded URL or the GitHub API.
#
# ls-remote lines are "<sha>\trefs/tags/<name>"; an annotated tag also appears peeled
# as "refs/tags/<name>^{}", so the peeled duplicates are dropped before matching names.
# Only exact app-v<N>.<N>.<N> names are accepted; sort -V, not string order, so
# app-v0.10.0 beats app-v0.9.0. Prints nothing and returns 1 when the remote cannot
# be reached; prints nothing and returns 0 when the remote has no matching tag.
define NEWEST_APP_TAG_FN
newest_app_tag() { \
  local raw; \
  if ! raw=$$(git ls-remote --tags origin 'app-v*' 2>/dev/null); then \
    return 1; \
  fi; \
  printf '%s\n' "$$raw" \
    | sed -E 's#^[0-9a-f]+[[:space:]]+refs/tags/##' \
    | grep -v '\^{}$$' \
    | grep -E '^app-v[0-9]+\.[0-9]+\.[0-9]+$$' \
    | sort -V \
    | tail -n1; \
  return 0; \
}
endef

# Compares VERSION against the newest app-v* tag on origin. plugin-v*, backend-v*
# and frontend-v* are package releases, not application releases, and are excluded
# by the exact app-v<N>.<N>.<N> match above.
check-release:
	@$(NEWEST_APP_TAG_FN); \
	current=$$(cat VERSION); \
	if ! newest=$$(newest_app_tag); then \
	  echo "could not reach the remote: check skipped"; \
	  exit 0; \
	fi; \
	if [ -z "$$newest" ]; then \
	  echo "no application release yet: nothing tagged app-v* in origin"; \
	  exit 0; \
	fi; \
	newest_v=$${newest#app-v}; \
	if [ "$$current" = "$$newest_v" ]; then \
	  echo "up to date: $$current is the newest application release"; \
	  exit 0; \
	fi; \
	smallest=$$(printf '%s\n%s\n' "$$current" "$$newest_v" | sort -V | head -n1); \
	if [ "$$smallest" = "$$current" ]; then \
	  echo "newer release: $$newest — install it with: make update"; \
	else \
	  echo "up to date: $$current is the newest application release"; \
	fi

# The install path: no lockfile-vs-install choice needed, dev deps stay out.
# The frontend build is guarded rather than unconditional so that a tree without
# frontend sources still installs.
#
# --omit=dev is what makes this the release path, and in a clone it takes vitest
# with it: `make test-backend` then answers `vitest: command not found`.
# `make install-backend` puts the dev dependencies back.
install:
	npm ci --omit=dev --prefix backend
	@if [ -f frontend/package.json ]; then $(MAKE) install-frontend build-frontend; fi

# run-backend installs first, for a checkout; start assumes install already ran,
# which is the case once `make install` has been run on a fresh clone.
start:
	CT_API_PORT=$(CT_API_PORT) CLAUDE_CONFIG_DIR=$(CLAUDE_CONFIG_DIR) CT_HARVEST_BQ_TABLE=$(CT_HARVEST_BQ_TABLE) node backend/src/infrastructure/ct-api.ts

# Moves an installed clone to the newest app-v* tag and reinstalls. Refuses on a
# dirty working tree instead of touching it: the user commits, stashes or discards
# by hand. The checkout ends detached, on purpose — an install is pinned to a
# release, not following a branch.
update:
	@if ! git rev-parse --git-dir >/dev/null 2>&1; then \
	  echo "not a git clone: make update only works on an install checked out with git"; \
	  exit 1; \
	fi
	@dirty=$$(git status --porcelain); \
	if [ -n "$$dirty" ]; then \
	  count=$$(printf '%s\n' "$$dirty" | wc -l | tr -d ' '); \
	  if [ "$$count" = "1" ]; then noun="file"; else noun="files"; fi; \
	  echo "update refused: $$count $$noun modified in this install"; \
	  printf '%s\n' "$$dirty" | sed -E 's/^(..) /  \1 /'; \
	  echo ""; \
	  echo "Commit or stash them, or discard everything with:"; \
	  echo "  git reset --hard && git clean -fd"; \
	  echo ""; \
	  echo "then run make update again."; \
	  exit 1; \
	fi
	@if ! git fetch --tags origin >/dev/null 2>&1; then \
	  echo "could not reach the remote: check your connection and try again"; \
	  exit 1; \
	fi
	@$(NEWEST_APP_TAG_FN); \
	if ! newest=$$(newest_app_tag); then \
	  echo "could not reach the remote: check your connection and try again"; \
	  exit 1; \
	fi; \
	if [ -z "$$newest" ]; then \
	  echo "no application release yet: nothing tagged app-v* in origin"; \
	  exit 0; \
	fi; \
	current_sha=$$(git rev-parse HEAD); \
	newest_sha=$$(git rev-parse "$$newest^{commit}" 2>/dev/null); \
	if [ "$$current_sha" = "$$newest_sha" ]; then \
	  echo "already at $$newest"; \
	  exit 0; \
	fi; \
	echo "updating to $$newest"; \
	git checkout --detach "$$newest" && $(MAKE) install
