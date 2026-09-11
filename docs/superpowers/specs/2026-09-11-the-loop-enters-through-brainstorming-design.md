# The loop enters through brainstorming

**Date:** 2026-09-11
**Repo:** `mercadona/control-tower`, directories `backend/` and `frontend/`
**State:** design approved — no production file touched yet
**Branch the design was written on:** `feat/loop-enters-through-brainstorming`, off `e04e484`

---

## 1. The problem: the app enters the loop at the wrong step

The loop has sixteen steps and three human gates. The app knows about neither.

`POST /start-plan` opens the plan issue itself, cuts a worktree and launches an
agent, which is the loop's **step 9** — the dispatch of one slice. Everything
before it happens outside the app: the design conversation, the execution spec,
its freeze, the groom that turns one table row into one issue, and the promotion
that authorises work. The app then adds a gate the loop does not have —
`POST /implement-plan`, which answers the plan's GO — and a plan review round
(`POST /review-plan`, the `-REVIEW` comment and its 30-second watch) that lives
between writing the plan and implementing it.

So the app is a cabin for the last third of the loop, and the first two thirds
are a terminal session with slash commands. The three gates that matter
(freeze, "start now", merge) are typed by hand, and the one gate the app does
implement is not one of them.

## 2. What the target flow is

```
brainstorming → execution spec → GATE 1 freeze → /ct-groom → GATE 2 status:ready
  → dispatch → the slice (plan · TDD · PR) → GATE 3 merge ⟲
```

`MODELO` writes the design doc and the spec. `HUMANO` freezes. `PROGRAMA` grooms.
`HUMANO` promotes. `PROGRAMA` dispatches. `MODELO + PROGRAMA` runs the slice.
`HUMANO` merges, and the merge is the only act with a permanent external effect:
it closes the issue, releases the `area:` / `touches:` tokens and satisfies the
`merge-after` of the slices that were waiting.

Two properties of that flow decide this design:

- **There is no gate between the plan and its implementation.** The
  authorisation was given at GATE 2. Once a slice is dispatched it writes its
  plan and implements it without waiting for anybody.
- **Nobody says which slice is next.** The order was decided once, in the
  spec's slices table, and the dispatcher derives the rest from the table's
  order, the merged dependencies and the free tokens.

## 3. What already exists, and what the POC already solved

`multiservicio/pocs.companion` is an Electron cabin over this same loop, and it
solved the piece we do not have: a **real interactive session inside the app**.

| Piece | Where | What it does |
|---|---|---|
| `PtyManager` | `src/main/pty.ts` | spawns through the user's login shell (`$SHELL -il -c`) so the session inherits the real `PATH`, exactly as if the developer had typed it |
| The phase prompt | `src/main/session-command.ts` | `claude --model <m> --permission-mode … "$COMPANION_PROMPT"` — the prompt travels in an environment variable, so quoting never has to be fought |
| The spec session | `src/main/torre/spec-session.ts` | runs in the **governed checkout**, with no worktree and no branch of its own, unlike a slice's dispatch |
| Session telemetry | `src/main/claude-hooks.ts`, `hooks-server.ts` | writes `SessionStart` / `UserPromptSubmit` / `Notification` / `Stop` hooks into the worktree's `.claude/settings.local.json`, each `curl`-ing a loopback server on an ephemeral port; it projects `working` / `waiting` and **the live question**, which is cleared the moment the session works again |

Two details of that telemetry are worth copying literally: the hook writer
**purges its own stale entries for every event present**, because a previous run
of the app leaves hooks pointing at a dead port and any survivor breaks the
session; and an answered question stops being a question, so `question` only
survives while the status stays `waiting`.

On our side, more exists than the entrance suggests:

- `start-plan.ts` already claims the issue (`planIssues.claim`), cuts and sows
  the worktree, measures the repository's baseline and sows that measurement
  into `.agent/SLICE.md` — one measurement, two readers. Four of the five acts
  of a dispatch are already there. What it does instead of reading a groomed
  issue is **create** one.
- The slices table, the groom, the claim, the kickoff and the run machine are
  deterministic programs under `plugin/scripts/`, and the backend is already
  allowed to import them: `start-plan.ts:5` imports
  `plugin/scripts/baseline.js` today.
- Every attempt of a slice is already measured. `ct-step commit` appends a row
  to `docs/superpowers/metrics/issue-<n>.jsonl` with step, task, attempt,
  outcome, `duration_ms`, `ruling`, `findings_total` and `tool_total_tokens`;
  `GET /implement-history` serves it, and `claude-code-usage.js` measures the
  tokens by reading Claude Code's own transcript
  (`~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`).

