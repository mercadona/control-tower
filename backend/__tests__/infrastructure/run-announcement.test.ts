import { describe, it, expect } from 'vitest'
import { AnnouncedStep, RunAnnouncement } from '../../src/infrastructure/run-announcement.ts'
import { RunNotUnderstood } from '../../src/domain/exceptions.ts'

class AnnouncementMother {
  static readonly BLOCKED_JUDGE_DISCARDED =
    '{"version":1,"kind":"refusal","state":"blocked-judge","outcome":"discarded","exit":3,'
    + '"run":{"issue":9,"task":1,"tasksTotal":2,"step":"judge","discards":6},"detail":"6 discards"}'

  static readonly UNKNOWN_VERSION = AnnouncementMother.BLOCKED_JUDGE_DISCARDED.replace('"version":1', '"version":2')

  static readonly VETOED_WITH_FINDINGS =
    '{"version":1,"kind":"refusal","state":"blocked-judge","outcome":"failed","exit":1,'
    + '"run":{"issue":9,"task":1,"tasksTotal":2,"step":"judge","discards":0},'
    + '"detail":"run blocked-judge: task 1/2, 0 discard(s)",'
    + '"findings":"- [high] uno.txt:1: mal","verdict":".agent/run-9/task-1-verdict-3.json"}'

  static readonly VETOED_WITH_UNREADABLE_FINDINGS =
    AnnouncementMother.VETOED_WITH_FINDINGS.replace('"findings":"- [high] uno.txt:1: mal"', '"findings":42')

  static undeclaredTransitionState(): string {
    return JSON.stringify({
      version: 1,
      kind: 'transition',
      state: 'made-up-state',
      outcome: 'done',
      exit: 0,
      run: { issue: 9, task: 2, tasksTotal: 2, step: 'commit', discards: 0 },
    })
  }

  static refusalWithEmptyDetail(): string {
    return JSON.stringify({
      version: 1,
      kind: 'refusal',
      state: 'blocked-judge',
      outcome: 'discarded',
      exit: 3,
      run: { issue: 9, task: 1, tasksTotal: 2, step: 'judge', discards: 6 },
      detail: '',
    })
  }

  static notValidJson(): string {
    return '{not valid json'
  }

  static undeclaredKind(): string {
    return JSON.stringify({
      version: 1,
      kind: 'made-up-kind',
      state: 'open',
      outcome: 'done',
      exit: 0,
      run: { issue: 9, task: 2, tasksTotal: 2, step: 'commit', discards: 0 },
    })
  }

  static transitionNamingNoStep(): string {
    return JSON.stringify({
      version: 1,
      kind: 'transition',
      state: 'open',
      outcome: 'done',
      exit: 0,
      run: { issue: 9, task: 2, tasksTotal: 2, discards: 0 },
    })
  }

  static undeclaredOutcome(): string {
    return JSON.stringify({
      version: 1,
      kind: 'transition',
      state: 'open',
      outcome: 'made-up-outcome',
      exit: 0,
      run: { issue: 9, task: 2, tasksTotal: 2, step: 'commit', discards: 0 },
    })
  }

  static nonIntegerExit(): string {
    return JSON.stringify({
      version: 1,
      kind: 'transition',
      state: 'open',
      outcome: 'done',
      exit: 1.5,
      run: { issue: 9, task: 2, tasksTotal: 2, step: 'commit', discards: 0 },
    })
  }

  static reconcilerRound(): string {
    return JSON.stringify({
      version: 1,
      kind: 'step',
      run: { issue: 9, task: 1, tasksTotal: 2, step: 'reconcile', attempt: 1 },
      dispatch: {
        inputs: [{ role: 'reconciliation-package', kind: 'literal', path: '.agent/reconcile-package.md' }],
        response: { kind: 'edits', path: null },
      },
      consuming: { argv: ['reconcile', '--plan', 'docs/superpowers/plans/plan.md', '--issue', '9'] },
    })
  }

