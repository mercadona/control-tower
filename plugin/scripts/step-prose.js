import { STEPS } from './run-machine.js'
import { INPUT_ROLES, INPUT_KINDS, RESPONSE_KIND_OF_STEP } from './step-announcement.js'
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

export const LABELS_ONLY_STEPS = new Set([STEPS.RECONCILE])

const OPTIONAL_INPUT_ROLES = new Set([INPUT_ROLES.CONTROLS_LOG, INPUT_ROLES.GLOBAL_LOG])

const KIND_OF_ROLE = new Map([
  [INPUT_ROLES.PACKAGE, INPUT_KINDS.LITERAL],
  [INPUT_ROLES.BRIEF, INPUT_KINDS.LITERAL],
  [INPUT_ROLES.RUBRIC, INPUT_KINDS.LITERAL],
  [INPUT_ROLES.PLAN, INPUT_KINDS.LITERAL],
  [INPUT_ROLES.CONTROLS_LOG, INPUT_KINDS.LITERAL],
  [INPUT_ROLES.GLOBAL_LOG, INPUT_KINDS.LITERAL],
  [INPUT_ROLES.VERDICTS, INPUT_KINDS.GLOB],
  [INPUT_ROLES.RECONCILIATION_PACKAGE, INPUT_KINDS.LITERAL],
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

export class DispatchMaterialRead {
  constructor({ inputs, response, consuming }) {
    this.inputs = Object.freeze(inputs.map((input) => Object.freeze({ ...input })))
    this.response = response === null ? null : Object.freeze({ ...response })
    this.consuming = consuming === null ? null : Object.freeze({ argv: Object.freeze([...consuming.argv]) })
    Object.freeze(this)
  }
}

export class DispatchProse {
  static CONSUMING_PREFIX = 'When it comes back:  ct-step '
  static #DECLARED_STEPS = new Set(Object.values(STEPS))

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

  static read({ stdout, step }) {
    const labels = INPUT_LABELS.get(step)
    if (!labels) {
      throw new UnreadableStepProse(`the step "${step}" declares no dispatch prose`)
    }
    const heading = STEP_HEADINGS.get(step)
    const responseLabel = RESPONSE_LABELS.get(step)
    if (!LABELS_ONLY_STEPS.has(step) && (!heading || !responseLabel)) {
      throw new UnreadableStepProse(`the step "${step}" declares no dispatch prose`)
    }
    const lines = String(stdout ?? '').split('\n')
    if (heading) DispatchProse.#requireOnce(lines, heading, `the heading of step "${step}"`)

    const inputs = []
    for (const [role, prefix] of labels) {
      const matches = lines.filter((line) => line.startsWith(prefix))
      if (matches.length > 1) {
        throw new UnreadableStepProse(`the label for the "${role}" input of step "${step}" appears ${matches.length} times`)
      }
      if (matches.length === 0) {
        if (!OPTIONAL_INPUT_ROLES.has(role)) {
          throw new UnreadableStepProse(`the mandatory "${role}" input of step "${step}" has no line`)
        }
        continue
      }
      inputs.push({
        role,
        kind: KIND_OF_ROLE.get(role),
        path: DispatchProse.#valueOf(matches[0], prefix, `the "${role}" input`),
      })
    }

    if (!responseLabel) {
      return new DispatchMaterialRead({ inputs, response: null, consuming: null })
    }

    const responseMatches = lines.filter((line) => line.startsWith(responseLabel))
    if (responseMatches.length !== 1) {
      throw new UnreadableStepProse(`the response line of step "${step}" appears ${responseMatches.length} times, not once`)
    }
    const response = {
      kind: RESPONSE_KIND_OF_STEP[step],
      path: DispatchProse.#valueOf(responseMatches[0], responseLabel, 'the response'),
    }

    const consumingMatches = lines.filter((line) => line.startsWith(DispatchProse.CONSUMING_PREFIX))
    if (consumingMatches.length !== 1) {
      throw new UnreadableStepProse(`the consuming line appears ${consumingMatches.length} times, not once`)
    }
    const command = DispatchProse.#valueOf(consumingMatches[0], DispatchProse.CONSUMING_PREFIX, 'the consuming line')

    return new DispatchMaterialRead({
      inputs,
      response,
      consuming: { argv: DispatchProse.#consumingArgv(command, response.path) },
    })
  }

  static inputLine(step, role, path) {
    return INPUT_LABELS.get(step).get(role) + path
  }

  static stepLine(step, attempt) {
    return `step: ${step} (attempt ${attempt})`
  }

  static stepOf(stdout) {
    const match = /^step: (\S+) \(attempt \d+\)$/m.exec(String(stdout ?? ''))
    return match && DispatchProse.#DECLARED_STEPS.has(match[1]) ? match[1] : null
  }

  static #consumingArgv(command, responsePath) {
    const verbEnd = command.indexOf(' ')
    if (verbEnd === -1) {
      throw new UnreadableStepProse(`the consuming line "${command}" names no response path after its verb`)
    }
    const verb = command.slice(0, verbEnd)
    const positional = `${verb} ${responsePath}`
    if (command !== positional && !command.startsWith(`${positional} `)) {
      throw new UnreadableStepProse(`the consuming line does not carry the declared response "${responsePath}" as its positional`)
    }
    const flags = command.slice(positional.length)
    return [verb, responsePath, ...(flags === '' ? [] : flags.slice(1).split(' '))]
  }

  static #requireOnce(lines, exact, label) {
    const count = lines.filter((line) => line === exact).length
    if (count !== 1) throw new UnreadableStepProse(`${label} appears ${count} times, not once`)
  }

  static #valueOf(line, prefix, label) {
    const value = line.slice(prefix.length)
    if (value === '') throw new UnreadableStepProse(`${label} carries an empty value`)
    if (value.includes('\0')) throw new UnreadableStepProse(`${label} carries a null byte`)
    return value
  }
}