## 4. Architecture: one session contract, two transports

The app exposes **one** terminal session — a stream to read, an input to write,
a list of the live ones — with a common envelope and two frame kinds declared
inside it: `tty` carries ANSI bytes, `event` carries one stream-json event. The
frontend picks its renderer by kind and never learns who launched the session.

Behind it, two adapters, and the split has a reason rather than a taste:

**The entrance is a PTY, because a person is at the other end.** The
brainstorming and spec conversation is a dialogue with a hard gate in it, whose
skill asks one question at a time and whose answers are picked from an
interactive list. That needs a terminal, not a transcript. It runs in the
governed checkout, with no worktree and no branch, with the phase prompt in an
environment variable and the hooks projecting `working` / `waiting` / the live
question.

**The implementation is headless, because nobody is.** The backend mints the
conversation's id with `randomUUID` and imposes it with `--session-id`, so
nothing has to parse a stream to learn it; it spawns
`claude -p --output-format stream-json --verbose` **detached with its output on
file descriptors**, so a call outlives the API that started it; and it continues
each step with `--resume`. Every call leaves a record under the state root —
`call.json`, `stream.ndjson`, `stderr.log` — and the model is a function of the
step, not an environment variable.

**The conductor is not duplicated.** Which step comes next is still decided by
the program that already decides it (`run-machine.js` behind `ct-step.mjs`); the
backend owns the process, not a second automaton. This is a restoration, not an
invention: `step-contracts.js:9` records that the argv of `claude -p` used to be
built there and was removed, and `ct-step.mjs:47,53` records what was lost with
it — `--json-schema`, which only exists in `--print` mode, and the cost, which a
subagent of the session does not report.

**What the app is the owner of, and what it only reads.** It owns the sessions it
launches and their records. It reads the governed repository, GitHub and the
worktree's metrics file. In the governed repository's tree it writes exactly one
thing, the freeze of section 5; on GitHub it promotes the labels of GATE 2 and
invokes the groom, whose writes belong to the groom.

## 5. The phase machine and the three gates

There is no `phase` field anywhere, and nothing journals an intention. The phase
is derived from evidence that can be read back after a restart, which is what
`ActivePlanRecovery` already does with its `matches` predicates.

| Question | The evidence that answers it |
|---|---|
| is there an epic in flight? | the most recent execution spec in `docs/superpowers/specs/` |
| is it frozen? | its `Estado: CONGELADA` line and date — written by the app |
| is it groomed? | the milestone and its issues exist |
| is work authorised? | at least one issue carries `status:ready` |
| which slice is next? | the table's order, the merged dependencies, the free tokens |
| is a slice in flight? | the worktree plus the conversation's record — not a label, not a journal |
| is it delivered? | a pull request with `Closes #N`, the issue at `status:in-review` |
| is it closed? | the issue closed by the merge |

**GATE 1 — freeze.** The yardstick already exists as modules the backend can
import: `analyzeSpecFreeze` (`groom.js`) returns every `[NEEDS CLARIFICATION`
marker with its line number and whether the hypothesis is absent, empty or
present; `analyzeSlicesTable` (`slices.js`) validates the table. The button
enables only when both are green, and when they are not it shows each failure as
the module reports it, with the line number where the module gives one. Pressing
it writes `Estado: CONGELADA` and the date into the spec and commits it.

This closes a real hole: **today nobody checks the freeze.** `ct-groom` names it
in the text of its own errors — "groom only accepts FROZEN specs" — but
`analyzeSpecFreeze` only looks at the markers and the hypothesis. When the freeze
becomes an act of the program, requiring it becomes possible.

**GATE 2 — start now.** The groom is `ct-groom.mjs <spec> --repo owner/name
--milestone T [--project N]`, and every validation in it runs before any
mutation and also under `--dry-run`, whose stdout is the plan as JSON. So the
cabin shows what will be created before creating it. Issues are born in
`status:backlog`; the button promotes them to `status:ready`. After that the app
does not ask again.

**GATE 3 — merge.** The human merges on GitHub. The app never writes to a pull
request: it shows the link and notices the merge by sweeping, which it already
does. When the issue closes, the tokens and the dependencies free up and the
next slice is dispatched.

**The pace.** One slice in flight. The relay happens when the pull request
opens, not when it is merged, because `dispatch-check --release` already frees
the `--cap` there while retaining `area:` / `touches:` until the merge. So a
merge only holds back the slices that actually depend on it.

## 6. What retires, what survives, and the loose thread of the GO

