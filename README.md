# Control Tower

**A development cycle with agents in which the machine dispatches and verifies, and the human decides exactly three times.**

Control Tower turns a frozen specification into GitHub issues, dispatches each
one to an isolated agent in its own worktree, and keeps count of who is working
on what, what has been delivered and what is residue. What it does not do — on
purpose — is decide: freezing the spec, promoting a slice to the queue and
merging are still human acts.

It is not an orchestrator of parallel agents. It is the opposite: a machine for
**not** parallelising what is coupled, and for letting what really is
independent move forward without anybody having to remember anything.

| | |
|---|---|
| Plugin | `control-tower-loop` `0.57.0` · slice table contract `v26` |
| Backend | `0.2.0` · 21 endpoints on `http://127.0.0.1:8787` |
| Front end | `0.1.1` · one screen, Vite + React 19 + TypeScript |
| Tests | 7,592 across three suites, all green |
| Licence | [MIT](LICENSE) |

---

## 1. What is in this repository

Three pieces, one repository, shipped through two different channels.

| Directory | What it is | Does it ship? |
|---|---|---|
| [`plugin/`](plugin/) | The **control-tower-loop** plugin for Claude Code: the whole loop — hydration, gates, dispatch, judges — and its suite | **Yes** — it is the marketplace's `source` |
| [`backend/`](backend/) | The local HTTP API the interface consumes, documented in [`backend/API.md`](backend/API.md). It also sweeps every minute the clones it has served, and harvests with `dispatch-check --collect` whatever each slice whose pull request already merged left behind | **Yes** — from a clone, see [`INSTALL.md`](INSTALL.md) |
| [`frontend/`](frontend/) | The page that consumes that API — the local cabin | **Yes** — served by the backend, from the same origin |

`plugin/` travels through both channels, and that is deliberate. The backend
does not only import from it, it runs it: `ct-api.ts` spawns
`plugin/scripts/dispatch-check.mjs`, and the errand it hands a plan agent names
`plugin/scripts/ct-step.mjs` and `plugin/conventions/`. So the application
carries the same directory as its runtime payload, unchanged. The alternative
was forking the loop, and
`backend/__tests__/infrastructure/plugin-contract.test.ts` exists to stop
exactly that.

**Why the plugin lives in a subdirectory.** A plugin's unit of distribution is
the `source` directory of `.claude-plugin/marketplace.json`, whole and with no
exclusion mechanism. Whatever falls outside `plugin/` never reaches an
installation, so `backend/` and `frontend/` can have npm dependencies without
imposing them on any governed repository. `plugin/__tests__/manifest.test.js`
watches this: if `source` goes back to `"./"`, it fails.

### The three human gates

| Gate | When | Why the machine cannot close it |
|---|---|---|
| **1 · The freeze** | The execution spec is written, in `DRAFT` | If the human does not read the spec, whoever writes it closes decisions under somebody else's signature. The hypothesis, each decision with its provenance and the anti-scope are presented, and it stops. **Without the freeze there is no groom.** |
| **2 · `status:ready`** | The issues already exist | The groom creates them in `status:backlog`, never in `ready`. That a slice is written does not mean it should be started now. |
| **3 · The merge** | The pull request is open and the claim released | The merge is the only thing that releases the area tokens and satisfies the dependencies. |

On top of those three, every slice carries a `plan` gate, and a slice whose row
declares journeys also carries an `e2e` gate. The plugin's README explains both.

---

## 2. Which of the two do you need?

There are two ways in, and they are not alternatives — the cabin drives the
plugin.

**The plugin alone** is enough to govern a repository from a Claude Code
session: five slash commands, no server, no page. Start here if you want to try
the loop on one repository.

**The local cabin** — backend plus page — adds a screen for the parts a
conversation does badly: the entrance brainstorming, gate 1 and gate 2 as
panels with the yardstick's findings beside the button, the live terminals of
the sessions it owns, and the plan's progress. It needs the plugin installed as
a directory in this clone, which a clone already gives you.

