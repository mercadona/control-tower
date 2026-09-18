# Installing Control Tower

This guide installs the local Control Tower cabin: the backend API and the
built front end, served together at `http://127.0.0.1:8787`. The page and the
API share one origin. The server listens on loopback only (`127.0.0.1`); it
does not accept connections from other machines.

## 1. Prerequisites

Two classes, and both are required. The build tools are what the install
itself needs. The external tools are the binaries Control Tower drives once
it runs; the backend reports itself not ready while one of them is missing,
and `GET /external-tools` answers `"ready": false`.

**One of the five is conditional.** `bq` is asked for only when you set
`CT_HARVEST_BQ_TABLE`, because that is exactly when the backend asks for it.
Leave that variable unset — the default — and a working install needs no
Google Cloud SDK at all. `make check` applies the same rule, so a default
setup never fails over `bq`.

`make check` names everything that is absent and exits `1` if anything is.
`make install` does not run the preflight itself, so run `make check` first.

### Build tools

| Tool | Version |
|---|---|
| `node` | >= 24.12 |
| `npm` | any |
| `git` | any |
| `python3` | any |
| a C++ toolchain | any |

The toolchain builds `node-pty@1.0.0`, a backend dependency with a native
install script. An install is a clone, and `npm install` compiles this
dependency from source on every machine, so every machine that installs
Control Tower needs a toolchain.

On macOS, get the toolchain with:

```sh
xcode-select --install
```

### External tools

Five binaries, each carrying its own credential. They are the ones
`backend/src/infrastructure/probed-tool-sessions.ts` probes, and the Tools
drawer in the interface reports them one by one.

`git` is the fifth, and it is already in the build tools table above: the
install needs it to clone, and the backend needs it authenticated to GitHub.
`make check` reports it once, under the build tools. So the `external tools`
block of that output has four rows, not five.

**`cmux` is not one of them, and is not required.** It was, while plan agents
were launched into a terminal session. #375 replaced that with a headless
dispatcher — `backend/src/infrastructure/headless-plan-agents.ts` — so the
backend no longer drives cmux, no longer probes it, and no longer has to be
started from inside it. Nothing in this guide asks you to install or open it.

| Tool | What it does | Install it | Make it ready |
|---|---|---|---|
| `gh` | GitHub issues and pull requests | `brew install gh` — <https://cli.github.com> | `gh auth login` |
| `acli` | the user stories that come from Jira | `brew install atlassian/acli/acli` — <https://developer.atlassian.com/cloud/acli/> | `acli jira auth login` |
| `claude` | the agent that writes the plan and implements it | `npm install -g @anthropic-ai/claude-code` — <https://docs.claude.com/en/docs/claude-code> | `claude`, then `/login` |
| `bq` | the row every harvested slice leaves in the harvest ledger — **only with `CT_HARVEST_BQ_TABLE` set** | part of the Google Cloud SDK — <https://cloud.google.com/sdk/docs/install> | `gcloud auth login && gcloud auth application-default login` |
| `git` | clones, worktrees and branches, authenticated to GitHub | see the build tools above | add an SSH key to your GitHub account |

The `brew` commands are the ones that installed these tools on the machine
this guide was written against. On Linux, follow the linked documentation
instead.

Two more binaries have to be present, not as tools in their own right but
because they are how two of the five are checked: `ssh` probes `git`'s access
to GitHub, and `gcloud` probes `bq`'s credential. `ssh` ships with macOS and
with every mainstream Linux distribution. `gcloud` arrives with the Google
Cloud SDK alongside `bq`, and follows the same rule: it is asked for only
when `CT_HARVEST_BQ_TABLE` is set.

Installing a tool is not the same as it being ready. `make check` reports
whether the binary is on `PATH`; whether its credential works is what the
Tools drawer reports once the backend runs, with the fix beside each row.

Run `make check` to see, tool by tool, what is missing:

```
$ make check
control-tower 0.1.0 — preflight

build tools — what the install itself needs
  node       ok       v24.19.0 (needs >= 24.12)
  npm        ok       11.17.0
  git        ok       /usr/bin/git
  python3    ok       3.14.6
  toolchain  ok       /Library/Developer/CommandLineTools

external tools — git is the fifth, reported above; bq only with CT_HARVEST_BQ_TABLE
  gh         ok       /opt/homebrew/bin/gh
  acli       missing  the Jira user stories will not load
  claude     ok       /Users/you/.local/bin/claude
  bq         skipped  not needed: CT_HARVEST_BQ_TABLE is unset

probes — how two of those five are checked, not tools of their own
  ssh        ok       /usr/bin/ssh
  gcloud     skipped  only probes bq

result: not ready — acli
```

