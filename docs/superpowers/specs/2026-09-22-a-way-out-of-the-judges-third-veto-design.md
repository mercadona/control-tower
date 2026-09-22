# A way out of the judge's third veto

Design for #497. Written 2026-09-22, after #493 and #496 closed and while
#505 is open.

## The decision this records

When the judge refuses, the message surfaces in the **coordinating session** and
the person fixes it from there — the same way a comment on an open pull request
reaches the coordinating session today. The decision was taken in the team
channel on 2026-09-21.

What the person gets is **the reason the judge failed**, so they can decide. The
page shows the same reason and offers no new button: every decision goes through
the coordinating session.

## What already exists, and is not rebuilt here

Three pieces of this were built by other work and are used as they are.

- **The classification.** #498 made `ct-step`'s stdout a structured contract. A
  refusal already carries `state`, `outcome` and `exit`, `RunAnnouncement` reads
  it into a `RunClosure`, and `/active-plans` publishes it as `refusal`.
- **The explanation.** The run already holds the whole FAIL verdict in
  `lastVerdict`, and the major findings formatted in `lastFindings`
  (`ct-step.mjs:2510-2513`). `archive('verdict', …)` writes a copy per attempt
  to `.agent/run-<issue>/task-<t>-verdict-<attempt>.json`.
- **The channel.** `CoordinatingSessions.announce(line)` writes a line into the
  live coordinating session and answers `false` when there is none
  (`coordinating-sessions.ts:434-442`). `ChangeAnnouncements` →
  `SessionChangeAnnouncements` → `RunPlanAgents.#announce` is the full precedent,
  including swallowing a failed announcement into stderr.

So the work is not to produce the explanation. It is to persist the closure,
carry the explanation across the seam, and give the person a way back in.

## Scope

`BLOCKED_JUDGE` only.

`BLOCKED_CONTROLS`, `BLOCKED_GLOBAL`, `BLOCKED_SLICE_JUDGE`,
`BLOCKED_RECONCILE` and `BLOCKED_E2E` are left untouched. Each re-enters at a
different step and resets a different counter, so they are six state-machine
decisions, not one. Leaving them unpersisted also keeps #505's hand retry
working for them — and #505's measured case was `blocked-global`, not the judge.

## The flow

```
third FAIL from the judge
   │
   ▼
run-machine: closed(run, BLOCKED_JUDGE)
   │
   ▼
ct-step: persists `closed: blocked-judge` in run-<n>.json
         and announces the refusal with findings + verdict path
   │
   ▼
OracleBoundary: reads the announcement, already classified (#498)
   │
   ├──► announces one line into the coordinating session:
   │      what failed, the major findings, the verdict path,
   │      and the command that grants another round
   │
   └──► /active-plans: `refusal` already travels
           │
           ▼
        the slice card shows it, read-only
   │
   ▼
the person answers in the coordinating session
   │
   ▼
ct-step reopen --issue <n> --instruction "…"
   │  drops `closed`, judgeRetries 2 → 0, step → implement,
   │  the instruction lands in `lastAdvice`
   ▼
recovery asks `ct-step next` again (#505) and gets a step
```

## Boundaries

| Unit | What it does | What it depends on |
|---|---|---|
| `run-machine.js` | says the third veto closes at `BLOCKED_JUDGE` | nothing new |
| `ct-step.mjs` | persists the closure, announces it with the findings, and `reopen` lifts it | the run file |
| `ClosureAnnouncements` port + `SessionClosureAnnouncements` | turns a refusal into one line for the coordinating session | `CoordinatingSessions.announce` |
| the slice card | renders `refusal` and the findings | `/active-plans`, which already carries them |

## The plugin half

### `step-announcement.js`

