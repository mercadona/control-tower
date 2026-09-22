import { describe, expect, it } from 'vitest'
import { SessionClosureAnnouncements } from '../../src/infrastructure/session-closure-announcements.ts'
import type { CoordinatingSessions } from '../../src/infrastructure/coordinating-sessions.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class SessionsDouble {
  readonly announced: string[] = []
  readonly heard: boolean

  constructor(heard: boolean = true) {
    this.heard = heard
  }

  announce(line: string): boolean {
    this.announced.push(line)

    return this.heard
  }

  get asSessions(): CoordinatingSessions {
    return this as unknown as CoordinatingSessions
  }
}

class Asked {
  static REPOSITORY = new RepositoryName('owner/name')
  static ISSUE = 973
  static TASK = 2
  static FINDINGS = '- [high] src/pago.ts:41: the amount is rounded before the discount'
  static VERDICT = '.agent/run-973/task-2-verdict-3.json'

  static of(over: Partial<ReturnType<typeof Asked.full>> = {}) {
    return { ...Asked.full(), ...over }
  }

  static full() {
    return {
      repository: Asked.REPOSITORY,
      issue: Asked.ISSUE,
      task: Asked.TASK as number | null,
      findings: Asked.FINDINGS as string | null,
      verdict: Asked.VERDICT as string | null,
    }
  }
}

describe('telling the coordinating session that the judge closed a run', () => {
  it('names_the_slice_the_task_and_the_state_the_run_is_closed_at', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of())

    expect(line).toContain('owner/name#973')
    expect(line).toContain('task 2')
    expect(line).toContain('blocked-judge')
  })

  it('carries_what_the_judge_found_and_where_the_whole_verdict_is', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of())

    expect(line).toContain('the amount is rounded before the discount')
    expect(line).toContain('.agent/run-973/task-2-verdict-3.json')
  })

  it('is_one_line_because_announce_submits_at_the_end_of_it', () => {
    expect(SessionClosureAnnouncements.lineFor(Asked.of())).not.toContain('\n')
  })

  it('tells_the_session_to_pass_it_on_and_names_the_command_that_grants_another_round', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of())

    expect(line).toContain('Tell the person')
    expect(line).toContain('ct-step reopen --issue 973')
    expect(line).toContain('Do not run it yourself')
  })

  it('a_veto_with_nothing_major_to_show_still_says_what_happened_and_where_to_look', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of({ findings: null }))

    expect(line).toContain('owner/name#973')
    expect(line).toContain('.agent/run-973/task-2-verdict-3.json')
    expect(line).not.toContain('What it found:')
  })

  it('a_verdict_that_could_not_be_archived_leaves_the_line_without_a_path', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of({ verdict: null }))

    expect(line).not.toContain('.agent/')
    expect(line).toContain('the amount is rounded before the discount')
  })

  it('a_closure_from_a_plugin_that_named_no_task_still_names_the_slice', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of({ task: null }))

    expect(line).toContain('a task of owner/name#973')
  })

  it('goes_through_the_one_thing_that_knows_which_session_is_live', async () => {
    const sessions = new SessionsDouble()
    const announcements = new SessionClosureAnnouncements({ sessions: () => sessions.asSessions })

    await announcements.announce(Asked.of())

    expect(sessions.announced).toEqual([SessionClosureAnnouncements.lineFor(Asked.of())])
  })

  it('a_session_that_is_not_there_is_not_an_error_because_the_run_is_closed_all_the_same', async () => {
    const sessions = new SessionsDouble(false)
    const announcements = new SessionClosureAnnouncements({ sessions: () => sessions.asSessions })

    await expect(announcements.announce(Asked.of())).resolves.toBeUndefined()
  })
})