  static reconcilerRoundWhoseConsumingArgvCarriesANumber(): string {
    return JSON.stringify({
      version: 1,
      kind: 'step',
      run: { issue: 9, task: 1, tasksTotal: 2, step: 'reconcile', attempt: 1 },
      dispatch: {
        inputs: [{ role: 'reconciliation-package', kind: 'literal', path: '.agent/reconcile-package.md' }],
        response: { kind: 'edits', path: null },
      },
      consuming: { argv: ['reconcile', '--plan', 'docs/superpowers/plans/plan.md', '--issue', 9] },
    })
  }

  static controlsRoundWhoseCommandsCarryANumber(): string {
    return JSON.stringify({
      version: 1,
      kind: 'step',
      run: { issue: 9, task: 1, tasksTotal: 2, step: 'controls', attempt: 1 },
      commands: ['npm run lint', 9],
      consuming: { argv: ['controls', '--plan', 'docs/superpowers/plans/plan.md', '--issue', '9'] },
    })
  }

  static controlsRoundWithNoConsumingKey(): string {
    return JSON.stringify({
      version: 1,
      kind: 'step',
      run: { issue: 9, task: 1, tasksTotal: 2, step: 'controls', attempt: 1 },
      commands: ['npm run lint', 'npm test'],
    })
  }

  static reconcilerRoundWithoutAPath(): string {
    return JSON.stringify({
      version: 1,
      kind: 'step',
      run: { issue: 9, task: 1, tasksTotal: 2, step: 'reconcile', attempt: 1 },
      dispatch: {
        inputs: [{ role: 'reconciliation-package', kind: 'literal' }],
        response: { kind: 'edits', path: null },
      },
      consuming: { argv: ['reconcile', '--plan', 'docs/superpowers/plans/plan.md', '--issue', '9'] },
    })
  }

  static reconcilerRoundOfAnUndeclaredInputKind(): string {
    return JSON.stringify({
      version: 1,
      kind: 'step',
      run: { issue: 9, task: 1, tasksTotal: 2, step: 'reconcile', attempt: 1 },
      dispatch: {
        inputs: [{ role: 'reconciliation-package', kind: 'directory', path: '.agent/reconcile-package.md' }],
        response: { kind: 'edits', path: null },
      },
      consuming: { argv: ['reconcile', '--plan', 'docs/superpowers/plans/plan.md', '--issue', '9'] },
    })
  }

  static sliceJudgeRoundCarryingTheVerdictsGlob(): string {
    return JSON.stringify({
      version: 1,
      kind: 'step',
      run: { issue: 9, task: 2, tasksTotal: 2, step: 'slice-judge', attempt: 1 },
      dispatch: {
        agent: 'ct-slice-judge',
        inputs: [
          { role: 'package', kind: 'literal', path: '/repo/.agent/run-9/slice-package.json' },
          { role: 'plan', kind: 'literal', path: 'docs/superpowers/plans/plan.md' },
          { role: 'verdicts', kind: 'glob', path: 'docs/superpowers/verdicts/issue-9-task-*.json' },
        ],
        response: { kind: 'file', path: '/repo/.agent/run-9/slice-verdict.json' },
      },
      consuming: {
        argv: [
          'slice-verdict', '/repo/.agent/run-9/slice-verdict.json',
          '--plan', 'docs/superpowers/plans/plan.md', '--issue', '9',
        ],
      },
    })
  }

  static judgeRoundAnnouncingNoInput(): string {
    return JSON.stringify({
      version: 1,
      kind: 'step',
      run: { issue: 9, task: 1, tasksTotal: 2, step: 'judge', attempt: 1 },
      dispatch: {
        agent: 'ct-judge',
        response: { kind: 'file', path: '/repo/.agent/run-9/task-1-verdict.json' },
      },
      consuming: {
        argv: [
          'verdict', '/repo/.agent/run-9/task-1-verdict.json',
          '--plan', 'docs/superpowers/plans/plan.md', '--issue', '9',
        ],
      },
    })
  }

