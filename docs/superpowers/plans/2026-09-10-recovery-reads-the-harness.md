# Recovery reads the harness records, not cmux windows

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, §2 of this plan and `backend/conventions/` win.

**Issue:** [#139](https://github.com/mercadona/control-tower/issues/139), phase 1 of its five —
the repair the headless transport made urgent. It rides in the same pull request,
[#299](https://github.com/mercadona/control-tower/pull/299), which is where it broke.

**Branch:** `feat/plan-headless-claude-p`. Every `Current state` block below reads verbatim at
the branch's **head**, not at its base: this plan repairs what the branch itself introduced.

**Tech stack:** Node 24 ESM, vitest 4, React 19. No new dependency.

## 1. Context and goal

`WorktreePlans.inFlight()` reconstructs the plans in flight from two sources. **What worktrees
exist** comes from `git worktree list` through `survey`, on disk. **Who attends each one** comes
from the list of cmux windows, wired at `ct-api.mjs:368` to
`listCmuxWorkspaces({ requireComplete: true })`, and that second source is the one that names the
`agent`. Phase 1 of the issue moved the first to disk; the second never moved, and PR #299 removed
the thing it reads: with `claude -p` as the transport nobody opens a window again.

Three consequences, and the sharpest is not the declared debt.

**`/active-plans` refuses every request with 503.** `listCmuxWorkspaces` answers `null` — not
`[]` — when cmux is absent, its daemon is down or it times out (`plugin/scripts/cmux.js:106`, the
final `catch`). `null` means *could not be known*: `inFlight()` propagates it, `recover()` returns
`false` without ever setting `conclusive`, and `ActivePlansRoute` refuses with 503
(`active-plans-route.js:88`) — including the plans the running process started itself, which are
sitting in memory. Measured on this machine on 2026-09-10: `cmux list-windows --json` exits 1 with
`Failed to connect to socket`, because the app is simply not running. So this is not a
degradation after a restart: it is the first request, on any machine whose cmux is not up.

**A restart loses the plan.** Even where cmux answers `[]`, a headless plan has no window, so
`/active-plans` drops it and the two watchers never take their baseline.

**And a recovered plan could not be driven anyway.** The `agent` a cmux recovery names is a handle
like `workspace:20`. Handed back to `/implement-plan` it reaches `HeadlessPlanAgents.#worktreeOf`
(`headless-plan-agents.js:181`), which looks for `harness/workspace:20/conversation.json` and
refuses. `DiskImplementationStartRegistry.matches` compares that same field byte for byte
(`disk-implementation-start-registry.js:53-56`) against a handle cmux reassigns across restarts.
Both start working here, and that is what makes this a repair rather than a way to silence a 503.

The evidence recovery needs is **already written**. `HeadlessPlanAgents.launch` records
`<state root>/harness/<agent>/conversation.json` with the worktree the conversation runs in
(`headless-plan-agents.js:117-121`), and reads it back to `--resume`. And §9.1 of the previous
plan measured that `--resume` recovers a conversation **from a new process**: the record is the
plan in flight, and the process being alive is not what makes it recoverable. Nothing here
journals a phase — the record is the receipt of a call that was made, and `ActivePlanRecovery`
goes on deriving the phase from its `matches` predicates.

### Desired end state

- **Recovery reads the harness.** `WorktreePlans` asks a reader of `conversation.json` records
  who attends each prepared worktree, and cmux is asked nothing. `/active-plans` answers 200 with
  no cmux on the PATH, and the `agent` it serves is the UUID `--resume` accepts.
- **A conversation record says which plan it belongs to**: worktree, issue, repository and the
  instant it was launched — the same instant its first call records.
- **The newest launch wins.** When two conversations name one worktree, the one with the greatest
  `startedAt` attends it. This, alone, is what makes relaunching a plan safe.
- **A conversation of another repository does not attend the worktree**, which is the one
  mismatch the composition can produce: a clone whose `origin` was re-pointed between the launch
  and the recovery.
- **A missing harness directory is zero plans, conclusively**; only a root that cannot be listed
  is *could not be known*. One unreadable record is skipped with its path on stderr and the other
  plans still come back.
- **`CmuxPlanAgents` and its launch policy leave the tree**, with their tests, and
  `no-window-titles-parsed.test.js` guards an empty list instead of one module. No module under
  `backend/src` names cmux, and `backend/conventions/this-repository.md` stops listing it as a
  collaborator of the backend.
- **The entrypoint's assembly of the plan agent is explicit again**: `#headlessAgents` and
  `#brief` are inlined into `run()`, where the rest of the graph is already built node by node, so
  the writer of the records and their reader are visibly wired to the same directory.
- **No operator-facing sentence still says cmux.** The two banners of `Home.tsx` that explain a
  lost plan and an inconclusive recovery describe what actually happened.

### Out of scope

- **Whether a call is still running.** Nothing on disk says how a call ended — the debt the
  branch already declared — and recovery does not need it: `--resume` works against a conversation
  whose process is gone. It is the same missing datum as the `harness_calls` row that decision 5
  of the issue wants (cost, turns, duration), so it is closed there and not here.
- **The 503 itself.** `inFlight()` keeps its `null`, `recover()` keeps its `false` and the route
  keeps its refusal. The issue puts the removal of that outcome in phase 4, and this slice only
  stops it from firing on every request.
- **Retention of the harness directory**, and with it the bound on how long a plan stays
  recoverable. §9.3 states what that bound really is, because §9 of the previous plan already
  declared the growth and this slice must not pretend the survey closes it.
- **`plugin/scripts/cmux.js` and everything else in the plugin.** cmux stays the plugin's
  transport for `/ct-next`, which still imports `launch-sentinel.js` and `shquote.js`
  (`plugin/scripts/ct-next.mjs:17-22`); what leaves is the backend's use of all three.
- **The strings that name cmux inside test doubles and fixtures** (`api-server.test.js:111`,
  `start-plan.test.js`, `implement-plan-route.test.js:225`, `StartPlanMother.ts:76`,
  `ImplementPlanMother.ts:25` and the assertions that read them). They are arbitrary failure
  messages of doubles, not operator-facing copy and not claims about the transport. The two
  exceptions are a test **name** and a `describe`, which `plugin/conventions/testing.md` says are
  sentences: Task 6 fixes both.
- **The manual end-to-end of the previous plan's §8**, still unrun. This slice makes it possible
  to watch — the frontend can list the plan again — but running it is a decision about spend.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| What recovery reads | `<state root>/harness/<agent>/conversation.json`, one per conversation, written by `launch` |
| Who the agent is | the name of the directory the record sits in — the UUID `launch` minted. It is never a field of the record |
| What the record carries | `{ worktree, issue, repository, startedAt }` — four primitives, written once |
| `startedAt` | the value `launch` already reads from its clock for the first call, so the conversation and its `write-plan` call share the instant |
| What makes a plan in flight | a prepared worktree in the survey that a well-formed record names. Liveness of the process is not consulted |
| Two records for one worktree | the greatest `startedAt` attends it. This is the whole protection against a relaunch |
| Matching a record to a worktree | same worktree path (or the same real path) **and** same repository. **Not** the issue number: `record.worktree` is always `GitWorkspace.pathFor(root, issue)` and a `prepared` only exists when its path is that same composition (`git-workspace.js:84-91`), so the path already entails the issue and a check on it could never fail |
| Why `repository` is still checked | it is the one mismatch the composition can produce — a clone whose `origin` was re-pointed between the launch and the recovery, which would otherwise recover the plan under the wrong repository and send its `gh` calls there |
| The harness root missing | `[]` — zero plans, conclusively. A first start has no harness directory |
| The harness root unlistable | `null` — could not be known, which is what `inFlight()` already propagates |
| How the two are told apart | `failure.code === 'ENOENT'`, the same test `Disk.read` already makes (`ct-api.mjs:111`) |
| One bad record | skipped, its path on stderr, the rest still recovered. It never makes the whole answer inconclusive |
| Where the reader lives | `backend/src/infrastructure/harness-conversations.js`, a new adapter. The alternative — a tenth collaborator `list` on `HeadlessPlanAgents` — is rejected: that class would then both write and enumerate, and `WorktreePlans` would depend on the launcher to recover |
| Where the record's shape lives | `HarnessConversation`, exported from `headless-plan-agents.js` beside `HarnessCall`, because it is the boundary model of that adapter and both ends must agree on it |
| `WorktreePlans`' collaborator | `conversations`, an async thunk answering `HarnessConversation[] | null`. `sessions` and `cwdKnown` go |
| `CmuxPlanAgents` | deleted in this pull request, with `launch-policy.js` and both of their tests (the human's call, 2026-09-10) |
| `backend/conventions/this-repository.md:56` | drops `cmux` from the collaborators it says live only in `infrastructure/`: after Task 5 the backend has no such collaborator, and a convention describing one is declared debt |
| The entrypoint | `#headlessAgents` and `#brief` are inlined into `run()`; no private factory hides a node of the graph |
| The frontend | the two banners of `Home.tsx` stop naming cmux. Their behaviour, their variants and the shape of `/active-plans` do not change |

## 3. Reference patterns

Files to imitate: `backend/src/infrastructure/headless-plan-agents.js` (the adapter that writes
what this slice reads, and the file `HarnessConversation` joins — a boundary model sharing its
adapter's file, as `HarnessCall` already does);
`backend/src/infrastructure/disk-checkout-registry.js` (a reader of the state root that degrades
to a declared value instead of throwing); `backend/src/infrastructure/run-file-progress.js` (a
reader whose collaborators are functions handed in by the entrypoint);
`backend/src/infrastructure/worktree-plans.js` (the subject: how it degrades, how it warns).

Rules to obey: `backend/conventions/this-repository.md` (the layering, the vocabulary, the test
commands and the no-declared-debt rule); `plugin/conventions/architecture.md`;
`plugin/conventions/boundaries.md`; `plugin/conventions/domain.md`;
`plugin/conventions/simplicity.md` (a guard no use case can reach is not a guard);
`plugin/conventions/style.md`; `plugin/conventions/testing.md` (the name is the sentence,
mothers, doubles, outside-in, and no test that repeats a dimension already covered).

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/infrastructure/headless-plan-agents.js` | modify | the entrypoint, the reader | Current state + Contract (Task 1) |
| `backend/__tests__/infrastructure/headless-plan-agents.test.js` | modify | vitest | none (body by TDD) |
| `backend/__tests__/infrastructure/headless-contract-real-process.test.js` | modify | vitest | none (body by TDD) |
| `backend/src/infrastructure/harness-conversations.js` | create | `WorktreePlans` | Contract (Task 2) |
| `backend/__tests__/infrastructure/harness-conversations.test.js` | create | vitest | none (body by TDD) |
| `backend/src/infrastructure/worktree-plans.js` | modify | `ActivePlanRecovery` | Contract (Task 3) |
| `backend/__tests__/infrastructure/worktree-plans.test.js` | modify | vitest | none (body by TDD) |
| `backend/src/infrastructure/ct-api.mjs` | modify (Task 3, then Task 5) | the operator | Contract (Task 3), Call site (Task 5) |
| `backend/__tests__/infrastructure/ct-api-real-process.test.js` | modify (Tasks 3 and 4) | vitest | none (body by TDD) |
| `backend/__tests__/infrastructure/cmux-contract-real-process.test.js` | delete | vitest | none (Task 3) |
| `backend/src/infrastructure/cmux-plan-agents.js` | delete | nobody | none (Task 6) |
| `backend/src/domain/policies/launch-policy.js` | delete | nobody | none (Task 6) |
| `backend/__tests__/infrastructure/cmux-plan-agents.test.js` | delete | vitest | none (Task 6) |
| `backend/__tests__/infrastructure/pull-request-review-loop.test.js` | modify | vitest | Current state (Task 6) |
| `backend/__tests__/infrastructure/no-window-titles-parsed.test.js` | modify | vitest | Current state (Task 6) |
| `backend/__tests__/infrastructure/implement-plan-route.test.js` | modify | vitest | none (Task 6) |
| `backend/conventions/this-repository.md` | modify | the yardstick | Final text (Task 6) |
| `backend/__tests__/conventions-no-restatement.test.js` | modify | vitest | none (Task 6) |
| `frontend/src/pages/home/Home.tsx` | modify | the operator | Call site (Task 7) |
| `frontend/src/pages/home/__tests__/Home.restoreWorkflow.test.tsx` | modify | vitest | none (Task 7) |

## 5. Interfaces

Consumes: `HeadlessPlanAgents.CONVERSATION_FILE`, already exported, and the record `launch`
writes under it.

Produces:
`HarnessConversation`, exported from `backend/src/infrastructure/headless-plan-agents.js`, with
`static isWellFormed(record) => boolean`, `constructor({ agent, worktree, issue, repository,
startedAt })` and `get json()`. It is deliberately one type for both directions: the writer knows
the agent and leaves it out of `json`, because the agent is the directory the file is written
into; the reader puts it back from that directory's name. An `agent` field inside the record could
disagree with its own path, and nothing would arbitrate.
`HarnessConversations`, exported from `backend/src/infrastructure/harness-conversations.js`, with
`constructor({ list, read, stderr, runsIn })` and `known() => Promise<HarnessConversation[] |
null>`.
`WorktreePlans`' constructor takes `conversations` where it took `sessions`.

## 6. Test strategy

vitest, run from `backend/` and never from the repository root, per
`backend/conventions/this-repository.md:133`. The fast subset during a task is
`npx vitest run --exclude '**/*-real-process.test.js'`; the whole suite runs before the task is
handed over. Task 7 runs the frontend's own suite from `frontend/` with `npx vitest run`.

Outside-in: the two new units (`HarnessConversation`'s shape, `HarnessConversations`' reading)
are pinned in their own tests with functions as doubles, as `run-file-progress.js`'s tests do;
`WorktreePlans` is pinned against real `HarnessConversation` instances, because
`plugin/conventions/testing.md` forbids doubling a value; and the composition is pinned once for
real by `ct-api-real-process.test.js`, which starts the entrypoint as a process, seeds a record on
disk and reads `/active-plans` over HTTP. That real-process test is the acceptance of this slice
and no unit test replaces it: the defect being repaired lives in the wiring.

**Every task is green at its own commit.** That is why Task 3 carries the entrypoint's wiring and
the deletion of `cmux-contract-real-process.test.js`: renaming the collaborator without them
leaves five red cases.

## 7. Tasks

### Task 1 — The conversation record names the plan it belongs to

**Objective:** `launch` records the issue, the repository and the launch instant beside the
worktree, so a reader can tell which plan a conversation attends and which of two is newest.

**Files:**
- Modify: `backend/src/infrastructure/headless-plan-agents.js`
- Modify: `backend/__tests__/infrastructure/headless-plan-agents.test.js`
- Modify: `backend/__tests__/infrastructure/headless-contract-real-process.test.js`

Current state (backend/src/infrastructure/headless-plan-agents.js, lines 116-121):

```javascript
    await this.#ensureDirectory(directory, PlanAgentNotLaunched)
    await this.#writeRecord(
      this.#conversationPathFor(agent),
      JSON.stringify({ worktree: briefing.located.path }),
      PlanAgentNotLaunched
    )
```

Contract (backend/src/infrastructure/headless-plan-agents.js):

```javascript
export class HarnessConversation {
  // well formed: an object that is not null and not an array, whose worktree and repository are
  // strings of length > 0 and whose issue and startedAt are integers > 0
  static isWellFormed(record)
  constructor({ agent, worktree, issue, repository, startedAt })
  get json() // { worktree, issue, repository, startedAt } — the agent IS the directory's name
}
```

`launch` writes `JSON.stringify(new HarnessConversation({ agent, worktree: briefing.located.path,
issue: briefing.issue.number, repository: briefing.repository.text, startedAt }).json)`, with the
`startedAt` of line 111. `#worktreeOf` swaps its two-field check (198-200) for
`HarnessConversation.isWellFormed`, refusing with `` `${agent} recorded a conversation at ${path}
that is not a well-formed record` ``. The two failure families do not move.

**TDD:** red first —
`it('launch_records_which_plan_the_conversation_attends_and_when_it_started')`, parsing the written
`conversation.json` and asserting it **equals** `{ worktree, issue: 33, repository: 'owner/repo',
startedAt }` with the mother's clock value, so a record that only carries the worktree fails.

**Tests:** added: the one above;
`a_conversation_recorded_without_the_issue_it_belongs_to_refuses_instead_of_resuming_a_plan_it_cannot_name`;
`a_conversation_recorded_as_a_json_array_refuses_instead_of_reading_fields_off_a_list`;
`a_conversation_whose_repository_is_the_empty_string_refuses_instead_of_naming_no_repository`.
Removed on purpose: `a_conversation_records_the_worktree_its_calls_have_to_run_in` (line 445),
whose literal `` `{"worktree":"…"}` `` the first test above subsumes over four fields.
The two `…_with_no_worktree_…` and `…_the_json_literal_null_…` cases keep their names on the new
message, and the mother writes the four fields.

**Verification:** the four fields are written; the one-field literal is gone.

```bash
cd backend && test -z "$(grep -n 'JSON.stringify({ worktree' src/infrastructure/headless-plan-agents.js)"
cd backend && npx vitest run __tests__/infrastructure/headless-plan-agents.test.js   # exit 0: the record, its four refusals
cd backend && npx vitest run __tests__/infrastructure/headless-contract-real-process.test.js   # exit 0: a real claude
cd backend && npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing else read it
```

### Task 2 — `HarnessConversations`, the reader of those records

**Objective:** a new adapter answers who is attending, by listing the harness root and reading one
record per directory, and it separates *zero plans* from *could not be known*.

**Files:**
- Create: `backend/src/infrastructure/harness-conversations.js`
- Create: `backend/__tests__/infrastructure/harness-conversations.test.js`

Contract (backend/src/infrastructure/harness-conversations.js):

```javascript
import { HarnessConversation, HeadlessPlanAgents } from './headless-plan-agents.js'

export class HarnessConversations {
  // list(path) -> Promise<string[]>: the names inside the harness root. It THROWS, and the
  //   discriminator is `failure.code === 'ENOENT'` — never the message.
  // read(path) -> Promise<string|null>: null when the file is not there (Disk.read's contract).
  constructor({ list, read, stderr, runsIn })

  // HarnessConversation[]  every well-formed record, agent = the directory it sits in
  // []                     ENOENT on the root: it does not exist, so zero plans, conclusively
  // null                   any other listing failure: could not be known
  async known()
}
```

The record's path is `${runsIn}/${agent}/${HeadlessPlanAgents.CONVERSATION_FILE}` — the same
composition `#conversationPathFor` uses, and the reason this module imports the constant instead
of repeating the file name. A directory whose read answers `null` is skipped in silence: it is
not a plan. A read that throws, a text that is not JSON and a record `isWellFormed` rejects are
each skipped with one line on `stderr` starting `plans in flight: `, the prefix
`worktree-plans.js` already uses for the same kind of degradation.

**TDD:** red first —
`it('a_harness_root_that_cannot_be_listed_could_not_be_known_so_recovery_never_declares_zero_plans')`,
with `list` throwing an `EACCES` error and the assertion that `known()` is `null`. Its boundary is
the case beside it, `…_no_harness_directory_…`, whose `list` throws ENOENT and must answer `[]`:
one code apart, opposite answers, and the pair is what makes the 503 impossible to reintroduce.

**Tests:** added:
`a_record_names_its_plan_by_its_fields_and_its_agent_by_the_directory_it_sits_in`;
`a_state_root_with_no_harness_directory_is_zero_plans_and_not_an_answer_that_could_not_be_known`;
`a_harness_root_that_cannot_be_listed_could_not_be_known_so_recovery_never_declares_zero_plans`;
`a_record_that_is_not_json_is_skipped_with_its_path_on_stderr_and_the_other_plans_still_come_back`;
`a_record_whose_issue_is_zero_is_skipped_instead_of_attending_a_worktree`;
`a_record_whose_issue_is_one_is_the_smallest_one_that_attends_a_worktree`;
`a_record_that_is_a_json_array_is_skipped_instead_of_reading_fields_off_a_list`;
`a_record_that_cannot_be_read_is_skipped_with_its_path_on_stderr`;
`a_directory_with_no_conversation_record_is_not_a_plan_and_says_nothing`.

**Verification:** the reader is covered on its own, and the two degradations are told apart.

```bash
cd backend && npx vitest run __tests__/infrastructure/harness-conversations.test.js   # exit 0: nine cases
cd backend && test "$(grep -c 'ENOENT' src/infrastructure/harness-conversations.js)" -eq 1
cd backend && test -z "$(grep -n 'conversation.json' src/infrastructure/harness-conversations.js)"
cd backend && npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing else moved
```

### Task 3 — Recovery attends by conversation, wired end to end

**Objective:** the agent of a plan in flight comes from the harness records, and the entrypoint
hands `WorktreePlans` the reader instead of cmux.

**Files:**
- Modify: `backend/src/infrastructure/worktree-plans.js`,
  `backend/__tests__/infrastructure/worktree-plans.test.js`,
  `backend/src/infrastructure/ct-api.mjs`,
  `backend/__tests__/infrastructure/ct-api-real-process.test.js`
- Delete: `backend/__tests__/infrastructure/cmux-contract-real-process.test.js`

Contract (backend/src/infrastructure/worktree-plans.js):

```javascript
constructor({ checkouts, survey, conversations, story, realpathOf, stderr })
// conversations() -> Promise<HarnessConversation[] | null>, awaited by inFlight (64) for
//   this.sessions(); its null still means could not be known
#agentOf(known, prepared, repository)
//   keeps those whose repository === repository.text and whose worktree is
//   prepared.located.path or resolves to it; answers the greatest startedAt's agent, or null
```

Gone with cmux: the `CmuxPlanAgents` import, `#opensAPlan` (23-26) and `#knowableIn` (57-62),
whose `cwdKnown` degradation has no counterpart on disk. `#toSurvey` reads
`conversation.worktree` for `entry.cwd`, unfiltered.
In `ct-api.mjs` the `listCmuxWorkspaces` import (29) goes with its use (368), `Disk` gains
`static async list(path) { return readdir(path) }` (`readdir` added to line 1), and `run()` builds
a `HarnessConversations` on `Disk.list`, `Disk.read`, `process.stderr.write` and
`join(asked.stateRoot, CtApi.#HARNESS_DIRECTORY)` before `recovery`, wired as
`conversations: () => harness.known()`. That `join` duplicates `#headlessAgents`' own for two
commits; Task 5 collapses it. `worktree-plans.test.js` drops its `CmuxPlanAgents` import (10) and
the `SessionsOfCmux` mother (30-50).

**TDD:** red first —
`it('the_newest_launch_is_the_conversation_that_attends_a_worktree_two_of_them_name')`, the older
record **first** so directory order cannot pass by luck, `startedAt` differing by one.

**Tests:** added: that one, and
`a_conversation_of_another_repository_does_not_attend_a_worktree_whose_path_it_matches`.
Removed on purpose:
`a_session_that_hides_its_directory_does_not_lend_its_agent_while_another_one_shows_its_own`,
`sessions_that_all_hide_their_directory_is_not_the_same_as_no_plans_in_flight`,
`a_session_whose_ref_is_not_a_handle_names_no_agent`,
`a_worktree_the_dispatcher_opened_is_not_adopted_as_a_plan_of_this_backend`,
`a_session_the_dispatcher_opened_does_not_put_its_checkout_on_the_list_to_survey`,
`an_entry_that_is_not_an_object_…` (Task 2 holds it), and every case of the deleted
`cmux-contract-real-process.test.js`. There the `ACmuxWithNoWindows` and `ACmuxAttendingOnePlan`
fixtures and `CMUX_FAKE` go: `the_plans_in_flight_are_recovered_…` loses `PATH: answering.path`,
`a_plan_whose_session_names_one_path_and_git_the_other_…` becomes
`a_plan_whose_conversation_names_…`, reseeded on a record whose `worktree` is the logical path
and still asserting the physical one. Surviving cases rename `session` to `conversation`.

**Verification:** no window is named, and recovery runs on records.

```bash
cd backend && test -z "$(grep -rn 'Cmux\|cwdKnown\|listCmuxWorkspaces' src/infrastructure/worktree-plans.js src/infrastructure/ct-api.mjs)"
cd backend && test -z "$(grep -rn 'Cmux' __tests__/infrastructure/worktree-plans.test.js)"
cd backend && npx vitest run   # exit 0: the whole suite, real processes
```

### Task 4 — The regression pin: `/active-plans` answers with no cmux on the PATH

**Objective:** the defect this slice exists for gets a test of its own, at the only altitude that
would have caught it — a real process, no cmux anywhere, an HTTP answer.

**Files:**
- Modify: `backend/__tests__/infrastructure/ct-api-real-process.test.js`

No code — the behaviour landed in Task 3; this commit adds the case that pins it.

**TDD:** mutation evidence instead of red-then-green, because Task 3 already made the behaviour
true. Write the case, see it green, then revert `conversations: () => harness.known()` to
`sessions: () => listCmuxWorkspaces({ requireComplete: true })`, run it again and **see it fail
with 503**, restore and see it green. The report carries all three outputs; without the middle
one the case proves nothing.

**Tests:** added:
`active_plans_is_served_with_no_cmux_on_the_path_because_no_window_is_asked_about_any_more` — a
record seeded under `<CLAUDE_CONFIG_DIR>/control-tower/harness/<uuid>/conversation.json`
(`Invocation.STATE_DIRECTORY` is `control-tower`, `invocation.js:16`) beside a real checkout with
a `.worktrees/<n>` prepared for the same issue, `PATH` set to a directory holding no `cmux` at
all, and the assertion that `/active-plans` answers **200** with that plan and its UUID agent.
Removed on purpose: none.

**Verification:** the pin passes, and the whole suite with it.

```bash
cd backend && npx vitest run __tests__/infrastructure/ct-api-real-process.test.js   # exit 0: 200 with no cmux on PATH
cd backend && test "$(grep -c 'no_window_is_asked_about_any_more' __tests__/infrastructure/ct-api-real-process.test.js)" -eq 1
cd backend && npx vitest run   # exit 0: the whole suite, real processes included
```

### Task 5 — The entrypoint's assembly is explicit again

**Objective:** the plan agent is built where every other node of the graph is built, so the
harness root is written once and both ends of the record visibly share it.

**Files:**
- Modify: `backend/src/infrastructure/ct-api.mjs`

Current state (backend/src/infrastructure/ct-api.mjs, lines 333-333):

```javascript
    const planAgents = CtApi.#headlessAgents(environment, asked.stateRoot)
```

Call site (backend/src/infrastructure/ct-api.mjs):

```javascript
    const planAgents = new HeadlessPlanAgents({
      start: new DetachedRun({ bin: HeadlessPlanAgents.BIN, budgetMs: CtApi.#PLAN_CALL_TIMEOUT_MS, env: environment }),
      makeDirectory: Disk.makeDirectory,
      write: Disk.atomicWrite,
      read: Disk.read,
      mint: randomUUID,
      clock: Date.now,
      brief: new PlanAgentBrief({ dispatchCheck: PluginTree.dispatchCheck(), conventions: PluginTree.conventions(), ctStep: PluginTree.ctStep() }),
      runsIn: harnessRoot,
      pluginRoot: PluginTree.root(),
```

`#headlessAgents` (lines 202-218) and `#brief` (194-200) are **deleted**, their bodies becoming
the block above, placed where line 333 is today. `const harnessRoot = join(asked.stateRoot,
CtApi.#HARNESS_DIRECTORY)` is declared once, before it, and Task 3's `HarnessConversations` takes
that name in place of its own `join`, so the constant appears three times in the file: the
declaration and the two collaborators. `#HARNESS_DIRECTORY` stays a static. No comment survives
into the code.

**TDD:** No TDD — a pure refactor with no behaviour to drive red. Its net is
`ct-api-real-process.test.js`, which starts the entrypoint as a real process and would fail to
listen if the assembly lost an argument.

**Tests:** N/A — none added, none removed.

**Verification:** the two factories are gone, the constant is written once and used twice, and a
real process still assembles and listens.

```bash
cd backend && test -z "$(grep -n '#headlessAgents\|#brief' src/infrastructure/ct-api.mjs)"
cd backend && test "$(grep -c 'harnessRoot' src/infrastructure/ct-api.mjs)" -eq 3
cd backend && test "$(grep -c "join(asked.stateRoot, CtApi.#HARNESS_DIRECTORY)" src/infrastructure/ct-api.mjs)" -eq 1
cd backend && npx vitest run __tests__/infrastructure/ct-api-real-process.test.js   # exit 0: it still assembles and listens
cd backend && npx vitest run   # exit 0: the whole suite, real processes included
```

### Task 6 — `CmuxPlanAgents` and its launch policy leave the tree

**Objective:** the transport nobody builds is deleted, the guard watches an empty list, and the
yardstick stops declaring a collaborator the backend no longer has.

**Files:**
- Delete: `backend/src/infrastructure/cmux-plan-agents.js`,
  `backend/src/domain/policies/launch-policy.js`,
  `backend/__tests__/infrastructure/cmux-plan-agents.test.js`
- Modify: `backend/__tests__/infrastructure/pull-request-review-loop.test.js`,
  `backend/__tests__/infrastructure/no-window-titles-parsed.test.js`,
  `backend/__tests__/infrastructure/implement-plan-route.test.js`,
  `backend/conventions/this-repository.md`,
  `backend/__tests__/conventions-no-restatement.test.js`

Current state (backend/__tests__/infrastructure/pull-request-review-loop.test.js, lines 126-126):

```javascript
    const planAgents = new CmuxPlanAgents({ brief: this.brief, run: (argv) => this.cmux.run(argv) })
```

Final text (backend/conventions/this-repository.md):

```markdown
Jira, GitHub, acli and gh exist only in `infrastructure/`.
```

That replaces line 56, and `conventions-no-restatement.test.js:34`'s literal
`'Jira, GitHub, cmux, acli and gh exist only in'` moves with it.
The guard becomes
`it('no_module_of_the_backend_names_a_cmux_workspace_now_that_nothing_opens_one')`, asserting
`toEqual([])` for `'ct-plan-'` and for `'plugin/scripts/cmux.js'`, so the import is watched too.
In the loop test, `CmuxDouble` becomes `DetachedRunDouble` with `start(spec)` recording `spec.argv`
and returning `{ pid: 4242 }` and a `stop()` that records nothing; `AGENT` becomes
`'6f1a2b3c-0000-4000-8000-000000000001'`; the composition becomes `new HeadlessPlanAgents({ start:
this.detached, makeDirectory: async () => {}, write: async () => {}, read: async () =>
JSON.stringify({ worktree: '/repo/.worktrees/7', issue: 7, repository:
'josemerca/ct-loop-sandbox', startedAt: 1 }), mint: () => AGENT, clock: () => 1, brief: this.brief,
runsIn: '/state/harness', pluginRoot: '/plugin' })` — nine collaborators, none omitted. Its
assertion becomes the single literal argv `['-p', <fixErrand>, '--output-format', 'stream-json',
'--verbose', '--permission-mode', 'bypassPermissions', '--fallback-model', 'opus', '--model',
'sonnet', '--plugin-dir', '/plugin', '--resume', AGENT]`. Its `describe` (line 146) drops `and
cmux` for `and the detached run`, and `implement-plan-route.test.js:165` renames
`…_an_argument_of_cmux` to `…_an_argument_of_claude`; that body does not change.

**TDD:** no new behaviour — the red step is the guard's `toEqual([])`, which fails while either
source file exists and passes when both are gone.

**Tests:** removed on purpose: every case of `cmux-plan-agents.test.js` — the adapter and
`LaunchPolicy` — whose subject is deleted. Added: none; the loop test keeps its three cases on a
new composition.

**Verification:** no cmux under `backend/src`, no plugin launcher imported by it, and the
yardstick's own guard still holds.

```bash
cd backend && test -z "$(grep -rl 'cmux\|Cmux' src)"
cd backend && test -z "$(grep -rl 'launch-sentinel\|shquote' src)"
cd backend && test ! -e src/infrastructure/cmux-plan-agents.js
cd backend && test ! -e src/domain/policies/launch-policy.js
cd backend && npx vitest run   # exit 0: the whole suite, real processes included
```

### Task 7 — No banner tells the operator about cmux

**Objective:** the two sentences the operator reads when a plan is lost or recovery is
inconclusive describe what actually happened, now that nothing asks cmux.

**Files:**
- Modify: `frontend/src/pages/home/Home.tsx`
- Modify: `frontend/src/pages/home/__tests__/Home.restoreWorkflow.test.tsx`

Call site (frontend/src/pages/home/Home.tsx):

```tsx
// line 251, the plan the backend no longer holds:
description="El backend ya no tiene este plan activo. Descarta el estado para crear una solicitud nueva."
// line 278, recovery that could not reach a conclusion:
description="El backend contestó, pero no pudo leer sus registros de planes. No puede saber qué planes hay activos. No se harán acciones hasta que se confirme el estado."
```

Nothing else moves: the variants, the
conditions that render them and the shape of `/active-plans` are untouched, and the fixtures that
carry `cmux` inside a refusal's `detail` stay as they are — they are the backend's message, not
this page's words.

**TDD:** red first — `Home.restoreWorkflow.test.tsx:170`'s assertion changes from
`'backend o cmux ya no tiene este plan activo'` to `'El backend ya no tiene este plan activo'`,
which fails against the current copy for exactly that reason.

**Tests:** added: none. Removed on purpose: none — the case at line 170 keeps its name and moves
its expected text.

**Verification:** no page of the frontend names cmux in its own copy, and its suite is green.

```bash
cd frontend && test -z "$(grep -n 'cmux' src/pages/home/Home.tsx)"
cd frontend && npx vitest run src/pages/home/__tests__/Home.restoreWorkflow.test.tsx   # exit 0: the reworded banner
cd frontend && npx vitest run   # exit 0: the whole frontend suite
```

## 8. Global verification

The suite proves the pieces. What it cannot prove is that the frontend lists a plan again after
the backend that wrote it was killed, so run that by hand once: start the backend,
`POST /start-plan`, wait for `~/.claude/control-tower/harness/<uuid>/conversation.json` to appear,
kill the backend, start it again and ask `/active-plans` — the plan comes back with the same UUID
as its agent, the same worktree and the same story, and that UUID is one `/implement-plan` can
resume. Then read the stderr of the second start: it says nothing about cmux, because nothing
asked.

The predicates below are what a program can score.

```bash
cd backend && npx vitest run   # exit 0: the whole backend suite, real-process tests included
cd frontend && npx vitest run   # exit 0: the whole frontend suite
cd backend && test -z "$(grep -rl 'cmux\|Cmux' src)"
cd backend && npx vitest run __tests__/infrastructure/no-window-titles-parsed.test.js   # exit 0: no module names a window
cd backend && test -z "$(git status --porcelain)"
node --input-type=module -e "import {readFileSync} from 'node:fs'; import {validatePlan} from './plugin/scripts/plan-contract.js'; const f='docs/superpowers/plans/2026-09-10-recovery-reads-the-harness.md'; const r=validatePlan(readFileSync(f,'utf8'),{readFile:(p)=>readFileSync(p,'utf8')}); if(!r.ok){console.error(r.violations.map((v)=>v.rule+': '+v.detail).join('\n'));process.exit(1)}"
```

## 9. Assumptions

1. **The plan's file name carries no `issue-139-` segment**, unlike the branch's other plan. Own
   call, with a measured reason: `checkPlans` validates **every** file matching `issue-<n>-`
   (`plugin/scripts/plan-contract.js:503-508`), `--release` reads the cited files at the **base of
   the branch**, and this plan cites files the branch itself introduced. Under that segment it
   would make the release gate of #139 unsatisfiable. The plan of record for #139 stays
   `2026-09-09-issue-139-adaptador-headless-claude-p.md`; §8 validates this one directly.
2. **The issue number is not checked when matching a record to a worktree**, because the path
   already entails it: `record.worktree` is `GitWorkspace.pathFor(root, issue)` and a `prepared`
   only exists for a path of that exact shape (`git-workspace.js:84-91`). Repo evidence, found by
   the architect's review of this plan. It follows that a recycled `.worktrees/<n>` **is** the same
   issue, so nothing but the recency rule protects a relaunch, and the `repository` check earns
   its place only through the re-pointed-origin case named in §2.
3. **A recovered plan stays recovered until its worktree is removed**, which the harvest does when
   the pull request merges. Until then every restart re-recovers it and starts a `ReviewWatch`
   polling `gh` every 30 seconds (`ct-api.mjs:294`, `active-plan-recovery.js:70`). Closing the cmux
   window used to be an earlier off-switch; there is none now, and an abandoned plan whose worktree
   nobody removes is polled indefinitely. Own call to declare rather than fix: an off-switch is
   either a terminal state on the record — the debt §1 leaves to `harness_calls` — or a retention
   policy, and both are decisions of their own.
4. **A record whose clone was deleted still pushes its root into `#toSurvey`**, so `survey` fails
   and one `plans in flight: … could not be surveyed` line prints on every start, forever. Same
   cause as 3, same decision.
5. **`startedAt` is `Date.now()`'s millisecond**, so two launches inside one millisecond would tie
   and the reducer keeps the first — which is directory order, the thing the desired end state says
   must not decide. Repo convention: the previous plan declared the same grain for a call's
   directory and judged it unreachable, and `launch` runs once per agent.
6. **Existing records stop resuming.** A `conversation.json` written by this branch's head carries
   only `worktree`, so after Task 1 `#worktreeOf` refuses it with `PlanAgentNotNamed`. Own call:
   the branch is unmerged, the records that exist are from its own manual runs, and the remedy is
   to relaunch the plan — which is decision 7 of the issue.
7. **The 503 stays reachable** — `list` throwing something that is not ENOENT still means *could
   not be known*. Issue decision: the removal of that outcome is phase 4's, and a disk that cannot
   be read is exactly the case it was written for.
8. **`Disk.list` returns names and not `Dirent`s**, so a directory entry that is not a directory is
   not silently absent: reading `<runsIn>/.DS_Store/conversation.json` raises `ENOTDIR`, not
   `ENOENT`, and `Disk.read` rethrows it. The reader treats `ENOTDIR` the same as a missing record —
   skipped in silence, not warned about — so a stray file such as macOS's `.DS_Store` costs one
   extra read and nothing on stderr. Own call: it keeps every double in the tests a plain function
   returning strings.
9. **Task 6's judge is asked to accept a deletion with no new assertion behind it.** Own call, and
   the guard's `toEqual([])` is the assertion: it is red while either file exists.
