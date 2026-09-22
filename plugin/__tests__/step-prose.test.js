import { describe, it, expect } from 'vitest'

import {
  UnreadableStepProse,
  StepProseLines,
  DispatchProse,
  STEP_HEADINGS,
  INPUT_LABELS,
  RESPONSE_LABELS,
} from '../scripts/step-prose.js'
import {
  INPUT_ROLES,
  INPUT_KINDS,
  DECLARED_INPUT_ROLES_OF_STEP,
  MANDATORY_INPUT_ROLES_OF_STEP,
  AnnouncedInput,
  AnnouncedResponse,
  StepAnnouncement,
} from '../scripts/step-announcement.js'
import { JUDGE_TOOLS } from '../scripts/step-contracts.js'
import { STEPS } from '../scripts/run-machine.js'

const packageInput = new AnnouncedInput({ role: INPUT_ROLES.PACKAGE, kind: INPUT_KINDS.LITERAL, path: '.agent/review-42-1.md' })
const briefInput = new AnnouncedInput({ role: INPUT_ROLES.BRIEF, kind: INPUT_KINDS.LITERAL, path: '.agent/task-1-judge-brief.md' })
const controlsLogInput = new AnnouncedInput({ role: INPUT_ROLES.CONTROLS_LOG, kind: INPUT_KINDS.LITERAL, path: '.agent/controls-42-1.log' })

class DispatchAnnouncements {
  static judge(inputs) {
    return StepAnnouncement.dispatch({
      issue: 42,
      task: 1,
      tasksTotal: 3,
      step: STEPS.JUDGE,
      attempt: 1,
      inputs,
      response: AnnouncedResponse.of(STEPS.JUDGE, '.agent/task-1-verdict.json'),
      consuming: { argv: ['verdict', '.agent/task-1-verdict.json', '--plan', 'plan.md', '--issue', '42'] },
    })
  }

  static sliceJudge() {
    return StepAnnouncement.dispatch({
      issue: 42,
      task: 3,
      tasksTotal: 3,
      step: STEPS.SLICE_JUDGE,
      attempt: 1,
      inputs: [
        new AnnouncedInput({ role: INPUT_ROLES.PACKAGE, kind: INPUT_KINDS.LITERAL, path: '.agent/slice-review-42.md' }),
        new AnnouncedInput({ role: INPUT_ROLES.PLAN, kind: INPUT_KINDS.LITERAL, path: '.aiplans/some-slice/plan.md' }),
        new AnnouncedInput({ role: INPUT_ROLES.VERDICTS, kind: INPUT_KINDS.GLOB, path: 'docs/superpowers/verdicts/issue-42-task-*.json' }),
      ],
      response: AnnouncedResponse.of(STEPS.SLICE_JUDGE, '.agent/slice-verdict.json'),
      consuming: { argv: ['slice-verdict', '.agent/slice-verdict.json', '--plan', 'plan.md', '--issue', '42'] },
    })
  }
}

