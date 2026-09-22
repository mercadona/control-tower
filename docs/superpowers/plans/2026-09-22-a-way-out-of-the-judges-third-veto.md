# A Way Out of the Judge's Third Veto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the judge vetoes a task three times, the closure is written down, the reason reaches the coordinating session, and one verb grants another round.

**Architecture:** `ct-step` persists `closed: blocked-judge` and puts the judge's findings into the refusal announcement #498 already publishes. The backend reads them into `RunClosure`, `DriveRun` announces one line into the coordinating session, and `/active-plans` carries them to a read-only card. A new `ct-step reopen` verb lifts the closure and re-enters at `implement` with the person's instruction.

**Tech Stack:** Node ESM (plugin), TypeScript + hexagonal architecture (backend), React + TypeScript (frontend), `vitest` everywhere.

**Spec:** `docs/superpowers/specs/2026-09-22-a-way-out-of-the-judges-third-veto-design.md`

## Global Constraints

- **English everywhere** except frontend product copy, which is Spanish. `CLAUDE.md` is the rule; `docs/glossary.md` decides vocabulary.
- **No feature flag.** This repository's `flag-discipline` default is off.
- **Never route around a control.** No `--no-verify`, no `--admin`, no weakening a test. A control that refuses is a finding to report.
- **Scope is `BLOCKED_JUDGE` alone.** `BLOCKED_CONTROLS`, `BLOCKED_GLOBAL`, `BLOCKED_SLICE_JUDGE`, `BLOCKED_RECONCILE` and `BLOCKED_E2E` are untouched.
- **Backwards compatible in both directions.** A stale cached plugin sends no new fields; the backend must read `null` and carry on.
- **Do not merge before #505.** The way back in depends on it.

## The shared contract, fixed here so every track can start at once

These names are agreed up front. No task waits on another to learn them.

**The announcement's two new keys** (`refusal` only, appended after `detail`, and **omitted entirely when null** so the existing exact-string assertions keep passing):

```json
{"version":1,"kind":"refusal","state":"blocked-judge","outcome":"failed","exit":1,"run":{...},"detail":"...","findings":"- [high] a.ts:1: what","verdict":".agent/run-7/task-1-verdict-3.json"}
```

**The backend type** (`backend/src/domain/value-objects/run-instruction.ts`):

```ts
export type RunClosure = {
  readonly state: string,
  readonly outcome: string,
  readonly exit: number,
  readonly task: number | null,
  readonly findings: string | null,
  readonly verdict: string | null,
}
```

`task` is read from the announcement's existing `run.task`. It travels on the
closure because `RunMachine` (`domain/ports/run-machine.ts`) exposes
`establishment`, `open` and `advance` and nothing else — and widening a port to
carry a number for a message would be the wrong trade.

**The `/active-plans` JSON** for an uncertain plan:

```json
{"phase":"uncertain","refusal":{"state":"blocked-judge","outcome":"failed","exit":1,"task":1,"findings":"- [high] a.ts:1: what","verdict":".agent/run-7/task-1-verdict-3.json"}}
```

**The verb:** `ct-step reopen --plan <file> --issue <n> --instruction "<text>"`. `--plan` is required because `ct-step.mjs:188` demands it of every verb before the verb runs.

## Parallelisation

Nine tasks in three waves. Tasks in the same wave touch disjoint files and can run at the same time.

| Wave | Tasks | Why they are parallel |
|---|---|---|
| 1 | **P1**, **B1**, **B2**, **F1** | Four different files in three different packages. The contract above is all they share. |
| 2 | **P2**, **B3**, **B4** | P2 needs P1's fields. B3 needs B1's type and B2's port. B4 needs B1's type. None touches another's files. |
| 3 | **P3**, **P4** | Both need P2's persistence. P3 edits the gate at `ct-step.mjs:341`; P4 adds a verb at `:184` and a branch inside that same gate — **P4 rebases on P3**, see its note. |

```
wave 1:  P1 ──┐      B1 ──┬──┐      B2 ──┐      F1 (independent, ships alone)
              │           │  │           │
wave 2:  P2 ──┘      B4 ──┘  └── B3 ─────┘
              │
wave 3:  P3 ──┴── P4
```

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `plugin/scripts/step-announcement.js` | P1 | the refusal's two optional fields |
| `plugin/__tests__/step-announcement.test.js` | P1 | proves the shape, with and without them |
| `plugin/scripts/ct-step.mjs` `:2927`, `:2969-2975` | P2 | persist the closure, fill the fields |
| `plugin/__tests__/ct-step-verdict.test.js` | P2 | proves both on a real third veto |
| `plugin/scripts/ct-step.mjs` `:337-360` | P3 | the gate: what each verb answers over a persisted closure |
| `plugin/scripts/ct-step.mjs` `:184`, `:164-180`, gate | P4 | the `reopen` verb |
| `plugin/__tests__/ct-step-reopen.test.js` | P3, P4 | one file, both behaviours |
| `backend/src/domain/value-objects/run-instruction.ts` | B1 | `RunClosure` gains two fields |
| `backend/src/infrastructure/run-announcement.ts` | B1 | reads them, tolerating absence |
| `backend/src/domain/ports/closure-announcements.ts` | B2 | the port |
| `backend/src/infrastructure/session-closure-announcements.ts` | B2 | the line, and the live session |
| `backend/src/application/actions/drive-run.ts` | B3 | announces a `blocked-judge` refusal |
| `backend/src/infrastructure/ct-api.ts` `:549-557` | B3 | wiring |
| `backend/src/infrastructure/active-plans-route.ts` `:176` | B4 | forwards the two fields |
| `frontend/src/app/active-plans/ActivePlan.types.ts` | F1 | declares `refusal` |
| `frontend/src/app/slice-session/.../SliceSession.tsx` | F1 | renders it, read-only |

---

# Wave 1

## Task P1: the refusal announcement carries the judge's findings

