# The plan agent is invoked, not typed at — a second adapter of `PlanAgents` on `claude -p`

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, §2 of this plan and `backend/conventions/` win.

**Issue:** [#139](https://github.com/mercadona/control-tower/issues/139) — *move from claude to
being able to choose whichever model we want (we start with `claude -p`)*.

**Branch:** `feat/plan-headless-claude-p`, cut from `main` at e6485e7. Every `Current state`
block below reads verbatim at that base.

**Tech stack:** Node 24 ESM, vitest 4. No new dependency.

## 1. Context and goal

Today the backend invokes nobody. `CmuxPlanAgents` opens a cmux window, writes a launcher script
to disk, types a line into it and waits for a sentinel file to say the shell resolved `claude`
(`cmux-plan-agents.js:78-96`); `resume`, `review` and `fix` then send keystrokes into that same
window (`cmux-plan-agents.js:98-114`). Three consequences the issue names: there is no invocation
to put `--model` in — the model is the constant `CmuxPlanAgents.MODEL`; nothing about the call is
measurable, because the call is not ours; and the identity of a plan in flight is a cmux handle,
so `WorktreePlans` has to ask cmux which windows exist (`worktree-plans.js:24`).

The seam this needs already exists. `PlanAgents` (`domain/ports/plan-agents.js`) has four methods,
`CmuxPlanAgents` is its only implementation, and the whole graph is assembled at one place,
`ct-api.mjs:309`. Nothing in `domain/` or `application/` names cmux: `StartPlan` only knows
`planAgents.launch(briefing)` (`start-plan.js:94`). And the endpoints are already fire-and-forget
— `PlanState` comes from `dispatch-check --check-plan` plus `git status`
(`plan-contract-progress.js:24`), never from the session — so an adapter that answers before the
model has finished honours the contract the frontend already polls.

This slice adds the second implementation of that port, `HeadlessPlanAgents`, which invokes
`claude -p` per step. It is **option A of the issue's phase 2 and 3 ordering**: the four errands
of `PlanAgentBrief` travel unchanged, so `resume` still hands the model the loop it drives itself
by asking `ct-step`. What this slice buys is the invocation — a model that is an argument, an
envelope on disk per call, and cmux out of the plan's path — not determinism, which is phase 4.

Four properties of the CLI were measured on 2026-09-09 against the installed `claude` and every
contract below rests on them: `--session-id <uuid>` imposes the conversation's id, so the adapter
mints the identity instead of parsing it back; `--resume <id>` in a **new process** recovers that
conversation; `--output-format stream-json --verbose` ends in a `result` event carrying
`total_cost_usd`, `num_turns`, `usage`, `modelUsage` and `duration_ms`; and a `spawn` with
`detached: true` plus `unref()` and its output on a **file descriptor** is reparented to pid 1 and
finishes writing that envelope with the parent long dead, while `spawn`'s own `timeout` still
kills it as long as the parent lives.

### Desired end state

- `PlanAgents` has two implementations. `CT_PLAN_TRANSPORT` picks one at the entrypoint;
  unset, or `cmux`, and the behaviour and the graph are exactly today's.
- With `CT_PLAN_TRANSPORT=headless`, `POST /start-plan` writes a plan **without opening any
  window**: `claude -p` runs in the prepared worktree and the agent it answers with is a UUID.
- `CT_PLAN_MODEL` names the model of every headless call; unset, it is `opus` — today's constant.
- Every headless call leaves a directory under the state root holding three files: `call.json`
  (the step, the issue, the repository, the model, the argv and the pid — the data that is **not**
  in the stream), `stream.ndjson` (claude's events, byte for byte and untrimmed) and `stderr.log`.
- The step of a call is one of `write-plan`, `review-plan`, `implement`, `fix-pull-request`, and
  it is written at the source because it is the one datum no reader can recover afterwards.
- A headless call outlives a restart of the backend, and its envelope still lands on disk.
- No headless call is made without a cap that arrives through its constructor.
- `resume`, `review` and `fix` continue the same conversation with `--resume`, each one its own
  call directory: the grain of the record is the invocation, not the plan.
- The four errands of `PlanAgentBrief` are untouched, and no module of `backend/src` other than
  `cmux-plan-agents.js` names a cmux window.

### Out of scope

- **The `harness_calls` table in BigQuery.** The envelope lands on disk untrimmed and
  self-described, which is what makes the call measurable; loading it needs a dataset with write
  permissions that does not exist yet — the harvest's own loader has never run for real either
  (`docs/medicion-slices.md`). Loading a table nobody can write to is not deliverable, so the
  loader and the sweep that would feed it wait for that dataset.
- **Recovery of a headless plan after a restart.** `WorktreePlans` reconstructs a plan in flight
  from cmux windows (`worktree-plans.js:24`); with the headless transport a restart leaves that
  plan without its agent. Phase 1 of the issue owns recovery and already has its own plan; this
  slice must not break it, and §9.4 states the consequence.
- **Who conducts the implementation.** `resume` keeps today's errand, `ct-step` included. Phase 4.
- **`cmux` itself.** `CmuxPlanAgents` is not touched, not deprecated and stays the default.
- **The plugin.** Not one line. `PlanAgentBrief`, `ct-step`, `dispatch-check` unchanged.
- **The frontend.** `/implement-plan` goes on receiving `agent`; its well-formedness rule already
  admits a UUID (`implement-plan-route.js:61-63`), so no contract moves.
- **Aggregates, money budgets and comparing variants**, per the issue's protected list.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Transport of the new adapter | `claude -p <errand> --output-format stream-json --verbose` |
| Why `stream-json` and not `json` | it is the only format whose events arrive while the call runs, and its final `result` carries the same envelope |
| The `agent` datum | a UUID the adapter mints with `randomUUID()` and imposes with `--session-id` |
| Continuing a conversation | `--resume <agent>`, a new process per call; never `--fork-session` |
| Session persistence | on: `--no-session-persistence` is never passed, because `--resume` needs it |
| Permission mode | `--permission-mode bypassPermissions`: nobody is at the other end to answer a prompt, and the errand has to run `git`, `gh` and `node dispatch-check` |
| Plugin directory | `--plugin-dir <plugin root>` is mandatory: the errand names the skill `control-tower-loop:writing-plans-prescriptive` (`plan-agent-brief.js:32`) |
| Survival | `detached: true`, output on file descriptors, `unref()` |
| The cap | a timer of the adapter's own that signals the **process group** (`process.kill(-pid, 'SIGTERM')`), arriving through the constructor with no default. Never `spawn`'s `timeout`: measured to leave the tools `claude` launched orphaned |
| A failed spawn | `child.on('error', …)` is registered before `child.pid` is read: measured, an unhandled `'error'` event kills the API and no `try`/`catch` sees it |
| Where a call's record lives | `<state root>/harness/<agent>/<step>-<startedAt>/` |
| Where a continuation runs | the worktree `launch` recorded in `<state root>/harness/<agent>/conversation.json`. The port is **not** changed to carry it |
| Default transport | `cmux`. With `CT_PLAN_TRANSPORT` unset nothing changes |
| Default model | `opus`, today's `CmuxPlanAgents.MODEL` |
| A malformed `CT_PLAN_TRANSPORT` or `CT_PLAN_MODEL` | refuses the invocation, like `CT_HARVEST_BQ_TABLE` already does |
| The errands | unchanged, all four |

## 3. Reference patterns

Files to imitate: `backend/src/infrastructure/cmux-plan-agents.js` (the port's other
implementation: static argv builders, typed failures, the constructor's named collaborators);
`backend/src/infrastructure/gh-plan-issues.js` (a boundary model sharing its adapter's file, the
shape `ClaudeStream` copies); `backend/src/infrastructure/tool-runner.js` (a call to a binary with
its budget); `backend/src/infrastructure/probed-tool-sessions.js` (a table of constants as the one
place a tool's argv lives); `backend/src/infrastructure/invocation.js` (an environment variable
read, validated and refused); `backend/__tests__/infrastructure/tool-runner-real-process.test.js`
(a real-process test with its marker and its `afterEach`);
`backend/__tests__/infrastructure/cmux-plan-agents.test.js` (an adapter test that asserts the
literal argv against a scripted double).

Rules to obey: `backend/conventions/this-repository.md`, `plugin/conventions/style.md`,
`plugin/conventions/architecture.md`, `plugin/conventions/boundaries.md`,
`plugin/conventions/domain.md`, `plugin/conventions/defects.md`,
`plugin/conventions/testing.md`, `plugin/conventions/simplicity.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/infrastructure/detached-run.js` | create | `HeadlessPlanAgents`, `ct-api.mjs` | Contract |
| `backend/__tests__/infrastructure/detached-run-real-process.test.js` | create | the suite | none (body by TDD) |
| `backend/src/infrastructure/headless-plan-agents.js` | create | `ct-api.mjs` | Contract |
| `backend/__tests__/infrastructure/headless-plan-agents.test.js` | create | the suite | none (body by TDD) |
| `backend/src/domain/exceptions.js` | modify | the adapter, the route | Current state |
| `backend/src/infrastructure/invocation.js` | modify | `ct-api.mjs` | Current state, Contract |
| `backend/__tests__/infrastructure/invocation.test.js` | modify | the suite | none (body by TDD) |
| `backend/src/infrastructure/ct-api.mjs` | modify | the entrypoint | Call site |
| `backend/__tests__/infrastructure/ct-api-real-process.test.js` | modify | the suite | none (body by TDD) |
| `backend/conventions/this-repository.md` | modify | every brief | Final text |

## 5. Interfaces

Consumes: `PlanAgents` — `launch(briefing) => Promise<agent>`,
`resume({ agent, issue, repository })`, `review({ agent, issue, repository, changes })`,
`fix({ agent, issue, repository, changes })`, from `backend/src/domain/ports/plan-agents.js`.
And `PlanAgentBrief` — `errandFor({ issue, repository })`,
`implementationErrandFor({ issueNumber, repository })`,
`reviewErrandFor({ issueNumber, repository, changes })`,
`fixErrandFor({ issueNumber, repository, changes })`, all four unchanged.

Produces: `DetachedRun` with `start({ argv, cwd, out, err }) => StartedRun` and `StartedRun.pid`.
`HeadlessPlanAgents`, the second implementation of `PlanAgents`, with the static
`HeadlessPlanAgents.TRANSPORT` naming it in `CT_PLAN_TRANSPORT`. `HarnessStep`, the closed
vocabulary of a call's step. `Invocation.transport` and `Invocation.model`.

## 6. Test strategy

Outside-in, and the application layer needs nothing: this slice adds no use case and changes no
port, so `start-plan.test.js` and `implement-plan.test.js` are already the black-box tests of
what calls this adapter, and they stay untouched. What is new is measured in two places.

`DetachedRun` is the one adapter that **is** the call — once the process is doubled there is
nothing left to assert — so it runs the real thing, with the
`-real-process.test.js` marker and an `afterEach` that kills any survivor.

`HeadlessPlanAgents` is cut right before `DetachedRun`: its double records what it was asked and
answers a pid, and the assertion is on the **literal argv** and on the files left on disk. It has
**one** failure cause, not the two an adapter usually has: the call refusing to start. Nothing
here parses claude's stream — `--session-id` imposes the identity, so the adapter opens the
descriptor and never reads it back — so there is no unreadable answer to tell apart, and a test
pinning the stream's shape would pin this machine's hooks instead: measured on 2026-09-09, the
same command answered 16 events whose first four were `hook_started`.

`Invocation` is a pure reader and already has its own test; the two variables go in there.

**The entrypoint is measured, not grepped.** Both branches of the graph are assembled by a real
process the suite starts (`ct-api-real-process.test.js`), because a collaborator that never
reaches its constructor is exactly the defect PR #167 shipped in this same issue and no unit test
caught. Counting an identifier in `ct-api.mjs` is not a substitute and this plan does not use one.

Run from `backend/`, per `backend/conventions/this-repository.md`: the fast subset is
`npx vitest run --exclude '**/*-real-process.test.js'` and the whole suite before handing over.

## 7. Tasks

### Task 1 — A call that outlives the process that started it

**Objective:** `DetachedRun` launches a binary whose output goes to files, which outlives its
caller, and whose group the cap kills if it runs past it.

**Files:**
- Create: `backend/src/infrastructure/detached-run.js`
- Create: `backend/__tests__/infrastructure/detached-run-real-process.test.js`

Contract (backend/src/infrastructure/detached-run.js):

```javascript
export class StartedRun {
  constructor({ pid })   // frozen
}

export class DetachedRun {
  static SIGNAL = 'SIGTERM'
  static APPEND = 'a'

  constructor({ bin, budgetMs, env })   // no default on the cap: it is the caller's

  start({ argv, cwd, out, err })   // StartedRun; `out` and `err` are absolute paths
}
```

`start` opens `out` and `err` with `DetachedRun.APPEND` and spawns with `detached: true` and
`stdio: ['ignore', <out fd>, <err fd>]`. Two of its lines are §2's decisions, both measured fatal:

- It registers `child.on('error', …)` **before** reading `child.pid` — an unhandled `'error'`
  event kills the API and no `try`/`catch` sees it — and the listener appends the failure to
  `err`, that call's diagnostic channel. Then a `child.pid` of `undefined` raises
  `PlanAgentNotLaunched` quoting `bin`.
- The cap is a timer of `budgetMs` calling `process.kill(-pid, DetachedRun.SIGNAL)` — the whole
  group, which `detached: true` created — `unref()`ed so it never holds the API open and cleared
  on the child's `exit`. `spawn`'s own `timeout` is never passed.

Then `unref()` on the child; `start` answers first.

**TDD:** red first — `it('what_the_call_prints_lands_in_the_file_the_caller_named')`, polled until
the file holds the marker its child writes. Then
`it('the_call_gets_a_process_group_of_its_own_so_the_cap_can_reach_what_it_launched')` — the pgid
from `ps -o pgid= -p <pid>` equals its own pid. Then the cap, both sides of its boundary:
`it('the_cap_kills_the_whole_group_so_a_tool_the_call_launched_is_not_left_orphaned')`, `budgetMs`
250 against a child that spawns a grandchild sleeping 5.000 ms, **both** dead when polled; and the
other side in **two** cases, because an exit code in a file says nothing about whether the cap
fired — `it('a_call_that_finishes_inside_its_cap_leaves_its_own_exit_code_in_out')` and
`it('a_call_that_finished_is_never_signalled_once_its_cap_comes_round')`, which spies
`process.kill`. Last `it('a_binary_that_is_not_installed_raises_without_taking_the_api_down_with_it')`:
the raise, and the suite alive past the tick `'error'` fires on.

**Tests:** added: the six above, plus the `Child` test type hanging their helpers and an
`afterEach` that reaps every process a case started. Removed: none.

**Verification:** each measured-fatal line has its own case, and no `spawn` option does the cap's
job.

```bash
cd backend && npx vitest run __tests__/infrastructure/detached-run-real-process.test.js   # exit 0: the six cases
cd backend && test "$(grep -c "on('error'" src/infrastructure/detached-run.js)" -eq 1
cd backend && test "$(grep -c 'process.kill(-' src/infrastructure/detached-run.js)" -eq 1
cd backend && test -z "$(grep -l 'timeout:' src/infrastructure/detached-run.js)"
cd backend && test -z "$(grep -l 'budgetMs = [0-9]' src/infrastructure/detached-run.js)"
cd backend && test "$(grep -c 'not_left_orphaned' __tests__/infrastructure/detached-run-real-process.test.js)" -eq 1
cd backend && npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing regressed
```

### Task 2 — The plan is written by an invocation, and the call leaves its record

**Objective:** `HeadlessPlanAgents.launch` mints the conversation's id, leaves the call's record
under the state root and invokes `claude -p` in the prepared worktree, answering that id at once.

**Files:**
- Create: `backend/src/infrastructure/headless-plan-agents.js`
- Create: `backend/__tests__/infrastructure/headless-plan-agents.test.js`
- Modify: `backend/src/domain/exceptions.js`

Contract (backend/src/infrastructure/headless-plan-agents.js):

```javascript
export const HarnessStep = Object.freeze({
  WRITE_PLAN: 'write-plan', REVIEW_PLAN: 'review-plan',
  IMPLEMENT: 'implement', FIX_PULL_REQUEST: 'fix-pull-request',
})

export class HarnessCall {          // what is NOT in claude's stream
  static CALL_FILE = 'call.json'
  static STREAM_FILE = 'stream.ndjson'
  static ERROR_FILE = 'stderr.log'
  constructor({ step, agent, issue, repository, model, argv, pid, startedAt })
  get json()                        // what CALL_FILE holds, keys in this order
}

export class HeadlessPlanAgents extends PlanAgents {
  static TRANSPORT = 'headless'
  static BIN = 'claude'
  static PRINT = '-p'
  static FORMAT = ['--output-format', 'stream-json', '--verbose']
  static PERMISSION = ['--permission-mode', 'bypassPermissions']

  static argvFor({ errand, model, pluginRoot, agent, resuming })
  constructor({ start, makeDirectory, write, mint, clock, brief, runsIn, model, pluginRoot })
  async launch(briefing)            // the agent: a UUID
}
```

`argvFor` answers `[PRINT, errand, ...FORMAT, ...PERMISSION, '--model', model, '--plugin-dir',
pluginRoot]`, then `['--session-id', agent]` or, when `resuming`, `['--resume', agent]`. `launch`
mints the agent, composes `${runsIn}/${agent}/${HarnessStep.WRITE_PLAN}-${clock()}`, **makes that
directory** — `DetachedRun` opens its paths and fails without it — starts the call with `cwd` at
`briefing.located.path`, and only then writes `HarnessCall.CALL_FILE`, which carries the pid just
answered.

**TDD:** red first — `it('the_plan_is_asked_for_with_the_errand_the_brief_composed_and_the_model_it_was_given')`,
asserting the whole argv literally, `--model` included. Then
`it('the_conversation_carries_the_id_the_adapter_imposed_and_not_one_read_back')` — the answer is
the minted id, and the argv holds `--session-id` with it and no `--resume`. Then
`it('the_call_leaves_its_step_and_its_model_on_disk_because_no_reader_can_recover_them_later')`,
reading `call.json` back for `step === 'write-plan'`;
`it('the_stream_of_the_call_and_its_diagnosis_are_two_different_files')`;
`it('the_plan_is_written_in_the_worktree_that_was_prepared_and_not_where_the_api_runs')`. Last the
failure cause: `it('a_call_that_cannot_be_started_refuses_without_leaving_a_conversation_behind')`.

**Tests:** added: the six above, plus the `HeadlessAgent` test type (`.launching()`, `.refusing()`,
`.captured()`) and a `BriefDouble`. Removed: none.

**Verification:** the argv is asserted whole, the step reaches disk, and the session is persisted.

```bash
cd backend && npx vitest run __tests__/infrastructure/headless-plan-agents.test.js   # exit 0: the six cases
cd backend && test "$(grep -c 'session-id' src/infrastructure/headless-plan-agents.js)" -eq 1
cd backend && test -z "$(grep -l 'no-session-persistence' src/infrastructure/headless-plan-agents.js)"
cd backend && npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing regressed
```

### Task 3 — A conversation records the worktree it runs in

**Objective:** `launch` writes down where its conversation works, because the port hands the three
continuations no worktree and a headless call cannot do without one.

**Files:**
- Modify: `backend/src/infrastructure/headless-plan-agents.js`
- Modify: `backend/__tests__/infrastructure/headless-plan-agents.test.js`

Contract (backend/src/infrastructure/headless-plan-agents.js):

```javascript
export class HeadlessPlanAgents extends PlanAgents {
  static CONVERSATION_FILE = 'conversation.json'   // { worktree }, written by launch

  async #worktreeOf(agent)   // raises PlanAgentNotResumed naming the agent when unrecorded,
                             // reached from a test only in Task 4, which gives it its callers
}
```

`plan-agents.js:8-23` hands `resume`, `review` and `fix` only `{ agent, issue, repository }`:
typing into a cmux window needed no worktree, the window was already in it. A headless call needs
a `cwd`, and getting it wrong runs `ct-step`, `git` and every edit where the API runs. `launch` is
always a conversation's first call and the only method that gets `briefing.located`, so it writes
`${runsIn}/${agent}/${CONVERSATION_FILE}` holding `{ worktree: briefing.located.path }`.
`#worktreeOf` reads it back. The port does not change; §9.8 says why.

**TDD:** red first — `it('a_conversation_records_the_worktree_its_calls_have_to_run_in')`: `launch`
against a named worktree, then read `conversation.json` back and assert its `worktree` is that
path. Then `it('two_conversations_do_not_share_the_worktree_they_recorded')` — two `launch`es on
different worktrees, each file its own. The refusal `#worktreeOf` owes is **Task 4's** case, not
this one's: a `#`-private method has no caller a test can reach until `resume` exists, and
`testing.md` reaches an internal through the use case that carries it, never directly.

**Tests:** added: the two above. Removed: none.

**Verification:** the worktree is recorded once per conversation and an unrecorded one refuses.

```bash
cd backend && npx vitest run __tests__/infrastructure/headless-plan-agents.test.js   # exit 0: the nine cases
cd backend && test "$(grep -c 'conversation.json' src/infrastructure/headless-plan-agents.js)" -eq 1
cd backend && test "$(grep -c 'never_recorded' __tests__/infrastructure/headless-plan-agents.test.js)" -eq 1
cd backend && npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing regressed
```

### Task 4 — The go, the review and the fixes continue the same conversation

**Objective:** `resume`, `review` and `fix` invoke `claude -p --resume <agent>` with today's
errands, in the worktree Task 3 recorded, each leaving its own record.

**Files:**
- Modify: `backend/src/infrastructure/headless-plan-agents.js`
- Modify: `backend/__tests__/infrastructure/headless-plan-agents.test.js`

Contract (backend/src/infrastructure/headless-plan-agents.js):

```javascript
export class HeadlessPlanAgents extends PlanAgents {
  async resume({ agent, issue, repository })            // HarnessStep.IMPLEMENT
  async review({ agent, issue, repository, changes })    // HarnessStep.REVIEW_PLAN
  async fix({ agent, issue, repository, changes })       // HarnessStep.FIX_PULL_REQUEST
}
```

The three answer nothing, as the port declares. Each takes its `cwd` from `#worktreeOf(agent)`,
composes its directory the way `launch` does — `${runsIn}/${agent}/${step}-${clock()}`, so the
grain of the record is the invocation — and takes its errand, unchanged, from the brief method
that already exists for it, with `resuming` true. A call that cannot be started raises
`PlanAgentNotResumed` too, the family's other cause
(`backend/conventions/this-repository.md`, *Naming an exception family*).

**TDD:** red first — `it('the_go_hands_the_implementation_errand_to_the_conversation_that_wrote_the_plan')`,
the whole argv with `--resume <agent>` and no `--session-id`, and the errand the brief's
`implementationErrandFor` returns. Then
`it('the_implementation_runs_in_the_worktree_where_the_plan_was_written_and_not_where_the_api_runs')`
— `cwd` is the recorded path and not `process.cwd()`. Then
`it('a_second_call_on_one_conversation_leaves_a_second_record_beside_the_first')` — two directories
under the same agent, steps `write-plan` and `implement`. Then
`it('the_changes_a_person_asked_for_travel_in_the_errand_of_the_review_call')` and
`it('the_fixes_of_a_pull_request_are_asked_for_with_the_step_that_says_so')`, asserting
`step === 'fix-pull-request'` on disk. Last, now that `resume` reaches it,
`it('a_conversation_whose_worktree_was_never_recorded_refuses_instead_of_guessing_one')` —
`PlanAgentNotResumed`, its message naming the agent.

**Tests:** added: the six above. Removed: none, and `worktreeOf` becomes `#worktreeOf` here.

**Verification:** the three resume instead of starting, and none can run outside the worktree.

```bash
cd backend && npx vitest run __tests__/infrastructure/headless-plan-agents.test.js   # exit 0: the fourteen cases
cd backend && test "$(grep -c 'not_where_the_api_runs' __tests__/infrastructure/headless-plan-agents.test.js)" -eq 2
cd backend && test "$(grep -c "'fix-pull-request'" src/infrastructure/headless-plan-agents.js)" -eq 1
cd backend && npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing regressed
```

### Task 5 — The transport and the model are read from the environment, or refused

**Objective:** `Invocation` answers which transport and which model were asked for, and refuses an
invocation that names either of them malformed.

**Files:**
- Modify: `backend/src/infrastructure/invocation.js`
- Modify: `backend/__tests__/infrastructure/invocation.test.js`

Current state (backend/src/infrastructure/invocation.js, lines 19-25):

```javascript
  static CLAIM_PREFIX = 'CT_CLAIM_'
  static CHILD_TIMEOUT_VARIABLE = 'CT_CLAIM_CHILD_TIMEOUT_MS'
  static HARVEST_TABLE_VARIABLE = 'CT_HARVEST_BQ_TABLE'
  static HARVEST_TABLE_SHAPE = 'project:dataset.table'
  static #MAX_PORT = 65535
  static #WHOLE_NUMBER = /^\d+$/
  static #HARVEST_TABLE = /^[A-Za-z0-9][A-Za-z0-9-]*:[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/
```

Contract (backend/src/infrastructure/invocation.js):

```javascript
export const InvocationOutcome = Object.freeze({
  // the four that are already there, plus:
  MALFORMED_TRANSPORT: 'malformed-transport',
  MALFORMED_MODEL: 'malformed-model',
})

export class Invocation {
  static TRANSPORT_VARIABLE = 'CT_PLAN_TRANSPORT'
  static MODEL_VARIABLE = 'CT_PLAN_MODEL'
  static DEFAULT_MODEL = 'opus'
  static #MODEL = /^[A-Za-z0-9][A-Za-z0-9.-]*$/

  get transport()   // CmuxPlanAgents.TRANSPORT or HeadlessPlanAgents.TRANSPORT
  get model()
}
```

`CmuxPlanAgents` gains `static TRANSPORT = 'cmux'` so neither name is written twice, and both
reach `Invocation` as data. An unset or empty `CT_PLAN_TRANSPORT` answers `cmux`; an unset or
empty `CT_PLAN_MODEL` answers `DEFAULT_MODEL`. A value outside the two transports, or a model
that fails `#MODEL`, refuses with its outcome and a reason quoting what it got — the shape
`MALFORMED_HARVEST_TABLE` already uses (`invocation.js:118-123`).

**TDD:** red first — `it('an_environment_that_names_no_transport_asks_for_the_one_that_types_into_a_window')`,
`transport === 'cmux'`. Then the boundary on both sides:
`it('the_headless_transport_is_asked_for_by_its_name')` and
`it('a_transport_that_is_neither_of_the_two_refuses_the_invocation_quoting_what_it_got')`,
asserting the reason contains the rejected value. Then
`it('an_environment_that_names_no_model_asks_for_the_one_the_window_used_to_type')`
(`model === 'opus'`), `it('the_model_of_every_headless_call_comes_from_the_environment')`, and
`it('a_model_whose_name_could_become_another_argument_refuses_the_invocation')` — a value with a
space and one starting with `-`.

**Tests:** added: the six above. Removed: none.

**Verification:** the two defaults are today's behaviour, both refusals quote their input, and
neither transport name is spelled twice in the tree.

```bash
cd backend && npx vitest run __tests__/infrastructure/invocation.test.js   # exit 0: its cases and the six new ones
cd backend && test "$(grep -c "'headless'" src/infrastructure/headless-plan-agents.js)" -eq 1
cd backend && test "$(grep -c "'cmux'" src/infrastructure/cmux-plan-agents.js)" -eq 2
cd backend && test -z "$(grep -l "'headless'" src/infrastructure/invocation.js)"
cd backend && npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing regressed
```

### Task 6 — The entrypoint picks the adapter, and the repository says what a harness call is

**Objective:** `ct-api.mjs` assembles one adapter or the other from `Invocation`, and
`this-repository.md` declares the slice's vocabulary.

**Files:**
- Modify: `backend/src/infrastructure/ct-api.mjs`
- Modify: `backend/conventions/this-repository.md`

Call site (backend/src/infrastructure/ct-api.mjs):

```javascript
// before, at line 309:
const planAgents = new CmuxPlanAgents({ run: CtApi.#tool(CmuxPlanAgents.BIN), /* … */ })

// after: one private static per adapter, chosen by what was asked for
const planAgents = asked.transport === HeadlessPlanAgents.TRANSPORT
  ? CtApi.#headlessAgents(asked.model)
  : CtApi.#cmuxAgents()
```

`#headlessAgents` builds `new HeadlessPlanAgents({ start: new DetachedRun({ bin:
HeadlessPlanAgents.BIN, budgetMs: CtApi.#PLAN_CALL_TIMEOUT_MS, env: environment }),
makeDirectory: Disk.makeDirectory, write: Disk.atomicWrite, read: Disk.read, mint: randomUUID,
clock: Date.now, brief: <the same PlanAgentBrief
`#cmuxAgents` builds today>, runsIn: join(asked.stateRoot, 'harness'), model, pluginRoot:
PluginTree.root() })`. `#PLAN_CALL_TIMEOUT_MS` is new beside the three at `ct-api.mjs:142-144`: 60 minutes.
`PluginTree.#root()` is private (`ct-api.mjs:61`) — make it public, its readers unchanged.
`Disk` gains `makeDirectory`.

Final text (backend/conventions/this-repository.md):

```markdown
| **Plan agent** | Whoever writes the plan for a story; a Claude reached one of two ways — typed at in a cmux tab, or invoked per step with `claude -p` (`CT_PLAN_TRANSPORT`) |
| **Harness call** | One invocation of the plan agent: its step, its model, its argv and the stream of events it wrote. It lives in its own directory under the state root and outlives the backend that started it |
| **Step of a call** | Which errand that invocation carried — `write-plan`, `review-plan`, `implement`, `fix-pull-request`. The one datum no reader recovers afterwards, so it is written at the source |
```

The `Plan agent` row **replaces** `this-repository.md:31`; the other two are new. Nothing else in
that document changes.

**TDD:** red first — `it('the_entrypoint_assembles_the_headless_transport_and_listens')` in
`ct-api-real-process.test.js`, starting the entrypoint with `CT_PLAN_TRANSPORT=headless` and
asserting it prints its port and is still up when asked. **Not optional, and no grep replaces
it**: today's cases start the default transport, so the headless branch would never be assembled
while the suite runs — §6 carries the precedent. Then
`it('the_entrypoint_asked_for_no_transport_still_assembles_the_one_that_types_into_a_window')`.

**Tests:** added: the two above, reusing the entrypoint helper that file already has. Removed:
none.

**Verification:** both branches are assembled by a process the suite starts, and the vocabulary
rows are in the document.

```bash
cd backend && npx vitest run __tests__/infrastructure/ct-api-real-process.test.js   # exit 0: both transports assemble
cd backend && test "$(grep -c 'CT_PLAN_TRANSPORT' __tests__/infrastructure/ct-api-real-process.test.js)" -ge 1
cd backend && test "$(grep -c 'PLAN_CALL_TIMEOUT_MS' src/infrastructure/ct-api.mjs)" -eq 2
cd backend && test "$(grep -c 'Harness call' conventions/this-repository.md)" -eq 1
cd backend && test -z "$(grep 'a Claude in a cmux tab' conventions/this-repository.md)"
cd backend && npx vitest run   # exit 0: the whole suite, real processes included
```

## 8. Global verification

The suite proves the pieces; what it cannot prove is that a real `claude -p` writes a real plan
with no window. That end-to-end is run by hand, once, and it is the acceptance criterion of the
issue's phase 2: start the backend with `CT_PLAN_TRANSPORT=headless` and `CT_PLAN_MODEL=opus`,
`POST /start-plan` for a repository with a plan issue, and watch three things with human eyes —
no cmux window opens, `stream.ndjson` grows under
`~/.claude/control-tower/harness/<uuid>/write-plan-*/`, and the plan lands committed and
published on the issue. Then read the last line of that stream: it is the `result` event, and
`total_cost_usd`, `num_turns` and `modelUsage` are the metrics this slice existed to make
possible. Kill the backend mid-run first and confirm the file goes on growing.

The predicates below are what a program can score.

```bash
cd backend && npx vitest run   # exit 0: the whole suite, real-process tests included
cd backend && test -z "$(grep -rl 'cmux' src/infrastructure/headless-plan-agents.js src/infrastructure/detached-run.js)"
cd backend && npx vitest run __tests__/infrastructure/no-window-titles-parsed.test.js   # exit 0: one module names a window
cd backend && test "$(grep -rc 'plugin/scripts' src/infrastructure/headless-plan-agents.js)" -eq 0
cd backend && test -z "$(git status --porcelain)"
node plugin/scripts/dispatch-check.mjs 139 --repo mercadona/control-tower --check-plan   # exit 0: the plan is contract-valid
```

## 9. Assumptions

1. **The four CLI properties the contracts rest on were measured, not assumed** (2026-09-09,
   installed `claude`): `--session-id` imposes the id and the envelope answers with it;
   `--resume` in a new process recovered a word from the previous call; the `result` event of
   `stream-json` carries `total_cost_usd`, `num_turns`, `usage`, `modelUsage` and `duration_ms`;
   and a `detached` + `unref()` spawn with its output on a file descriptor was reparented to pid 1
   and its `timeout` still killed a child while the parent lived. Provenance: own call.
2. **The cap is enforced only while the backend lives.** The timer that signals the group lives in
   the parent, so a call that survives a restart survives without its cap. Accepted here: the
   repair is the sweep that the BigQuery slice brings, which reads every call directory and can
   kill a run past its deadline. Own call, declared rather than hidden.
3. **`bypassPermissions` is a real escalation over today.** In cmux a person is beside the
   session and a prompt can be answered; headless there is nobody, and the errand has to run
   `git`, `gh` and `node dispatch-check`, so anything less denies them and the call fails. The
   call runs with `cwd` at the prepared worktree. Own call; it needs a human's nod, and §2 records
   it as closed so the implementer does not relitigate it.
4. **A headless plan in flight is not recovered after a restart.** `WorktreePlans` asks cmux which
   windows exist, so with this transport a restart leaves the plan without its `agent` and
   `/implement-plan` cannot be given one. The conversation itself is not lost — it is on disk and
   `--resume` reaches it — only the backend's knowledge of it. Phase 1 of the issue owns recovery
   and has its own plan; that is why the call directory is named by the agent. Provenance: issue.
5. **`step` is written at the source and the rest of the envelope is not copied.** The issue's
   decision 5 says `step` is the only datum that cannot be recovered in SQL, so `call.json` holds
   it and the stream stays byte for byte as claude wrote it. Provenance: issue.
6. **`--max-turns` does not exist in the installed CLI**, so the only caps available were money
   (excluded by the issue's decision 3) and the process. Hence the process cap. Own call.
7. **The four errands are not touched**, so `resume` still tells the model to drive itself with
   `ct-step`. This is option A, chosen in the session that dispatched this plan over driving the
   implementation from the backend. Provenance: the dispatching session.
8. **The worktree of a continuation is remembered on disk, not added to the port.** The port hands
   `resume`, `review` and `fix` no worktree, and a headless call needs a `cwd`. Adding `located` to
   those three methods is arguably the tidier model, but it changes the port, `CmuxPlanAgents`, the
   three use cases that call them and their tests — which is what this slice set out not to touch.
   `launch` already knows the worktree and is always a conversation's first call, so it records it
   and the continuations read it. The failure mode of the alternative is not symmetric: a missing
   `cwd` runs `git` and every edit in the wrong tree, whereas a missing note refuses. Own call;
   it is reversible in phase 4, when the port changes anyway.
