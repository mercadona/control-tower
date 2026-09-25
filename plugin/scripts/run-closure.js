import { OUTCOMES, PHASES, RUN_STATES, STEPS } from './run-machine.js'

export class ReopenRefused extends Error {}

export class RunClosure {
  static REOPENABLE = Object.freeze([RUN_STATES.BLOCKED_JUDGE, RUN_STATES.BLOCKED_CONTROLS, RUN_STATES.BLOCKED_GLOBAL])

  static persists(state) {
    return state === RUN_STATES.DELIVERED || RunClosure.REOPENABLE.includes(state)
  }

  static outcomeOf(run) {
    switch (run.closed) {
      case RUN_STATES.BLOCKED_JUDGE:
        return OUTCOMES.FAILED
      case RUN_STATES.BLOCKED_CONTROLS:
      case RUN_STATES.BLOCKED_GLOBAL:
        return run.lastFailure.outcome
      default:
        throw new Error(`a closure with no outcome to repeat: "${run.closed}"`)
    }
  }

  static reopen(run, instruction) {
    const { closed, ...reopened } = run
    switch (closed) {
      case RUN_STATES.BLOCKED_JUDGE:
        return Object.freeze({ ...reopened, step: STEPS.IMPLEMENT, judgeRetries: 0, lastAdvice: instruction })
      case RUN_STATES.BLOCKED_CONTROLS:
        return Object.freeze({
          ...reopened, step: STEPS.IMPLEMENT, controlRetries: 0, lastAdvice: instruction, reopenedFrom: closed,
        })
      case RUN_STATES.BLOCKED_GLOBAL:
        return Object.freeze({
          ...reopened,
          phase: PHASES.FIX,
          step: STEPS.IMPLEMENT,
          controlRetries: 0,
          judgeRetries: 0,
          correctionRetries: 0,
          lastAdvice: instruction,
          reopenedFrom: closed,
        })
      default:
        throw new ReopenRefused(RunClosure.refusalOf(run))
    }
  }

  static refusalOf(run) {
    return `the run of issue ${run.issue} is not closed at `
      + `${RUN_STATES.BLOCKED_JUDGE}, ${RUN_STATES.BLOCKED_CONTROLS} or ${RUN_STATES.BLOCKED_GLOBAL}: `
      + `it stands at step ${run.step}, so there is nothing to reopen.`
  }
}