**Files:**
- Modify: `plugin/scripts/step-announcement.js:166-182`
- Test: `plugin/__tests__/step-announcement.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `StepAnnouncement.refusal({ issue, task, tasksTotal, step, discards, state, outcome, exit, detail, findings, verdict })`. `findings` and `verdict` are optional strings. When either is `null`, `undefined` or `''`, its key is **absent** from the printed object.

- [ ] **Step 1: Write the failing tests**

Add to `plugin/__tests__/step-announcement.test.js`, inside the `describe('the announcement declares its whole shape', …)` block:

```javascript
  it('a refusal prints the findings and the verdict path after its detail', () => {
    const announcement = StepAnnouncement.refusal({
      issue: 42,
      task: 1,
      tasksTotal: 5,
      step: STEPS.JUDGE,
      discards: 1,
      state: RUN_STATES.BLOCKED_JUDGE,
      outcome: OUTCOMES.FAILED,
      exit: 1,
      detail: 'the judge vetoed three times',
      findings: '- [high] uno.txt:1: mal',
      verdict: '.agent/run-42/task-1-verdict-3.json',
    })

    expect(announcement.text()).toBe(
      '{"version":1,"kind":"refusal","state":"blocked-judge","outcome":"failed","exit":1,'
      + '"run":{"issue":42,"task":1,"tasksTotal":5,"step":"judge","discards":1},'
      + '"detail":"the judge vetoed three times",'
      + '"findings":"- [high] uno.txt:1: mal","verdict":".agent/run-42/task-1-verdict-3.json"}\n'
    )
  })

  it('a refusal with nothing to say about the verdict prints neither key, because a stale reader must see what it always saw', () => {
    const announcement = StepAnnouncement.refusal({
      issue: 42,
      task: 1,
      tasksTotal: 5,
      step: STEPS.JUDGE,
      discards: 1,
      state: RUN_STATES.BLOCKED_JUDGE,
      outcome: OUTCOMES.FAILED,
      exit: 1,
      detail: 'the judge vetoed three times',
      findings: null,
      verdict: null,
    })

    expect(announcement.text()).toBe(
      '{"version":1,"kind":"refusal","state":"blocked-judge","outcome":"failed","exit":1,'
      + '"run":{"issue":42,"task":1,"tasksTotal":5,"step":"judge","discards":1},'
      + '"detail":"the judge vetoed three times"}\n'
    )
  })
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd plugin && npx vitest run __tests__/step-announcement.test.js -t 'findings'`
Expected: FAIL. The first test prints an object with no `findings` key.

- [ ] **Step 3: Write the implementation**

In `plugin/scripts/step-announcement.js`, replace the body of `static refusal` (currently lines 166-182) with:

```javascript
  static refusal({ issue, task, tasksTotal, step, discards, state, outcome, exit, detail, findings, verdict }) {
    StepAnnouncement.#requireDeclared(step, STEPS, 'step')
    StepAnnouncement.#requireDeclared(state, RUN_STATES, 'run state')
    StepAnnouncement.#requireDeclared(outcome, OUTCOMES, 'outcome')
    if (typeof detail !== 'string' || detail === '') {
      throw new MalformedAnnouncement('a refusal needs a non-empty detail')
    }
    const announcement = {
      version: ANNOUNCEMENT_VERSION,
      kind: ANNOUNCEMENT_KINDS.REFUSAL,
      state,
      outcome,
      exit,
      run: StepAnnouncement.#closureRun({ issue, task, tasksTotal, step, discards }),
      detail,
    }
    // Both keys are OMITTED when there is nothing to say, rather than printed
    // as null: a refusal that carries no verdict has to read exactly as it read
    // before this task, because that is the shape a backend running against an
    // older plugin — or an older backend reading a newer one — already handles.
    if (typeof findings === 'string' && findings !== '') announcement.findings = findings
    if (typeof verdict === 'string' && verdict !== '') announcement.verdict = verdict
    return new StepAnnouncement(announcement)
  }
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd plugin && npx vitest run __tests__/step-announcement.test.js`
Expected: PASS, including the pre-existing `a refusal prints its state outcome exit run and detail`.

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/step-announcement.js plugin/__tests__/step-announcement.test.js
git commit -m "feat(plugin): a refusal can carry the judge's findings and the path of its verdict

The two keys are omitted when empty, so a refusal with nothing to say
prints exactly what it printed before.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task B1: `RunClosure` carries the findings across the seam

**Files:**
- Modify: `backend/src/domain/value-objects/run-instruction.ts:1-5`
- Modify: `backend/src/infrastructure/run-announcement.ts:93-112`
- Test: `backend/__tests__/infrastructure/run-announcement.test.ts`

**Interfaces:**
- Consumes: the announcement shape in **The shared contract**.
- Produces: `RunClosure` with `findings: string | null` and `verdict: string | null`. `RunAnnouncement.of(stdout).closure` fills both.

- [ ] **Step 1: Write the failing tests**

Add to `backend/__tests__/infrastructure/run-announcement.test.ts`. First add two mothers inside `class AnnouncementMother`:

```ts
  static readonly VETOED_WITH_FINDINGS =
    '{"version":1,"kind":"refusal","state":"blocked-judge","outcome":"failed","exit":1,'
    + '"run":{"issue":9,"task":1,"tasksTotal":2,"step":"judge","discards":0},'
    + '"detail":"run blocked-judge: task 1/2, 0 discard(s)",'
    + '"findings":"- [high] uno.txt:1: mal","verdict":".agent/run-9/task-1-verdict-3.json"}'

  static readonly VETOED_WITH_UNREADABLE_FINDINGS =
    AnnouncementMother.VETOED_WITH_FINDINGS.replace('"findings":"- [high] uno.txt:1: mal"', '"findings":42')
