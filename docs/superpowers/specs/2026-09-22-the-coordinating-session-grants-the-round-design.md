# The coordinating session grants the round

Design for #521, the follow-up to #517 that was merged on 2026-09-22 as
`22559dbb`. Written the same day, against `main` at `a87d898c`.

## The decision this records

#517 delivered half of what was decided on 2026-09-21: when the judge vetoes a
task three times, the reason reaches the **coordinating session**. What it did
with the other half — the way back in — is hand the person a shell command. The
line it sends ends *"Do not run it yourself."*, so the round is granted by a
human typing `ct-step reopen` inside the slice's worktree.

**That is the part this changes.** The coordinating session asks the person what
to change and sends **their words** to the backend, which grants the round and
lets the run carry on. The person keeps what was always theirs: the decision and
the words. The page still gains no button, and there is still no limit on
rounds — the limit is the person.

## Why the merged half cannot stand as it is

One reason of principle and two of fact.

**It is the only action on a slice that goes round the backend.** The prompt
every coordinating session already carries says it in one line
(`phase-prompt.ts`, `CHANGE_TO_A_SLICE`): *"A change a person asks you for on a
slice travels through you and never round you."* A change goes out as
`POST /slices/<issue>/message`, a held change as `POST /slices/<issue>/held-change`,
recovery as `POST /recover-plan`. A veto is the one thing that leaves the session
and lands in a terminal.

**Whoever reads the line cannot execute it.** `ct-step` resolves the repository
with `git rev-parse --show-toplevel` of its own cwd (`ct-step.mjs:225`) and the
run file as `<repoRoot>/.agent/run-<issue>.json` (`:253`), so the command only
works inside the slice's worktree — and the announced line names neither that
path nor the plan's: it says *"--plan with the run's plan"*. Two lookups stand
between the message and the command, and the message says nothing about where to
do them.

**A reopen on its own does not move the run.** `DriveRun.#drive` already threw
`RunNotAdvanced` and its promise is gone (`drive-run.ts:108-110`). After the run
file is lifted it reads `step: implement` with nobody driving, and it waits for a
recovery sweep to notice. A way back in that leaves the slice standing still is
half a way back in.

## What already exists, and is not rebuilt here

- **The `reopen` verb** (`ct-step.mjs:367-420`): drops `closed`, resets
  `judgeRetries`, re-enters at `implement` and writes the person's words to
  `lastAdvice`, which `writeBrief` appends to the implementer's brief
  (`:1011`, `adviceSection` at `:1033`). It keeps its name and its behaviour.
  One thing is added to it, below.