**The plan review retires.** The plan of a slice is written by its agent, judged
by `ct-judge` against its issue, and read by a person in the pull request's diff
— not before. That removes `POST /review-plan`, `ask-plan-changes.ts`,
`read-changes-asked.ts`, the `#planReviews` wiring (`ct-api.ts:309`),
`PlanState.REVIEWING` with its `reviewing` SSE frame, and the `REVIEWING` mapping
of `ReviewGatePolicy`.

**The pull request's fix loop survives**, and it is a different thing that is
easy to take down by accident: `ReviewWatch` is one class wired twice — at
`ct-api.ts:309` for the plan and at `:328` for the pull request — and the second
wiring reads `ReadFixesAsked`, which asks `PullRequests` rather than the issue,
and delivers through `RequestFixes`. That is GATE 3 asking for changes, and the
`fixing` step of `/implement-progress`.

**The GO's loose thread.** `POST /implement-plan` was never "a human read the
plan": it was the app **answering the nonce** of the plugin's protocol
(`GO de #N: contesta exactamente -OK <nonce>`), which `dispatch-check --release`
demands with exit 9 for a slice whose gate is `plan`. With GATE 2 as the
authorisation, answering it automatically would be theatre. So a slice that
declares `gate: plan` is **not dispatchable by the app**: it is refused with an
explicit code instead of signing a go nobody read. The gates that survive are
`visual` and `apply`, which are evidence for GATE 3.

**cmux leaves the backend.** With the launch headless, `cmux-plan-agents.ts`
goes, cmux stops being the sixth external tool the backend probes
(`probed-tool-sessions.ts`), and `/active-plans` recovers by reading the records
under the state root: the record *is* the plan in flight, and the process being
alive is not what makes it recoverable. The 503 on a machine whose cmux is not
running dies with it.

## 7. What we measure

The tokens of each attempt are already measured. What the headless transport
adds is the money and the turns: the stream's final `result` carries
`total_cost_usd`, `num_turns`, `usage`, `modelUsage` and `duration_ms`, per call
and per model — exactly what `ct-step.mjs:53` declares impossible while the judge
is a subagent of the session. And the session id stops being guessed from a
transcript folder: the backend mints it.

PR #299 (`feat/plan-headless-claude-p`, closed unmerged) measured the four CLI
properties this rests on — `--session-id` imposes the id, `--resume` recovers the
conversation from a new process, the final `result` carries the measurements, and
a detached spawn writing to descriptors keeps writing with its parent dead — and
its review caught four defects of the same family, an invocation taking the API
down with it: `spawn`'s `'error'` on the next tick, which a `try`/`catch` around
the call does not see; `spawn`'s own `timeout`, which signals only the group
leader and orphans the tools the agent launched; `process.kill` raising `ESRCH`
inside a timer; and a failed continuation degrading into a generic
`request-failed`. That knowledge is harvested here rather than rediscovered.

## 8. Isolation and boundaries

- **The session channel** knows about streams and input, and nothing about
  phases, gates or GitHub. Two adapters implement it; neither leaks into the
  route.
- **The gates** are three programs with one yardstick each. A gate's yardstick is
  imported, never reimplemented: the app must not grow a second opinion about
  whether a spec is freezable.
- **The dispatcher** selects, claims, isolates and launches, in that order, with
  the compensation each act already has. It does not decide what the agent does
  next.
- **The record** is written once and never mutated, and its absence is the whole
  of "not prepared". No lock, no revision, no owner pid.
- Direction of dependency, unchanged: `backend/` may import `plugin/scripts/`;
  `plugin/` never learns that the backend exists. Everything new in `backend/`
  is `.ts`, which `typescript-only.test.ts` keeps live; the plugin stays `.js`.

## 9. Anti-scope

- **An epic governs one repository.** The spec, the table, the milestone and the
  issues live in one. The `repo_list` mode of `/start-plan` does not enter this
  flow; it stays where it is for the short path of a loose issue.
- No change to the prescriptive planning skill, the plan contract, the task
  brief or the run machine's report format.
- No second orchestration graph, no phase enumeration, no transition table.
- The slice's session is not attached to by mirroring somebody else's terminal:
  what the cabin shows of a slice is the stream of the calls the backend itself
  made.
- No automatic merge, and no write of any kind from the app onto a pull request.

## 10. Parked

The POC's decision log (`.companion/decisiones.jsonl`, append-only, with
`minutos_humanos` per gate) is the measurement of human time, which nothing has
today. It is a product contract of its own and it is not smuggled in here.