```

Then a new `describe` at the end of the file:

```ts
describe('what the refusal says about the verdict that closed the run', () => {
  it('reads the findings and the verdict path when the plugin sends them', () => {
    const announcement = RunAnnouncement.of(AnnouncementMother.VETOED_WITH_FINDINGS)

    expect(announcement?.closure?.findings).toBe('- [high] uno.txt:1: mal')
    expect(announcement?.closure?.verdict).toBe('.agent/run-9/task-1-verdict-3.json')
    expect(announcement?.closure?.task).toBe(1)
  })

  it('a plugin too old to send them is read, because a stale cached plugin must not break the boundary', () => {
    const announcement = RunAnnouncement.of(AnnouncementMother.BLOCKED_JUDGE_DISCARDED)

    expect(announcement?.closure?.findings).toBeNull()
    expect(announcement?.closure?.verdict).toBeNull()
  })

  it('a findings field that is not text is read as nothing, not as an unreadable announcement', () => {
    const announcement = RunAnnouncement.of(AnnouncementMother.VETOED_WITH_UNREADABLE_FINDINGS)

    expect(announcement?.closure?.findings).toBeNull()
    expect(announcement?.closure?.verdict).toBe('.agent/run-9/task-1-verdict-3.json')
  })
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd backend && npx vitest run __tests__/infrastructure/run-announcement.test.ts -t 'verdict that closed'`
Expected: FAIL with `undefined` where `null` or the text is expected.

- [ ] **Step 3: Write the implementation**

In `backend/src/domain/value-objects/run-instruction.ts`, replace lines 1-5:

```ts
export type RunClosure = {
  readonly state: string,
  readonly outcome: string,
  readonly exit: number,
  readonly task: number | null,
  readonly findings: string | null,
  readonly verdict: string | null,
}
```

In `backend/src/infrastructure/run-announcement.ts`, replace the last line of `#closureOf` (currently `return Object.freeze({ state, outcome, exit: exit as number })`) with:

```ts
    return Object.freeze({
      state,
      outcome,
      exit: exit as number,
      task: RunAnnouncement.#taskOf(record),
      findings: RunAnnouncement.#textOr(record.findings),
      verdict: RunAnnouncement.#textOr(record.verdict),
    })
```

And add these two private helpers next to `#isRecord`:

```ts
  // A field that is absent, empty or not text is NOTHING, and never a reason to
  // refuse the announcement: the plugin lives in a cached copy outside this
  // repository, so a machine that has not pulled it sends refusals without
  // these keys. Rejecting those would turn an upgrade into an outage.
  static #textOr(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  // `run.task` has always been in the announcement. It is lifted onto the
  // closure because that is where the message that names it is composed from,
  // and RunMachine exposes no way to ask which task a run is on.
  static #taskOf(record: Record<string, unknown>): number | null {
    const run = record.run
    const task = RunAnnouncement.#isRecord(run) ? run.task : undefined
    return Number.isInteger(task) ? task as number : null
  }
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd backend && npx vitest run __tests__/infrastructure/run-announcement.test.ts && npx tsc -p tsconfig.json`
Expected: PASS, and the typecheck reports nothing but a pre-existing missing `node-pty`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/value-objects/run-instruction.ts backend/src/infrastructure/run-announcement.ts backend/__tests__/infrastructure/run-announcement.test.ts
git commit -m "feat(backend): a run closure carries what the judge found, read as nothing when the plugin is older

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task B2: the port that tells the coordinating session

**Files:**
- Create: `backend/src/domain/ports/closure-announcements.ts`
- Create: `backend/src/infrastructure/session-closure-announcements.ts`
- Test: `backend/__tests__/infrastructure/session-closure-announcements.test.ts`

**Interfaces:**
- Consumes: `CoordinatingSessions.announce(line: string): boolean`, which already exists at `coordinating-sessions.ts:434`.
- Produces:
  - `ClosureAnnouncements.announce({ repository: RepositoryName, issue: number, task: number | null, findings: string | null, verdict: string | null }): Promise<void>`
  - `SessionClosureAnnouncements.lineFor(same object): string`

- [ ] **Step 1: Write the failing tests**

Create `backend/__tests__/infrastructure/session-closure-announcements.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SessionClosureAnnouncements } from '../../src/infrastructure/session-closure-announcements.ts'
import type { CoordinatingSessions } from '../../src/infrastructure/coordinating-sessions.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class SessionsDouble {
  readonly announced: string[] = []
  readonly heard: boolean

  constructor(heard: boolean = true) {
    this.heard = heard
  }

  announce(line: string): boolean {
    this.announced.push(line)

    return this.heard
  }

  get asSessions(): CoordinatingSessions {
    return this as unknown as CoordinatingSessions
  }
}

class Asked {
  static REPOSITORY = new RepositoryName('owner/name')
  static ISSUE = 973
  static TASK = 2
  static FINDINGS = '- [high] src/pago.ts:41: the amount is rounded before the discount'
  static VERDICT = '.agent/run-973/task-2-verdict-3.json'

  static of(over: Partial<ReturnType<typeof Asked.full>> = {}) {
    return { ...Asked.full(), ...over }
  }

  static full() {
    return {
      repository: Asked.REPOSITORY,
      issue: Asked.ISSUE,
      task: Asked.TASK as number | null,
      findings: Asked.FINDINGS as string | null,
      verdict: Asked.VERDICT as string | null,
    }
  }
}

describe('telling the coordinating session that the judge closed a run', () => {
  it('names_the_slice_the_task_and_the_state_the_run_is_closed_at', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of())

    expect(line).toContain('owner/name#973')
    expect(line).toContain('task 2')
    expect(line).toContain('blocked-judge')
  })

  it('carries_what_the_judge_found_and_where_the_whole_verdict_is', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of())

    expect(line).toContain('the amount is rounded before the discount')
    expect(line).toContain('.agent/run-973/task-2-verdict-3.json')
  })

  it('is_one_line_because_announce_submits_at_the_end_of_it', () => {
    expect(SessionClosureAnnouncements.lineFor(Asked.of())).not.toContain('\n')
  })

  it('tells_the_session_to_pass_it_on_and_names_the_command_that_grants_another_round', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of())

    expect(line).toContain('Tell the person')
    expect(line).toContain('ct-step reopen --issue 973')
    expect(line).toContain('Do not run it yourself')
  })

  it('a_veto_with_nothing_major_to_show_still_says_what_happened_and_where_to_look', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of({ findings: null }))

    expect(line).toContain('owner/name#973')
    expect(line).toContain('.agent/run-973/task-2-verdict-3.json')
    expect(line).not.toContain('What it found:')
  })

  it('a_verdict_that_could_not_be_archived_leaves_the_line_without_a_path', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of({ verdict: null }))

    expect(line).not.toContain('.agent/')
    expect(line).toContain('the amount is rounded before the discount')
  })

  it('a_closure_from_a_plugin_that_named_no_task_still_names_the_slice', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of({ task: null }))

    expect(line).toContain('a task of owner/name#973')
  })

  it('goes_through_the_one_thing_that_knows_which_session_is_live', async () => {
    const sessions = new SessionsDouble()
    const announcements = new SessionClosureAnnouncements({ sessions: () => sessions.asSessions })

    await announcements.announce(Asked.of())

    expect(sessions.announced).toEqual([SessionClosureAnnouncements.lineFor(Asked.of())])
  })

  it('a_session_that_is_not_there_is_not_an_error_because_the_run_is_closed_all_the_same', async () => {
    const sessions = new SessionsDouble(false)
    const announcements = new SessionClosureAnnouncements({ sessions: () => sessions.asSessions })

    await expect(announcements.announce(Asked.of())).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd backend && npx vitest run __tests__/infrastructure/session-closure-announcements.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the implementation**

Create `backend/src/domain/ports/closure-announcements.ts`:

```ts
import type { RepositoryName } from '../value-objects/repository-name.ts'

export type AnnouncedClosure = {
  repository: RepositoryName,
  issue: number,
  task: number | null,
  findings: string | null,
  verdict: string | null,
}

export class ClosureAnnouncements {
  async announce({ repository, issue, task }: AnnouncedClosure): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement announce({ repository, issue, task, findings, verdict }), `
      + `asked for ${repository.text}#${issue} task ${task}`
    )
  }
}
```

Create `backend/src/infrastructure/session-closure-announcements.ts`:

```ts
import { ClosureAnnouncements, type AnnouncedClosure } from '../domain/ports/closure-announcements.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'

export class SessionClosureAnnouncements extends ClosureAnnouncements {
  readonly sessions: () => CoordinatingSessions

  constructor({ sessions }: { sessions: () => CoordinatingSessions }) {
    super()
    this.sessions = sessions
  }

  // ONE line, and addressed to the coordinating AGENT rather than to a person:
  // `CoordinatingSessions.announce` appends the submit character, so a second
  // line would be sent as a second prompt. The agent is the one that explains
  // it, which is what the change announcement next door already does.
  static lineFor({ repository, issue, task, findings, verdict }: AnnouncedClosure): string {
    const found = findings === null ? '' : ` What it found: ${SessionClosureAnnouncements.#flat(findings)}.`
    const where = verdict === null ? '' : ` The whole verdict is at ${verdict}.`

    const which = task === null ? 'a task' : `task ${task}`

    return `The judge vetoed ${which} of ${repository.text}#${issue} three times and the run is `
      + `closed at blocked-judge.${found}${where} Tell the person what failed and that you can grant `
      + `another round with \`ct-step reopen --issue ${issue} --instruction "…"\`. Do not run it yourself.`
  }

  override async announce(closure: AnnouncedClosure): Promise<void> {
    this.sessions().announce(SessionClosureAnnouncements.lineFor(closure))
  }