`make check` names everything missing and exits non-zero. But it checks
`PATH` only. When every binary is there, the last line changes:

```
result: every binary present — this checks PATH only, never a credential
```

That line is not a finished setup. It says the binaries exist. It says
nothing about the `gh`, `acli` and `bq` credentials. Those only become
measurable once the backend starts — see step 5, Verify, below.

## 2. Install

Clone the repository. This is the path that works today:

```sh
git clone https://github.com/mercadona/control-tower.git
cd control-tower
```

This clones the default branch. No `app-v*` tag exists yet, so there is no
specific version to select. Once `app-v*` tags exist, clone a specific
version with:

```sh
git clone --branch app-v<version> https://github.com/mercadona/control-tower.git
```

Then, from the clone:

1. Run the preflight check:

   ```sh
   make check
   ```

   It works when the last line reads `result: every binary present — this
   checks PATH only, never a credential` and the command exits `0`.

2. Install:

   ```sh
   make install
   ```

   It works when the command exits `0` with no error. It installs the
   backend's production dependencies and, because a clone keeps
   `frontend/package.json`, also builds `frontend/dist`.

## 3. Authenticate

**An AI agent must stop here.** `gh auth login`, `acli jira auth login`,
`claude` followed by `/login`, adding an SSH key to a GitHub account, and
`gcloud auth login` all open a browser or prompt interactively. No agent can
complete them on a human's behalf.

1. Tell the user exactly which of these logins are still outstanding.
2. Wait for the user to complete them.
3. Do not attempt any of these steps yourself.
4. Do not report the setup complete until the user confirms they are done.

## 4. Run

**One command starts the whole application**, from the install directory:

```sh
make start
```

It builds `frontend/dist` from the sources in this checkout, then serves that
bundle and the API together on `CT_API_PORT` (`8787` by default). There is
nothing to start in a second terminal, and nothing to open first — no `cmux`,
no separate front-end server.

**Use `make start` every time, and do not replace it with `make run-backend`.**
The backend serves whatever `frontend/dist` already holds and never builds it.
In a clone that follows a branch, `git pull` moves the sources and leaves the
bundle where it was, so a backend started on its own serves the page as it
looked at the last build — an interface several commits behind the code, with
nothing on screen to say so. The build costs about two seconds. Paying it on
every start is why `start` is the one command.

It works when stdout carries a line shaped `{"port":<n>}`. **That line is
never the first line of output**, and a script that waits for the server must
match every line against that shape rather than read line 1: the front-end
build prints first, and the backend prints its own start-up lines. Example of
what a real run prints:

```
npm run build --prefix frontend --if-present

> control-tower-frontend@0.2.0 build
> tsc --noEmit -p tsconfig.json && vite build

vite v6.4.3 building for production...
✓ 170 modules transformed.
dist/index.html                               0.44 kB │ gzip:   0.29 kB
dist/assets/index-DFk5TzR3.js               641.13 kB │ gzip: 178.48 kB
✓ built in 602ms
CT_API_PORT=8787  CT_HARVEST_BQ_TABLE= node backend/src/infrastructure/ct-api.ts
{"port":8787}
coordinating session: nothing recorded to recover
```

A `(!) Some chunks are larger than 500 kB` warning from vite belongs to that
output and is not a failure.

Once that line appears, open `http://127.0.0.1:8787` in a browser.

The other two targets exist for working on one side at a time, and neither is
the way to run the application:

| Command | What it runs | When |
|---|---|---|
| `make start` | the whole application: builds the page, then serves it with the API | **always, unless you have a reason not to** |
| `make run-backend` | the API alone, serving whatever `frontend/dist` holds | backend work, when the page does not change |
| `make dev-frontend` | the page alone, on vite's `5173` with hot reload | front-end work; needs `make run-backend` in another terminal |

`make dev-frontend` cannot press the gate buttons: vite's proxy strips the
`Origin` header, and the backend refuses a gate key that does not come from
the page. Use `make start` to exercise a gate.

### Running it in the background

`make start` blocks in the foreground. An agent that needs the server up
without blocking its own terminal can start it in the background and wait
for the `{"port":<n>}` line itself.

