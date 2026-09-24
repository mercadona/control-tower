import { ChangeAnnouncements } from '../domain/ports/change-announcements.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

export class SessionChangeAnnouncements extends ChangeAnnouncements {
  readonly sessions: () => CoordinatingSessions

  constructor({ sessions }: { sessions: () => CoordinatingSessions }) {
    super()
    this.sessions = sessions
  }

  static lineFor({ repository, issue, ticket }: {
    repository: RepositoryName, issue: number, ticket: string,
  }): string {
    return `The change you left for ${repository.text}#${issue} has just gone out to that slice. `
      + `Its ticket was ${ticket}. Tell the person, naming the ticket, and do not send it again.`
  }

  override async announce({ repository, issue, ticket }: {
    repository: RepositoryName, issue: number, ticket: string,
  }): Promise<void> {
    await this.sessions().announce(SessionChangeAnnouncements.lineFor({ repository, issue, ticket }))
  }
}