  // `lastFindings` is a list of lines and this is a single line, so the list's
  // own newlines become separators rather than submits.
  static #flat(findings: string): string {
    return findings.split('\n').map((line) => line.trim().replace(/^- /, '')).filter(Boolean).join('; ')
  }
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd backend && npx vitest run __tests__/infrastructure/session-closure-announcements.test.ts && npx tsc -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/ports/closure-announcements.ts backend/src/infrastructure/session-closure-announcements.ts backend/__tests__/infrastructure/session-closure-announcements.test.ts
git commit -m "feat(backend): the coordinating session can be told that the judge closed a run

One line, addressed to the agent, because announce submits at the end of
it. A session that is not there is not an error.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task F1: the slice card shows why the judge closed the run

**Files:**
- Modify: `frontend/src/app/active-plans/ActivePlan.types.ts:12`
- Modify: `frontend/src/app/slice-session/components/slice-session/SliceSession.tsx`
- Modify: `frontend/src/app/slice-session/components/slice-session/SliceSession.css`
- Test: `frontend/src/app/slice-session/components/slice-session/SliceSession.test.tsx`

**Interfaces:**
- Consumes: the `/active-plans` JSON in **The shared contract**.
- Produces: `SliceRecovery` gains `refusal: SliceRefusal | null`, where

```ts
type SliceRefusal = { state: string; outcome: string; exit: number; task: number | null; findings: string | null; verdict: string | null }
```