  static judgeRoundAnnouncingAnEmptyInputList(): string {
    return JSON.stringify({
      version: 1,
      kind: 'step',
      run: { issue: 9, task: 1, tasksTotal: 2, step: 'judge', attempt: 1 },
      dispatch: {
        agent: 'ct-judge',
        inputs: [],
        response: { kind: 'file', path: '/repo/.agent/run-9/task-1-verdict.json' },
      },
      consuming: {
        argv: [
          'verdict', '/repo/.agent/run-9/task-1-verdict.json',
          '--plan', 'docs/superpowers/plans/plan.md', '--issue', '9',
        ],
      },
    })
  }

  static judgeRoundCarryingThePackageAlone(): string {
    return JSON.stringify({
      version: 1,
      kind: 'step',
      run: { issue: 9, task: 1, tasksTotal: 2, step: 'judge', attempt: 1 },
      dispatch: {
        agent: 'ct-judge',
        inputs: [{ role: 'package', kind: 'literal', path: '/repo/.agent/run-9/task-1-package.json' }],
        response: { kind: 'file', path: '/repo/.agent/run-9/task-1-verdict.json' },
      },
      consuming: {
        argv: [
          'verdict', '/repo/.agent/run-9/task-1-verdict.json',
          '--plan', 'docs/superpowers/plans/plan.md', '--issue', '9',
        ],
      },
    })
  }

  static judgeRoundCarryingAnUndeclaredPlanRole(): string {
    return JSON.stringify({
      version: 1,
      kind: 'step',
      run: { issue: 9, task: 1, tasksTotal: 2, step: 'judge', attempt: 1 },
      dispatch: {
        agent: 'ct-judge',
        inputs: [
          { role: 'package', kind: 'literal', path: '/repo/.agent/run-9/task-1-package.json' },
          { role: 'brief', kind: 'literal', path: 'docs/superpowers/plans/2026-09-21-issue-9-brief.md' },
          { role: 'plan', kind: 'literal', path: '/etc/hosts' },
        ],
        response: { kind: 'file', path: '/repo/.agent/run-9/task-1-verdict.json' },
      },
      consuming: {
        argv: [
          'verdict', '/repo/.agent/run-9/task-1-verdict.json',
          '--plan', 'docs/superpowers/plans/plan.md', '--issue', '9',
        ],
      },
    })
  }

  static judgeRoundCarryingTheBriefTwice(): string {
    return JSON.stringify({
      version: 1,
      kind: 'step',
      run: { issue: 9, task: 1, tasksTotal: 2, step: 'judge', attempt: 1 },
      dispatch: {
        agent: 'ct-judge',
        inputs: [
          { role: 'package', kind: 'literal', path: '/repo/.agent/run-9/task-1-package.json' },
          { role: 'brief', kind: 'literal', path: 'docs/superpowers/plans/2026-09-21-issue-9-brief.md' },
          { role: 'brief', kind: 'literal', path: '/etc/hosts' },
        ],
        response: { kind: 'file', path: '/repo/.agent/run-9/task-1-verdict.json' },
      },
      consuming: {
        argv: [
          'verdict', '/repo/.agent/run-9/task-1-verdict.json',
          '--plan', 'docs/superpowers/plans/plan.md', '--issue', '9',
        ],
      },
    })
  }

  static judgeRoundCarryingItsOptionalControlsLog(): string {
    return JSON.stringify({
      version: 1,
      kind: 'step',
      run: { issue: 9, task: 1, tasksTotal: 2, step: 'judge', attempt: 1 },
      dispatch: {
        agent: 'ct-judge',
        inputs: [
          { role: 'package', kind: 'literal', path: '/repo/.agent/run-9/task-1-package.json' },
          { role: 'brief', kind: 'literal', path: 'docs/superpowers/plans/2026-09-21-issue-9-brief.md' },
          { role: 'controls-log', kind: 'literal', path: '/repo/.agent/run-9/controls-9-1.log' },
        ],
        response: { kind: 'file', path: '/repo/.agent/run-9/task-1-verdict.json' },
      },
      consuming: {
        argv: [
          'verdict', '/repo/.agent/run-9/task-1-verdict.json',
          '--plan', 'docs/superpowers/plans/plan.md', '--issue', '9',
        ],
      },
    })
  }