Install the plugin first either way. Section 3 covers it; section 4 covers the
cabin.

---

## 3. The plugin

### Install it

```
/plugin marketplace add mercadona/control-tower
/plugin install control-tower-loop@control-tower
```

> The `owner/repo` shortcut clones over SSH by default. Export
> `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` if you prefer HTTPS.

Then, **once per repository you want to govern**:

```
/ct-init
```

`/ct-init` leaves `.agent/STATE.md`, `.agent/conventions.md`, the slice table
contract (`docs/superpowers/SLICES-CONTRACT.md` on a fresh repository;
`docs/superpowers/CONTRATO-SLICES.md`, kept in place, on one that already had
that legacy name), a short section in
`AGENTS.md` that links to it, the `.gitignore` rules, `.claude/settings.json`
and the scope gate under `.github/` (the workflow, the bundle, and the one-line `package.json` that keeps node reading that bundle as ESM). **It plans nothing**: filling in the
repository's real commands — build, test, lint, CI — in `AGENTS.md` is up to
you. If it warns that the repository already came with its own conventions,
choosing which one rules is your decision, not the plugin's.

`.claude/settings.json` is what makes the repository carry the loop instead of
your machine: it names this marketplace and this plugin, pinned at the release
that wrote it (`ref: plugin-v<version>`, the tag every release already
carries), so anyone who clones gets the same commands, skills, agents and hooks.
`/ct-init` also runs the install itself
(`claude plugin install control-tower-loop@control-tower --scope project`) and
verifies it, once per machine. Two things stay yours, and it says so: **trust
the folder**, because a project's marketplace only takes effect after that —
until then the install is reported as `refused`, not run; and make
`ct-scope-gate` a **required check** on the default branch, because until it
is, the gate shows red and lets the merge through anyway.

Moving a repository to a newer plugin release is one line — the `ref` — and
`/ct-init` reports the mismatch rather than changing it.

The scaffolder underneath `/ct-init` is also a standalone script, with no
plugin load needed to run it:

```
bash <clone>/plugin/scripts/ct-init.sh <target>
```

This is how a clean-slate repository gets bootstrapped in the first place, on
a machine where nothing has the plugin loaded yet: `/ct-init` itself only
resolves once a session has the plugin, and this script is what a governed
repository's `.claude/settings.json` — one of the things it writes — is missing
until a first run. Run it once from a clone of this repository against the
repository you want to govern, then use `/ct-init` for every later run.

### What the environment needs

- **Node ≥ 24.** The executables are ESM and the hooks are bundled with esbuild.
- **`gh` authenticated** against the repository. All the state lives in GitHub
  issues, labels and pull requests.
- **`cmux` on the `PATH`.** It opens the terminal of every dispatched agent.
  `/ct-next --dry-run` checks that it is there without running it. It is a
  macOS application and has no Linux build today.
- **A Project v2 with an iteration field named exactly `Sprint`**, only if you
  use `/ct-groom --project`.

### The five commands

| Command | What it does | Mutates |
|---|---|---|
| `/ct-init` | Prepares a repository for the loop | the local repository |
| `/ct-groom` | Reads the slice table of the **frozen** spec and creates the milestone, the labels, the issues and the Project entries. Idempotent by existence; it detects divergence but does not apply it without `--reconcile` | GitHub |
| `/ct-next` | Chooses the next dispatchable slice — order, merged dependencies, no token collision, a `--cap` gap available — claims it, creates worktree and branch, seeds the state and launches the agent verifying that it really started | GitHub + disk |
| `/ct-status` | Answers in one go what is in flight, what has been delivered and what is residue | nothing |
| `/ct-harvest` | Answers what each slice of a milestone really cost, read out of GitHub's timeline and the telemetry the slice left committed. No field by hand. With `--bq` it loads the harvest into BigQuery | nothing, without `--bq` |

**Always start dry.** `/ct-groom --dry-run` validates exactly the same as the
real run, and `/ct-next --dry-run` checks what the real run needs and prints
the kickoff in prose.

