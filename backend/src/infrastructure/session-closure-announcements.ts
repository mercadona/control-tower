import { ClosureAnnouncements, type AnnouncedClosure } from '../domain/ports/closure-announcements.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'

export class SessionClosureAnnouncements extends ClosureAnnouncements {
  readonly sessions: () => CoordinatingSessions

  constructor({ sessions }: { sessions: () => CoordinatingSessions }) {
    super()
    this.sessions = sessions
  }

  // ONE line, and addressed to the coordinating AGENT rather than to a person:
  // `CoordinatingSessions.announce` appends the submit character, so a second
  // line would be sent as a second prompt. The agent is the one that explains
  // it, which is what the change announcement next door already does.
  static lineFor({ repository, issue, task, findings, verdict }: AnnouncedClosure): string {
    const found = findings === null ? '' : ` What it found: ${SessionClosureAnnouncements.#flat(findings)}.`
    const where = verdict === null ? '' : ` The whole verdict is at ${verdict}.`

    const which = task === null ? 'a task' : `task ${task}`

    return `The judge vetoed ${which} of ${repository.text}#${issue} three times and the run is `
      + `closed at blocked-judge.${found}${where} Tell the person what failed and that you can grant `
      + `another round with \`ct-step reopen --issue ${issue} --instruction "…"\`. Do not run it yourself.`
  }

  override async announce(closure: AnnouncedClosure): Promise<void> {
    this.sessions().announce(SessionClosureAnnouncements.lineFor(closure))
  }

  // `lastFindings` is a list of lines and this is a single line, so the list's
  // own newlines become separators rather than submits.
  static #flat(findings: string): string {
    return findings.split('\n').map((line) => line.trim().replace(/^- /, '')).filter(Boolean).join('; ')
  }
}
