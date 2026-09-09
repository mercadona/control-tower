import { STEPS } from './run-machine.js'

export const Dispatch = Object.freeze({
  LET_THROUGH: 'let-through',
  DENIED: 'denied',
})

export class DispatchVerdict {
  static letThrough() {
    return new DispatchVerdict(Dispatch.LET_THROUGH, null)
  }

  static denied(reason) {
    return new DispatchVerdict(Dispatch.DENIED, reason)
  }

  constructor(dispatch, reason) {
    this.dispatch = dispatch
    this.reason = reason
    Object.freeze(this)
  }
}

export class StepSeal {
  static #INPUT_OF = Object.freeze({
    [STEPS.IMPLEMENT]: "the task's brief",
    [STEPS.JUDGE]: "the task's review package",
    [STEPS.ADVISE]: "the adviser's package",
    [STEPS.SLICE_JUDGE]: "the slice's review package",
  })

  static SEALED_STEPS = Object.freeze(Object.keys(StepSeal.#INPUT_OF))

  static of(run) {
    return `${run.task}:${run.step}:${StepSeal.attemptOf(run)}`
  }

  static inputWrittenFor(step) {
    return StepSeal.#INPUT_OF[step] ?? null
  }

  static attemptOf(run) {
    return run.controlRetries + run.judgeRetries + run.correctionRetries + 1
  }
}

export class DispatchGate {
  static verdictFor(run, ctStepPath) {
    if (run.closed) return DispatchVerdict.letThrough()
    const input = StepSeal.inputWrittenFor(run.step)
    if (input === null) return DispatchVerdict.letThrough()
    if (run.nextSeal === StepSeal.of(run)) return DispatchVerdict.letThrough()
    return DispatchVerdict.denied(DispatchGate.#reason(run, ctStepPath, input))
  }

  static #reason(run, ctStepPath, input) {
    return [
      `The run of issue ${run.issue} is on step "${run.step}" and you have not asked for the step yet.`,
      '',
      `"ct-step next" does not only say which step it is: it WRITES ${input}, which is the file this subagent has to read. Dispatched now it is left without it, and that does not show until it comes back with the work done on top of something else.`,
      '',
      'Ask for the step and dispatch with what it prints:',
      `  node ${ctStepPath} next --plan ${run.plan} --issue ${run.issue}`,
      '',
      '"next" does not transition the run: it informs and prepares, so asking for it costs no attempt and no discard.',
    ].join('\n')
  }
}