The five share one channel convention — **stdout is the product, stderr is the
diagnosis** — and a grammar of exit codes with three states: done, could not be
checked, something is still pending.

**The whole reference is [`plugin/README.md`](plugin/README.md)**, and the long
document — the steps one by one, the state machine, the exact format of every
artefact that travels between steps — is in [`docs/loop/`](docs/loop/) as a
29-page PDF and a self-contained HTML page.

---

## 4. The local cabin

The backend and the built page, served together at `http://127.0.0.1:8787`. The
page and the API share one origin, and the server listens on loopback only — it
does not accept connections from other machines.

**[`INSTALL.md`](INSTALL.md) is the install reference.** It names every tool
with its version, the fix beside each row, the three environment variables and a
troubleshooting table. What follows is the short path; when a step fails, that
document says why.

### 4.1 Prerequisites

Two classes. The build tools are what the install needs; the external tools are
the binaries Control Tower drives once it runs.

| Build tool | Version |
|---|---|
| `node` | ≥ 24.12 |
| `npm`, `git`, `python3` | any |
| a C++ toolchain | any — `xcode-select --install` on macOS |

The toolchain builds `node-pty`, a backend dependency that compiles from source
on every machine.

| External tool | What it does | Make it ready |
|---|---|---|
| `gh` | GitHub issues and pull requests | `gh auth login` |
| `acli` | the user stories that come from Jira | `acli jira auth login` |
| `claude` | the agent that writes the plan and implements it | `claude`, then `/login` |
| `git` | clones, worktrees and branches | an SSH key on your GitHub account |
| `bq` | the row every harvested slice leaves in the ledger | only with `CT_HARVEST_BQ_TABLE` set |

`bq` is the conditional one. Leave `CT_HARVEST_BQ_TABLE` unset — the default —
and a working install needs no Google Cloud SDK at all.

`cmux` is not in that table and the application does not need it. #375 made the
backend's dispatcher headless, so it neither drives cmux nor probes it. The
plugin's own `/ct-next` still launches a dispatched agent into a cmux session —
see «What the environment needs» above — but that is the loop's requirement, not
the cabin's.

### 4.2 Install

```sh
git clone https://github.com/mercadona/control-tower.git
cd control-tower
make check      # names everything missing and exits 1 if anything is
make install    # backend production dependencies, and builds frontend/dist
```

`make check` checks `PATH` only, never a credential. Its last line reading
`result: every binary present` is not a finished setup.

### 4.3 Authenticate

**An agent must stop here.** `gh auth login`, `acli jira auth login`, `claude`
followed by `/login`, adding an SSH key and `gcloud auth login` all open a
browser or prompt interactively. No agent completes them on a person's behalf.

### 4.4 Run

**One command starts the whole application**, and nothing has to be opened
first:

```sh
make start
```

It builds `frontend/dist` from this checkout's sources, then serves that bundle
and the API together on `CT_API_PORT` (`8787` by default).

**Do not start the application with `make run-backend`.** The backend serves
whatever `frontend/dist` already holds and never builds it, so in a clone that
follows a branch a `git pull` leaves the page several commits behind the code
with nothing on screen to say so. The build costs about two seconds, and
paying it on every start is why `start` is the one command.

It works when stdout carries a line shaped `{"port":<n>}`. **That line is never
the first line of output** — the build prints first — so a script that waits for
the server must match every line against that shape, not read line 1. Then open
`http://127.0.0.1:8787`.

Stop it by matching the `node` process, not `make`, which spawns it as a child:

```sh
pkill -f 'node backend/src/infrastructure/ct-api.ts'
```

### 4.5 Verify

`make start` printing a port is not a finished setup either. The completion
signal is `GET /external-tools` answering `"ready": true`:

```sh
curl -sS http://127.0.0.1:8787/external-tools
```

Two rows never block. `claude` reports `unknown` whenever it is installed,
because its login cannot be observed from the backend process. And `bq` blocks
only when metrics delivery is on.

### 4.6 Configure

Four environment variables, all optional, **all read once at start-up** — a
change needs a restart.

