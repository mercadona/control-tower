import { STEPS } from './run-machine.js'
import { INPUT_ROLES } from './step-announcement.js'
import {
  IMPLEMENTER_MODEL,
  IMPLEMENTER_TOOLS,
  JUDGE_TOOLS,
  ADVISOR_TOOLS,
  SLICE_JUDGE_TOOLS,
} from './step-contracts.js'

export const STEP_HEADINGS = new Map([
  [STEPS.IMPLEMENT, `DISPATCH AN IMPLEMENTER (subagent with model ${IMPLEMENTER_MODEL} — tools: ${IMPLEMENTER_TOOLS}) with:`],
  [STEPS.JUDGE, `DISPATCH THE JUDGE (subagent ct-judge — declared WITHOUT Bash: ${JUDGE_TOOLS}) with:`],
  [STEPS.ADVISE, `DISPATCH THE ADVISOR (subagent ct-advisor — declared with ${ADVISOR_TOOLS} only) with:`],
  [STEPS.SLICE_JUDGE, `DISPATCH THE SLICE JUDGE (subagent ct-slice-judge — declared WITHOUT Bash: ${SLICE_JUDGE_TOOLS}) with:`],
])

export const INPUT_LABELS = new Map([
  [STEPS.IMPLEMENT, new Map([
    [INPUT_ROLES.RUBRIC, '  - the rubric from '],
    [INPUT_ROLES.BRIEF, "  - the task's brief: "],
  ])],
  [STEPS.JUDGE, new Map([
    [INPUT_ROLES.PACKAGE, '  - the review package: '],
    [INPUT_ROLES.BRIEF, "  - the task's brief: "],
    [INPUT_ROLES.CONTROLS_LOG, '  - the logs of the controls, ALREADY green, in case it wants them: '],
  ])],
  [STEPS.ADVISE, new Map([
    [INPUT_ROLES.PACKAGE, "  - the advisor's package: "],
  ])],
  [STEPS.SLICE_JUDGE, new Map([
    [INPUT_ROLES.PACKAGE, "  - the slice's review package: "],
    [INPUT_ROLES.PLAN, '  - the plan: '],
    [INPUT_ROLES.GLOBAL_LOG, '  - the log of the Global verification, ALREADY green, in case it wants it: '],
    [INPUT_ROLES.VERDICTS, '  - the verdict of every task, already committed: '],
  ])],
  [STEPS.RECONCILE, new Map([
    [INPUT_ROLES.RECONCILIATION_PACKAGE, '  - the reconciliation package: '],
  ])],
])

export const RESPONSE_LABELS = new Map([
  [STEPS.IMPLEMENT, '  - that it write its report to: '],
  [STEPS.JUDGE, '  - that it write its verdict to: '],
  [STEPS.ADVISE, '  - that it write its advice to: '],
  [STEPS.SLICE_JUDGE, '  - that it write its verdict to: '],
])

export class UnreadableStepProse extends Error {
  constructor(detail) {
    super(`the step prose cannot be read: ${detail}`)
    this.detail = detail
  }
}

export class StepProseLines {
  constructor({ heading, material, consuming }) {
    this.heading = heading
    this.material = Object.freeze([...material])
    this.consuming = consuming
    Object.freeze(this)
  }
}

export class DispatchProse {
  static CONSUMING_PREFIX = 'When it comes back:  ct-step '

  static render(announcement) {
    const { run, dispatch, consuming } = JSON.parse(announcement.text())
    const step = run.step
    const heading = STEP_HEADINGS.get(step)
    const responseLabel = RESPONSE_LABELS.get(step)
    if (!heading || !responseLabel) {
      throw new UnreadableStepProse(`the step "${step}" declares no dispatch prose`)
    }
    const material = (dispatch.inputs || []).map((input) => DispatchProse.inputLine(step, input.role, input.path))
    material.push(responseLabel + dispatch.response.path)
    return new StepProseLines({
      heading,
      material,
      consuming: DispatchProse.CONSUMING_PREFIX + consuming.argv.join(' '),
    })
  }

  static inputLine(step, role, path) {
    return INPUT_LABELS.get(step).get(role) + path
  }

  static stepLine(step, attempt) {
    return `step: ${step} (attempt ${attempt})`
  }
}
