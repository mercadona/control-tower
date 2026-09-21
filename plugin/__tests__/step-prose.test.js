import { describe, it, expect } from 'vitest'

import {
  UnreadableStepProse,
  StepProseLines,
  DispatchMaterialRead,
  DispatchProse,
  STEP_HEADINGS,
  INPUT_LABELS,
  RESPONSE_LABELS,
  LABELS_ONLY_STEPS,
} from '../scripts/step-prose.js'
import {
  INPUT_ROLES,
  INPUT_KINDS,
  RESPONSE_KIND_OF_STEP,
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

describe('DispatchProse.read parses the prose back into the material an announcement declared', () => {
  it('the material read back over the rendered lines is the material the announcement declared', () => {
    const announcement = DispatchAnnouncements.judge([packageInput, briefInput, controlsLogInput])
    const lines = DispatchProse.render(announcement)
    const stdout = [
      `task 1/3 — some task`,
      DispatchProse.stepLine(STEPS.JUDGE, 1),
      '',
      lines.heading,
      ...lines.material,
      '',
      lines.consuming,
      'Do not pass it the OUTPUT of the controls: a dirty lint must not dirty its judgement.',
    ].join('\n')

    const read = DispatchProse.read({ stdout, step: STEPS.JUDGE })

    expect(read).toBeInstanceOf(DispatchMaterialRead)
    expect(read.inputs).toEqual([
      { role: INPUT_ROLES.PACKAGE, kind: INPUT_KINDS.LITERAL, path: '.agent/review-42-1.md' },
      { role: INPUT_ROLES.BRIEF, kind: INPUT_KINDS.LITERAL, path: '.agent/task-1-judge-brief.md' },
      { role: INPUT_ROLES.CONTROLS_LOG, kind: INPUT_KINDS.LITERAL, path: '.agent/controls-42-1.log' },
    ])
    expect(read.response).toEqual({ kind: RESPONSE_KIND_OF_STEP[STEPS.JUDGE], path: '.agent/task-1-verdict.json' })
    expect(read.consuming).toEqual({ argv: ['verdict', '.agent/task-1-verdict.json', '--plan', 'plan.md', '--issue', '42'] })
  })

  it('a label printed twice makes the read refuse', () => {
    const announcement = DispatchAnnouncements.judge([packageInput, briefInput])
    const lines = DispatchProse.render(announcement)
    const stdout = [lines.heading, ...lines.material, lines.material[0], lines.consuming].join('\n')

    expect(() => DispatchProse.read({ stdout, step: STEPS.JUDGE })).toThrow(UnreadableStepProse)
  })

  it('an empty path makes the read refuse', () => {
    const announcement = DispatchAnnouncements.judge([packageInput, briefInput])
    const lines = DispatchProse.render(announcement)
    const material = [...lines.material]
    material[0] = '  - the review package: '
    const stdout = [lines.heading, ...material, lines.consuming].join('\n')

    expect(() => DispatchProse.read({ stdout, step: STEPS.JUDGE })).toThrow(UnreadableStepProse)
  })

  it('a consuming argv element with a space survives the round trip', () => {
    const announcement = StepAnnouncement.dispatch({
      issue: 42,
      task: 1,
      tasksTotal: 3,
      step: STEPS.JUDGE,
      attempt: 1,
      inputs: [packageInput, briefInput],
      response: AnnouncedResponse.of(STEPS.JUDGE, '/tmp/ct step/.agent/run-42/task-1-verdict.json'),
      consuming: { argv: ['verdict', '/tmp/ct step/.agent/run-42/task-1-verdict.json', '--plan', 'plan.md', '--issue', '42'] },
    })
    const lines = DispatchProse.render(announcement)
    expect(lines.consuming).toBe('When it comes back:  ct-step verdict /tmp/ct step/.agent/run-42/task-1-verdict.json --plan plan.md --issue 42')
    const stdout = [lines.heading, ...lines.material, lines.consuming].join('\n')

    const read = DispatchProse.read({ stdout, step: STEPS.JUDGE })

    expect(read.response).toEqual({
      kind: RESPONSE_KIND_OF_STEP[STEPS.JUDGE],
      path: '/tmp/ct step/.agent/run-42/task-1-verdict.json',
    })
    expect(read.consuming).toEqual({
      argv: ['verdict', '/tmp/ct step/.agent/run-42/task-1-verdict.json', '--plan', 'plan.md', '--issue', '42'],
    })
  })

  it('a consuming line whose positional is not the response path is refused', () => {
    const announcement = DispatchAnnouncements.judge([packageInput, briefInput])
    const lines = DispatchProse.render(announcement)
    const forgedConsuming = 'When it comes back:  ct-step verdict .agent/forged-verdict.json --plan .agent/task-1-verdict.json --issue 42'
    const stdout = [lines.heading, ...lines.material, forgedConsuming].join('\n')

    expect(() => DispatchProse.read({ stdout, step: STEPS.JUDGE })).toThrow(UnreadableStepProse)
  })

  it('a consuming argv that names another path makes the read refuse', () => {
    const announcement = DispatchAnnouncements.judge([packageInput, briefInput])
    const lines = DispatchProse.render(announcement)
    const tamperedConsuming = 'When it comes back:  ct-step verdict .agent/some-other-verdict.json --plan plan.md --issue 42'
    const stdout = [lines.heading, ...lines.material, tamperedConsuming].join('\n')

    expect(() => DispatchProse.read({ stdout, step: STEPS.JUDGE })).toThrow(UnreadableStepProse)
  })

  it('a step with no declared prose makes the read refuse', () => {
    expect(() => DispatchProse.read({ stdout: 'anything at all', step: STEPS.CONTROLS })).toThrow(UnreadableStepProse)
  })

  it('the committed verdicts come back as the one glob input', () => {
    const announcement = DispatchAnnouncements.sliceJudge()
    const lines = DispatchProse.render(announcement)
    const stdout = [lines.heading, ...lines.material, lines.consuming].join('\n')

    const read = DispatchProse.read({ stdout, step: STEPS.SLICE_JUDGE })

    expect(read.inputs).toContainEqual({
      role: INPUT_ROLES.VERDICTS,
      kind: INPUT_KINDS.GLOB,
      path: 'docs/superpowers/verdicts/issue-42-task-*.json',
    })
  })
})

describe('DispatchProse and the reconciliation package label', () => {
  it('the reconciliation package line and the path the backend takes share one declared label', () => {
    const line = DispatchProse.inputLine(STEPS.RECONCILE, INPUT_ROLES.RECONCILIATION_PACKAGE, '/tmp/p.md')

    expect(line).toBe('  - the reconciliation package: /tmp/p.md')

    const read = DispatchProse.read({ stdout: line, step: STEPS.RECONCILE })

    expect(read.inputs).toEqual([
      { role: INPUT_ROLES.RECONCILIATION_PACKAGE, kind: INPUT_KINDS.LITERAL, path: '/tmp/p.md' },
    ])
    expect(read.response).toBe(null)
    expect(read.consuming).toBe(null)
  })
})

describe('DispatchProse keeps INPUT_LABELS coupled to the heading and response maps', () => {
  it('every step of INPUT_LABELS outside LABELS_ONLY_STEPS has an entry in STEP_HEADINGS and in RESPONSE_LABELS', () => {
    const drift = []
    for (const step of INPUT_LABELS.keys()) {
      if (LABELS_ONLY_STEPS.has(step)) continue
      if (!STEP_HEADINGS.has(step)) drift.push({ step, missingFrom: 'STEP_HEADINGS' })
      if (!RESPONSE_LABELS.has(step)) drift.push({ step, missingFrom: 'RESPONSE_LABELS' })
    }

    expect(drift).toEqual([])
  })
})

describe('DispatchProse names the step from the stdout it prints', () => {
  it('stepOf reads back the step ct-step announced in its "step:" line', () => {
    const stdout = ['task 1/3 — some task', DispatchProse.stepLine(STEPS.JUDGE, 2), ''].join('\n')

    expect(DispatchProse.stepOf(stdout)).toBe(STEPS.JUDGE)
  })

  it('stepOf answers null when the stdout carries no such line', () => {
    expect(DispatchProse.stepOf('nothing to see here')).toBe(null)
  })

  it('a step name outside the declared steps is not named', () => {
    const stdout = ['task 1/3 — some task', 'step: judge2 (attempt 1)', ''].join('\n')

    expect(DispatchProse.stepOf(stdout)).toBe(null)
  })
})