| Variable | Default | Shape |
|---|---|---|
| `CT_API_PORT` | `8787` | digits only, ≤ `65535`; `0` asks the OS for an ephemeral port |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | an absolute path, if set |
| `CT_STATE_DIR` | `<Claude config directory>/control-tower` | an absolute path; empty means unset |
| `CT_HARVEST_BQ_TABLE` | unset | `project:dataset.table` |

Copy `.env.example` to `.env` and fill in your own values there instead of
exporting them in every terminal. Git ignores `.env`, and the Makefile reads
it with `-include`, so `make check`, `make run-backend` and `make start` all
see the same value. It is read at start-up like the four variables above, so
a change still needs a restart.

`CT_STATE_DIR` separates CT's backend records, checkout registry and machine
logs from the Claude account. It is the exact root, with no extra
`control-tower` suffix. A value that is not an absolute path is refused with a
sentence — by the backend at start-up and by `/ct-status`, `/ct-next`,
`ct-step` and `dispatch-check` alike — rather than silently using account
state. Unset keeps the current location unchanged.

Backend and plugin commands have to resolve the **same** root, and two things
now see to it rather than leaving it to whoever typed `make`. When a
coordinating session opens in a checkout, the backend writes the root it
resolved into that checkout's `.claude/settings.local.json`, so a command
launched there inherits it; that file is one machine's local state and
`ct-init` already keeps it out of git. And the backend publishes the same root
where both halves can find it without the variable itself, so a command that
resolves a different one while the backend is running stops and names both
instead of reporting a loop that looks empty. With the backend stopped there is
nothing to compare against, and a marker left by a backend that is gone is
ignored.

It changes no credentials, Claude settings, conversation transcripts or
repository-local `.agent/` and metrics files. Existing records are not moved or
deleted; stop active work before choosing another root. This is state
separation, not a credential security boundary.

`CT_HARVEST_BQ_TABLE` off is not a failure: plans, dispatch and the collection
of merged slices work the same. The only cost is that no merged pull request
leaves a row in the harvest ledger, so those slices never show up when two
coding tools are compared. The rail's **Métricas** section says which of the
two you are running.

> This repository is public. Write a placeholder — `my-project:my_dataset.my_table` —
> never a real GCP project, dataset or table name, whether in this file or in
> your own `.env`.

---

## 5. The journey of a milestone

What the cabin puts on screen, in order. A name in **Spanish** below is a label
the page really shows; the last two steps have no panel of their own and are
named in English here.

**Entrance — the brainstorming.** The form takes a ticket key (`ABC-123`), a
GitHub issue URL or free text, plus the repository and the absolute path of its
local clone. Its button opens a coordinating session with
`POST /coordinating-session`: a `claude` conversation in the governed checkout,
with no worktree cut and no branch created. That conversation writes the design
document and the execution spec.

**Puerta 1 · Congelación del spec.** The panel polls `GET /spec-freeze` and
shows the yardstick's findings over the spec on disk. **Congelar el spec** stays
disabled while any finding remains. Pressing it mutates `DRAFT → CONGELADA` and
opens a pull request — gate 1 ends in a pull request, and a person merges it.

**Puerta 2 · El groom y la autorización.** Once that pull request merges, the
panel shows the dry run's product: the issues the groom would create, ordered
and labelled, before anything is created. Three presses live here.
**Revisar el slicing con la sesión** opens a groom conversation so a person can
walk the table instead of only saying yes or no to it. **Ejecutar el groom**
creates the milestone, the labels and the issues, in `status:backlog`.
**Autorizar el trabajo** promotes them to `status:ready`. When the coordinating
session changed the slicing, **Publicar el nuevo slicing** sends the correction
out as its own pull request; merging that pull request is the authorisation, so
the groom then presses itself.