Note the shape `make start CT_API_PORT=$PORT`, with the assignment **after**
the target. A `.env` file assigns `CT_API_PORT` inside the Makefile, and a
Makefile assignment beats the environment — so `CT_API_PORT=8080 make start`
is silently ignored on any machine whose `.env` sets the port. An assignment
on the command line beats both, and is the only form that always holds.

```sh
PORT=8787
LOG=/tmp/control-tower.log

make start CT_API_PORT=$PORT > "$LOG" 2>&1 &
MAKE_PID=$!

for _ in $(seq 1 60); do
  grep -q '{"port":' "$LOG" && break
  kill -0 "$MAKE_PID" 2>/dev/null || { echo "backend exited early"; cat "$LOG"; exit 1; }
  sleep 1
done
grep -q '{"port":' "$LOG" || { echo "timed out"; cat "$LOG"; exit 1; }

PORT=$(sed -n 's/.*{"port":\([0-9]*\)}.*/\1/p' "$LOG" | head -1)
echo "listening on $PORT"
```

Stop it with:

```sh
pkill -f 'node backend/src/infrastructure/ct-api.ts'
```

Match the `node` process, not `$MAKE_PID`. `make` spawns `node` as a child
process. Killing `make` can leave the `node` server running behind it.

## 5. Verify

`make check` passing, or `make start` printing `{"port":<n>}`, is not a
finished setup. The real completion signal is `GET /external-tools`
answering `"ready": true`.

```sh
curl -sS "http://127.0.0.1:$PORT/external-tools" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("ready:", d["ready"]); [print(" ", t["tool"], t["session"], t["fix"] or "") for t in d["tools"] if t["session"] != "ready"]'
```

Real output from a `make start` in this checkout, with every binary present:

```
ready: True
  claude unknown claude, then /login — not observable from this process
```

The rows it prints are the ones that are not `ready`, and not all of them
block. What blocks is exactly this, from `tool-session.ts:38`: a tool that is
not installed, or whose state is `missing`. Two consequences worth knowing
before you read the output as a failure:

- **`unknown` never blocks.** `claude` reports `unknown` whenever it is
  installed, because its login cannot be observed from the backend process —
  `probed-tool-sessions.ts` says so in its own `fix` text. It appears in the
  list above and `ready` can still be `true`.
- **`bq` blocks only when metrics delivery is on.** `survey-external-tools.ts:29`
  asks `MetricsDelivery.demands` first, so a missing `bq` holds readiness back
  only if `CT_HARVEST_BQ_TABLE` is set. `make check` applies the same rule, so
  the preflight and the running backend agree.

Only `"ready": true` at the top means the setup is finished.

## 6. Configure

Copy `.env.example` to `.env` and fill in your own values. `.env` is
git-ignored, so a clone never publishes what you put there; `.gitignore`
carries the same reason next to the line. `make check`, `make run-backend`
and `make start` all read this file through the Makefile's own `-include`,
so a value set there reaches every one of them. It is read once, at
start-up, so a change still needs a restart.

Three environment variables control the backend. All three are optional.

| Variable | Default | Shape |
|---|---|---|
| `CT_API_PORT` | `8787` | digits only, <= `65535` |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | an absolute path, if set |
| `CT_HARVEST_BQ_TABLE` | unset | `project:dataset.table` |

- **`CT_API_PORT`**. Set it to `0` to get an ephemeral port chosen by the
  operating system. This is exactly why the `{"port":<n>}` line on stdout
  matters: with `CT_API_PORT=0` you cannot know the port in advance.
- **`CLAUDE_CONFIG_DIR`**. If you set it, it must be an absolute path. The
  backend keeps its state under
  `<CLAUDE_CONFIG_DIR or ~/.claude>/control-tower`.
- **`CT_HARVEST_BQ_TABLE`**. Shape `project:dataset.table`. Leave it unset
  to keep metrics delivery off; the app works the same, and the only cost is
  that no merged pull request leaves a row in the harvest ledger. The backend
  reads this variable once, at start-up, so a change needs a restart.

  This repository is public. Use an obvious placeholder when you write down
  a value, for example `my-project:my_dataset.my_table` — never a real GCP
  project, dataset or table name. The same rule applies to your own `.env`:
  git ignores the file, but treat it as a value that could still leak.

## 7. Update

An installed Control Tower is a clone checked out at an `app-v<version>`
tag. There is no tarball to download and no asset to unpack. Moving to a
newer release means moving the same clone to a newer tag, and `make update`
does that.

First, check whether a newer application release exists:

```sh
make check-release
```

It reads `git ls-remote --tags origin 'app-v*'`; it does not call the GitHub
API. Four possible outcomes, all exit `0`:

```
up to date: <version> is the newest application release
```

```
newer release: app-v<version> — install it with: make update
```

```
no application release yet: nothing tagged app-v* in origin
```

```
could not reach the remote: check skipped
```

Today's real answer is the third one: no `app-v*` release exists yet.

A `plugin-v*` tag is a release of the Claude Code plugin, not of the
application. Only an `app-v*` tag counts as an application release.

When a newer release exists, move to it with:

```sh
make update
```

`make update` refuses on a dirty working tree. It does not touch your files;
you commit, stash or discard them yourself:

```
update refused: 1 file modified in this install
  ?? notes.txt

Commit or stash them, or discard everything with:
  git reset --hard && git clean -fd

then run make update again.
```

It never runs `git reset --hard` or `git clean` itself. That line only tells
you the command; running it is your decision.

When it can move to a newer tag, it prints the tag, checks it out, and runs
`make install`:

```
updating to app-v0.10.0
```

The checkout ends detached, on purpose. An install is pinned to a release,
not following a branch. `git status` will say you are not on a branch; that
is expected, not an error. Run `git describe --tags` to see which release you
are on.

When the clone is already at the newest tag:

```
already at app-v0.10.0
```

When no `app-v*` tag exists yet — which is the case today — `make update`
prints the same line as `make check-release` and exits `0`:

```
no application release yet: nothing tagged app-v* in origin
```

## 8. Troubleshooting

| Symptom | What it means | What to do |
|---|---|---|
| `CT_API_PORT must be an integer between 0 and 65535, got "<value>"` | `invocation.ts` refused a malformed `CT_API_PORT` (outcome `MALFORMED_PORT`). | Set `CT_API_PORT` to digits only, at most `65535`, or unset it. |
| `the home directory of whoever runs this could not be resolved, so there is no absolute path for the state Control Tower shares with its plugin: set HOME, or CLAUDE_CONFIG_DIR to an absolute path` | The backend could not resolve an absolute state directory (outcome `UNKNOWN_STATE_HOME`). | Set `HOME`, or set `CLAUDE_CONFIG_DIR` to an absolute path. |
| `CT_HARVEST_BQ_TABLE must look like project:dataset.table, got "<value>"` | `CT_HARVEST_BQ_TABLE` does not match the required shape (outcome `MALFORMED_HARVEST_TABLE`). | Fix the value to `project:dataset.table`, or unset it to turn metrics delivery off. |
| The page in the browser is missing a change that is merged and present in the working tree | The bundle in `frontend/dist` is older than the sources. The backend serves that directory and only `make start`, `make build-frontend` and `make install` write it, so a backend started with `make run-backend` after a `git pull` serves the previous build. | Start with `make start`, which rebuilds first. Check what the bundle is by comparing the date of `frontend/dist/index.html` against the last commit that touched `frontend/src`. |
| `the frontend is not installed, so frontend/dist cannot be built: run make install first` | `make start` found `frontend/package.json` but no `frontend/node_modules`, so the build it runs first cannot work. | Run `make install` (or `make install-frontend`), then `make start` again. |
| `make install` fails while building `node-pty`, mentioning `node-gyp` or a missing compiler | The C++ toolchain is missing or broken. | On macOS, run `xcode-select --install`. On Linux, install a toolchain that provides `g++` or `c++`. Then run `make install` again. |
| `make check` ends with `result: not ready — <items>` | A build tool or an external tool is missing, or below its minimum version. | Install or upgrade every tool it names, then run `make check` again. |
| npm prints an `allow-scripts` warning about `node-pty` during `make install` | This is advisory: npm's default settings (`ignore-scripts=false`, `strict-allow-scripts=false`) still let `node-pty` build. The warning does not stop the install. | No action needed. Do not run `npm approve-scripts`. |
| `make install` finishes but the backend refuses to start, and your npm config has `ignore-scripts` or `strict-allow-scripts` enabled | With either setting on, `node-pty` cannot build, so the backend has no working pseudo-terminal to start with. | Unset `ignore-scripts` and `strict-allow-scripts` in your npm config, then run `make install` again. |
| `update refused: N file(s) modified in this install` | `make update` found local changes and stopped before touching anything. | Commit or stash the files it lists, or discard everything with `git reset --hard && git clean -fd`, then run `make update` again. |
| `not a git clone: make update only works on an install checked out with git` | `make update` found no `.git` directory. | Only a clone can update this way. Install with `git clone`, as in step 2. |