- **The closure and its announcement** (#517): the run file persists
  `closed: blocked-judge`, the refusal carries `findings` and `verdict`, and
  `SessionClosureAnnouncements` turns it into one line for the live coordinating
  session.
- **`/active-plans`** publishes the closure (#517). That is where the session
  reads the `repo`, the `issue` and the `agent` it must send back.
- **The precedent for a person's words reaching a running slice**:
  `SliceMessageRoute` → `RunPlanAgents.fix` → `journal.hold` →
  `#resumeIfNobodyDrives` (`run-plan-agents.ts:184-197`). Including the resume.
- **`RunPlanAgents.recover`** (`:133`), which re-drives a run nobody drives.

## Scope

`BLOCKED_JUDGE` only, and only the veto — the same scope #517 declared. The five
sibling closures and the spent discard budget are untouched.

## The name

`reopen` is already taken in the backend for something else: `dispatch-check
--reopen`, `SliceNotReopened`, `ReopenNotUnderstood` are about reopening a
slice's branch so it can take a change. ct-step's verb keeps its own name — it is
merged, and where it lives it reads right. The backend's noun for this is
**another round**:

| Surface | Name |
|---|---|
| Route | `POST /slices/:issue/another-round` |
| Port method | `RunPlanAgents.anotherRound` |
| Machine method | `CtRunMachine.anotherRound` |
| Failure | `AnotherRoundNotGranted` |

## The flow

```
the judge vetoes a third time
   │
   ▼
ct-step persists `closed: blocked-judge` and announces the refusal   (#517)
   │
   ▼
DriveRun → ClosureAnnouncements → the coordinating session gets one line
   │
   ▼
the session tells the person what the judge found and ASKS what to change
   │
   ▼
POST /slices/<issue>/another-round {repo, agent, instruction}
   │
   ├── the action inspects first: no blocked-judge closure → 409, nothing journaled
   │
   ▼
CtRunMachine.anotherRound: `reopen --plan … --issue … --instruction …`
   │  journaled like every other command, cwd = the worktree
   │  ct-step announces a TRANSITION to `open`
   ▼
the oracle answers `next` → the run re-enters `implement`
   │
   ▼
#resumeIfNobodyDrives: the run carries on by itself
   │
   ▼
the implementer's brief carries the person's words under
"## Advice for this attempt"
```

## The backend half

### The route

`another-round-route.ts`, modelled on `slice-message-route.ts`: the same request
object shape, the same `Projection` of refusals, the same 400s for a body that is
not a JSON object, an unknown field, a malformed `repo`, `issue` or `agent`. The
third field is `instruction` and it must be a non-empty string. It answers
`202 {status: 'granted'}`.

A module of its own rather than a third route inside `slice-message-route.ts`:
the field is not a `text` for the slice's agent but an instruction for the run's
machine, and the failures it collapses are its own.

### The guard, before anything is journaled

The action **inspects before it acts**: `machine.inspect(watch)` must answer
`uncertain` with a closure whose state is `blocked-judge`. Anything else is
refused with 409, naming what the run is doing.

This is not politeness. `CtRunMachine.#execute` writes the command into the
journal *before* spawning (`journal.begin` at `ct-run-machine.ts:606`, the spawn
right after), so a `reopen` that ct-step refuses with `WRONG_STEP` — exit 9, no
announcement — stays in the chain as a refusal with no closure, and `open()`
re-asks only when the closure is there (`:478-481`). The cheapest way not to
poison the chain is not to write the command.

### `CtRunMachine.anotherRound(watch, instruction)`

Runs `reopen --plan <manifest.plan> --issue <n> --instruction <text>
--output-format json` as a journaled command whose `previous` is the **last**
ticket, with `cwd: watch.located.path`, exactly like every other command.

It has to be the last one. The journal is a linear chain: two successors of the
same command is *"a forked successor"* (`:705`), and `#advanceFrom` refuses a
successor whose argv is not the one the oracle derived from its predecessor
(`:577`). Hanging the grant off the last command is what keeps both true, and it
is why the reopen has to announce something the oracle understands.

### What the oracle must read, and what it must not learn

`OracleBoundary.#closure` already answers `next` for a TRANSITION whose state is
`OPEN` (`:355-358`). So the reopen announces a transition to `OPEN`, the machine
asks `next`, `next` finds the run at `implement`, and the implementer is
dispatched with the brief that carries the person's words.

**No new effect kind, no new branch in the oracle.** The one verb that grants a
round reuses the answer the machine already has for "the run is open, carry on".

### The resume

`RunPlanAgents.anotherRound` is `fix`'s shape (`:184-197`): resolve the watch,
check the provenance, refuse a legacy run, act, then `#resumeIfNobodyDrives`.
The slice moves without anybody clicking anything, which is the whole point of
routing this through the backend.

## The plugin half

`ct-step reopen` prints prose and exits (`ct-step.mjs:386-390`). Under
`--output-format json` it must also write
`StepAnnouncement.transition({ …, state: RUN_STATES.OPEN, outcome: OUTCOMES.DONE,
exit: EXIT.OK })`, the way the `DELIVERED` gate a few lines above it already
announces its own closure from a top-level block (`:352-356`). The prose line
stays: a person running the verb by hand still gets a sentence.

Nothing else in ct-step changes.

## The prompt half

Two texts, because they do different jobs.

**The announced line** (`SessionClosureAnnouncements.lineFor`) loses *"Do not run
it yourself."* and gains the call:

```
The judge vetoed task 2 of mercadona/x#973 three times and the run is closed at
blocked-judge. What it found: [high] src/pago.ts:41 the amount is rounded before
the discount. The whole verdict is at .agent/run-973/task-2-verdict-3.json. Tell
the person what the judge found, ask them what to change, and send THEIR words
with POST /slices/973/another-round {repo, agent, instruction}. The instruction
is theirs: you do not invent it.
```

**A new `PhasePrompt` constant**, beside `CHANGE_TO_A_SLICE` and
`RECOVERY_CAPABILITIES`, in both `brainstorming` and `groom`:

> When a slice's run closes at `blocked-judge`, the judge has vetoed the same
> task three times and the run waits on a decision that is the person's. Read
> `GET /active-plans` for the repo, the issue and the agent, tell the person what
> the judge found, and ask them what to change. Send their words with
> `POST /slices/<issue>/another-round` and `{repo, agent, instruction}`: the
> backend grants the round and the run carries on by itself. The instruction is
> the person's — you do not invent it, you do not widen the task, and you do not
> grant a round nobody asked for. There is no limit on rounds; the limit is the
> person.

Both, because they answer different questions. The line is one message in a
scrollback and says what just happened; the prompt is where a session knows what
it is allowed to do, and it is there on the next turn and the one after that.

## Failure modes

| Situation | Behaviour |
|---|---|
| No live coordinating session | Unchanged from #517: `announce` answers `false`, one line to stderr, the closure is in the file and the card shows it. The round can still be granted later, from a session opened afterwards. |
| The run is not closed at `blocked-judge` | 409 before anything is journaled, naming the state the run is in. ct-step is never spawned. |
| Two grants racing | The second inspects, finds no `blocked-judge` closure, and is refused 409. |
| Empty or missing `instruction` | 400 from the route's own refusal. ct-step is never spawned. |
| A stale cached plugin with no `reopen` verb | ct-step exits with the usage refusal and no announcement. The refusal is journaled with no closure, so the action refuses every later grant too; the run has to be recovered another way. Tracked as #522. |
| Granted, then vetoed three more times | Closes and announces again. There is no limit: the limit is the person, whose decision this is. |
| The backend restarts between the closure and the grant | Both survive — the closure is in the run file (#517) and the veto is in the journal. |
| The session invents an instruction instead of asking | Not a failure the code can catch, and not a new trust: it is the same one `CHANGE_TO_A_SLICE` already places in the session for every change a person asks for. The prompt says the words are the person's. |

## Testing

| Surface | What is measured |
|---|---|
| `ct-step-reopen.test.js` | `reopen --output-format json` announces a TRANSITION to `open`; without the flag the stdout is the prose it is today. |
| `ct-run-machine.test.ts` | the grant is journaled as the successor of the last command; the oracle answers `next`; the chain stays linear; a `reopen` the plugin does not know journals a refusal with a null closure and stops there. |
| `another-round-route.test.ts` | the 202, and every refusal in the table above. |
| `run-plan-agents.test.ts` | the inspect guard, and that a granted round resumes a run nobody drives. |
| `session-closure-announcements.test.ts` | the line names the POST and no longer forbids acting. |
| `phase-prompt.test.ts` | the constant is in both prompts. |
| `yardstick.test.ts`, `conforming-modules.test.js` | the two controls every new module here answers to. |

## What does not change

- **The page gains no button.** Every decision goes through the coordinating
  session, as decided on 2026-09-21.
- **The person's ownership.** They are asked, and their words travel verbatim.
- **`reopen` stays runnable by hand** in the worktree. A person debugging the
  loop needs that, and an HTTP-only verb would take it away.
- **#517's declared follow-up** — `reopen` resetting `judgeRetries` rewinds
  `StepSeal.attemptOf`, so a post-grant round overwrites the archived files of
  the earlier attempts — is still open and is not fixed here.

## Language

English, as the repository requires. The frontend is untouched, so this change
has no product copy.

## Out of scope

- The five sibling closures, and the closure that shares the state with a spent
  discard budget.
- Any override that commits past a veto. The person grants another round, not a
  way around the judge.