**Solicitud → Revisar plan → Implementación.** `POST /start-plan` cuts the
worktree, opens the plan issue and launches the plan agent; the progress arrives
over Server-Sent Events. When the plan agent finishes, the backend publishes the
plan as a comment on the issue and starts the implementation itself, in the same
watch and with no second request to make: the plan is read there, not answered.
Until `0.58.0` this stage was a gate — a human granted the go, the release
refused to pass without it, and a `POST /implement-plan` resumed the work. A-3
(issue #434) retired the protocol and #435 took that route out of the backend,
where it now answers 404. The implementation goes on task by task, through
`ct-step`.

**Gate 3 · the merge.** It has no panel: it happens on GitHub. Still yours, but
you no longer have to announce it —
on delivering, `--release` leaves a detached watcher polling the pull request,
and as soon as it sees it merged it warns the coordinator that its harvest is
pending. It deletes nothing — the warning is the automation. The merge closes
the issue and releases the `area:`/`touches:` tokens, which is what unblocks the
slices that were waiting.

**The harvest.** The backend sweeps every minute and collects what a merged
slice left behind: it closes that worktree's `cmux` session and deletes worktree
and branch, but only if the pull request is merged, the tree clean and the local
tip the commit that landed. If any of the three fails it touches nothing and
says which. `/ct-harvest` then answers what the milestone cost.

---

## 6. Developing

Each piece is an independent npm package, with its own lockfile and its own
suite.

```sh
cd plugin   && npm ci && npm test   # 158 files, 4,281 tests — builds dist/ first
cd backend  && npm ci && npm test   #  94 files, 1,990 tests
cd frontend && npm ci && npm test   #  69 files, 1,321 tests
```

The `Makefile` at the root joins them without replacing them. Every target
names its package, and `make help` lists them all:

| Target | What it does |
|---|---|
| `make install-plugin` · `install-backend` · `install-frontend` · `install-all` | dependencies |
| `make test-plugin` · `test-backend` · `test-frontend` · `test-all` | the suites |
| `make build-plugin` | `plugin/dist` — the hook bundles |
| `make build-frontend` | `frontend/dist` |
| `make start` | **the whole application**: builds `frontend/dist`, then serves it with the API |
| `make run-backend` | the API alone; serves whatever `frontend/dist` already holds, and never builds it |
| `make dev-frontend` | vite on 5173 proxying to the API — run `make run-backend` in another terminal |
| `make check` · `check-release` · `install` · `update` · `version` | the install path of section 4 |

**`make dev-frontend` cannot press the gate buttons.** The vite proxy strips
`Origin` before forwarding, so no gate key is minted, and a press without the
key is refused with `gate-not-from-the-page`. Use `make start` to
exercise gates 1 and 2.

### Two derived directories are tracked, and both have a rule

**`plugin/dist/`.** `hooks/hooks.json` starts the bundles, not the sources
under `hooks/`. Every change in `hooks/`, or in any module of `scripts/` those
hooks import, **has to carry a rebuilt `dist/` in the same commit** — otherwise
the repository distributes the old hook while the source already says something
else, and the suite stays green, because `npm test` builds first. Run
`npm run build` and read the diff of `dist/*.js` as part of the change.

**`docs/loop/`.** `loop.body.html` is the only file edited by hand; the HTML and
the PDF are regenerated with `node docs/loop/build.mjs`, and travel in the same
commit for the same reason.

### Conventions

`plugin/conventions/` is the travelling yardstick — eight English documents that
bind on every diff here and in every governed repository.
`backend/conventions/this-repository.md` adds what only this backend decides.

**The language rule is in [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md),
which carry the same text on purpose.** Everything is English — code, tests,
documentation, commit messages, issues and pull requests — with two exemptions:
frontend product copy, which is Spanish because the interface is read by
Spanish-speaking engineers, and values fixed by an external contract. Ten parsed
markdown headings are Spanish **and contract**; translating one is a coordinated
change of the constant, every live issue and every governed repository's spec, in
a single move. Read that document before renaming anything, and
[`docs/glossary.md`](docs/glossary.md) before choosing an English term.

**A repository control is not an obstacle to route around.** No `--no-verify`,
no moved hooks path, no `--force` past a protection, no weakening a test until
it stops failing. A control that refuses when it should not is a finding: stop,
say what refused, and let a person decide.

### Continuous integration

`.github/workflows/continuous-integration.yml` runs on every pull request, in
six jobs. `changes` decides which of the three packages the pull request
actually touches, and `dist`, `test`, `backend` and `frontend` hang off its
outputs, so a pull request that only moves `backend/` stops paying for the
plugin suite. The filter has one edge — `backend/` imports `plugin/` sources, so
a plugin change turns the backend job on too — and one blunt rule: **any changed
path outside the three packages turns all three on**, because two of the suites
guard invariants of the repository root.

`ci` aggregates the other four into one check. A job the filter turned off
counts as a pass — it was not needed, it did not fail — but `changes` itself
never counts as skipped, so a broken filter cannot come out green with nothing
tested.

**What `ci` does not do today is block a merge.** The active ruleset on `main`
requires a pull request, linear history, and no deletion or force-push; it
requires **no status check**. So CI runs on every pull request and reports, and
merging a red one is a person's decision rather than something the repository
refuses. Read `ci` before you merge.

---

## 7. Releases

`release-please` derives every changelog from the commit messages, which this
repository writes in Conventional Commits with the package as the scope
(`feat(plugin):`, `fix(backend):`). Every push to `main` leaves **one** pull
request open with the three changelogs and the three versions already bumped;
merging it is what creates the tags and the GitHub releases. Publishing stays a
human decision, like the loop's other three gates.

| Tag | Releases |
|---|---|
| `plugin-v*` | the Claude Code plugin — the only thing distributed, and its version travels in every run's telemetry |
| `backend-v*` | the local API |
| `frontend-v*` | the page |

`release-please` sorts every commit by the **files** it touches, not by the
scope of the message, so a commit that crosses two packages appears in both
changelogs. That pull request brings no checks: the events a default
`GITHUB_TOKEN` creates do not trigger other workflows.

> **One known gap, reported and not papered over.** `make check-release` and
> `make update` read `app-v*` tags, and `INSTALL.md` §7 describes updating an
> install by moving the clone to a newer one. **No `app-v*` tag exists, and
> nothing produces one**: `release-please-config.json` declares `plugin`,
> `backend` and `frontend`, and the root `VERSION` file is maintained by hand and
> is in no release. So `make check-release` always answers *no application
> release yet*, and installing means cloning the default branch, which is what
> section 4.2 does. Whether the application gets a release channel of its own is
> a decision, not a bug to fix quietly.

---

## 8. Where to read more

| Document | What it holds |
|---|---|
| [`INSTALL.md`](INSTALL.md) | the install reference: every tool, every variable, every failure and its fix |
| [`plugin/README.md`](plugin/README.md) | the loop in full: the commands, `ct-step`, the state machine, the artefacts, and the **known limits** |
| [`docs/loop/`](docs/loop/) | the 29-page reference document, plus the long reference of each command |
| [`backend/API.md`](backend/API.md) | the 21 endpoints, read from a running server, with every refusal code |
| [`frontend/README.md`](frontend/README.md) | the page, panel by panel, and the design system it mirrors |
| [`CLAUDE.md`](CLAUDE.md) · [`AGENTS.md`](AGENTS.md) | the language rule, the Project workflow, and the controls an agent does not route around |
| [`docs/glossary.md`](docs/glossary.md) | every Spanish term still in the tree and the English one it becomes |
| [`docs/judge-bench.md`](docs/judge-bench.md) | how a change to a judge is measured before it ships |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | the design documents, including the merge with the companion app and its divergence note |

The plans and specs under `docs/superpowers/` and the round handoffs in
`docs/prompt-*.md` are the minutes of decisions already taken. They stay in
Spanish, and nothing here rewrites them. New ones are written in English.

## Licence

[MIT](LICENSE), © 2026 José Agüera. The superpowers fork under
`plugin/skills/` keeps its own MIT notice in
[`plugin/skills/LICENSE-superpowers`](plugin/skills/LICENSE-superpowers); the
modifications are documented in [`plugin/skills/FORK.md`](plugin/skills/FORK.md).
