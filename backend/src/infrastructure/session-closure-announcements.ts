import { ClosureAnnouncements, type AnnouncedClosure } from '../domain/ports/closure-announcements.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'

export class SessionClosureAnnouncements extends ClosureAnnouncements {
  readonly sessions: () => CoordinatingSessions

  constructor({ sessions }: { sessions: () => CoordinatingSessions }) {
    super()
    this.sessions = sessions
  }

  static lineFor({ repository, issue, task, findings, verdict }: AnnouncedClosure): string {
    const found = findings === null ? '' : ` What it found: ${SessionClosureAnnouncements.#flat(findings)}.`
    const where = verdict === null ? '' : ` The whole verdict is at ${verdict}.`

    const which = task === null ? 'a task' : `task ${task}`

    return `The judge vetoed ${which} of ${repository.text}#${issue} three times and the run is `
      + `closed at blocked-judge.${found}${where} Tell the person what the judge found, ask them what `
      + `to change, and send THEIR words with POST /slices/${issue}/another-round `
      + '{repo, agent, instruction}. The instruction is theirs: you do not invent it.'
  }

  override async announce(closure: AnnouncedClosure): Promise<boolean> {
    return this.sessions().announce(SessionClosureAnnouncements.lineFor(closure))
  }

  static #flat(findings: string): string {
    return findings.split('\n').map((line) => line.trim().replace(/^- /, '')).filter(Boolean).join('; ')
  }
}