  static transitionCarryingDispatchInputs(): string {
    return JSON.stringify({
      version: 1,
      kind: 'transition',
      state: 'open',
      outcome: 'done',
      exit: 0,
      run: { issue: 9, task: 1, tasksTotal: 2, step: 'reconcile', discards: 0 },
      dispatch: {
        inputs: [{ role: 'reconciliation-package', kind: 'literal', path: '.agent/reconcile-package.md' }],
        response: { kind: 'edits', path: null },
      },
    })
  }

  static dispatchProse(step: string): string {
    return [
      'DISPATCH THE JUDGE (subagent ct-judge — declared WITHOUT Bash: Read, Grep, Glob, Write, Skill) with:',
      '  - the review package: /repo/.agent/run-9/task-1-package.json',
      "  - the task's brief: docs/superpowers/plans/2026-09-21-issue-9-brief.md",
      `step: ${step} (attempt 1)`,
      '  - that it write its verdict to: /repo/.agent/run-9/task-1-verdict.json',
      'When it comes back:  ct-step verdict /repo/.agent/run-9/task-1-verdict.json '
        + '--plan docs/superpowers/plans/2026-09-21-issue-9-brief.md --issue 9',
    ].join('\n')
  }
}

describe('RunAnnouncement', () => {
  it('a refusal composes the diagnostic from its state outcome and exit', () => {
    const announcement = RunAnnouncement.of(AnnouncementMother.BLOCKED_JUDGE_DISCARDED)

    expect(announcement?.kind).toBe('refusal')
    expect(announcement?.step).toBe('judge')
    expect(announcement?.closure).toEqual({
      state: 'blocked-judge',
      outcome: 'discarded',
      exit: 3,
      task: 1,
      findings: null,
      verdict: null,
    })
    expect(announcement?.diagnostic).toBe(
      'ct-step refused: the run is blocked-judge with outcome discarded (exit 3) — 6 discards',
    )
  })

  it('an announcement of an unknown version is not understood', () => {
    expect(() => RunAnnouncement.of(AnnouncementMother.UNKNOWN_VERSION)).toThrow(RunNotUnderstood)
  })

  it('prose answers null instead of an announcement', () => {
    expect(RunAnnouncement.of(AnnouncementMother.dispatchProse('judge'))).toBeNull()
  })

  it('a transition of an undeclared state is not understood', () => {
    expect(() => RunAnnouncement.of(AnnouncementMother.undeclaredTransitionState())).toThrow(RunNotUnderstood)
  })

  it('a refusal with an empty detail is not understood', () => {
    expect(() => RunAnnouncement.of(AnnouncementMother.refusalWithEmptyDetail())).toThrow(RunNotUnderstood)
  })

  it('an announcement that is not valid JSON is not understood', () => {
    expect(() => RunAnnouncement.of(AnnouncementMother.notValidJson())).toThrow(RunNotUnderstood)
  })

  it('an announcement of an undeclared kind is not understood', () => {
    expect(() => RunAnnouncement.of(AnnouncementMother.undeclaredKind())).toThrow(RunNotUnderstood)
  })

  it('a transition that names no step is not understood', () => {
    expect(() => RunAnnouncement.of(AnnouncementMother.transitionNamingNoStep())).toThrow(RunNotUnderstood)
  })

  it('the refusal of a transition that names no step says these words', () => {
    expect(() => RunAnnouncement.of(AnnouncementMother.transitionNamingNoStep())).toThrowError(
      new RunNotUnderstood(
        'the announcement names no step in {"version":1,"kind":"transition","state":"open","outcome":"done",'
        + '"exit":0,"run":{"issue":9,"task":2,"tasksTotal":2,"discards":0}}',
      ),
    )
  })

  it('a transition of an undeclared outcome is not understood', () => {
    expect(() => RunAnnouncement.of(AnnouncementMother.undeclaredOutcome())).toThrow(RunNotUnderstood)
  })

  it('a transition with a non-integer exit is not understood', () => {
    expect(() => RunAnnouncement.of(AnnouncementMother.nonIntegerExit())).toThrow(RunNotUnderstood)
  })
})