**Note:** this task ships on stubs. It needs neither B4 nor the plugin to be green.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/app/slice-session/components/slice-session/SliceSession.test.tsx`. First a helper near `renderSession`:

```tsx
const vetoed = (over: Partial<SliceRecovery> = {}): SliceRecovery => ({
  diagnostic: 'ct-step refused: the run is blocked-judge with outcome failed (exit 1)',
  action: 'inspect',
  pending: false,
  failure: null,
  onAct: () => {},
  onRetry: () => {},
  refusal: {
    state: 'blocked-judge',
    outcome: 'failed',
    exit: 1,
    task: 2,
    findings: '- [high] src/pago.ts:41: el importe se redondea antes del descuento',
    verdict: '.agent/run-7/task-2-verdict-3.json',
  },
  ...over,
})
```

Then the tests:

```tsx
  it('a run the judge closed names the closure and shows what the judge found', async () => {
    stubFetch(SliceSessionMother.progress())
    render(
      <SliceSession
        issue={SliceSessionMother.ISSUE}
        root={SliceSessionMother.ROOT}
        repo={SliceSessionMother.REPO}
        recovery={vetoed()}
      />
    )

    expect(await screen.findByText('El juez cerró este slice')).toBeInTheDocument()
    expect(screen.getByText(/el importe se redondea antes del descuento/)).toBeInTheDocument()
    expect(screen.getByText('.agent/run-7/task-2-verdict-3.json')).toBeInTheDocument()
  })

  it('the card offers no way to decide, because the decision goes through the coordinating session', async () => {
    stubFetch(SliceSessionMother.progress())
    render(
      <SliceSession
        issue={SliceSessionMother.ISSUE}
        root={SliceSessionMother.ROOT}
        repo={SliceSessionMother.REPO}
        recovery={vetoed()}
      />
    )

    expect(await screen.findByRole('button', { name: 'Reintentar recuperación' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ronda/i })).toBeNull()
  })

  it('a veto with nothing major to show still names the closure', async () => {
    stubFetch(SliceSessionMother.progress())
    render(
      <SliceSession
        issue={SliceSessionMother.ISSUE}
        root={SliceSessionMother.ROOT}
        repo={SliceSessionMother.REPO}
        recovery={vetoed({ refusal: { state: 'blocked-judge', outcome: 'failed', exit: 1, task: 2, findings: null, verdict: null } })}
      />
    )

    expect(await screen.findByText('El juez cerró este slice')).toBeInTheDocument()
    expect(screen.queryByText(/^\.agent\//)).toBeNull()
  })

  it('an uncertain slice with no closure is the card it always was', async () => {
    stubFetch(SliceSessionMother.progress())
    render(
      <SliceSession
        issue={SliceSessionMother.ISSUE}
        root={SliceSessionMother.ROOT}
        repo={SliceSessionMother.REPO}
        recovery={vetoed({ refusal: null })}
      />
    )

    expect(await screen.findByText('No se puede confirmar el estado de implementación')).toBeInTheDocument()
    expect(screen.queryByText('El juez cerró este slice')).toBeNull()
  })
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd frontend && npx vitest run src/app/slice-session/components/slice-session/SliceSession.test.tsx`
Expected: FAIL. `refusal` is not a property of `SliceRecovery`, and the heading is not rendered.

- [ ] **Step 3: Write the implementation**

In `frontend/src/app/active-plans/ActivePlan.types.ts`, add the type and widen the uncertain variant:

```ts
export type PlanRefusal = {
  state: string
  outcome: string
  exit: number
  task: number | null
  findings: string | null
  verdict: string | null
}

export type ActivePlan = ActivePlanIdentity & (
  | { phase: 'planning' | 'implementing' }
  | {
      phase: 'uncertain'
      diagnostic: string
      recovery: { action: RecoveryAction; detail: string }
      refusal?: PlanRefusal
    }
)
```

In `SliceSession.tsx`, add the import, the constant, the field and the block:

```tsx
import { PlanRefusal, RecoveryAction } from 'app/active-plans/ActivePlan.types'
```

```tsx
const VETOED_TITLE = 'El juez cerró este slice'
const VETOED_HINT = 'Habla con la sesión coordinadora para decidir qué hacer.'
const FOUND_LABEL = 'Lo que encontró el juez'
const VERDICT_LABEL = 'Veredicto completo'
const BLOCKED_JUDGE = 'blocked-judge'
```

```tsx
type SliceRecovery = {
  diagnostic: string
  action: RecoveryAction
  pending: boolean
  failure: string | null
  refusal?: PlanRefusal | null
  onAct: () => void
  onRetry: () => void
}
```

Inside the component, above the `return`:

```tsx
  const vetoed = recovery?.refusal?.state === BLOCKED_JUDGE ? recovery.refusal : null
```

And inside `{recovery !== null && ( … )}`, replace the `<Banner …/>` with:

```tsx
          <Banner
            type="warning"
            role="alert"
            title={vetoed === null ? UNCERTAIN_TITLE : VETOED_TITLE}
            description={vetoed === null ? (recovery.failure ?? recovery.diagnostic) : VETOED_HINT}
          />
          {vetoed !== null && (
            <dl className="slice-session__veto">
              {vetoed.findings !== null && (
                <>
                  <dt className="lg-body-small">{FOUND_LABEL}</dt>
                  <dd className="slice-session__veto-findings">{vetoed.findings}</dd>
                </>
              )}
              {vetoed.verdict !== null && (
                <>
                  <dt className="lg-body-small">{VERDICT_LABEL}</dt>
                  <dd className="slice-session__veto-verdict">{vetoed.verdict}</dd>
                </>
              )}
            </dl>
          )}
```

Append to `SliceSession.css`:

```css
.slice-session__veto {
  margin: 0;
}

.slice-session__veto-findings {
  margin: 0 0 var(--spacing-2, 8px);
  white-space: pre-wrap;
}

.slice-session__veto-verdict {
  margin: 0;
  font-family: monospace;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd frontend && npx vitest run src/app/slice-session/ && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, and the pre-existing tests in that folder still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/active-plans/ActivePlan.types.ts frontend/src/app/slice-session/components/slice-session/
git commit -m "feat(frontend): the slice card says the judge closed the run and shows what it found

Read-only: the decision goes through the coordinating session, so the
card gains no button.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Wave 2

## Task P2: the third veto is written down, with the judge's reason

**Depends on:** P1.

**Files:**
- Modify: `plugin/scripts/ct-step.mjs:2923-2928` and `:2966-2977`
- Test: `plugin/__tests__/ct-step-verdict.test.js`

**Interfaces:**
- Consumes: `StepAnnouncement.refusal({ …, findings, verdict })` from P1.
- Produces: after a third veto, `.agent/run-<n>.json` reads `closed: 'blocked-judge'`, and `ct-step verdict --output-format json` prints a refusal with `findings` and `verdict`.

**Why no `outcome` or `exit` is persisted:** the discard path exits at `ct-step.mjs:2917`, before the persistence below. So a persisted `closed: blocked-judge` is always the veto — `OUTCOMES.FAILED`, `EXIT.VETOED`. Tasks P3 and P4 rely on this.

- [ ] **Step 1: Write the failing tests**

Add to `plugin/__tests__/ct-step-verdict.test.js`, inside `describe('a veto leaves no trace to undo', …)`:

```javascript
  it('the third veto is written down, so the closure survives the process that reached it', () => {
    for (let i = 0; i < 3; i++) {
      ct('report', writeReport(['uno.txt']))
      ct('controls')
      veto()
      if (runState().step === 'advise') advise()
    }

    expect(runState().closed).toBe('blocked-judge')
  })

  it('the refusal of the third veto carries what the judge found and where its verdict is', () => {
    for (let i = 0; i < 2; i++) {
      ct('report', writeReport(['uno.txt']))
      ct('controls')
      veto()
      if (runState().step === 'advise') advise()
    }
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    // `judgeTask` seals the review token into the verdict and forwards every
    // extra argument to the verb (fixtures/ct-step-harness.js:245), so the
    // announcement flag rides along without bypassing the token.
    const third = judgeTask(
      writeVerdict('FAIL', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]),
      '--output-format', 'json',
    )
    const announced = JSON.parse(third.stdout.trim().split('\n').pop())

    expect(announced.state).toBe('blocked-judge')
    expect(announced.findings).toContain('uno.txt')
    expect(announced.verdict).toMatch(/task-\d+-verdict-\d+\.json$/)
  })
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd plugin && npx vitest run __tests__/ct-step-verdict.test.js -t 'written down'`
Expected: FAIL, `runState().closed` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `plugin/scripts/ct-step.mjs`, replace the persistence at `:2927`:

```javascript
  if (transition.state === RUN_STATES.DELIVERED) run = { ...run, closed: RUN_STATES.DELIVERED }
```

with:

```javascript
  if (transition.state === RUN_STATES.DELIVERED) run = { ...run, closed: RUN_STATES.DELIVERED }
  // The judge's veto is persisted for the same reason the good closure is: a
  // closure that lives only in the exit code of a process that has gone leaves
  // the run reading `step: judge` with the budget spent, so the next `next`
  // re-enters the judge and re-closes for free. Only this state, and only from
  // this path: the discard budget exits above, so a persisted `blocked-judge`
  // is always the veto — `FAILED`, `EXIT.VETOED`. `reopen` is what lifts it.
  if (transition.state === RUN_STATES.BLOCKED_JUDGE) run = { ...run, closed: RUN_STATES.BLOCKED_JUDGE }
```

Then, in the closure announcement below, replace:

```javascript
    const closure = {
      issue, task: run.task, tasksTotal: run.tasksTotal, step: before, discards: run.discards,
      state: transition.state, outcome, exit: code,
    }
    const announcement = code === EXIT.OK
      ? StepAnnouncement.transition(closure)
      : StepAnnouncement.refusal({ ...closure, detail })
```

with:

```javascript
    const closure = {
      issue, task: run.task, tasksTotal: run.tasksTotal, step: before, discards: run.discards,
      state: transition.state, outcome, exit: code,
    }
    // Only the judge's closure explains itself, and only because it is the one
    // whose reason the run is already holding: `lastVerdict` and `lastFindings`
    // are written by `verdictVerb` and `archive` has just put the verdict on
    // disk. Nothing is recomputed here.
    const explained = transition.state === RUN_STATES.BLOCKED_JUDGE
      ? { findings: run.lastFindings ?? null, verdict: archivedVerdictPath() }
      : {}
    const announcement = code === EXIT.OK
      ? StepAnnouncement.transition(closure)
      : StepAnnouncement.refusal({ ...closure, detail, ...explained })
```

And add this helper next to `archive` (around `:1160`):

```javascript
// The path `archive('verdict', …)` has just written, relative to the repository
// root so the line that travels to a person names something they can open. It
// answers null when the file is not there: archiving is best effort (it warns
// and carries on), and naming a file that does not exist is worse than naming
// none.
function archivedVerdictPath() {
  const relative = join('.agent', `run-${issue}`, `task-${run.task}-verdict-${currentAttempt()}.json`)
  return existsSync(join(repoRoot, relative)) ? relative : null
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd plugin && npx vitest run __tests__/ct-step-verdict.test.js __tests__/ct-step-delivery.test.js __tests__/e2e-ct-step.test.js`
Expected: PASS. The delivery and e2e suites prove the good closure still behaves.

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/ct-step.mjs plugin/__tests__/ct-step-verdict.test.js
git commit -m "feat(plugin): the judge's third veto is persisted and its refusal says what the judge found

Only this closure and only from the transition path: the discard budget
exits before it, so a persisted blocked-judge is always the veto.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task B3: `DriveRun` tells the coordinating session

**Depends on:** B1 (the type) and B2 (the port).

**Files:**
- Modify: `backend/src/application/actions/drive-run.ts`
- Modify: `backend/src/infrastructure/ct-api.ts:549-557`
- Test: `backend/__tests__/application/drive-run.test.ts`

**Interfaces:**
- Consumes: `ClosureAnnouncements` and `AnnouncedClosure` from B2; `RunClosure.findings` / `.verdict` from B1.
- Produces: `DriveRun` takes an optional `announcements: ClosureAnnouncements | null = null`. **Optional on purpose:** nine test sites construct `DriveRun`, and none of them should have to change for this.

- [ ] **Step 1: Write the failing tests**

Add to `backend/__tests__/application/drive-run.test.ts`. First the imports and a double:

```ts
import { ClosureAnnouncements, type AnnouncedClosure } from '../../src/domain/ports/closure-announcements.ts'
```

```ts
class AnnouncementsSpy extends ClosureAnnouncements {
  readonly announced: AnnouncedClosure[] = []
  readonly failing: boolean

  constructor(failing: boolean = false) {
    super()
    this.failing = failing
  }

  override async announce(closure: AnnouncedClosure): Promise<void> {
    this.announced.push(closure)
    if (this.failing) throw new Error('the session went away')
  }
}
```

Then the tests. Follow the file's existing mother for building a `DriveRun` whose first instruction is a refusal; pass `announcements` to it:

```ts
describe('a run the judge closed', () => {
  it('is announced to the coordinating session once, and still stops the drive', async () => {
    const announcements = new AnnouncementsSpy()
    const driving = DriveRunMother.refusing({
      detail: 'run blocked-judge: task 2/3, 0 discard(s)',
      closure: {
        state: 'blocked-judge', outcome: 'failed', exit: 1, task: 2,
        findings: '- [high] uno.ts:1: mal', verdict: '.agent/run-7/task-2-verdict-3.json',
      },
      announcements,
    })

    await expect(driving.drive()).rejects.toBeInstanceOf(RunNotAdvanced)
    expect(announcements.announced).toHaveLength(1)
    expect(announcements.announced[0]!.task).toBe(2)
    expect(announcements.announced[0]!.findings).toBe('- [high] uno.ts:1: mal')
  })

  it('a refusal of any other state is not announced, because only the judge has a way out', async () => {
    const announcements = new AnnouncementsSpy()
    const driving = DriveRunMother.refusing({
      detail: 'run blocked-global: task 3/3, 0 discard(s)',
      closure: {
        state: 'blocked-global', outcome: 'failed', exit: 9, task: 3, findings: null, verdict: null,
      },
      announcements,
    })

    await expect(driving.drive()).rejects.toBeInstanceOf(RunNotAdvanced)
    expect(announcements.announced).toEqual([])
  })

  it('an announcement that fails does not change what the drive throws', async () => {
    const announcements = new AnnouncementsSpy(true)
    const driving = DriveRunMother.refusing({
      detail: 'run blocked-judge: task 2/3, 0 discard(s)',
      closure: {
        state: 'blocked-judge', outcome: 'failed', exit: 1, task: 2, findings: null, verdict: null,
      },
      announcements,
    })

    await expect(driving.drive()).rejects.toBeInstanceOf(RunNotAdvanced)
  })
})
```

`DriveRunMother.refusing` does not exist yet, and building it is part of this task. `backend/__tests__/application/drive-run.test.ts:320` already constructs a `DriveRun` inside the file's own mother class, with a `RunMachine` double whose `open` answers an instruction. Extend that class with a `refusing({ detail, closure, announcements })` static that builds the same object with `announcements` passed through and a machine whose `open` answers `new RunInstruction({ kind: 'refused', detail, closure })`, and returns `{ drive: () => driver.execute(new DriveRunParams({ watch, planner })) }`. Read that block before writing it; do not add a second way to build the same object.

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd backend && npx vitest run __tests__/application/drive-run.test.ts -t 'judge closed'`
Expected: FAIL — `DriveRun` takes no `announcements`.

- [ ] **Step 3: Write the implementation**

In `backend/src/application/actions/drive-run.ts`, add the import:

```ts
import type { ClosureAnnouncements } from '../../domain/ports/closure-announcements.ts'
```

Add the field, the constructor parameter and the constant:

```ts
export class DriveRun {
  static readonly BLOCKED_JUDGE = 'blocked-judge'

  readonly calls: PlanCalls
  readonly publication: PlanPublication
  readonly machine: RunMachine
  readonly step: ExecuteRunInstruction
  readonly messages: DeliverHeldMessages
  readonly escalations: ReadSliceEscalation
  readonly announcements: ClosureAnnouncements | null
  readonly driving: Map<string, Promise<void>>
```

```ts
  constructor({ calls, publication, machine, step, messages, escalations, announcements = null }: {
    calls: PlanCalls,
    publication: PlanPublication,
    machine: RunMachine,
    step: ExecuteRunInstruction,
    messages: DeliverHeldMessages,
    escalations: ReadSliceEscalation,
    // Optional, and null by default: this is the only dependency of the drive
    // that changes nothing about whether the run advances, and making it
    // required would make every construction of a DriveRun carry a double for
    // a message.
    announcements?: ClosureAnnouncements | null,
  }) {
```

...with `this.announcements = announcements` alongside the others.

Replace the `case 'refused'` arm of the `switch` in `#drive`:

```ts
        case 'refused':
          await this.#announce(params.watch, instruction.work)
          throw new RunNotAdvanced(instruction.work.detail)
```

And add the private method next to `#waiting`:

```ts
  // Only the judge's closure, because it is the only one a person can get out
  // of today. The failure is swallowed the way RunPlanAgents.#announce swallows
  // its own: a message that does not arrive must not turn a closed run into a
  // crashed backend, and the closure is on disk and on the page regardless.
  async #announce(watch: PlanWatch, refused: { closure: RunClosure | null }): Promise<void> {
    const closure = refused.closure
    if (this.announcements === null || closure === null) return
    if (closure.state !== DriveRun.BLOCKED_JUDGE) return
    try {
      await this.announcements.announce({
        repository: watch.repository,
        issue: watch.issue.number,
        task: closure.task,
        findings: closure.findings,
        verdict: closure.verdict,
      })
    } catch {
      // Nothing to do and nothing to say here: the drive is about to throw
      // RunNotAdvanced with the refusal's own detail, which is the real news.
    }
  }
```

Add the type import for `RunClosure` at the top:

```ts
import type { RunClosure } from '../../domain/value-objects/run-instruction.ts'
```

In `backend/src/infrastructure/ct-api.ts`, add the import next to the other announcement import at `:38`:

```ts
import { SessionClosureAnnouncements } from './session-closure-announcements.ts'
```

and add one line to the `new DriveRun({…})` at `:549`:

```ts
      escalations: readSliceEscalation,
      announcements: new SessionClosureAnnouncements({ sessions: () => coordinatingSessions }),
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd backend && npx vitest run __tests__/application/drive-run.test.ts __tests__/infrastructure/run-plan-agents.test.ts __tests__/infrastructure/run-plan-recovery.test.ts && npx tsc -p tsconfig.json`
Expected: PASS. The two infrastructure suites prove the nine untouched construction sites still compile and behave.

- [ ] **Step 5: Commit**

```bash
git add backend/src/application/actions/drive-run.ts backend/src/infrastructure/ct-api.ts backend/__tests__/application/drive-run.test.ts
git commit -m "feat(backend): a run the judge closed is announced in the coordinating session

Only blocked-judge, because it is the only closure a person can get out
of. A failed announcement changes nothing the drive throws.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task B4: `/active-plans` forwards what the judge found

**Depends on:** B1.

**Files:**
- Modify: `backend/src/infrastructure/active-plans-route.ts:175-177`
- Test: `backend/__tests__/infrastructure/active-plans-route.test.ts`

**Interfaces:**
- Consumes: `RunClosure` from B1.
- Produces: the `/active-plans` JSON in **The shared contract**. `findings` and `verdict` are always present on `refusal`, as `null` when there is nothing.

- [ ] **Step 1: Write the failing test**

Add to `backend/__tests__/infrastructure/active-plans-route.test.ts`, following that file's existing way of remembering an uncertain plan and reading the route's JSON:

```ts
  it('an uncertain plan the judge closed carries what it found, so the page needs no second call', () => {
    const plans = new ActivePlans()
    plans.rememberUncertain(
      watch,
      'ct-step refused: the run is blocked-judge with outcome failed (exit 1)',
      { action: 'inspect', detail: 'ct-step refused' },
      {
        state: 'blocked-judge', outcome: 'failed', exit: 1, task: 2,
        findings: '- [high] uno.ts:1: mal', verdict: '.agent/run-7/task-2-verdict-3.json',
      },
    )

    const [projected] = plans.projected()

    expect(projected!.refusal).toEqual({
      state: 'blocked-judge',
      outcome: 'failed',
      exit: 1,
      task: 2,
      findings: '- [high] uno.ts:1: mal',
      verdict: '.agent/run-7/task-2-verdict-3.json',
    })
  })
```

Read the file first and reuse its own names for the watch fixture and for the projection call — do not introduce a second way to build either.

- [ ] **Step 2: Run the test and see it fail**

Run: `cd backend && npx vitest run __tests__/infrastructure/active-plans-route.test.ts -t 'judge closed'`
Expected: FAIL. `refusal` carries only `state`, `outcome` and `exit`.

- [ ] **Step 3: Write the implementation**

In `backend/src/infrastructure/active-plans-route.ts`, replace lines 175-177:

```ts
    if (refusal !== null) {
      projected.refusal = Object.freeze({ state: refusal.state, outcome: refusal.outcome, exit: refusal.exit })
    }
```

with:

```ts
    if (refusal !== null) {
      // The fields are listed rather than spread, the way they already were:
      // this is the wire, and a field reaches the page because somebody decided
      // it should. `findings` and `verdict` are always present, null included,
      // so the page never has to tell "absent" from "nothing to show".
      projected.refusal = Object.freeze({
        state: refusal.state,
        outcome: refusal.outcome,
        exit: refusal.exit,
        task: refusal.task,
        findings: refusal.findings,
        verdict: refusal.verdict,
      })
    }
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd backend && npx vitest run __tests__/infrastructure/active-plans-route.test.ts && npx tsc -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/infrastructure/active-plans-route.ts backend/__tests__/infrastructure/active-plans-route.test.ts
git commit -m "feat(backend): active-plans carries what the judge found, so the card needs no second call

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Wave 3

## Task P3: a persisted closure answers instead of re-entering the judge

**Depends on:** P2.

**Files:**
- Modify: `plugin/scripts/ct-step.mjs:337-360`
- Test: `plugin/__tests__/ct-step-reopen.test.js` (create)

**Interfaces:**
- Consumes: the persisted `closed: 'blocked-judge'` from P2.
- Produces: over a persisted judge closure, `ct-step next` exits `EXIT.VETOED` (1) announcing a refusal; every other verb dies with `EXIT.WRONG_STEP` naming `reopen`.

- [ ] **Step 1: Write the failing tests**

Create `plugin/__tests__/ct-step-reopen.test.js`:

```javascript
// The way out of the judge's third veto. The preamble — and why there are nine
// files and not one — is in fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo } from './fixtures/ct-step-harness.js'

let repo
const { ct, writeReport, writeVerdict, runState, judgeTask } = makeHelpers(() => repo)

const veto = () => judgeTask(writeVerdict('FAIL', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]))

const advise = () => {
  ct('next')
  const p = join(repo, 'advice.json')
  writeFileSync(p, JSON.stringify({ approach: 'por otro camino', files_to_reconsider: [] }))
  return ct('advice', p)
}

// Three vetoes, through the adviser the second one opens.
const blocked = () => {
  for (let i = 0; i < 3; i++) {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    veto()
    if (runState().step === 'advise') advise()
  }
  expect(runState().closed).toBe('blocked-judge')
}

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

describe('a run the judge closed does not quietly close again', () => {
  it('next answers the closure instead of re-entering the judge', () => {
    blocked()

    const answered = ct('next')

    expect(answered.status).toBe(1)
    expect(answered.stdout + answered.stderr).toContain('reopen')
    expect(runState().step).toBe('judge')
  })

  it('next announces the closure it is standing on, not a step', () => {
    blocked()

    const answered = ct('next', '--output-format', 'json')
    const announced = JSON.parse(answered.stdout.trim().split('\n').pop())

    expect(announced.kind).toBe('refusal')
    expect(announced.state).toBe('blocked-judge')
    expect(announced.outcome).toBe('failed')
    expect(announced.exit).toBe(1)
  })

  it('a verb that would transition is a sequence error that names the way out', () => {
    blocked()

    const answered = ct('report', writeReport(['uno.txt']))

    expect(answered.status).toBe(9)
    expect(answered.stderr).toContain('reopen')
  })
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd plugin && npx vitest run __tests__/ct-step-reopen.test.js -t 'does not quietly close again'`
Expected: FAIL. `next` re-enters the judge and answers a step.

- [ ] **Step 3: Write the implementation**

In `plugin/scripts/ct-step.mjs`, immediately after the `if (run.closed === RUN_STATES.DELIVERED) { … }` block that ends around `:360`, add:

```javascript
// The judge's closure, given the shape of the good one right above: the state
// is READ from the file instead of rebuilt from the table, and the verbs that
// would transition are sequence errors. The pair (outcome, exit) is not
// persisted because it does not have to be — the discard budget exits before
// the persistence, so a `blocked-judge` on disk is always the veto.
if (run.closed === RUN_STATES.BLOCKED_JUDGE) {
  const WAY_OUT = `the judge vetoed task ${run.task} of issue ${issue} three times and the run is closed. `
    + `Grant another round with "ct-step reopen --plan ${planPath} --issue ${issue} --instruction \\"…\\"".`
  if (verb === 'next') {
    if (announcing) {
      safeWrite(1, StepAnnouncement.refusal({
        issue, task: run.task, tasksTotal: run.tasksTotal, step: run.step, discards: run.discards,
        state: RUN_STATES.BLOCKED_JUDGE, outcome: OUTCOMES.FAILED, exit: EXIT.VETOED,
        detail: WAY_OUT,
      }).text())
    }
    out(WAY_OUT)
    process.exit(EXIT.VETOED)
  }
  die(WAY_OUT, EXIT.WRONG_STEP)
}
```

Confirm `OUTCOMES` is already imported in this file; `run-machine.js` exports it and `ct-step.mjs` uses it at `:2914`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd plugin && npx vitest run __tests__/ct-step-reopen.test.js __tests__/ct-step-verdict.test.js __tests__/e2e-ct-step.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/ct-step.mjs plugin/__tests__/ct-step-reopen.test.js
git commit -m "fix(plugin): a run the judge closed answers its closure instead of re-entering the judge

Before this, next re-entered at judge with the budget spent and re-closed
on the first FAIL: the loop was not stuck, it was re-blocking for free.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task P4: `ct-step reopen` grants another round

**Depends on:** P2. **Rebase on P3** before starting: both edit the same gate block, and P3's `WAY_OUT` is the text this task makes true.

**Files:**
- Modify: `plugin/scripts/ct-step.mjs:164-180` (usage), `:184` (the verb list), the gate block P3 added
- Test: `plugin/__tests__/ct-step-reopen.test.js`

**Interfaces:**
- Consumes: the gate block from P3.
- Produces: `ct-step reopen --plan <file> --issue <n> --instruction "<text>"`. On a run closed at `blocked-judge` it exits `0`, leaves `closed` absent, `judgeRetries: 0`, `step: 'implement'`, `lastAdvice` holding the text, and `discards` untouched. On any other run it exits `EXIT.WRONG_STEP`.

- [ ] **Step 1: Write the failing tests**

Add to `plugin/__tests__/ct-step-reopen.test.js`:

```javascript
describe('reopen is the way a person gets a run out of the judge', () => {
  it('lifts the closure and sends the run back to the implementer', () => {
    blocked()

    const reopened = ct('reopen', '--instruction', 'redondea después de aplicar el descuento')

    expect(reopened.status).toBe(0)
    expect(runState().closed).toBeUndefined()
    expect(runState().step).toBe('implement')
    expect(runState().judgeRetries).toBe(0)
  })

  it('carries the person instruction to the implementer the way the adviser does', () => {
    blocked()

    ct('reopen', '--instruction', 'redondea después de aplicar el descuento')

    expect(runState().lastAdvice).toContain('redondea después de aplicar el descuento')
  })

  it('does not reset the discards, because an illegible judge is a different failure', () => {
    blocked()
    const spent = runState().discards

    ct('reopen', '--instruction', 'otra vuelta')

    expect(runState().discards).toBe(spent)
  })

  it('after it, next dispatches the implementer again instead of answering a closure', () => {
    blocked()
    ct('reopen', '--instruction', 'otra vuelta')

    const answered = ct('next')

    expect(answered.status).toBe(0)
    expect(runState().step).toBe('implement')
  })

  it('a run that is not closed at the judge has nothing to reopen', () => {
    ct('report', writeReport(['uno.txt']))

    const refused = ct('reopen', '--instruction', 'otra vuelta')

    expect(refused.status).toBe(9)
    expect(refused.stderr).toContain('not closed')
  })

  it('an instruction is required, because a reopen with nothing to say repeats the veto', () => {
    blocked()

    const refused = ct('reopen')

    expect(refused.status).toBe(2)
    expect(refused.stderr).toContain('--instruction')
  })
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd plugin && npx vitest run __tests__/ct-step-reopen.test.js -t 'way a person gets'`
Expected: FAIL with `unknown verb: reopen`.

- [ ] **Step 3: Write the implementation**

In `plugin/scripts/ct-step.mjs`, add `reopen` to the verb list at `:184`:

```javascript
if (!['next', 'report', 'controls', 'verdict', 'advice', 'commit', 'reconcile', 'global', 'slice-verdict', 'e2e', 'reopen'].includes(verb)) {
```

Add a line to `USAGE` (`:164-180`), next to the other verbs:

```
  reopen --instruction "<text>"   grant another round after the judge's third veto
```

Inside the gate block P3 added, before its `if (verb === 'next')`, insert:

```javascript
  if (verb === 'reopen') {
    const instruction = arg('--instruction')
    if (typeof instruction !== 'string' || instruction.trim() === '') {
      die(`reopen needs --instruction "<text>": ${WAY_OUT}`, EXIT.USAGE)
    }
    // The three fields a third veto leaves behind, and nothing else. The
    // DISCARDS ARE NOT RESET: they count an answer that could not be read,
    // which is a different failure from a judgement that said no, and clearing
    // them here would hide a judge that is illegible behind a person's
    // patience. The instruction travels as `lastAdvice` because that is the
    // field the implementer's brief already appends (see adviceSection): the
    // person's words reach the implementer by the road the adviser's already
    // take.
    const { closed: _lifted, ...reopened } = run
    run = { ...reopened, step: STEPS.IMPLEMENT, judgeRetries: 0, lastAdvice: instruction }
    save()
    out(`run reopened at task ${run.task} of issue ${issue}: the implementer gets another round, and the judge will look again. Ask for the step with "ct-step next".`)
    process.exit(EXIT.OK)
  }
```

Then, after the whole gate block, add the refusal for a run that is not closed there:

```javascript
// `reopen` outside its closure: the run is not the judge's to give back.
if (verb === 'reopen') {
  die(
    `the run of issue ${issue} is not closed at ${RUN_STATES.BLOCKED_JUDGE}: it stands at step ${run.step}, `
    + 'so there is nothing to reopen.',
    EXIT.WRONG_STEP,
  )
}
```

Confirm `STEPS` is imported in this file; it is used throughout, for instance at `:2422`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd plugin && npx vitest run __tests__/ct-step-reopen.test.js __tests__/ct-step-verdict.test.js __tests__/ct-step-advice.test.js __tests__/e2e-ct-step.test.js`
Expected: PASS.

- [ ] **Step 5: Run every test in the repository**

Run: `make test-all`
Expected: PASS, or only failures that reproduce on a clean `main` on this machine. Say which, and do not weaken anything to make one go away.

- [ ] **Step 6: Commit**

```bash
git add plugin/scripts/ct-step.mjs plugin/__tests__/ct-step-reopen.test.js
git commit -m "feat(ct-step): reopen grants another round after the judge's third veto

The person's instruction reaches the implementer as lastAdvice, the road
the adviser's own advice already takes. Discards are not reset: an
illegible judge is a different failure from one that said no.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Closing the branch

- [ ] `make check` is green.
- [ ] #505 has merged. **Do not open this pull request for merge before it has**, because the way back in depends on it.
- [ ] The pull request title carries a conventional-commit type and is the message that reaches `main`. Proposed: `feat(ct-step): a person can get a run out of the judge's third veto`.
- [ ] The issue moves to `In Review` in Project 16 when the pull request opens, and to `Done` when it merges (`docs/project-16.md`).

## Self-review of this plan against the spec

| Spec section | Task |
|---|---|
| Plugin: announcement fields | P1 |
| Plugin: persistence `:2927` | P2 |
| Plugin: announcement `:2969-2975` | P2 |
| Plugin: the gate `:341` | P3 |
| Plugin: the `reopen` verb | P4 |
| Backend: `RunClosure` + `run-announcement.ts` | B1 |
| Backend: the port and its implementation | B2 |
| Backend: the call site in `DriveRun` + wiring | B3 |
| Backend: `active-plans-route.ts:176` | B4 |
| Frontend: types and the card | F1 |
| Failure modes: no live session | B2 (`a_session_that_is_not_there…`) |
| Failure modes: stale cached plugin | B1 (`a plugin too old to send them…`) |
| Failure modes: no verdict file | P2 (`archivedVerdictPath` answers null), B2, F1 |
| Failure modes: no major findings | B2, F1 |
| Failure modes: `reopen` outside its closure | P4 |
| Failure modes: reopened and vetoed again | P4 (`after it, next dispatches…`) |
| Language rule | F1 is Spanish copy; everything else English |
