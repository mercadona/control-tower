import { OUTCOMES, RUN_STATES } from '../../../plugin/scripts/run-machine.js'
import { ClosureAnnouncements, type AnnouncedClosure } from '../domain/ports/closure-announcements.ts'
import type { RunFailure } from '../domain/value-objects/run-instruction.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'

export class SessionClosureAnnouncements extends ClosureAnnouncements {
  readonly sessions: () => CoordinatingSessions

  constructor({ sessions }: { sessions: () => CoordinatingSessions }) {
    super()
    this.sessions = sessions
  }

  static lineFor(closure: AnnouncedClosure): string {
    switch (closure.state) {
      case RUN_STATES.BLOCKED_JUDGE:
        return SessionClosureAnnouncements.#vetoLine(closure)
      case RUN_STATES.BLOCKED_CONTROLS:
        return SessionClosureAnnouncements.#checkLine(
          closure, `The controls of ${SessionClosureAnnouncements.#taskOf(closure.task)}`,
        )
      case RUN_STATES.BLOCKED_GLOBAL:
        return SessionClosureAnnouncements.#checkLine(closure, 'The Global verification')
      default:
        throw new Error(`a closure with no line to announce: "${closure.state}"`)
    }
  }

  override async announce(closure: AnnouncedClosure): Promise<boolean> {
    return this.sessions().announce(SessionClosureAnnouncements.lineFor(closure))
  }

  static #vetoLine({ repository, issue, task, findings, verdict, vetoed }: AnnouncedClosure): string {
    const found = findings === null ? '' : ` What it found: ${SessionClosureAnnouncements.#flat(findings)}.`
    const where = verdict === null ? '' : ` The whole verdict is at ${verdict}.`

    const which = vetoed ?? SessionClosureAnnouncements.#taskOf(task)

    return `The judge vetoed ${which} of ${repository.text}#${issue} three times and the run is `
      + `closed at blocked-judge.${found}${where} Tell the person what the judge found, ask them what `
      + `to change, and send THEIR words with POST /slices/${issue}/another-round `
      + '{repo, agent, instruction}. The instruction is theirs: you do not invent it.'
  }

  static #checkLine({ repository, issue, state, outcome, failure }: AnnouncedClosure, subject: string): string {
    const cause = SessionClosureAnnouncements.#causeOf(outcome, failure)
    const log = failure === null ? '' : ` The log is at ${failure.log}.`

    return `${subject} of ${repository.text}#${issue} ${cause} and the run is closed at ${state}.${log} `
      + `Tell the person what failed, ask them what to change, and send THEIR words with `
      + `POST /slices/${issue}/another-round {repo, agent, instruction}. The instruction is theirs: `
      + 'you do not invent it.'
  }

  static #causeOf(outcome: string, failure: RunFailure | null): string {
    const named = failure === null || failure.command === null ? null : failure
    switch (outcome) {
      case OUTCOMES.FAILED:
        return named === null ? 'went red' : `went red: \`${named.command}\`${SessionClosureAnnouncements.#exitOf(named.code)}`
      case OUTCOMES.INDETERMINATE:
        return named === null ? 'could not be measured' : `could not be measured: \`${named.command}\``
      default:
        throw new Error(`a closure with no cause to announce: "${outcome}"`)
    }
  }

  static #exitOf(code: number | null): string {
    return code === null ? '' : ` exited ${code}`
  }

  static #taskOf(task: number | null): string {
    return task === null ? 'a task' : `task ${task}`
  }

  static #flat(findings: string): string {
    return findings.split('\n').map((line) => line.trim().replace(/^- /, '')).filter(Boolean).join('; ')
  }
}
