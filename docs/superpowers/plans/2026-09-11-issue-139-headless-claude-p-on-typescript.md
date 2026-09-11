# #139 — the headless `claude -p` transport and recovery by conversation, on TypeScript

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, §2 of this plan and `backend/conventions/` win.

**Issue:** [#139](https://github.com/mercadona/control-tower/issues/139) — phases 2 and 1 of its
five, delivered together because the second one repairs what the first one breaks.

**Branch:** `feat/headless-claude-p-ts`, cut from `origin/main` at ea54477. Every `Current state`
block below reads verbatim **at that base**, which is the tree `--release` reads.

**Tech stack:** Node 24, TypeScript with `erasableSyntaxOnly`, vitest 4, React 19. No new
dependency.

## 1. Context and goal

PR #299 delivered two finished, reviewed slices in JavaScript on branch
`feat/plan-headless-claude-p` (tag `pre-ts-rebase-backup`, head `a184e67`, base `e6485e7`): a
headless `claude -p` adapter that replaces typing into a cmux window, and a repair that makes
recovery read the `conversation.json` records that adapter writes instead of asking cmux which
windows exist. While it was open, main migrated the whole backend to TypeScript (67 commits) and
rebuilt the very seam the second slice rewrites. The branch cannot be merged. This plan re-lands
both slices' end state on main, in TypeScript, as one ordered sequence. The originals stay readable
at `git show pre-ts-rebase-backup:docs/superpowers/plans/<name>` and are the statement of intent
behind every decision below; they are **not** re-committed.

Today the backend invokes nobody. `CmuxPlanAgents` opens a cmux window, writes a launcher script to
disk, types a line into it and waits for a sentinel (`cmux-plan-agents.ts:123-141`); `resume`,
`review` and `fix` send keystrokes into that same window. So there is no invocation to put
`--model` in, nothing about the call is measurable, and the identity of a plan in flight is a cmux
handle — which is why `WorktreePlans` asks cmux which windows exist (`ct-api.ts:417`) and refuses
the whole of `/active-plans` with 400 on any machine whose cmux is not up.

The collisions the TypeScript migration introduced, each answered in §2 and §9:
**C1** cmux is still a probed external tool (`ct-api.ts:31,248`,
`probed-tool-sessions.ts:39-42,80-86`, pinned by `ct-api-real-process.test.ts:312-325`) and must
stay one — the ban is scoped to the recovery path, not to the tree. **C2** `null` is gone from this
seam: `PlansInFlight` carries the reason and `ActivePlansRoute` refuses 400 with it, so the port is
written in main's vocabulary rather than translated. **C3** the refusal carries the tool's own words
and `WorktreePlans.#refuse` stays its single writer. **C5** `plan-refusal.test.ts:59` is a trapdoor.
**C6** and **C7** two test doubles that did not exist when the branch was written. **C8**
`RealpathOf` is exported from the file being deleted. **C10** dead code compiles, because
`noUnusedLocals` is off.

**The plan is the first commit of the branch, and it quotes main.** `--release` reads a plan's cited
files at the **base** of the branch, so a plan quoting main satisfies that gate; `--check-plan`, run
after the work, reads the working tree and will report `literality` on every block whose file the
tasks rewrote and `reference-paths` on `backend/src/infrastructure/cmux-plan-agents.ts`. That is
expected for an implemented plan and is not a defect of this document.

### Desired end state

- **`claude -p` is the transport, and nothing chooses.** `POST /start-plan` writes a plan without
  opening any window; the agent it answers with is a UUID the adapter minted and imposed.
- **The model is a function of the step**: `fable` writes and reviews the plan, `sonnet` implements
  and fixes, and the two judges declare `fable` in their own frontmatter. Every call carries
  `--fallback-model opus`. Declared as a `Projection`, so an undeclared step raises.
- Every headless call leaves `call.json`, `stream.ndjson` and `stderr.log` in its own directory
  under the state root, and outlives a restart of the backend.
- **Recovery reads the harness.** `WorktreePlans` asks a reader of `conversation.json` records who
  attends each prepared worktree; cmux is asked nothing about plans. A missing harness root is zero
  plans **conclusively**, so `/active-plans` answers 200 on a fresh machine.
- **The newest launch wins** when two conversations name one worktree, and a conversation of another
  repository does not attend it.
- `CmuxPlanAgents` and `LaunchPolicy` leave the tree; the entrypoint's assembly of the plan agent is
  inline in `run()`; no operator-facing sentence still says cmux.

### Out of scope

- **The `harness_calls` table in BigQuery** and the sweep that would feed it: the dataset does not
  exist and the harvest's own loader has never run for real.
- **Whether a call is still running.** Nothing on disk says how a call ended, and recovery does not
  need it: `--resume` works against a conversation whose process is gone.
- **Who conducts the implementation.** The four errands of `PlanAgentBrief` travel unchanged, so
  `resume` still hands the model the loop it drives itself with `ct-step`. Phase 4.
- **`plugin/scripts/cmux.js` and the rest of the plugin.** cmux stays the plugin's transport for
  `/ct-next`, and stays the backend's `GET /external-tools` row (C1). What leaves is the backend's
  use of it to recover a plan.
- **Retention of the harness directory**, and with it the bound on how long a plan stays
  recoverable.
- **The strings that name cmux inside test doubles and fixtures** (`start-plan.test.ts`,
  `StartPlanMother.ts`, `ImplementPlanMother.ts` and the assertions that read them): they are
  arbitrary failure messages, not operator copy. The exceptions are two test names, in Tasks 9
  and 12.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Transport | `claude -p <errand> --output-format stream-json --verbose`, always. No variable, no fallback transport |
| The `agent` datum | a UUID the adapter mints with `randomUUID()` and imposes with `--session-id` |
| Continuing a conversation | `--resume <agent>`, a new process per call; never `--fork-session`, and `--no-session-persistence` is never passed |
| Permission mode | `--permission-mode bypassPermissions`; `--plugin-dir <plugin root>` is mandatory |
| Survival and the cap | `detached: true`, output on file descriptors, `unref()`; a timer of the adapter's own signalling the **process group**, arriving through the constructor with no default. Never `spawn`'s `timeout` |
| Where types live | beside each class, in the file that owns it. No shared `types.ts` |
| `HarnessStep` | `Object.freeze({…} as const)` plus `export type HarnessStepValue = (typeof HarnessStep)[keyof typeof HarnessStep]`, as `ActivePlanPhase` does (`active-plans-route.ts:7-13`). Never an enum — `erasableSyntaxOnly` |
| The reader's collaborators | `list: DirectoryListing = (path: string) => Promise<string[]>` (throws; discriminated by `code`), `read: RecordRead = (path: string) => Promise<string \| null>`, `stderr: DiagnosticWriter` (the one `git-workspace.ts` exports), `runsIn: string` — all exported from `harness-conversations.ts` |
| The adapter's collaborators | `start: RunStarter`, a structural `{ start(spec: RunSpec): StartedPid, stop(started: StartedPid): void }` with `StartedPid = { readonly pid: number }`, so a double satisfies it without extending anything; `makeDirectory`, `write`, `read: RecordRead`, `mint`, `clock`, `brief`, `runsIn`, `pluginRoot` |
| `StartedRun` | exported from `detached-run.ts`; the seam is typed as the structural `StartedPid`, not the class |
| The reader's three-way answer | `HarnessAnswer`, a value object beside the reader shaped like `CmuxAnswer`: `static answered(conversations)`, `static refused(reason)`, `readonly conversations`, `readonly reason`, `get wasAnswered`. **Not** `PlansInFlight` (it carries `PlanWatch`, a domain value) and **not** a bare union (the reason must reach the 400 detail) |
| A missing harness root | `HarnessAnswer.answered([])` — zero plans, conclusively. Only a non-ENOENT listing failure is `refused(...)` |
| A stray file in the harness root | reading through it raises **ENOTDIR**, not ENOENT; treat it as a missing record and skip in silence |
| Who writes the refusal | `HarnessConversations.known()` **returns** the unlistable-root reason and does not print it; `WorktreePlans.#refuse` (`worktree-plans.ts:118-122`) stays the single writer of the `plans in flight: ` line. Per-record skip lines keep their own `stderr` write |
| The record | `{ worktree, issue, repository, startedAt }`, four primitives. The agent is never a field — it is the directory the record sits in |
| Two records for one worktree | the greatest `startedAt` attends it |
| Matching a record to a worktree | same worktree path (or same real path) **and** same repository. **Not** the issue: the record's worktree is always `GitWorkspace.pathFor(root, issue)` and a `prepared` only exists for that same composition, so the path entails the issue and a check on it could never fail |
| Where the ban on cmux applies | the recovery path, not the tree. `no-window-titles-parsed.test.ts` asserts three lists explicitly; the global grep predicate is dropped |
| `cmux-plan-agents.ts` | deleted, with `domain/policies/launch-policy.ts` and their tests. `RealpathOf` **moves to and is exported from `worktree-plans.ts`** |
| `#private` methods and static fields | survive unchanged — `erasableSyntaxOnly` bans enums, namespaces, parameter properties and `import =`, not these. `static readonly` is fine |
| A thrown error class passed as a value | `type PlanAgentFailureConstructor = new (reason: string) => PlanAgentFailure`, mirroring `implement-plan-route.ts:34` |
| `Projection` | `static readonly MODELS: Projection<string, HarnessStepValue>`, mirroring `implement-plan-route.ts:172,231` |
| `catch (failure)` | `failure` is `unknown` under `strict`. Use the house narrowing of `ct-api.ts:123-127` — a local `NodeJS.ErrnoException \| null` via `instanceof Error`, then `errno?.code`. Never `as any` |
| Test files | `.ts`, importing `'../../src/….ts'`. `typescript-only.test.ts` fails on any `.js`/`.mjs` added under `backend/` |
| **The tests a task names** | **a floor, not a ceiling.** A task that ports a module re-lands the JavaScript original's cases for it, minus the ones §7 hands to a later task and minus the ones the port makes unreachable — a required field, a type that now forbids the mutation a case existed to catch. The plan names what one page holds; the port keeps what was already reviewed. Anything dropped is named in the task's report with which of those two reasons |
| **A production line with no test in the task** | stays. A narrowed test list is not a licence to delete reviewed code: port the line, then restore the case that pinned it |
| The model per step | `write-plan` and `review-plan` to fable; `implement` and `fix-pull-request` to sonnet; `--fallback-model opus` on every call. The two judges declare fable in their own frontmatter |
| The entrypoint | `HeadlessPlanAgents` and its `DetachedRun` are assembled **inline in `run()`**; no private factory hides a node of the graph |
| API.md | the backup's wording, main's statuses: `implementation-phase-uncertain` 400, `active-plans-recovery-inconclusive` 400, `plan-under-review` exists |
| The two original plans | referenced, not re-committed |

## 3. Reference patterns

Files to imitate: `backend/src/infrastructure/gh-plan-issues.ts` (a boundary model sharing its
adapter's file — the shape `HarnessCall`, `HarnessConversation` and `HarnessAnswer` copy);
`backend/src/infrastructure/tool-runner.ts` (a call to a binary with its budget);
`backend/src/infrastructure/probed-tool-sessions.ts` (a table of constants as the one place a tool's
argv lives); `backend/src/infrastructure/disk-checkout-registry.ts` (a reader of the state root that
degrades to a declared value instead of throwing); `backend/src/infrastructure/run-file-progress.ts`
(a reader whose collaborators are functions handed in by the entrypoint);
`backend/src/infrastructure/active-plans-route.ts` (the frozen-object-plus-value-type idiom);
`backend/src/infrastructure/implement-plan-route.ts` (a `Projection` keyed by error constructors);
`backend/src/infrastructure/worktree-plans.ts` (the subject: how it degrades, how it warns);
`backend/src/domain/value-objects/plans-in-flight.ts` (the answered/refused value object);
`backend/__tests__/infrastructure/tool-runner-real-process.test.ts` (a real-process test with its
marker and its `afterEach`).

Rules to obey: `backend/conventions/this-repository.md`; `plugin/conventions/style.md`;
`plugin/conventions/architecture.md`; `plugin/conventions/boundaries.md`;
`plugin/conventions/domain.md`; `plugin/conventions/defects.md`; `plugin/conventions/testing.md`;
`plugin/conventions/simplicity.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/infrastructure/detached-run.ts` | create | the adapter, the entrypoint | Contract (T1) |
| `backend/__tests__/infrastructure/detached-run-real-process.test.ts` | create | vitest | none (body by TDD) |
| `backend/src/infrastructure/headless-plan-agents.ts` | create (T2), modify (T3) | the entrypoint, the reader | Contract (T2, T3) |
| `backend/__tests__/infrastructure/headless-plan-agents.test.ts` | create (T2), modify (T3) | vitest | none (body by TDD) |
| `backend/__tests__/infrastructure/headless-contract-real-process.test.ts` | create (T3) | vitest | none (body by TDD) |
| `backend/src/infrastructure/implement-plan-route.ts` | modify | the client | Current state (T4) |
| `backend/__tests__/infrastructure/plan-refusal.test.ts` | modify | vitest | Current state (T4) |
| `backend/__tests__/infrastructure/implement-plan-route.test.ts` | modify | vitest | none (T4, T9) |
| `backend/src/infrastructure/harness-conversations.ts` | create | `WorktreePlans` | Contract (T5) |
| `backend/__tests__/infrastructure/harness-conversations.test.ts` | create | vitest | none (body by TDD) |
| `backend/src/infrastructure/ct-api.ts` | modify (T6, then T7) | the operator | Current state + Call site (T6), prose (T7) |
| `backend/__tests__/infrastructure/ct-api-real-process.test.ts` | modify (T6, T7, T8) | vitest | none (body by TDD) |
| `backend/__tests__/infrastructure/pull-request-review-loop.test.ts` | modify | vitest | none (T6) |
| `backend/src/infrastructure/worktree-plans.ts` | modify (T7, T9) | `ActivePlanRecovery` | Current state + Contract (T7) |
| `backend/__tests__/infrastructure/worktree-plans.test.ts` | modify | vitest | none (body by TDD) |
| `backend/__tests__/infrastructure/cmux-contract-real-process.test.ts` | delete | vitest | none (T7) |
| `backend/__tests__/infrastructure/api-server.test.ts` | modify | vitest | none (T7) |
| `backend/__tests__/infrastructure/active-plan-recovery.test.ts` | modify | vitest | none (T7) |
| `backend/src/infrastructure/cmux-plan-agents.ts` | delete | nobody | none (T9) |
| `backend/src/domain/policies/launch-policy.ts` | delete | nobody | none (T9) |
| `backend/__tests__/infrastructure/cmux-plan-agents.test.ts` | delete | vitest | none (T9) |
| `backend/__tests__/infrastructure/no-window-titles-parsed.test.ts` | modify | vitest | Current state (T9) |
| `backend/conventions/this-repository.md` | modify (T9, T10) | the yardstick | Final text (T9, T10) |
| `backend/API.md` | modify | the frontend | Final text (T10) |
| `plugin/agents/ct-judge.md` | modify | the loop | Current state (T11) |
| `plugin/agents/ct-slice-judge.md` | modify | the loop | none (prose) |
| `plugin/__tests__/step-contracts.test.js` | modify | vitest | none (T11) |
| `plugin/__tests__/judge-bench.test.js` | modify | vitest | none (T11) |
| `frontend/src/pages/home/Home.tsx` | modify | the operator | Call site (T12) |
| `frontend/src/pages/home/__tests__/Home.restoreWorkflow.test.tsx` | modify | vitest | none (T12) |
| `frontend/src/app/active-plans/client.test.ts` | modify | vitest | none (T12) |

## 5. Interfaces

Consumes: `PlanAgents` — `launch(briefing) => Promise<string>`,
`resume({ agent, issue, repository })`, `review({ agent, issue, repository, changes })`,
`fix({ agent, issue, repository, changes })`, from `backend/src/domain/ports/plan-agents.ts`,
unchanged. `PlanAgentBrief`'s four errand methods, unchanged. `PlansInFlight.listed(watches)` /
`.refused(reason)` / `.wereListed`, unchanged.

Produces:
`DetachedRun` with `start(spec: RunSpec): StartedRun` and `stop(started: StartedPid): void`; the
types `RunSpec`, `StartedPid` and the class `StartedRun`, all exported from `detached-run.ts`.
`HeadlessPlanAgents`, the second implementation of `PlanAgents`, with `HarnessStep`,
`HarnessStepValue`, `HarnessCall`, `HarnessConversation`, `ConversationRecord`, `RecordRead` and
`RunStarter`, all from `headless-plan-agents.ts`; the static
`HarnessCall.pathsFor({ runsIn, agent, step, startedAt })` composes a call's directory and the three
files in it, and `HeadlessPlanAgents.conversationPathFor({ runsIn, agent })` the record's path.
`HarnessConversations` with `known(): Promise<HarnessAnswer>`, plus `HarnessAnswer` and
`DirectoryListing`, from `harness-conversations.ts`.
`RealpathOf`, exported from `worktree-plans.ts` once `cmux-plan-agents.ts` is gone.
`WorktreePlans`' constructor takes `conversations` where it took `sessions`.

## 6. Test strategy

vitest, run from `backend/` and never from the repository root, per
`backend/conventions/this-repository.md`. The fast subset during a task is
`npx vitest run --exclude '**/*-real-process.test.ts'`; the whole suite runs before the task is
handed over, and `npm run typecheck` runs before both, because Node strips types and never checks
them.

Outside-in, and the application layer needs nothing: no use case and no port changes, so
`start-plan.test.ts` and `implement-plan.test.ts` stay untouched. `DetachedRun` **is** the call —
once the process is doubled there is nothing left to assert — so it runs the real thing behind the
`-real-process.test.ts` marker with an `afterEach` that reaps survivors. `HeadlessPlanAgents` is cut
right before `DetachedRun`: its double records what it was asked and answers a pid, and the
assertion is the **literal argv** plus the files left on disk. Nothing parses claude's stream.
`HarnessConversations` and `HarnessAnswer` are pinned with plain functions as doubles, as
`run-file-progress.ts`'s tests do; `WorktreePlans` is pinned against real `HarnessConversation`
instances, because `plugin/conventions/testing.md` forbids doubling a value.

The composition is measured, not grepped: `ct-api-real-process.test.ts` starts the entrypoint as a
process, seeds a record on disk and reads `/active-plans` over HTTP. That is the acceptance of this
slice and no unit test replaces it — the defect being repaired lives in the wiring.

Every test mother here needs its `readonly x: T` field declarations, which the JavaScript originals
never had; that is most of the cost of Tasks 2, 3 and 5.

## 7. Tasks

Order and dependencies: T1 → T2 → T3 → {T4, T5, T6}; T5 and T6 → T7 → T8 → T9 → T10; T11 and T12
depend on nothing and can land at any point. Each task is one commit and is green at it.

### Task 1 — A call that outlives the process that started it

**Objective:** `DetachedRun` launches a binary whose output goes to files, which outlives its
caller, and whose process group the cap kills if it runs past it.

**Files:**
- Create: `backend/src/infrastructure/detached-run.ts`
- Create: `backend/__tests__/infrastructure/detached-run-real-process.test.ts`

Contract (backend/src/infrastructure/detached-run.ts):

```typescript
export type RunSpec = { argv: string[], cwd: string, out: string, err: string }
export type StartedPid = { readonly pid: number }
export class StartedRun implements StartedPid {
  readonly pid: number
  constructor({ pid }: { pid: number })   // frozen
}
export class DetachedRun {
  static readonly SIGNAL = 'SIGTERM'
  static readonly APPEND = 'a'
  constructor({ bin, budgetMs, env }: { bin: string, budgetMs: number, env: NodeJS.ProcessEnv })
  start(spec: RunSpec): StartedRun   // out and err are absolute paths, opened with APPEND
  stop(started: StartedPid): void    // the same group, swallowing only ESRCH
}
```

`start` opens both paths, spawns with `detached: true` and `stdio: ['ignore', <out fd>, <err fd>]`,
closes the descriptors, `unref()`s the child and answers first. Three lines are §2's decisions, all
three measured fatal: `child.on('error', …)` is registered **before** `child.pid` is read — an
unhandled `'error'` kills the API and no `try`/`catch` sees it — and appends the failure to `err`;
a `pid` of `undefined` then raises `PlanAgentNotLaunched` quoting `bin`; and the cap is a timer of
`budgetMs` calling `process.kill(-pid, DetachedRun.SIGNAL)`, `unref()`ed so it never holds the API
open and cleared on `exit`. `spawn`'s own `timeout` is never passed. Narrow `catch (failure)` the
way `ct-api.ts:123-127` does.

**TDD:** red first — `it('what_the_call_prints_lands_in_the_file_the_caller_named')`, polled until
the file holds the marker its child writes. Then
`it('the_call_gets_a_process_group_of_its_own_so_the_cap_can_reach_what_it_launched')`: the pgid
from `ps -o pgid= -p <pid>` equals its own pid. Then the cap on both sides of its boundary —
`it('the_cap_kills_the_whole_group_so_a_tool_the_call_launched_is_not_left_orphaned')`, `budgetMs`
250 against a child that spawns a grandchild sleeping 5000 ms, **both** dead when polled; and,
because an exit code in a file says nothing about whether the cap fired,
`it('a_call_that_finishes_inside_its_cap_leaves_its_own_exit_code_in_out')` plus
`it('a_call_that_finished_is_never_signalled_once_its_cap_comes_round')`, which spies
`process.kill`.

**Tests:** added: the five above and
`a_binary_that_is_not_installed_raises_without_taking_the_api_down_with_it` — the raise, and the
suite alive past the tick `'error'` fires on — plus a `Child` helper type and an `afterEach` that
reaps every process a case started. Removed: none.

**Verification:** each measured-fatal line has its own case, and no `spawn` option does the cap's
job.

```bash
cd backend && npm run typecheck   # exit 0: the new module type-checks
cd backend && npx vitest run __tests__/infrastructure/detached-run-real-process.test.ts   # exit 0: six cases
cd backend && test "$(grep -c "on('error'" src/infrastructure/detached-run.ts)" -eq 1
cd backend && test "$(grep -c 'process.kill(-' src/infrastructure/detached-run.ts)" -eq 1
cd backend && test -z "$(grep -l 'timeout:' src/infrastructure/detached-run.ts)"
cd backend && npx vitest run   # exit 0: the whole suite, real processes included
```

### Task 2 — The plan is written by an invocation

**Objective:** `launch` mints the conversation's id, records which plan it attends and invokes
`claude -p` in the prepared worktree.

**Files:**
- Create: `backend/src/infrastructure/headless-plan-agents.ts`
- Create: `backend/__tests__/infrastructure/headless-plan-agents.test.ts`

Contract (backend/src/infrastructure/headless-plan-agents.ts):

```typescript
export const HarnessStep = Object.freeze({ WRITE_PLAN: 'write-plan', REVIEW_PLAN: 'review-plan',
  IMPLEMENT: 'implement', FIX_PULL_REQUEST: 'fix-pull-request' } as const)
export type HarnessStepValue = (typeof HarnessStep)[keyof typeof HarnessStep]
export class HarnessCall {
  static readonly CALL_FILE = 'call.json'; static readonly STREAM_FILE = 'stream.ndjson'
  static readonly ERROR_FILE = 'stderr.log'
  get json()   // step, agent, issue, repository, model, argv, pid, startedAt — in that order
}
export class HarnessConversation {   // built from { agent, worktree, issue, repository, startedAt }
  static isWellFormed(record: unknown): record is ConversationRecord
  get json(): ConversationRecord   // no agent: the agent IS the directory's name
}
export class HeadlessPlanAgents extends PlanAgents {
  static readonly BIN = 'claude'; static readonly PRINT = '-p'
  static readonly FORMAT = ['--output-format', 'stream-json', '--verbose']
  static readonly PERMISSION = ['--permission-mode', 'bypassPermissions']
  static readonly FALLBACK = ['--fallback-model', 'opus']
  static readonly CONVERSATION_FILE = 'conversation.json'
  static readonly MODELS: Projection<string, HarnessStepValue>
  static argvFor({ errand, step, pluginRoot, agent, resuming }): string[]
}
```

`ConversationRecord`, `RecordRead` and `RunStarter` are exported here too; a record is well formed
when its two strings are non-empty and its two numbers integers above zero. `argvFor` answers
`[PRINT, errand, ...FORMAT, ...PERMISSION, ...FALLBACK, '--model',
MODELS.of(step), '--plugin-dir', pluginRoot]`, then `--session-id` or, resuming, `--resume`. The
static `conversationPathFor({ runsIn, agent })` composes the record's path, so Tasks 3 and 5 share
it. `launch` mints, makes `${runsIn}/${agent}/${step}-${startedAt}`, writes the conversation, starts
the call in `briefing.located.path`, then `call.json`.

**TDD:** red first —
`it('the_plan_is_asked_for_with_the_errand_the_brief_composed_and_the_model_its_step_declares')`,
the whole argv asserted literally.

**Tests:** added: that one,
`the_conversation_carries_the_id_the_adapter_imposed_and_not_one_read_back`,
`launch_records_which_plan_the_conversation_attends_and_when_it_started`,
`the_call_leaves_its_step_and_its_model_on_disk_because_no_reader_can_recover_them_later`,
`the_stream_of_the_call_and_its_diagnosis_are_two_different_files`,
`the_plan_is_written_in_the_worktree_that_was_prepared_and_not_where_the_api_runs`,
`a_step_no_model_was_declared_for_raises_instead_of_asking_for_undefined` and
`a_call_that_cannot_be_started_refuses_without_leaving_a_conversation_behind`.

**Verification:** the argv is whole and the identity imposed.

```bash
cd backend && npm run typecheck   # exit 0
cd backend && npx vitest run __tests__/infrastructure/headless-plan-agents.test.ts   # exit 0
cd backend && test "$(grep -c 'session-id' src/infrastructure/headless-plan-agents.ts)" -eq 1
cd backend && test -z "$(grep -l 'no-session-persistence' src/infrastructure/headless-plan-agents.ts)"
cd backend && npx vitest run   # exit 0
```

### Task 3 — The go, the review and the fixes continue the same conversation

**Objective:** `resume`, `review` and `fix` invoke `claude -p --resume <agent>` with today's
errands, in the worktree `launch` recorded, each leaving its own record.

**Files:**
- Modify: `backend/src/infrastructure/headless-plan-agents.ts`
- Modify: `backend/__tests__/infrastructure/headless-plan-agents.test.ts`
- Create: `backend/__tests__/infrastructure/headless-contract-real-process.test.ts`

Contract (backend/src/infrastructure/headless-plan-agents.ts):

```typescript
export class HeadlessPlanAgents extends PlanAgents {
  async resume({ agent, issue, repository }): Promise<void>            // HarnessStep.IMPLEMENT
  async review({ agent, issue, repository, changes }): Promise<void>   // HarnessStep.REVIEW_PLAN
  async fix({ agent, issue, repository, changes }): Promise<void>      // FIX_PULL_REQUEST
  async #worktreeOf(agent: string): Promise<string>
  //   PlanAgentNotResumed when no record is there; PlanAgentNotNamed when it cannot be understood
}
```

The three answer nothing, as the port declares. Each takes its `cwd` from `#worktreeOf(agent)`,
composes its own directory the way `launch` does — the grain of a record is the invocation, not the
plan — and takes its errand unchanged from the brief method that already exists for it, with
`resuming` true. A call that cannot be started raises `PlanAgentNotResumed`, the family's other
cause. `#worktreeOf` owes **two** causes: an absent record is `PlanAgentNotResumed`; one that cannot
be understood — not JSON, or a JSON `HarnessConversation.isWellFormed` rejects — is
`PlanAgentNotNamed`, which Task 4 maps at the route. An unguarded parse would answer `undefined`,
and a `cwd` of `undefined` runs `git` and every edit where the API runs. The port does not change;
§9.6 says why.

**TDD:** red first —
`it('the_go_hands_the_implementation_errand_to_the_conversation_that_wrote_the_plan')`: the whole
argv with `--resume <agent>` and **no** `--session-id`.

**Tests:** added:
`the_implementation_runs_in_the_worktree_where_the_plan_was_written_and_not_where_the_api_runs`;
`a_second_call_on_one_conversation_leaves_a_second_record_beside_the_first`;
`the_changes_a_person_asked_for_travel_in_the_errand_of_the_review_call`;
`the_fixes_of_a_pull_request_are_asked_for_with_the_step_that_says_so`;
`a_conversation_whose_worktree_was_never_recorded_refuses_instead_of_guessing_one`;
`a_conversation_recorded_as_a_json_array_refuses_instead_of_reading_fields_off_a_list`;
`a_conversation_whose_repository_is_the_empty_string_refuses_instead_of_naming_no_repository`.
In `headless-contract-real-process.test.ts`, against a fake `claude`:
`the_files_a_real_launch_leaves_agree_with_what_the_process_received_and_the_conversation_names_the_plan_it_belongs_to`
and `the_envelope_a_launch_composes_keeps_landing_after_the_process_that_launched_it_has_already_exited`.

**Verification:** the three resume, and none runs outside the worktree.

```bash
cd backend && npm run typecheck   # exit 0
cd backend && npx vitest run __tests__/infrastructure/headless-plan-agents.test.ts   # exit 0: 15 cases
cd backend && npx vitest run __tests__/infrastructure/headless-contract-real-process.test.ts   # exit 0
cd backend && test "$(grep -c 'not_where_the_api_runs' __tests__/infrastructure/headless-plan-agents.test.ts)" -eq 2
cd backend && test -z "$(grep -rn 'JSON.stringify({ worktree' src __tests__)"
cd backend && npx vitest run   # exit 0
```

### Task 4 — A conversation record nobody can understand refuses the go with its own code

**Objective:** `PlanAgentNotNamed` reaching `/implement-plan` collapses into a declared refusal
instead of a crash, and the guard that watches the two collapse tables stops hiding it.

**Files:**
- Modify: `backend/src/infrastructure/implement-plan-route.ts`
- Modify: `backend/__tests__/infrastructure/plan-refusal.test.ts`
- Modify: `backend/__tests__/infrastructure/implement-plan-route.test.ts`

Current state (backend/src/infrastructure/implement-plan-route.ts, lines 231-235):

```typescript
  static readonly #BY_FAILURE: Projection<ImplementCollapseOf, ImplementFailureConstructor> = new Projection<ImplementCollapseOf, ImplementFailureConstructor>('refusal', [
    [GoNotRecorded, ImplementCollapse.#collapsed('go-not-recorded')],
    [PlanGoNotAnswered, ImplementCollapse.#collapsed('plan-go-not-answered')],
    [PlanAgentNotResumed, ImplementCollapse.#collapsed('plan-agent-not-resumed')],
  ])
```

Current state (backend/__tests__/infrastructure/plan-refusal.test.ts, lines 59-59):

```typescript
  const RESUMING_AN_AGENT = ImplementCollapse.declaredFailures()
```

A fourth row is added,
`[PlanAgentNotNamed, ImplementCollapse.#collapsed('plan-agent-worktree-not-understood')]`, and
`PlanAgentNotNamed` joins the import at line 11. That single line is a trapdoor on the test above:
`startingAPlan` subtracts `RESUMING_AN_AGENT` from what `PlanCollapse` must declare, so the class
would silently leave `PlanCollapse`'s expected set while `start-plan-route.ts` still declares it.
The constant becomes `const SHARED_WITH_RESUMING_AN_AGENT_ON_PURPOSE = ['PlanAgentNotNamed']` plus a
`RESUMING_AN_AGENT` that filters those names out of `ImplementCollapse.declaredFailures()`, which
keeps the sharing deliberate and visible.

**TDD:** red first —
`it('the_classes_starting_a_plan_and_resuming_an_agent_can_both_collapse_on_are_exactly_the_ones_declared_shared_on_purpose')`
in `plan-refusal.test.ts`: intersect `PlanCollapse.declaredFailures()` with
`ImplementCollapse.declaredFailures()` and assert it **equals**
`SHARED_WITH_RESUMING_AN_AGENT_ON_PURPOSE`. Red today, because the intersection is empty and the
list has one name; a second shared class added by mistake turns it red again.

**Tests:** added: the one above, and
`a_conversation_record_that_cannot_be_understood_refuses_the_go_with_its_own_code` in
`implement-plan-route.test.ts`, asserting 400 with `plan-agent-worktree-not-understood` and the
exception's own message as `detail`. Removed on purpose: none.

**Verification:** the code is declared once, the codes stay distinct, and the sharing is pinned.

```bash
cd backend && npm run typecheck   # exit 0
cd backend && test "$(grep -c 'plan-agent-worktree-not-understood' src/infrastructure/implement-plan-route.ts)" -eq 1
cd backend && test "$(grep -c 'SHARED_WITH_RESUMING_AN_AGENT_ON_PURPOSE' __tests__/infrastructure/plan-refusal.test.ts)" -eq 3
cd backend && npx vitest run __tests__/infrastructure/plan-refusal.test.ts   # exit 0: the two tables agree
cd backend && npx vitest run __tests__/infrastructure/implement-plan-route.test.ts   # exit 0: the new refusal
cd backend && npx vitest run   # exit 0: the whole suite
```

### Task 5 — `HarnessConversations`, the reader of those records

**Objective:** a new adapter answers who is attending, listing the harness root and reading a
record per directory, and tells *zero plans* from *could not be known*.

**Files:**
- Create: `backend/src/infrastructure/harness-conversations.ts`
- Create: `backend/__tests__/infrastructure/harness-conversations.test.ts`

Contract (backend/src/infrastructure/harness-conversations.ts):

```typescript
export type DirectoryListing = (path: string) => Promise<string[]>   // THROWS; `code` tells apart
export class HarnessAnswer {   // readonly conversations and reason, as PlansInFlight
  static answered(conversations: readonly HarnessConversation[]): HarnessAnswer
  static refused(reason: string): HarnessAnswer
  get wasAnswered(): boolean   // reason === null
}
export class HarnessConversations {
  constructor({ list, read, stderr, runsIn })   // the four §2 closes
  async known(): Promise<HarnessAnswer>
}
```

ENOENT on the root is `answered([])` — zero plans, conclusively, which is what a first start looks
like. Any other listing failure is `refused(reason)`, and that reason is **returned, never
printed**: `WorktreePlans.#refuse` is the single writer of the `plans in flight: ` line, and two
writers print one refusal twice. A record is read at
`HeadlessPlanAgents.conversationPathFor({ runsIn, agent })` — the reason this module imports the
constant instead of repeating the file name. A read answering `null`, and one raising `ENOTDIR`
because the entry is a stray file such as `.DS_Store`, are both skipped **in silence**: neither is a
plan. A read that raises otherwise, a text that is not JSON and a record `isWellFormed` rejects are
each skipped with a line on `stderr`; the other plans still come back.

**TDD:** red first —
`it('a_harness_root_that_cannot_be_listed_could_not_be_known_so_recovery_never_declares_zero_plans')`,
`list` throwing `EACCES`, asserting `known()` is not `wasAnswered` and carries that message. Its
boundary is the case beside it, whose `list` throws ENOENT and answers `wasAnswered` with an empty
list: one code apart, opposite answers.

**Tests:** added: that one and
`a_record_names_its_plan_by_its_fields_and_its_agent_by_the_directory_it_sits_in`;
`a_state_root_with_no_harness_directory_is_zero_plans_and_not_an_answer_that_could_not_be_known`;
`the_root_that_could_not_be_listed_hands_its_reason_up_instead_of_writing_it_itself`;
`a_record_that_is_not_json_is_skipped_with_its_path_on_stderr_and_the_other_plans_still_come_back`;
`a_record_whose_issue_is_zero_is_skipped_instead_of_attending_a_worktree`;
`a_record_whose_issue_is_one_is_the_smallest_one_that_attends_a_worktree`;
`a_record_that_is_a_json_array_is_skipped_instead_of_reading_fields_off_a_list`;
`a_record_that_cannot_be_read_is_skipped_with_its_path_on_stderr`;
`a_stray_file_in_the_harness_root_is_not_a_plan_and_says_nothing`.

**Verification:** the two degradations are told apart, and no reason is printed here.

```bash
cd backend && npm run typecheck   # exit 0
cd backend && npx vitest run __tests__/infrastructure/harness-conversations.test.ts   # exit 0: 10 cases
cd backend && test "$(grep -c 'ENOENT' src/infrastructure/harness-conversations.ts)" -eq 1
cd backend && test -z "$(grep -l 'conversation.json' src/infrastructure/harness-conversations.ts)"
cd backend && test -z "$(grep -l 'could not be listed' src/infrastructure/harness-conversations.ts)"
cd backend && npx vitest run   # exit 0
```

### Task 6 — The entrypoint invokes instead of typing

**Objective:** `ct-api.ts` builds `HeadlessPlanAgents` on a `DetachedRun`, inline in `run()`.

**Files:**
- Modify: `backend/src/infrastructure/ct-api.ts`
- Modify: `backend/__tests__/infrastructure/ct-api-real-process.test.ts`
- Modify: `backend/__tests__/infrastructure/pull-request-review-loop.test.ts`

Current state (backend/src/infrastructure/ct-api.ts, lines 364-368):

```typescript
    const planAgents = new CmuxPlanAgents({
      run: CtApi.#tool(CmuxPlanAgents.BIN),
      write: Disk.write,
      read: Disk.read,
      remove: Disk.remove,
```

Call site (backend/src/infrastructure/ct-api.ts):

```typescript
    const harnessRoot = join(asked.stateRoot, CtApi.#HARNESS_DIRECTORY)
    const planAgents = new HeadlessPlanAgents({
      start: new DetachedRun({ bin: HeadlessPlanAgents.BIN, budgetMs: CtApi.#PLAN_CALL_TIMEOUT_MS, env: environment }),
      makeDirectory: Disk.makeDirectory, write: Disk.atomicWrite, read: Disk.read,
      mint: randomUUID, clock: Date.now,
      brief: new PlanAgentBrief({ dispatchCheck: …, conventions: …, ctStep: … }),   // as line 375 builds it
      runsIn: harnessRoot, pluginRoot: PluginTree.root(),
    })
```

No private factory hides a node: the entrypoint reads as a state machine you can follow.
`#HARNESS_DIRECTORY` is a new static, `'harness'`; `#PLAN_CALL_TIMEOUT_MS` is new beside the three
of lines 159-161, 60 minutes; `PluginTree.#root()` (72) goes public; `Disk` gains `makeDirectory`;
and the collaborator's type at lines 218, 307 and 324 becomes `PlanAgents`, the port, not this
adapter. Recovery still reads cmux here. Then delete what just died, because `noUnusedLocals` is
off: `tmpdir` (5), the `LaunchPolicy, LaunchBudget` import (51), `Disk.remove`
(140-142) and the statics `#PROBES_PER_SEND`, `#RESENDS`, `#SECONDS_BETWEEN_PROBES` and
`#LAUNCH_DIRECTORY` — `#SECONDS_BETWEEN_READS` and `#SECONDS_BETWEEN_ASKS` stay. In the loop test
`CmuxDouble` becomes a `DetachedRunDouble` recording `spec.argv` and answering `{ pid: 4242 }`,
`AGENT` becomes a UUID, and `Untouched` and its `LaunchPolicy` import go too.

**TDD:** red first — `it('the_entrypoint_assembles_the_headless_plan_agent_and_listens')` in
`ct-api-real-process.test.ts`, starting the entrypoint with nothing set and asserting it listens.
No grep replaces it: a collaborator that never reaches its constructor is the defect PR #167
shipped in this issue, and no unit test caught it.

**Tests:** added: the one above. Changed:
`types_an_errand_naming_the_real_issue_instead_of_issue_hash_undefined` becomes
`passes_an_errand_naming_the_real_issue_instead_of_issue_hash_undefined`, asserting the literal
argv `['-p', <fixErrand>, ...FORMAT, ...PERMISSION, ...FALLBACK, '--model', 'sonnet',
'--plugin-dir', '/plugin', '--resume', AGENT]`; its `describe` drops `and cmux` for `and the
detached run`. Removed: none.

**Verification:** the graph is assembled by a real process, and nothing dead is left.

```bash
cd backend && npm run typecheck   # exit 0
cd backend && test -z "$(grep -n '#headlessAgents\|#brief\|#LAUNCH_DIRECTORY' src/infrastructure/ct-api.ts)"
cd backend && test "$(grep -c 'PLAN_CALL_TIMEOUT_MS' src/infrastructure/ct-api.ts)" -eq 2
cd backend && test -z "$(grep -n 'tmpdir\|LaunchBudget\|SECONDS_BETWEEN_PROBES' src/infrastructure/ct-api.ts)"
cd backend && npx vitest run __tests__/infrastructure/ct-api-real-process.test.ts   # exit 0
cd backend && npx vitest run   # exit 0
```

### Task 7 — Recovery attends by conversation

**Objective:** the agent of a plan in flight comes from the records, not from cmux.

**Files:**
- Modify: `backend/src/infrastructure/worktree-plans.ts`,
  `backend/__tests__/infrastructure/worktree-plans.test.ts`,
  `backend/src/infrastructure/ct-api.ts`,
  `backend/__tests__/infrastructure/api-server.test.ts`,
  `backend/__tests__/infrastructure/active-plan-recovery.test.ts`,
  `backend/__tests__/infrastructure/ct-api-real-process.test.ts`
- Delete: `backend/__tests__/infrastructure/cmux-contract-real-process.test.ts`

Current state (backend/src/infrastructure/worktree-plans.ts, lines 104-105):

```typescript
    const listed = this.sessions()
    if (!listed.wasAnswered) return this.#refuse(listed.reason)
```

Contract (backend/src/infrastructure/worktree-plans.ts):

```typescript
export type ConversationsAsked = () => Promise<HarnessAnswer>
constructor({ checkouts, survey, conversations, story, realpathOf, stderr })
#agentOf(known, prepared, repository)   // same repository.text, same worktree or real path; the
//   greatest startedAt wins, or null. #toSurvey reads conversation.worktree, unfiltered
```

`inFlight` awaits `conversations()` and refuses with `answer.reason`. Gone with cmux: the `Cmux`
imports, the `KnowableSession`, `PlanSession` and `SessionsAsked` types, `#opensAPlan` (61-64) and
`#knowableIn` (95-101). In `ct-api.ts` the `CmuxWorkspaceQuery` import **stays** — `#askCmux` has a
second caller, `cmuxAnswers` (248), the `/external-tools` row — line 417 becomes
`conversations: () => harness.known()`, `Disk` gains `list(path)`, and `run()` builds the
`HarnessConversations` before `recovery`, with `runsIn: harnessRoot`.

**TDD:** red first —
`it('the_newest_launch_is_the_conversation_that_attends_a_worktree_two_of_them_name')`, the older
record **first** so directory order cannot pass by luck, `startedAt` apart by one.

**Tests:** added: that one and
`a_conversation_of_another_repository_does_not_attend_a_worktree_whose_path_it_matches`. Removed,
each a cmux-session case with nothing on disk to map onto:
`a_session_that_hides_its_directory_does_not_lend_its_agent_while_another_one_shows_its_own`,
`when_no_session_exposes_its_directory_the_error_channel_says_that_is_why`,
`sessions_that_all_hide_their_directory_is_not_the_same_as_no_plans_in_flight`,
`an_entry_that_is_not_an_object_does_not_take_the_whole_recovery_down_with_it`,
`a_session_whose_ref_is_not_a_handle_names_no_agent`,
`a_worktree_the_dispatcher_opened_is_not_adopted_as_a_plan_of_this_backend`,
`a_session_the_dispatcher_opened_does_not_put_its_checkout_on_the_list_to_survey`, and every case
of `cmux-contract-real-process.test.ts`. `SessionsOfCmux` becomes a `ConversationsOf` mother of real
values; `ACmuxAttendingOnePlan` and `CMUX_FAKE` go and the two-paths case is reseeded on a record,
while the two cmux fixtures of the `/external-tools` row stay; and the doubles at
`api-server.test.ts:217` and `active-plan-recovery.test.ts:82` take `conversations:`.

**Verification:** no window is named on the recovery path.

```bash
cd backend && npm run typecheck   # exit 0
cd backend && test -z "$(grep -rln 'Cmux\|cwdKnown' src/infrastructure/worktree-plans.ts __tests__/infrastructure/worktree-plans.test.ts)"
cd backend && test "$(grep -c 'harnessRoot' src/infrastructure/ct-api.ts)" -eq 3
cd backend && test ! -e __tests__/infrastructure/cmux-contract-real-process.test.ts
cd backend && npx vitest run   # exit 0
```

### Task 8 — The regression pin: `/active-plans` answers with no cmux on the PATH

**Objective:** the defect this repair exists for gets a test of its own, at the only altitude that
would have caught it — a real process, no cmux anywhere, an HTTP answer.

**Files:**
- Modify: `backend/__tests__/infrastructure/ct-api-real-process.test.ts`

No code — the behaviour landed in Task 7; this commit adds the case that pins it, and pinning it is
a commit of its own because the evidence it rests on is a mutation, not a red run.

**TDD:** mutation evidence instead of red-then-green. Write the case, see it green, then revert the
thunk of `ct-api.ts:417` to `sessions: () => CtApi.#askCmux()` with the collaborator renamed back,
run it again and **see it fail with 400**, restore and see it green. The report carries all three
outputs; without the middle one the case proves nothing, because a pin written after the fact is
green whatever the wiring says.

**Tests:** added:
`active_plans_is_served_with_no_cmux_on_the_path_because_no_window_is_asked_about_any_more` — a
record seeded under `<CLAUDE_CONFIG_DIR>/control-tower/harness/<uuid>/conversation.json`
(`Invocation.STATE_DIRECTORY` is `control-tower`) beside a real checkout with a `.worktrees/<n>`
prepared for the same issue, `PATH` set to a directory holding no `cmux` at all, and the assertion
that `/active-plans` answers **200** with that plan and its UUID agent. Removed on purpose: none.

**Verification:** the pin passes, and the whole suite with it.

```bash
cd backend && test "$(grep -c 'no_window_is_asked_about_any_more' __tests__/infrastructure/ct-api-real-process.test.ts)" -eq 1
cd backend && npx vitest run __tests__/infrastructure/ct-api-real-process.test.ts   # exit 0: 200 with no cmux on PATH
cd backend && npx vitest run   # exit 0: the whole suite, real processes included
```

### Task 9 — `CmuxPlanAgents` and its launch policy leave the tree

**Objective:** the transport nobody builds is deleted with its policy and its tests, and the guard
that watched one module watches three explicit lists instead.

**Files:**
- Delete: `backend/src/infrastructure/cmux-plan-agents.ts`,
  `backend/src/domain/policies/launch-policy.ts`,
  `backend/__tests__/infrastructure/cmux-plan-agents.test.ts`
- Modify: `backend/src/infrastructure/worktree-plans.ts`,
  `backend/__tests__/infrastructure/no-window-titles-parsed.test.ts`,
  `backend/__tests__/infrastructure/implement-plan-route.test.ts`,
  `backend/conventions/this-repository.md`

Current state (backend/__tests__/infrastructure/no-window-titles-parsed.test.ts, lines 26-28):

```typescript
  it('the_only_module_that_names_a_cmux_workspace_is_the_one_that_opens_it', () => {
    expect(SourceTree.containing('ct-plan-')).toEqual(['infrastructure/cmux-plan-agents.ts'])
  })
```

`RealpathOf` is exported from the file being deleted (`cmux-plan-agents.ts:25`) and consumed by
`worktree-plans.ts:2,38,46` and its test: it **moves to and is exported from `worktree-plans.ts`**,
now its only consumer. The guard becomes
`it('no_module_of_the_backend_opens_a_cmux_window_now_that_nothing_types_into_one')` with three
assertions and no global grep, because C1 keeps cmux a probed external tool:
`containing('ct-plan-')` is `[]`, `containing('cmux-plan-agents')` is `[]`, and
`containing('plugin/scripts/cmux.js')` is `['infrastructure/ct-api.ts']` — a named, declared
exception, the `/external-tools` row. `implement-plan-route.test.ts:225` renames
`…_an_argument_of_cmux` to `…_an_argument_of_claude`; its body does not change.

Final text (backend/conventions/this-repository.md):

```markdown
| **External tool** | A binary Control Tower drives that has to be usable before work starts: `gh`, `acli`, `claude`, `git`, `bq` carry a credential of their own, and `cmux` carries a query that answers whether its daemon is up. Which six lives in `probed-tool-sessions.ts`, and so does what is asked of the five that carry a credential; the query `cmux` is asked arrives injected from `ct-api.ts` |
```

That row replaces line 67, whose tail claimed the cmux query is the very one plans are recovered
with — false from Task 7 on. Line 77 stays true and unchanged, so
`conventions-no-restatement.test.ts:34` needs no edit; §9.11 says why.

**TDD:** the red step is the guard's three `toEqual` assertions, red while either source file exists
and green once both are gone. No behaviour is added.

**Tests:** removed on purpose: every case of `cmux-plan-agents.test.ts` — the adapter and
`LaunchPolicy` — whose subject is deleted. Added: none; the guard keeps its one case.

**Verification:** no adapter of cmux under `backend/src`, and the one mention left is declared.

```bash
cd backend && test ! -e src/infrastructure/cmux-plan-agents.ts
cd backend && test ! -e src/domain/policies/launch-policy.ts
cd backend && test -z "$(grep -rl 'launch-sentinel\|shquote\|CmuxPlanAgents' src __tests__)"
cd backend && test "$(grep -c 'export type RealpathOf' src/infrastructure/worktree-plans.ts)" -eq 1
cd backend && npm run typecheck   # exit 0: nothing still imports the deleted module
cd backend && npx vitest run   # exit 0: the whole suite
```

### Task 10 — The repository and the API say what a harness call is

**Objective:** `this-repository.md` and `API.md` describe the transport and the recovery that now
exist, on main's statuses.

**Files:**
- Modify: `backend/conventions/this-repository.md`
- Modify: `backend/API.md`

Final text (backend/conventions/this-repository.md):

```markdown
| **Plan agent** | Whoever writes the plan for a story; a Claude invoked per step with `claude -p`, never a session typed into |
| **Harness call** | One invocation of the plan agent: its step, its model, its argv and the stream it wrote. It lives in its own directory under the state root and outlives the backend that started it |
| **Step of a call** | Which errand the invocation carried — `write-plan`, `review-plan`, `implement`, `fix-pull-request`. The one datum no reader recovers afterwards, so it is written at the source |
| **Model of a step** | Which model a step asks for: `fable` writes and reviews a plan and judges, `sonnet` implements and fixes. A judge declares it in its own agent frontmatter, never inheriting the dispatching session; every headless call carries `--fallback-model opus` |
```

The first row **replaces** line 54; the other three are new below it.

Final text (backend/API.md):

```markdown
| `plan-agent-not-launched` | claude -p refused |
| `plan-agent-not-named` | the agent's conversation record could not be understood |
| `plan-agent-not-resumed` | 400 | the conversation could not be continued with `claude -p --resume` |
| `plan-agent-worktree-not-understood` | 400 | the agent's recorded conversation could not be read back as a worktree |
| `active-plans-recovery-inconclusive` | **400** | what is in flight could not be listed, so the list would be a lie; `detail` carries it |
```

Rows one and two replace lines 191-192; three replaces line 302 and four is new after it; five
replaces line 500 — **400**, main's status, not the backup's 503. Four stretches of prose are
corrected, each claim checked against this task's tree: line 137's example `detail` becomes
`claude -p refused`; line 225 recovers a session **from a conversation record**; lines 502-517 say
recovery reads the `conversation.json` records under the state root and not a live workspace, that
a missing harness root is zero plans conclusively — a fresh machine gets a clean 200 with an empty
list — and that the 400 fires only when that root exists but cannot be listed or the registry
cannot be read, keeping what the page must show and `detail` carrying the reason and dropping the
three sentences about a stale cmux schema; and lines 535-538 and 634 stop tying the `cmux` row to
recovery.

**TDD:** No TDD — documentation. `conventions-no-restatement.test.ts` reads `this-repository.md`
for the terms and rules it must keep; the predicates below do the rest.

**Tests:** N/A — no behaviour is added and none is removed.

**Verification:** the vocabulary is there once each, and no sentence ties cmux to recovery.

```bash
cd backend && test "$(grep -c 'Harness call' conventions/this-repository.md)" -eq 1
cd backend && test "$(grep -c 'Model of a step' conventions/this-repository.md)" -eq 1
cd backend && test -z "$(grep -n 'a Claude in a cmux tab\|reads the live cmux' conventions/this-repository.md API.md)"
cd backend && test "$(grep -c 'plan-agent-worktree-not-understood' API.md)" -eq 1
cd backend && npx vitest run __tests__/conventions-no-restatement.test.ts   # exit 0
cd backend && npx vitest run   # exit 0
```

### Task 11 — The two judges run on fable

**Objective:** the task judge and the slice judge declare `fable` in their own frontmatter, and the
plugin's suite says so.

**Files:**
- Modify: `plugin/agents/ct-judge.md`
- Modify: `plugin/agents/ct-slice-judge.md`
- Modify: `plugin/__tests__/step-contracts.test.js`
- Modify: `plugin/__tests__/judge-bench.test.js`

Current state (plugin/agents/ct-judge.md, lines 4-5):

```markdown
tools: Read, Grep, Glob, Write, Skill
model: opus
```

Both agents move `model:` to `fable`. Nothing else in either file changes — not the description, not
`tools`, not a line of the body. `ct-advisor.md` and `ct-reconciler.md` stay on `opus`: the human
named the judge. In `step-contracts.test.js` the `it.each` at lines 1270-1276 keeps only the
reconciler and the advisor on `'opus'` and gains a second `it.each` over the two judges asserting
`'fable'`, so the contract stays "each of the four declares a model", and says which. In
`judge-bench.test.js`, lines 254 and 287 — both reading the real `ct-judge.md` — become `'fable'`;
lines 46 and 260 belong to the synthetic `bench-judge` fixture and stay on `'opus'`.

**TDD:** red first — the new `it.each` over the task judge and the slice judge asserting
`agentModel(file)` is `'fable'`, red against both files as they stand. Then the two frontmatter
values, then the two `judge-bench` assertions.

**Tests:** added: the `it.each` above, two cases. Changed: the existing `it.each` drops its two judge
rows and keeps the reconciler and the advisor. Removed on purpose: none — no agent loses the
assertion that it declares its own model.

**Verification:** both judges ask for fable, the other two agents did not move, and the plugin's
suite is green.

```bash
test "$(grep -c '^model: fable' plugin/agents/ct-judge.md)" -eq 1
test "$(grep -c '^model: fable' plugin/agents/ct-slice-judge.md)" -eq 1
test "$(grep -c '^model: opus' plugin/agents/ct-advisor.md)" -eq 1
test "$(grep -c '^model: opus' plugin/agents/ct-reconciler.md)" -eq 1
cd plugin && npm test   # exit 0: the plugin suite, the two judges on fable
```

### Task 12 — No banner tells the operator about cmux

**Objective:** the two sentences a person reads when a plan is lost or recovery is inconclusive
describe what actually happened, now that nothing asks cmux.

**Files:**
- Modify: `frontend/src/pages/home/Home.tsx`
- Modify: `frontend/src/pages/home/__tests__/Home.restoreWorkflow.test.tsx`
- Modify: `frontend/src/app/active-plans/client.test.ts`

Call site (frontend/src/pages/home/Home.tsx):

```tsx
// line 267, the plan the backend no longer holds:
description="El backend ya no tiene este plan activo. Descarta el estado para crear una solicitud nueva."
// line 294, recovery that could not reach a conclusion:
description="El backend contestó, pero no pudo leer sus registros de planes. No puede saber qué planes hay activos. No se harán acciones hasta que se confirme el estado."
```

Nothing else moves: the variants, the conditions that render them and the shape of `/active-plans`
are untouched. The fixtures that carry `cmux` inside a refusal's `detail`
(`Home.restoreWorkflow.test.tsx:196,472`, `ImplementPlanMother.ts`, `StartPlanMother.ts`) stay as
they are — they are the backend's message travelling through, not this page's words.

**TDD:** red first — `Home.restoreWorkflow.test.tsx:170`'s assertion changes from
`'backend o cmux ya no tiene este plan activo'` to `'El backend ya no tiene este plan activo'`,
which fails against the current copy for exactly that reason.

**Tests:** added: none. Changed: the case at line 170 keeps its name and moves its expected text,
and `client.test.ts:89`'s name becomes
`should report recovery as inconclusive when the backend says its records could not be read` — a
name is a sentence, and that one says something the backend can still answer. Removed on purpose:
none.

**Verification:** no page of the frontend names cmux in its own copy, and both suites are green.

```bash
cd frontend && test -z "$(grep -n 'cmux' src/pages/home/Home.tsx)"
cd frontend && test -z "$(grep -n 'says cmux could not be asked' src/app/active-plans/client.test.ts)"
cd frontend && npx tsc --noEmit -p tsconfig.json   # exit 0: the page still type-checks
cd frontend && npx vitest run src/pages/home/__tests__/Home.restoreWorkflow.test.tsx   # exit 0: the reworded banner
cd frontend && npx vitest run   # exit 0: the whole frontend suite
```

## 8. Global verification

The suite proves the pieces. What it cannot prove is that a real `claude -p` writes a real plan with
no window, and that the frontend lists it again after the backend that started it was killed. Run
that by hand, once: start the backend — nothing to set — `POST /start-plan` for a repository with a
plan issue, and watch three things with human eyes: no cmux window opens, `stream.ndjson` grows
under `~/.claude/control-tower/harness/<uuid>/write-plan-*/`, and the plan lands committed and
published on the issue. Kill the backend mid-run and confirm the file goes on growing; start it
again and ask `/active-plans` — the plan comes back with the same UUID as its agent, and that UUID
is one `/implement-plan` resumes. Then read the last line of the stream: it is the `result` event,
and `total_cost_usd`, `num_turns` and `modelUsage` are the metrics this slice existed to make
possible.

The predicates below are what a program can score.

```bash
cd backend && npm run typecheck   # exit 0: the graph is sound with no cmux adapter in it
cd backend && npx vitest run   # exit 0: the whole backend suite, real-process tests included
cd backend && npx vitest run __tests__/infrastructure/no-window-titles-parsed.test.ts   # exit 0: the three lists
cd backend && test -z "$(grep -rl 'CmuxPlanAgents\|LaunchPolicy\|launch-sentinel' src __tests__)"
cd frontend && npx tsc --noEmit -p tsconfig.json   # exit 0
cd frontend && npx vitest run   # exit 0: the whole frontend suite
cd plugin && npm test   # exit 0: the plugin suite
test -z "$(git status --porcelain)"
```

## 9. Assumptions

1. **The four CLI properties every contract rests on were measured, not assumed** (2026-09-09, the
   installed `claude`): `--session-id` imposes the conversation's id, so the adapter mints the
   identity instead of parsing it back; `--resume` in a **new process** recovers that conversation,
   which is why a record on disk is enough to recover a plan and liveness is never consulted;
   `--output-format stream-json --verbose` ends in a `result` event carrying `total_cost_usd`,
   `num_turns`, `usage`, `modelUsage` and `duration_ms`; and a `detached` + `unref()` spawn with its
   output on a file descriptor is reparented to pid 1 and keeps writing with the parent long dead,
   while `spawn`'s own `timeout` leaves the tools `claude` launched orphaned. Provenance: own call,
   in the session that wrote the original plan.
2. **The ban on cmux is scoped to the recovery path, not to the tree** — C1.
   `probed-tool-sessions.ts` owns the cmux row of `/external-tools` and `ct-api.ts` injects its
   query; PR #270 pinned both with `ct-api-real-process.test.ts:312-325`. The blanket predicate the
   original plan carried, "no module under `backend/src` names cmux", would silently undo that, so
   it is dropped and Task 9's guard names its exception instead. Provenance: repo evidence.
3. **`null` never crosses this seam** — C2. `PlansInFlight` and `HarnessAnswer` both carry the
   reason, and the 400 detail is that reason. The original plans lean on a bare `null` meaning
   *could not be known*; the port is written in main's vocabulary rather than translated literally,
   because a translated `null` would have to be re-decorated with a reason at the route. Provenance:
   repo convention.
4. **The refusal has exactly one writer** — C3. `HarnessConversations.known()` returns the
   unlistable-root reason; `WorktreePlans.#refuse` prints it. Two writers print the operator's one
   refusal twice. Per-record skip lines keep their own `stderr` write: they have no other channel.
   Own call.
5. **The issue number is not checked when matching a record to a worktree**, because the path already
   entails it: `record.worktree` is `GitWorkspace.pathFor(root, issue)` and a `prepared` only exists
   for a path of that exact shape (`git-workspace.ts:107,148`). It follows that a recycled
   `.worktrees/<n>` **is** the same issue, so nothing but the recency rule protects a relaunch, and
   the `repository` check earns its place only through the re-pointed-origin case. Repo evidence.
6. **The worktree of a continuation is remembered on disk, not added to the port.** The port hands
   `resume`, `review` and `fix` no worktree, and a headless call needs a `cwd`. Adding `located` to
   those three methods is arguably tidier, but it changes the port, the three use cases that call
   them and their tests — which is what this slice sets out not to touch. The failure modes are not
   symmetric: a missing `cwd` runs `git` and every edit in the wrong tree, a missing note refuses.
   Own call, reversible in phase 4, when the port changes anyway.
7. **`bypassPermissions` is a real escalation over today.** In cmux a person sits beside the session
   and can answer a prompt; headless there is nobody, and the errand has to run `git`, `gh` and
   `node dispatch-check`, so anything less denies them and the call fails. The call runs with `cwd`
   at the prepared worktree. Own call, recorded as closed in §2 so it is not relitigated.
8. **The cap is enforced only while the backend lives**, and **a recovered plan stays recovered until
   its worktree is removed** — which the harvest does when the pull request merges. Until then every
   restart re-recovers it and starts a `ReviewWatch` polling `gh`; closing the cmux window used to be
   an earlier off-switch and there is none now. Both declared rather than fixed: the repair is the
   sweep the BigQuery slice brings, and an off-switch is a terminal state on the record or a
   retention policy, each a decision of its own.
9. **`startedAt` is `Date.now()`'s millisecond**, so two launches inside one millisecond tie and the
   reducer keeps the first — which is directory order, the thing §1 says must not decide.
   Unreachable in practice: `launch` runs once per agent. Repo convention, inherited from the
   original plan. And **`Disk.list` returns names, not `Dirent`s**, so a stray file in the harness
   root costs one extra read that raises `ENOTDIR`; the reader skips it in silence, which keeps every
   double in the tests a plain function returning strings.
10. **This plan has twelve tasks where the design had ten.** Two of the design's tasks did not fit on
    one A4 page and no honest trim brought them under it: the whole of `HeadlessPlanAgents` measured
    5871 characters and the whole of the recovery change 5739, against a ceiling of 3500. Splitting a
    commit is the remedy `writing-plans-prescriptive` names and the one thing the plan writer is
    allowed to split, so the adapter became Tasks 2 and 3 (the module and `launch`, then the three
    continuations) and the recovery change became Tasks 7 and 8 (the change, then its pin). Both
    splits follow the seam the original plans already used, both halves are green at their own
    commit, and the second split buys something: Task 7 gets a real red step of its own, and the
    mutation evidence lands where it belongs, on the pin. My call.
11. **Line 77 of `this-repository.md` is not touched, and neither is
    `conventions-no-restatement.test.ts`.** The original plan dropped `cmux` from "Jira, GitHub,
    cmux, acli and gh exist only in `infrastructure/`" because the backend would no longer name cmux
    at all. Under C1 it still does, in `ct-api.ts`, so the sentence stays true and removing it would
    make the yardstick describe a backend that does not exist. What Task 9 does correct is line 67,
    whose tail claims the cmux query is the one plans are recovered with — false from Task 7 on. My
    call, against the design's file list, on repo evidence.
12. **`api-server.test.ts` is not the only double that has to be renamed in Task 7.**
    `active-plan-recovery.test.ts:82` carries the same `sessions:` collaborator with the same
    message and did not appear in the design's list. Both are in Task 7's file list;
    `grep -rn 'sessions:' __tests__` finds them and nothing else that matters. My call, on repo
    evidence.
13. **The typecheck command is `npm run typecheck`, not `npx tsc -p tsconfig.json`.** Measured in the
    planning session: `typescript` is absent from `backend/node_modules`, so `npx tsc` downloads and
    runs the unrelated `tsc@2.0.4` package and exits 1 with a message about not being the tsc you are
    looking for. The script in `backend/package.json` runs the project's own compiler, and
    `this-repository.md` already declares it as the command that says the graph is sound. It could
    not be exercised here for the same reason, so the implementer runs `npm install` in `backend/`
    before the first task. My call, measured. Everything else in this plan's command blocks was run
    at this base and is green: the fast backend subset (53 files), the frontend suite (35 files) and
    its `npx tsc --noEmit`, and `cd plugin && npm test` (148 files).
