import { describe, expect, it } from 'vitest'
import { SessionChangeAnnouncements } from '../../src/infrastructure/session-change-announcements.ts'
import type { CoordinatingSessions } from '../../src/infrastructure/coordinating-sessions.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class SessionsDouble {
  readonly announced: string[] = []
  readonly heard: boolean

  constructor(heard: boolean = true) {
    this.heard = heard
  }

  async announce(line: string): Promise<boolean> {
    this.announced.push(line)

    return this.heard
  }

  get asSessions(): CoordinatingSessions {
    return this as unknown as CoordinatingSessions
  }
}

class Asked {
  static REPOSITORY = new RepositoryName('owner/name')
  static ISSUE = 470
  static TICKET = '66666666-6666-4666-8666-666666666666'

  static of() {
    return { repository: Asked.REPOSITORY, issue: Asked.ISSUE, ticket: Asked.TICKET }
  }
}

describe('telling the coordinating session that a change it left has gone out', () => {
  it('names_the_slice_and_the_ticket_the_person_was_given_when_it_was_kept', () => {
    const line = SessionChangeAnnouncements.lineFor(Asked.of())

    expect(line).toContain('owner/name#470')
    expect(line).toContain(Asked.TICKET)
  })

  it('tells_the_session_to_pass_it_on_and_not_to_send_the_change_again', () => {
    const line = SessionChangeAnnouncements.lineFor(Asked.of())

    expect(line).toContain('Tell the person')
    expect(line).toContain('do not send it again')
  })

  it('goes_through_the_one_thing_that_knows_which_session_is_live', async () => {
    const sessions = new SessionsDouble()
    const announcements = new SessionChangeAnnouncements({ sessions: () => sessions.asSessions })

    await announcements.announce(Asked.of())

    expect(sessions.announced).toEqual([SessionChangeAnnouncements.lineFor(Asked.of())])
  })

  it('a_session_that_is_not_there_is_not_an_error_because_the_change_went_out_all_the_same', async () => {
    const sessions = new SessionsDouble(false)
    const announcements = new SessionChangeAnnouncements({ sessions: () => sessions.asSessions })

    await expect(announcements.announce(Asked.of())).resolves.toBeUndefined()
  })
})