describe('DispatchProse.render writes the prose from the announcement', () => {
  it('the prose of a judge announcement is the four lines ct-step prints for it', () => {
    const announcement = DispatchAnnouncements.judge([packageInput, briefInput, controlsLogInput])

    const lines = DispatchProse.render(announcement)

    expect(lines).toBeInstanceOf(StepProseLines)
    expect(lines.heading).toBe(`DISPATCH THE JUDGE (subagent ct-judge — declared WITHOUT Bash: ${JUDGE_TOOLS}) with:`)
    expect(lines.material).toEqual([
      '  - the review package: .agent/review-42-1.md',
      "  - the task's brief: .agent/task-1-judge-brief.md",
      '  - the logs of the controls, ALREADY green, in case it wants them: .agent/controls-42-1.log',
      '  - that it write its verdict to: .agent/task-1-verdict.json',
    ])
    expect(lines.consuming).toBe('When it comes back:  ct-step verdict .agent/task-1-verdict.json --plan plan.md --issue 42')
  })

  it('an absent optional input costs no line', () => {
    const announcement = DispatchAnnouncements.judge([packageInput, briefInput])

    const lines = DispatchProse.render(announcement)

    expect(lines.material).toEqual([
      '  - the review package: .agent/review-42-1.md',
      "  - the task's brief: .agent/task-1-judge-brief.md",
      '  - that it write its verdict to: .agent/task-1-verdict.json',
    ])
  })

  it('a reconcile dispatch with no declared heading or response label makes render refuse', () => {
    const announcement = StepAnnouncement.dispatch({
      issue: 42,
      task: 1,
      tasksTotal: 1,
      step: STEPS.RECONCILE,
      attempt: 1,
      inputs: [new AnnouncedInput({ role: INPUT_ROLES.RECONCILIATION_PACKAGE, kind: INPUT_KINDS.LITERAL, path: '.agent/reconcile-42-1.md' })],
      response: AnnouncedResponse.of(STEPS.RECONCILE),
      consuming: { argv: ['reconcile', '--plan', 'plan.md', '--issue', '42'] },
    })

    expect(() => DispatchProse.render(announcement)).toThrow(UnreadableStepProse)
  })
})

describe('DispatchProse keeps INPUT_LABELS coupled to the heading and response maps', () => {
  it('every step of INPUT_LABELS outside the labels-only steps has an entry in STEP_HEADINGS and in RESPONSE_LABELS', () => {
    const labelsOnlySteps = ['reconcile']
    const drift = []
    for (const step of INPUT_LABELS.keys()) {
      if (labelsOnlySteps.includes(step)) continue
      if (!STEP_HEADINGS.has(step)) drift.push({ step, missingFrom: 'STEP_HEADINGS' })
      if (!RESPONSE_LABELS.has(step)) drift.push({ step, missingFrom: 'RESPONSE_LABELS' })
    }

    expect(drift).toEqual([])
  })
})

describe('MANDATORY_INPUT_ROLES_OF_STEP partitions the prose labels of every step', () => {
  it('the mandatory roles of a step are its prose labels minus the two optional ones', () => {
    expect(MANDATORY_INPUT_ROLES_OF_STEP).toEqual({
      implement: ['rubric', 'brief'],
      judge: ['package', 'brief'],
      advise: ['package'],
      'slice-judge': ['package', 'plan', 'verdicts'],
      reconcile: ['reconciliation-package'],
    })

    const optional = ['controls-log', 'global-log']
    for (const [step, labels] of INPUT_LABELS) {
      expect(MANDATORY_INPUT_ROLES_OF_STEP[step])
        .toEqual([...labels.keys()].filter((role) => !optional.includes(role)))
    }
  })
})

describe('DECLARED_INPUT_ROLES_OF_STEP is the prose labels of every step, optional roles included', () => {
  it('the declared roles of a step are the roles its prose gives a label', () => {
    expect(DECLARED_INPUT_ROLES_OF_STEP).toEqual({
      implement: ['rubric', 'brief'],
      judge: ['package', 'brief', 'controls-log'],
      advise: ['package'],
      'slice-judge': ['package', 'plan', 'global-log', 'verdicts'],
      reconcile: ['reconciliation-package'],
    })
  })

  it('the declared roles and the labels of a step are the same set, and the mandatory roles a subset', () => {
    expect(Object.keys(DECLARED_INPUT_ROLES_OF_STEP).sort()).toEqual([...INPUT_LABELS.keys()].sort())

    for (const [step, labels] of INPUT_LABELS) {
      expect([...DECLARED_INPUT_ROLES_OF_STEP[step]].sort()).toEqual([...labels.keys()].sort())
      for (const role of MANDATORY_INPUT_ROLES_OF_STEP[step]) {
        expect(DECLARED_INPUT_ROLES_OF_STEP[step]).toContain(role)
      }
    }
  })
})
