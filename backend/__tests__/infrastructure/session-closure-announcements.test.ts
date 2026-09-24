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
  static ISSUE = 973
  static TASK = 2
  static FINDINGS = '- [high] src/pago.ts:41: the amount is rounded before the discount\n'
    + '- [medium] src/pago.ts:88: the zero amount is not covered'
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

  it('flattens_every_major_finding_into_that_one_line', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of())

    expect(line).toContain('the amount is rounded before the discount; [medium]')
    expect(line).toContain('the zero amount is not covered')
  })

  it('names_the_call_that_grants_the_round_and_the_three_fields_it_takes', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of())

    expect(line).toContain('POST /slices/973/another-round')
    expect(line).toContain('{repo, agent, instruction}')
  })

  it('asks_the_session_to_put_the_question_to_the_person_instead_of_handing_over_a_command', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of())

    expect(line).toContain('Tell the person what the judge found')
    expect(line).toContain('ask them what to change')
  })

  it('says_the_instruction_is_the_persons_so_the_session_does_not_invent_one', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of())

    expect(line).toContain('The instruction is theirs: you do not invent it.')
  })

  it('no_longer_forbids_the_session_from_acting_because_acting_is_now_its_job', () => {
    const line = SessionClosureAnnouncements.lineFor(Asked.of())

    expect(line).not.toContain('Do not run it yourself')
    expect(line).not.toContain('ct-step')
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

  it('a_session_that_is_not_there_is_not_an_error_but_it_answers_that_it_did_not_arrive', async () => {
    const sessions = new SessionsDouble(false)
    const announcements = new SessionClosureAnnouncements({ sessions: () => sessions.asSessions })

    await expect(announcements.announce(Asked.of())).resolves.toBe(false)
  })

  it('a_live_session_answers_that_the_line_arrived_so_the_caller_has_nothing_to_report', async () => {
    const sessions = new SessionsDouble()
    const announcements = new SessionClosureAnnouncements({ sessions: () => sessions.asSessions })

    await expect(announcements.announce(Asked.of())).resolves.toBe(true)
  })
})