`StepAnnouncement.refusal` takes two more fields, both optional: `findings` (the
text `lastFindings` already formats) and `verdict` (the archived verdict's path).
Without them the announcement is what it is today.

### `ct-step.mjs`, three sites

1. **The persistence** (`:2927`). Alongside `DELIVERED`, `BLOCKED_JUDGE` is now
   written as `closed`.
2. **The announcement** (`:2969-2975`). The `closure` object carries
   `findings: run.lastFindings` and the verdict path.
3. **The gate** (`:341`). The `DELIVERED` branch gains a sibling for
   `BLOCKED_JUDGE`: `next` announces the persisted closure, and any verb that
   transitions dies with `WRONG_STEP` naming `reopen`.

### The `reopen` verb

Added to the list at `:184`. It refuses unless the run reads
`closed: blocked-judge`. When it does, it drops `closed`, sets
`judgeRetries: 0` and `step: implement`, and stores `--instruction` in
`lastAdvice`.

The instruction needs no new plumbing: `lastAdvice` is already appended to the
implementer's brief (`ct-step.mjs:943` and `:957`), the same way the adviser's
advice travels.

**Discards are not reset.** They count a different failure — an answer that
cannot be read — and resetting them would hide a judge that is illegible.

## The backend half

### `run-announcement.ts` and `RunClosure`

`RunClosure` (`domain/value-objects/run-instruction.ts:1`) gains
`findings: string | null`, `verdict: string | null` and `task: number | null`,
because it is the value that travels from the boundary to `DriveRun`.

`task` is lifted from the announcement's existing `run.task`. It rides on the
closure rather than being asked of the machine, because `RunMachine`
(`domain/ports/run-machine.ts`) declares `establishment`, `open` and `advance`
and nothing else — widening a port to carry a number for a message is the wrong
trade.

`RunAnnouncement` reads both from the record. Absent or malformed, both are
`null`: a machine running a stale cached plugin must not break the read.

### The port

`ClosureAnnouncements` in `domain/ports/`, a sibling of `ChangeAnnouncements`,
with one method and a static `lineFor`. `SessionClosureAnnouncements` in
`infrastructure/` calls `CoordinatingSessions.announce`.

**The line is addressed to the coordinating agent, not to a person**, because
that is what the existing announcement does — it ends *"Tell the person, naming
the ticket, and do not send it again."* It is also why the message is one line:
`announce` appends the submit character, so a multi-line message would be sent
in pieces.

```
The judge vetoed task 2 of mercadona/x#973 three times and the run is
closed at blocked-judge. What it found: [high] src/pago.ts:41 the amount
is rounded before the discount; [medium] src/pago.ts:88 the zero amount
is not covered. The whole verdict is at .agent/run-973/task-2-verdict-3.json.
Tell the person what failed and that you can grant another round with
`ct-step reopen --issue 973 --instruction "…"`. Do not run it yourself.
```

### Where it is called

`DriveRun.#drive` (`application/actions/drive-run.ts:88-89`), at
`case 'refused'`, immediately before it throws `RunNotAdvanced`. The refused
instruction already carries the closure, so the announcement is composed from
what is in hand.

`DriveRun` is an application action, so `ClosureAnnouncements` is injected into
it — the same way `ChangeAnnouncements` is a domain port used from the
application layer.

The failure is swallowed the way `RunPlanAgents.#announce` swallows its own: a
failed announcement goes to stderr and propagates nothing. An announcement that
does not arrive must not turn a closed run into a crashed backend.

Only a closure whose state is `blocked-judge` is announced. Every other refusal
throws exactly as it does today.

## The frontend half

`refusal` already reaches the card. It only has to be read.

- `ActivePlan.types.ts` declares the field.
- `SliceSession.tsx` renders the closure's state and the findings inside the
  banner that already exists.
- No new button. `Reintentar recuperación` stays as it is.

## Failure modes

| Situation | Behaviour |
|---|---|
| No live coordinating session | `announce` answers `false`. The closure is persisted and the card shows it regardless. One line to stderr. |
| The machine runs a stale cached plugin | The announcement carries no `findings` or `verdict`. The backend reads `null` and the line degrades to the short notice. |
| `archive` failed, so no verdict file | `verdict` is `null` and the line omits the path. |
| The FAIL has no major findings | `lastFindings` is `null`. The line says the judge vetoed and names the verdict path. |
| `reopen` on a run that is not `blocked-judge` | Refused with `WRONG_STEP`, naming the state it is in. |
| `reopen` on a delivered run | The `DELIVERED` gate refuses first. |
| Reopened, then vetoed three more times | Closes and announces again. **There is no reopen limit**: the limit is the person, whose decision this is. |
| The backend restarts between the closure and the reopen | The closure survives, because it is now in the file. That is what gap 1 buys. |

## Dependency on #505

**The way back in depends on #505.** With the closure persisted, `ct-step next`
answers the confirmed refusal — exactly what was predicted on the issue. Without
#505 the recovery reads the journal's last refused receipt and never asks again,
so a `reopen` done in the worktree is never picked up by the page.

Branch from `main`, and **wait for #505 to land before merging**.

## Testing

TDD, one test per new behaviour.

**Plugin** (`vitest`, `plugin/__tests__/`)

- `step-announcement.test.js`: the refusal accepts both fields, and is still
  valid without them.
- `ct-step-verdict.test.js`: the third veto persists `closed: blocked-judge`, and
  the announcement carries the findings and the verdict path.
- New `ct-step-reopen.test.js`: `reopen` lifts the closure and leaves
  `judgeRetries: 0`, `step: implement` and the instruction in `lastAdvice`; it
  does not touch discards; it refuses when the run is not blocked at the judge;
  and `next` over a persisted closure announces it instead of re-entering the
  judge.

**Backend** (`vitest`, `backend/__tests__/`)

- `run-announcement.test.ts`: both fields are read, and are `null` when absent or
  malformed.
- New `session-closure-announcements.test.ts`: the composed line, with findings
  and without them; and that `announce` answering `false` does not throw.
- `drive-run.test.ts`: a `blocked-judge` refusal announces once and still throws
  `RunNotAdvanced`; a refusal of any other state announces nothing; and a failed
  announcement does not change what `DriveRun` throws.

**Frontend** (`frontend/src/…`)

- `SliceSession.test.tsx`: with `refusal`, the card shows the closure state and
  the findings; without it, the card is what it is today.

## Language

Card labels are Spanish, because they are product copy. The findings are written
by the judge and arrive in English: they are shown verbatim, not translated.
Everything else — code, tests, the line to the coordinating agent, `ct-step`'s
messages — is English.

## Out of scope

- The five sibling closures.
- #493 and #496, both closed.
- Any override that commits past a veto. The person gets another round, not a
  way around the judge.
