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
      case RUN_STATES.BLOCKED_JUDGE: {
        const { reopenedFrom: _ended, ...judged } = reopened
        return Object.freeze({ ...judged, step: STEPS.IMPLEMENT, judgeRetries: 0, lastAdvice: instruction })
      }
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

  static afterGreenControls(run) {
    if (run.reopenedFrom !== RUN_STATES.BLOCKED_CONTROLS) return run
    return { ...run, reopenedFrom: null, lastAdvice: null }
  }

  static wayOut({ run, issue, planPath, subject }) {
    const grant = `Grant another round with "ct-step reopen --plan ${planPath} --issue ${issue} --instruction \\"…\\"".`
    switch (run.closed) {
      case RUN_STATES.BLOCKED_JUDGE:
        return `the judge vetoed ${subject} of issue ${issue} three times and the run is closed. ${grant}`
      case RUN_STATES.BLOCKED_CONTROLS:
        return `the controls of ${subject} of issue ${issue} ${RunClosure.causeOf(run.lastFailure, 'are')} `
          + `(log at ${run.lastFailure.log}) and the run is closed. ${grant}`
      case RUN_STATES.BLOCKED_GLOBAL:
        return `the Global verification of issue ${issue} ${RunClosure.causeOf(run.lastFailure, 'is')} `
          + `(log at ${run.lastFailure.log}) and the run is closed. ${grant}`
      default:
        throw new Error(`a closure with no way out to explain: "${run.closed}"`)
    }
  }

  static failureOf(run) {
    if (!run.lastFailure) return null
    const { command, code, log } = run.lastFailure
    return Object.freeze({ command, code, log })
  }

  static causeOf({ outcome, command, code }, be) {
    switch (outcome) {
      case OUTCOMES.FAILED:
        if (command === null) return `${be} red: a check that runs no command failed`
        return `${be} red: \`${command}\` exited ${code}`
      case OUTCOMES.INDETERMINATE:
        if (command === null) return 'could not be measured: a check that runs no command could not run'
        return `could not be measured: \`${command}\``
      default:
        throw new Error(`a failure with no cause to name: "${outcome}"`)
    }
  }

  static refusalOf(run) {
    return `the run of issue ${run.issue} is not closed at `
      + `${RUN_STATES.BLOCKED_JUDGE}, ${RUN_STATES.BLOCKED_CONTROLS} or ${RUN_STATES.BLOCKED_GLOBAL}: `
      + `it stands at step ${run.step}, so there is nothing to reopen.`
  }
}