describe('AnnouncedStep', () => {
  it('the announced round takes its reconciliation package from the announcement', () => {
    const round = AnnouncedStep.read(AnnouncementMother.reconcilerRound())

    expect(round?.inputs).toEqual([
      { role: 'reconciliation-package', kind: 'literal', path: '.agent/reconcile-package.md' },
    ])
  })

  it('an announced input with no path is refused', () => {
    expect(AnnouncedStep.read(AnnouncementMother.reconcilerRoundWithoutAPath())).toBeNull()
  })

  it('an announced input whose kind is outside the vocabulary leaves the round unread', () => {
    expect(AnnouncedStep.read(AnnouncementMother.reconcilerRoundOfAnUndeclaredInputKind())).toBeNull()
  })

  it('an announced input of kind glob survives the door', () => {
    const round = AnnouncedStep.read(AnnouncementMother.sliceJudgeRoundCarryingTheVerdictsGlob())

    expect(round?.inputs).toEqual([
      { role: 'package', kind: 'literal', path: '/repo/.agent/run-9/slice-package.json' },
      { role: 'plan', kind: 'literal', path: 'docs/superpowers/plans/plan.md' },
      { role: 'verdicts', kind: 'glob', path: 'docs/superpowers/verdicts/issue-9-task-*.json' },
    ])
  })

  it('an announcement of kind transition carries no inputs', () => {
    expect(AnnouncedStep.read(AnnouncementMother.transitionCarryingDispatchInputs())).toBeNull()
  })

  it('a judge round that announces no input leaves the round unread', () => {
    expect(AnnouncedStep.read(AnnouncementMother.judgeRoundAnnouncingNoInput())).toBeNull()
    expect(AnnouncedStep.read(AnnouncementMother.judgeRoundAnnouncingAnEmptyInputList())).toBeNull()
  })

  it('a judge round missing the brief leaves the round unread', () => {
    expect(AnnouncedStep.read(AnnouncementMother.judgeRoundCarryingThePackageAlone())).toBeNull()
  })

  it('a judge round carrying a role the judge step does not declare leaves the round unread', () => {
    expect(AnnouncedStep.read(AnnouncementMother.judgeRoundCarryingAnUndeclaredPlanRole())).toBeNull()
  })

  it('a judge round carrying the same role twice leaves the round unread', () => {
    expect(AnnouncedStep.read(AnnouncementMother.judgeRoundCarryingTheBriefTwice())).toBeNull()
  })

  it('the optional role the judge step declares survives the door', () => {
    const round = AnnouncedStep.read(AnnouncementMother.judgeRoundCarryingItsOptionalControlsLog())

    expect(round?.inputs).toEqual([
      { role: 'package', kind: 'literal', path: '/repo/.agent/run-9/task-1-package.json' },
      { role: 'brief', kind: 'literal', path: 'docs/superpowers/plans/2026-09-21-issue-9-brief.md' },
      { role: 'controls-log', kind: 'literal', path: '/repo/.agent/run-9/controls-9-1.log' },
    ])
  })

  it('an announced consuming argv that carries a number leaves the round unread', () => {
    expect(AnnouncedStep.read(AnnouncementMother.reconcilerRoundWhoseConsumingArgvCarriesANumber())).toBeNull()
  })

  it('an announced commands list that carries a number leaves the round unread', () => {
    expect(AnnouncedStep.read(AnnouncementMother.controlsRoundWhoseCommandsCarryANumber())).toBeNull()
  })

  it('an announced step with no consuming key keeps an empty argv', () => {
    const round = AnnouncedStep.read(AnnouncementMother.controlsRoundWithNoConsumingKey())

    expect(round?.argv).toEqual([])
    expect(round?.commands).toEqual(['npm run lint', 'npm test'])
  })

  it('a slice-judge round with both optional roles absent stays readable', () => {
    const round = AnnouncedStep.read(AnnouncementMother.sliceJudgeRoundCarryingTheVerdictsGlob())

    expect(round?.step).toBe('slice-judge')
    expect(round?.inputs.map((input) => input.role)).toEqual(['package', 'plan', 'verdicts'])
  })
})

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
