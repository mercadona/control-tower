# `GET /external-tools` — whether the tools you have to log into are usable

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, §2 of this plan and `backend/conventions/` win.

**Issue:** [#146](https://github.com/mercadona/control-tower/issues/146) — *endpoint para la
obteción del estado de las herramientas externas*. The issue carries a title and a link to an
empty Notion card, so it froze no acceptance criteria: the input is the request in the session
that dispatched this plan, and every decision it left open is closed in §2 or declared in §9.

**Branch:** `feat/external-tools-status`, cut from `main` at 15e2097 (the merge of PR #133, the
`repo_list` slice). Every `Current state` block below reads verbatim at that base.

**Tech stack:** Node 24 ESM, express 5, vitest 4. No new dependency.

## 1. Context and goal

Control Tower drives five external tools that carry a credential, and today nothing asks them
whether that credential is there. `gh` is the whole state of the loop (`Gh.BIN`, wired at
`ct-api.mjs:295`); `acli` reads the Jira story in `POST /start-plan`
(`acli-user-stories.js:7`, wired at `ct-api.mjs:183`); `claude` is what cmux types in every dispatched session
(`kickoff.js:43`); `git` pushes and fetches (`GitWorkspace.BIN`); and `bq` loads the harvest row
when `CT_HARVEST_BQ_TABLE` is set (`bigquery-load.js:68`). Each one fails **at the moment it is
used**, mid-flow, with the tool's own words: `acli-user-stories.js:36` is the only place in the
backend that turns one of those failures into an instruction (`run "acli jira auth login"`), and
it does so after a plan was already asked for.

There is one preflight in the tree and it is the plugin's, not the backend's: `ct-next.mjs`
around line 2320 looks up `cmux` and the agent binary in `PATH` and refuses the batch. It says
nothing about credentials.

This slice adds one read-only endpoint, `GET /external-tools`, that probes those five tools and
answers, per tool, whether it is installed, whether its session is usable, and the command that
fixes it — so the answer arrives before the first plan instead of during it.

### Desired end state

- `GET /external-tools` answers 200 with `{ ready, tools }`. `tools` has exactly five entries, in
  the order the probe table declares, each `{ tool, installed, session, fix }`.
- `session` is one of `ready`, `missing`, `unknown`. `fix` is the literal command that repairs a
  tool whose session is not `ready`, and `null` for one that is.
- `ready` is `true` when no tool blocks. A tool blocks when it is not installed or its session is
  `missing`; `unknown` never blocks.
- `claude` always answers `unknown`: its login cannot be observed from this process, and the
  detail of `fix` says where it can.
- `git` is probed through `ssh -T git@github.com`, whose **exit code is 1 on success**: the parse
  reads the marker on stderr.
- Every probe is a read, declared `safeToRepeat: true`, and a probe that fails is data — the
  endpoint answers 200 with that tool `missing`, never a refusal.
- Any method other than GET on the path answers 405 with `Allow: GET`.
- The five binaries, their argv, their readiness markers and their fix commands live **only** in
  `backend/src/infrastructure/probed-tool-sessions.js`.

### Out of scope

- **The frontend.** Nothing renders this yet; the endpoint is the deliverable.
- **`cmux`, `node` and `sh`** (human's call): they carry no credential, and `cmux` is already
  looked up by `ct-next.mjs`'s preflight. The verdict of this endpoint therefore does not answer
  "can I dispatch a slice", only "am I logged into everything that asks me to log in".
- **Capability granularity** (human's call): a tool is one row. So `gh` answers `ready` on a
  token that lacks the `project` scope, and `/ct-groom --project` would still fail — declared in
  §9.3, not fixed here.
- **Gating other endpoints.** `POST /start-plan` does not consult this; it keeps failing as it
  fails today.
- **Caching.** Every request probes.
- **A plugin-side command** (human's call): the check lives in the backend, so `ct-next.mjs`
  keeps its own preflight and this endpoint does not feed it.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Route | `GET /external-tools`, mounted like `ActivePlansRoute` (human's call: an endpoint, not a plugin script) |
| Tools in scope | exactly `gh`, `acli`, `claude`, `git`, `bq` — the five that carry a credential (human's call) |
| Payload | `{ ready: boolean, tools: [{ tool, installed, session, fix }] }` |
| `session` vocabulary | `ready` \| `missing` \| `unknown`, frozen in `SessionState` |
| Why three states | a login that cannot be observed is not a login that is broken; the repo already refuses that collapse (`ct-next.mjs` warns instead of failing, `branchExistsLocally` answers `'unknown'`) |
| What blocks `ready` | `!installed \|\| session === 'missing'`; `unknown` does not block |
| `fix` | the literal repair command, `null` when `session === 'ready'` — the reader is whoever has to log in, and a ready tool has no such reader (`plugin/conventions/simplicity.md`) |
| No tool output in the payload | every `fix` and every state is **declared** by us, next to the probe, never echoed from the tool: `gh auth status` prints a masked token and `ssh -T` prints the account's handle |
| Refusals | none: no input, and a failed probe is data. No request model, no `Projection`, no `Collapse` |
| Failure of the whole survey | impossible by construction; if the port throws, the last net in `api-server.js` answers 400 `request-failed` as it does for every route |
| Tool names | data in the adapter's table, never a domain constant: `backend/conventions/this-repository.md` orders that `gh` and `acli` exist only in `infrastructure/` |
| Port | `ToolSessions.all()` — one collaborator: "the tools I need a session with" |
| Use case | `SurveyExternalTools` in `application/queries/`, **with a Result and no Params**: it takes no input, and a zero-field Params is a type with no consumer (`plugin/conventions/simplicity.md`) |
| Probe of `gh` | `gh auth status`; exit 0 ⇒ `ready`. Fix: `gh auth login` |
| Probe of `acli` | `acli jira auth status`; exit 0 ⇒ `ready`. Fix: `acli jira auth login` |
| Probe of `bq` | `gcloud auth list --filter=status:ACTIVE --format=value(account)`; exit 0 **and** non-blank stdout ⇒ `ready`. Fix: `gcloud auth login && gcloud auth application-default login` |
| Probe of `git` | `ssh -o BatchMode=yes -o ConnectTimeout=10 -T git@github.com`; stderr contains `successfully authenticated` ⇒ `ready`, whatever the exit code |
| Probe of `claude` | none. `unknown`, always. Fix: `claude, then /login` |
| `installed` | `PATH` lookup of the tool's own binary, **never executed** — the rule `ct-next.mjs` states for `cmux` |
| Which binary is looked up vs probed | looked up: the tool's own (`bq`, `git`); probed: whatever answers for it (`gcloud`, `ssh`) |
| Probe clients | one `ExternalTool` per probe binary, built in `ct-api.mjs`: a client per tool, never per call (`plugin/conventions/architecture.md`) |
| Budget | the entrypoint's `#PROCESS_TIMEOUT_MS` (30 s), unchanged. The adapter never picks a cap and has no default for one: it arrives inside the injected clients (`plugin/conventions/boundaries.md`) |
| Typed errors | none. This adapter throws nothing: a probe that refuses and a probe whose answer we cannot read are the same datum, `missing`. Declared in §6 against the two-causes rule |

## 3. Reference patterns

Files to imitate:
- `backend/src/infrastructure/implement-progress-route.js` — the GET controller: `PATH`,
  `METHOD`, `handledBy`, `refuseOtherMethods`, the 200 built by hand.
- `backend/src/infrastructure/active-plans-route.js` — the route with no request model.
- `backend/src/application/queries/read-implementation-progress.js` — a query and its Result.
- `backend/src/infrastructure/acli-user-stories.js` — the adapter: `static BIN`, `argvFor`, the
  parse, the declared reason.
- `backend/src/domain/ports/user-stories.js` — the port that throws on its own name.
- `backend/src/domain/value-objects/implementation-state.js` — a frozen value object.
- `backend/__tests__/infrastructure/acli-user-stories.test.js` — an adapter test: literal argv,
  literal recorded output.
- `backend/__tests__/application/survey-workspaces.test.js` — a query test with doubled ports.
- `backend/__tests__/infrastructure/implement-progress-route.test.js` — a controller test through
  a listening server.

Rules to obey:
- `backend/conventions/this-repository.md` — what only this backend decides: `<endpoint>-route.js`,
  one file per endpoint; that `gh` and `acli` exist only in `infrastructure/`; how this API answers
  (`{code, detail}`, kebab-case codes, 400 for what the application judged); where the suite runs.
- `plugin/conventions/boundaries.md` — the failure of an external system is data, not an exception;
  the caller declares `safeToRepeat`; no call without a cap and the adapter does not choose it; the
  projection outwards is exhaustive; an adapter is named after its implementation.
- `plugin/conventions/simplicity.md` — the burden of proof is on what is added; a field of an
  answer with no reader named is an antipattern.
- `plugin/conventions/architecture.md` — one client per tool, never per call; a new type has the
  burden of proof.
- `plugin/conventions/domain.md` — the guard a value object keeps for itself, and only that one.
- `plugin/conventions/testing.md` — the three rules, what each layer asserts, the mother, the
  declared output shape from a named real capture, the assertion seen to fail, the mutation sweep.
- `plugin/conventions/style.md`, `plugin/conventions/defects.md`,
  `plugin/conventions/decisions.md` — the rest of the travelling yardstick, which binds here too.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/domain/value-objects/tool-session.js` | create | the adapter, the query's Result | Contract (Task 1) |
| `backend/src/domain/ports/tool-sessions.js` | create | the query, the adapter | Contract (Task 1) |
| `backend/src/application/queries/survey-external-tools.js` | create | the route | Contract (Task 1) |
| `backend/__tests__/application/survey-external-tools.test.js` | create | vitest | none (body by TDD) |
| `backend/src/infrastructure/probed-tool-sessions.js` | create | `ct-api.mjs` | Contract (Task 2) |
| `backend/__tests__/infrastructure/probed-tool-sessions.test.js` | create | vitest | none (body by TDD) |
| `backend/src/infrastructure/external-tools-route.js` | create | `api-server.js` | Contract (Task 3) |
| `backend/src/infrastructure/api-server.js` | modify | `ct-api.mjs` | Current state + Call site (Task 3) |
| `backend/src/infrastructure/ct-api.mjs` | modify | the entrypoint | prose (Task 3) |
| `backend/__tests__/infrastructure/external-tools-route.test.js` | create | vitest | none (body by TDD) |
| `README.md` | modify | whoever reads the repo | Final text (Task 4) |
| `backend/conventions/this-repository.md` | modify | whoever writes backend code | Final text (Task 4) |

## 5. Interfaces

Consumes: nothing new. `ToolRunner` and `ExternalTool` are already in the tree and are used as
they are — `ExternalTool.run(argv, { safeToRepeat })` answering a `ProcessOutput`
(`{ code, stdout, stderr, failed }`), built by `CtApi.#talkingTo(bin, ExternalTool)`.

Produces:
- `SessionState` — the frozen vocabulary `{ READY: 'ready', MISSING: 'missing', UNKNOWN: 'unknown' }`.
- `ToolSession` — `new ToolSession({ tool, installed, state, fix })`, with `get blocks()`.
- `ToolSessions` — the port, `async all()` answering `ToolSession[]`.
- `SurveyExternalTools` — `new SurveyExternalTools({ toolSessions })`, `async execute()` answering
  a `SurveyExternalToolsResult` with `sessions` and `get ready()`.
- `ProbedToolSessions` — `new ProbedToolSessions({ clients, lookUp })`, and `static PROBES`.
- `ExternalToolsRoute` — `PATH`, `METHOD`, `handledBy(surveyExternalTools)`, `refuseOtherMethods`.

## 6. Test strategy

Outside-in, per `backend/conventions/testing.md`, run from `backend/`:

- **Task 1, application:** the query as a black box with the port doubled at the constructor. The
  domain gets no tests of its own: `ToolSession.blocks` and the `ready` rule are reached through
  the query. The mother is `ToolSessionsDouble`, with named scenarios.
- **Task 2, adapter:** cut right before the tools. `clients` is a scripted conversation per
  binary that answers by what it is asked and **raises when nobody wrote an answer**, and `lookUp`
  is a double. The assertions are the **literal argv** of each probe and the parse of a declared
  output shape, and each such test **names where its capture came from**: `gh auth status`,
  `acli jira auth status`, `gcloud auth list` and `ssh -T git@github.com` run by hand on this
  machine on 2026-09-08, transcribed into the test and never requested while the suite runs.
- **The two-causes rule does not bite here, and that is declared, not skipped.**
  `plugin/conventions/testing.md` requires an adapter's tests to tell apart the system refusing
  from the system answering something unreadable. This adapter has neither cause: it throws
  nothing, and every probe that is not conclusively `ready` is the same datum, `missing`. There is
  no structured parse that could be unreadable — the readings are an exit code, a substring and a
  blank test — so there is no second cause to tell apart. Nobody should look for it.
- **Task 3, controller:** through a listening server and `fetch`, asserting the status and the
  literal JSON body, with the use case doubled — and, on the 405, that the use case was not asked.
- **Task 4:** no tests; it is documentation. Declared here so nobody looks for them.
- **Every assertion is seen to fail for the reason its name gives**: break by hand the one thing it
  protects, run it, watch it turn red, restore it. It is not the red phase, and it bites hardest on
  `git_is_ready_when_ssh_says_it_authenticated_even_though_it_exits_1`, whose subject is one
  substring of one line.
- **A mutation sweep closes each task**, on a committed clean tree, one change at a time, and its
  **declaration travels in the commit message**: which line was mutated, whether the suite went
  red, and — if it survived — which of the two repairs was chosen, the test nobody wrote or the
  line nobody needs. Whoever judges reads that declaration; there is nothing for them to run.
- **Values are real instances, never doubles**: the mothers build actual `ToolSession`s.

No task pins the total number of tests in the suite.

## 7. Tasks

### Task 1 — The query answers a verdict per tool and one for the whole set

**Objective:** `SurveyExternalTools` answers the five sessions it is given and whether anything
blocks, with the blocking rule in the domain.

**Files:**
- Create: `backend/src/domain/value-objects/tool-session.js`
- Create: `backend/src/domain/ports/tool-sessions.js`
- Create: `backend/src/application/queries/survey-external-tools.js`
- Create: `backend/__tests__/application/survey-external-tools.test.js`

Contract (backend/src/domain/value-objects/tool-session.js and ports/tool-sessions.js):

```javascript
export const SessionState = Object.freeze({ READY: 'ready', MISSING: 'missing', UNKNOWN: 'unknown' })

export class ToolSession {
  // frozen; guards its own invariant: state must be a SessionState member, quoting what it got
  constructor({ tool, installed, state, fix })
  get blocks()   // !installed || state === SessionState.MISSING
}

// ports/tool-sessions.js
export class ToolSessions {
  async all()   // throws `${this.constructor.name} must implement all()`
}
```

Contract (backend/src/application/queries/survey-external-tools.js):

```javascript
export class SurveyExternalToolsResult {
  constructor({ sessions })   // frozen
  get ready()                 // no session blocks
}

export class SurveyExternalTools {
  constructor({ toolSessions })
  async execute()             // no Params: there is no input
}
```

**TDD:** red first — `it('nothing_blocks_when_every_session_is_ready')`, three ready sessions,
`result.ready === true`. Then the boundary of the blocking rule, one case each side:
`it('an_installed_tool_whose_session_is_unknown_does_not_block')` (`installed: true`,
`UNKNOWN`, `ready === true`) and `it('an_installed_tool_whose_session_is_missing_blocks')`
(same but `MISSING`, `ready === false`). Then
`it('a_tool_that_is_not_installed_blocks_however_ready_its_session_reads')` (`installed: false`,
`READY`, `ready === false`) and `it('the_sessions_come_back_in_the_order_the_port_gave_them')`.
Last, `it('a_state_outside_the_vocabulary_cannot_be_constructed')` — the constructor throws
quoting the value.

**Tests:** added: the six above, plus the `ToolSessionsDouble` mother with
`ToolSessionsDouble.allReady()`, `.with(sessions)` and a `raising()` that throws when asked
twice. Removed on purpose: none.

**Verification:** the vocabulary is closed, the blocking rule is pinned on both sides of its
boundary, and no tool's name reached the domain or the application.

```bash
cd backend && npx vitest run __tests__/application/survey-external-tools.test.js   # exit 0: the six cases
cd backend && test "$(grep -c 'does_not_block' __tests__/application/survey-external-tools.test.js)" -eq 1
cd backend && test -z "$(grep -rl 'auth login' src/domain src/application)"
cd backend && npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing regressed
```

### Task 2 — The adapter probes the five tools and reads what they answer

**Objective:** `ProbedToolSessions` answers one `ToolSession` per tool from a `PATH` lookup and a
read-only probe, with every binary, argv, marker and fix in one table.

**Files:**
- Create: `backend/src/infrastructure/probed-tool-sessions.js`
- Create: `backend/__tests__/infrastructure/probed-tool-sessions.test.js`

Contract (backend/src/infrastructure/probed-tool-sessions.js):

```javascript
// One row per tool, in order. `bin` is looked up in PATH, never executed; `probe` is launched.
export class ProbedToolSessions extends ToolSessions {
  static PROBES = [
    { tool: 'gh',     bin: 'gh',     probe: 'gh',   argv: ['auth', 'status'], fix: 'gh auth login' },
    { tool: 'acli',   bin: 'acli',   probe: 'acli', argv: ['jira', 'auth', 'status'],
      fix: 'acli jira auth login' },
    { tool: 'claude', bin: 'claude', probe: null,   argv: null,
      fix: 'claude, then /login — not observable from this process' },
    { tool: 'git',    bin: 'git',    probe: 'ssh',
      argv: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-T', 'git@github.com'],
      fix: 'add an SSH key to your GitHub account' },
    { tool: 'bq',     bin: 'bq',     probe: 'gcloud',
      argv: ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'],
      fix: 'gcloud auth login && gcloud auth application-default login' },
  ]
  static AUTHENTICATED = 'successfully authenticated'   // ssh -T exits 1 on success
  constructor({ clients, lookUp })   // clients: { [probe]: { run(argv, { safeToRepeat }) } }
  async all()
}
```

Reading each answer, not derivable from the table: `gh` and `acli` are `READY` when the output
did not fail; `git` when its stderr contains `AUTHENTICATED`, whatever the exit code; `bq` when the
output did not fail **and** its stdout is not blank; a row with no probe is `UNKNOWN`; anything else
is `MISSING`. `fix` is `null` exactly when `READY`. Every probe declares `safeToRepeat: true`.

**TDD:** red first — `it('every_probe_is_sent_the_literal_argv_the_table_declares')`, asserting the four
conversations and `claude` launched nothing. Then the parse, from transcripts recorded
2026-09-08: `it('git_is_ready_when_ssh_says_it_authenticated_even_though_it_exits_1')` — `code: 1`,
stderr `Hi jjponz! You've successfully authenticated, but GitHub does not provide shell access.`;
`it('bq_is_missing_when_gcloud_lists_no_active_account')` — `code: 0`, blank stdout — against
`it('bq_is_ready_when_gcloud_prints_an_active_account')`, stdout `jponzvan@mercadona.es`;
`it('claude_is_always_unknown_and_says_where_to_log_in')`;
`it('a_tool_missing_from_PATH_is_not_installed_and_is_never_probed')`;
`it('a_ready_tool_carries_no_fix')`.

**Tests:** added: the seven above, plus the `ClientsDouble` mother (`.allHappy()`,
`.saying(bin, output)`, raising if asked for an unscripted answer) and a `lookUp` double.
Removed on purpose: none.

**Verification:** the argv are literal, both readings of `ssh` and `gcloud` are told apart,
and probes are repeatable.

```bash
cd backend && npx vitest run __tests__/infrastructure/probed-tool-sessions.test.js   # exit 0: seven cases
cd backend && test "$(grep -c 'even_though_it_exits_1' __tests__/infrastructure/probed-tool-sessions.test.js)" -eq 1
cd backend && test "$(grep -c 'safeToRepeat: true' src/infrastructure/probed-tool-sessions.js)" -ge 1
cd backend && npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: no regressions
```

### Task 3 — The endpoint answers, and the entrypoint wires it

**Objective:** `GET /external-tools` answers the survey, and `ct-api.mjs` builds the adapter with
one client per probe binary.

**Files:**
- Create: `backend/src/infrastructure/external-tools-route.js`
- Modify: `backend/src/infrastructure/api-server.js`
- Modify: `backend/src/infrastructure/ct-api.mjs`
- Create: `backend/__tests__/infrastructure/external-tools-route.test.js`
- Modify: `backend/__tests__/infrastructure/api-server.test.js`

Current state (backend/src/infrastructure/api-server.js, lines 93-98):

```javascript
    app.get(
      ActivePlansRoute.PATH,
      Browsers.turnAwayForeign,
      ActivePlansRoute.handledBy(this.activePlans, this.recovery)
    )
    app.all(ActivePlansRoute.PATH, ActivePlansRoute.refuseOtherMethods)
```

Contract (backend/src/infrastructure/external-tools-route.js):

```javascript
export class ExternalToolsRoute {
  static PATH = '/external-tools'
  static METHOD = 'GET'
  static handledBy(surveyExternalTools)   // 200 { ready, tools: [{ tool, installed, session, fix }] }
  static refuseOtherMethods(request, response)   // 405, Allow: GET, code method-not-allowed
}
```

Call site (backend/src/infrastructure/api-server.js):

```javascript
// after the ActivePlansRoute pair, same shape:
app.get(ExternalToolsRoute.PATH, Browsers.turnAwayForeign, ExternalToolsRoute.handledBy(this.externalTools))
app.all(ExternalToolsRoute.PATH, ExternalToolsRoute.refuseOtherMethods)
```

`ApiServer`'s constructor gains `externalTools` beside `activePlans`, stored as
`this.externalTools`. In `ct-api.mjs`, `new ApiServer({ … })` at line 307 gains
`externalTools: new SurveyExternalTools({ toolSessions: CtApi.#toolSessions() })` (line 335), and a new
private `#toolSessions()` builds `new ProbedToolSessions({ clients, lookUp })`: `clients` is one
`CtApi.#talkingTo(bin, ExternalTool)` per distinct `probe` of `ProbedToolSessions.PROBES`, and
`lookUp` resolves a binary against `PATH` without executing it.

**TDD:** red first — `it('answers_a_row_per_tool_with_its_state_and_its_fix')` through a listening
server and `fetch`, asserting status 200 and the literal body for a doubled survey of two
sessions. Then `it('a_ready_tool_answers_a_null_fix')`;
`it('the_verdict_is_false_when_one_tool_blocks')`; and the boundary of the method:
`it('a_post_is_refused_with_405_and_allow_get_without_asking_the_use_case')`, asserting the
header, the `{ code: 'method-not-allowed' }` body **and** that the double was never asked.

**Tests:** added: the four above, plus a `SurveySpy` mother. Modified:
`backend/__tests__/infrastructure/api-server.test.js` builds `ApiServer` with the new
`externalTools` collaborator wherever it constructs one. Removed on purpose: none.

**Verification:** the endpoint answers its literal body, the 405 does not reach the use case, and
the entrypoint still boots and serves one whole request.

```bash
cd backend && npx vitest run __tests__/infrastructure/external-tools-route.test.js   # exit 0: the four cases
cd backend && test -n "$(grep -l 'ExternalToolsRoute' src/infrastructure/api-server.js)"
cd backend && test "$(grep -c 'method-not-allowed' __tests__/infrastructure/external-tools-route.test.js)" -ge 1
cd backend && npx vitest run   # exit 0: whole suite, entrypoint real-process included
```

### Task 4 — The repo says the endpoint exists and what its words mean

**Objective:** the README lists the new endpoint and `this-repository.md` declares the two terms
this slice adds to the backend's ubiquitous language.

**Files:**
- Modify: `README.md`
- Modify: `backend/conventions/this-repository.md`

Final text (README.md, line 8 — the `backend/` row, in the document's own language):

```markdown
| [`backend/`](backend/) | La API HTTP local que la interfaz consume (`POST /start-plan`, `GET /plan-events/:issue`, `POST /implement-plan`, `GET /implement-progress/:issue`, `GET /external-tools`); además barre cada minuto los clones que ha atendido y cosecha con `dispatch-check --collect` lo que dejó cada slice cuya PR ya se mergeó | No |
```

Final text (backend/conventions/this-repository.md, two rows after `Workbench` on line 42):

```markdown
| **External tool** | A binary Control Tower drives that carries a credential of its own: `gh`, `acli`, `claude`, `git`, `bq`. Which five, and what is asked of each, lives in `probed-tool-sessions.js` |
| **Tool session** | Whether that credential is usable right now: `ready`, `missing`, or `unknown` when it cannot be observed from this process. `unknown` is not a failure |
```

**TDD:** No TDD — documentation. Both claims were verified against the branch's base while writing
this plan: `README.md:8` lists four endpoints today, and `Workbench` on
`backend/conventions/this-repository.md:42` is the ubiquitous language table's last row.

**Tests:** N/A — documentation, as §6 declares.

**Verification:** the endpoint is named where the repo lists its endpoints, the terms are in the
table, and only one line of the README moved.

```bash
test "$(grep -c 'GET /external-tools' README.md)" -eq 1
test "$(grep -c 'Tool session' backend/conventions/this-repository.md)" -eq 1
test "$(git diff --numstat origin/main -- README.md | cut -f2)" -eq 1
test -z "$(git status --porcelain)"
```

## 8. Global verification

Run from the repository root, with every task committed. The last two commands need the API up:
start it in another terminal with `make run-backend` and leave it on 8787 — then read the answer
with human eyes and check that the five rows say what your machine actually is (`gh auth status`,
`acli jira auth status` and `gcloud auth list` are the three you can cross-check by hand).

```bash
cd backend && npx vitest run   # exit 0: the whole backend suite, real processes included
cd plugin && npx vitest run    # exit 0: the plugin suite is untouched by this slice
test -n "$(grep -l 'external-tools' backend/src/infrastructure/api-server.js)"
test -z "$(grep -rl 'auth login' backend/src/domain backend/src/application)"
curl -sS -m 20 -o "${TMPDIR:-/tmp}/ct-external-tools.json" http://127.0.0.1:8787/external-tools
node --input-type=module -e 'import {readFileSync} from "node:fs"; const b=JSON.parse(readFileSync(`${process.env.TMPDIR ?? "/tmp"}/ct-external-tools.json`,"utf8")); const states=["ready","missing","unknown"]; const ok = typeof b.ready==="boolean" && b.tools.length===5 && b.tools.every((t)=>states.includes(t.session) && (t.session==="ready")===(t.fix===null)); process.exit(ok?0:1)'
```

## 9. Assumptions

1. **The issue froze nothing.** #146 carries a title and a link to an empty Notion card. Its
   acceptance criteria are the request in the dispatching session, and the three forks that
   changed the shape of the work were put to the human and answered: backend-only, the five
   credential-carrying tools, one row per tool. Marked "(human's call)" in §2 and §1's out of
   scope. *Provenance: issue + the session that dispatched this plan.*
2. **`bq` is the tool; `gcloud` is its login.** The string `gcloud` appears nowhere in the tree
   today — what the code launches is `bq`. So the row is `bq`, and the probe and the fix name
   `gcloud` because that is where its credential comes from. *Provenance: own call, from the
   tree.*
3. **`gh` will read `ready` on a token with no `project` scope.** Measured on this machine on
   2026-09-08: the token carries `admin:public_key, gist, read:org, repo`, so
   `gh project view/item-add/item-list` (`ct-groom.mjs:1329,1381,1459`) would fail while this
   endpoint says `ready`. One row per tool cannot express that, and the human chose one row per
   tool knowing it. Declared debt, not a defect of this slice. *Provenance: human's call.*
4. **`git`'s probe assumes GitHub over SSH.** The whole loop's state lives in GitHub, and
   `gh auth status` reports `Git operations protocol: ssh` on this machine. A repo reached over
   HTTPS, or a git remote that is not GitHub, would read `missing` while working fine.
   *Provenance: own call, from the tree and the machine.*
5. **The probes cost a network round trip and run sequentially.** `git`'s reaches `github.com` on
   every request. The bound is not one budget: the four probes run one after another, each client
   carrying the entrypoint's 30 s cap and up to 3 retries at 2 s, so a pathological request is
   minutes, not seconds — a blip is what the retry policy is for, and a hang is what the cap is
   for, but they compose. Accepted because the endpoint is asked once, by a human, before starting
   work; the number to revisit first if that ever stops being true is the retry count, since a
   readiness probe has less use for one than a plan-starting call does. *Provenance: own call,
   corrected by the final whole-branch review, which did the arithmetic the first version of this
   assumption did not.*
6. **`unknown` does not block.** Otherwise `claude` would make `ready` permanently `false` and the
   verdict would carry no information. The repo already refuses that collapse in `ct-next.mjs`,
   which warns about the agent binary instead of failing. *Provenance: repo convention.*
7. **No `Params` for the query.** Every other use case in the tree carries one, so the shape is
   the repo's habit — but no document at this base requires it (the string `Params` appears in
   none of them), and this query takes no input: a zero-field `Params` would be a type with no
   consumer, which `plugin/conventions/simplicity.md` refuses. The Result stays, because it
   carries the `ready` rule. *Provenance: own call, against the habit, on a rule.*
8. **The README row stays in Spanish.** That document is Spanish; only the endpoint is added, so
   the rest of the line is byte-identical. The two rows added to the conventions document are
   English, like every other row of that table. *Provenance: own call.*
9. **A `fix` presupposes the binaries.** Two states carry a login command that cannot run as
   written: a tool absent from `PATH` (`installed: false`, and the `fix` still names its login),
   and a tool whose *probe* binary is absent — `bq` present with no `gcloud` reads
   `{ installed: true, session: 'missing', fix: 'gcloud auth login && …' }`, because `ToolRunner`
   turns an ENOENT into an exit code like any other failure. The row is still true about the
   credential, and `installed` answers the other half; declared on the `Tool session` row of
   `backend/conventions/this-repository.md`. The alternative — reading `unknown` when the probe
   binary cannot be found, since `unknown` is exactly "we could not look" and does not block — is
   the better answer and was left out of this slice deliberately: it is a behaviour change arriving
   after the branch was reviewed. *Provenance: final whole-branch review; deferred by own call.*
10. **The reading of a probe dispatches on the probe binary's name with a fall-through.**
   `gh` and `acli` fall through to "exit 0 ⇒ ready", and only `ssh` and `gcloud` are named.
   `plugin/conventions/defects.md` calls a catch-all over a closed vocabulary an antipattern, and
   this backend owns a `Projection` built so an unmapped member raises. A sixth row would inherit
   the exit-code reading silently. Carried, not fixed: §7 closed this shape on purpose ("not
   derivable from the table"), and a reader per row is a design change worth its own slice rather
   than a late edit to a reviewed branch. *Provenance: final whole-branch review; carried by own
   call.*
