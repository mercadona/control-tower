import { describe, it, expect, vi } from 'vitest'
import { HarnessConversations } from '../../src/infrastructure/harness-conversations.js'
import { HarnessConversation, HeadlessPlanAgents } from '../../src/infrastructure/headless-plan-agents.js'

class Harness {
  static RUNS_IN = '/state/harness'
  static AGENT = '11111111-2222-3333-4444-555555555555'
  static OTHER_AGENT = '66666666-7777-8888-9999-000000000000'
  static WORKTREE = '/repo/.worktrees/42'
  static OTHER_WORKTREE = '/repo/.worktrees/7'
  static REPOSITORY = 'josemerca/ct-loop-sandbox'
  static ISSUE = 42
  static STARTED_AT = 1_700_000_000_000
  static NOT_JSON_TEXT = 'not-json{'

  static #pathFor(agent) {
    return `${Harness.RUNS_IN}/${agent}/${HeadlessPlanAgents.CONVERSATION_FILE}`
  }

  static PATH = Harness.#pathFor(Harness.AGENT)

  static #enoent() {
    return Object.assign(new Error('no such file or directory'), { code: 'ENOENT' })
  }

  static #eacces() {
    return Object.assign(new Error('permission denied'), { code: 'EACCES' })
  }

  static #recordFor({
    worktree = Harness.WORKTREE, issue = Harness.ISSUE, repository = Harness.REPOSITORY, startedAt = Harness.STARTED_AT,
  } = {}) {
    return JSON.stringify({ worktree, issue, repository, startedAt })
  }

  constructor({ agentNames = [], listFailure = null, texts = new Map(), readFailures = new Map() } = {}) {
    this.agentNames = agentNames
    this.listFailure = listFailure
    this.texts = texts
    this.readFailures = readFailures
    this.stderr = vi.fn()
    this.listCalls = []
    this.readCalls = []
  }

  static empty() {
    return new Harness({ listFailure: Harness.#enoent() })
  }

  static unlistable() {
    return new Harness({ listFailure: Harness.#eacces() })
  }

  static holdingOneWellFormedRecord() {
    return new Harness({
      agentNames: [Harness.AGENT],
      texts: new Map([[Harness.AGENT, Harness.#recordFor()]]),
    })
  }

  static holdingARecordThatIsNotJSON() {
    return new Harness({
      agentNames: [Harness.AGENT, Harness.OTHER_AGENT],
      texts: new Map([
        [Harness.AGENT, Harness.NOT_JSON_TEXT],
        [Harness.OTHER_AGENT, Harness.#recordFor({ worktree: Harness.OTHER_WORKTREE })],
      ]),
    })
  }

  static holdingARecordWhoseIssueIsZero() {
    return new Harness({
      agentNames: [Harness.AGENT],
      texts: new Map([[Harness.AGENT, Harness.#recordFor({ issue: 0 })]]),
    })
  }

  static holdingARecordWhoseIssueIsOne() {
    return new Harness({
      agentNames: [Harness.AGENT],
      texts: new Map([[Harness.AGENT, Harness.#recordFor({ issue: 1 })]]),
    })
  }

  static holdingARecordThatIsAJsonArray() {
    return new Harness({
      agentNames: [Harness.AGENT],
      texts: new Map([[Harness.AGENT, JSON.stringify([Harness.WORKTREE])]]),
    })
  }

  static holdingARecordThatCannotBeRead() {
    return new Harness({
      agentNames: [Harness.AGENT],
      readFailures: new Map([[Harness.AGENT, Harness.#eacces()]]),
    })
  }

  static holdingADirectoryWithNoConversationRecord() {
    return new Harness({ agentNames: [Harness.AGENT] })
  }

  conversations() {
    return new HarnessConversations({
      list: async (path) => {
        this.listCalls.push(path)
        if (this.listFailure !== null) throw this.listFailure

        return this.agentNames
      },
      read: async (path) => {
        this.readCalls.push(path)
        const agent = this.agentNames.find((name) => Harness.#pathFor(name) === path)
        if (this.readFailures.has(agent)) throw this.readFailures.get(agent)

        return this.texts.has(agent) ? this.texts.get(agent) : null
      },
      stderr: this.stderr,
      runsIn: Harness.RUNS_IN,
    })
  }
}

describe('HarnessConversations', () => {
  it('a_record_names_its_plan_by_its_fields_and_its_agent_by_the_directory_it_sits_in', async () => {
    const harness = Harness.holdingOneWellFormedRecord()

    const known = await harness.conversations().known()

    expect(known).toHaveLength(1)
    const [conversation] = known
    expect(conversation).toBeInstanceOf(HarnessConversation)
    expect(conversation.agent).toBe(Harness.AGENT)
    expect(conversation.json).toEqual({
      worktree: Harness.WORKTREE,
      issue: Harness.ISSUE,
      repository: Harness.REPOSITORY,
      startedAt: Harness.STARTED_AT,
    })
    expect(harness.listCalls).toEqual([Harness.RUNS_IN])
    expect(harness.readCalls).toEqual([Harness.PATH])
  })

  it('a_state_root_with_no_harness_directory_is_zero_plans_and_not_an_answer_that_could_not_be_known', async () => {
    const known = await Harness.empty().conversations().known()

    expect(known).toEqual([])
  })

  it('a_harness_root_that_cannot_be_listed_could_not_be_known_so_recovery_never_declares_zero_plans', async () => {
    const known = await Harness.unlistable().conversations().known()

    expect(known).toBeNull()
  })

  it('a_record_that_is_not_json_is_skipped_with_its_path_on_stderr_and_the_other_plans_still_come_back', async () => {
    const harness = Harness.holdingARecordThatIsNotJSON()

    const known = await harness.conversations().known()

    expect(known).toHaveLength(1)
    expect(known[0].worktree).toBe(Harness.OTHER_WORKTREE)
    expect(harness.stderr).toHaveBeenCalledWith(expect.stringContaining(Harness.PATH))
    expect(harness.stderr.mock.calls[0][0].startsWith('plans in flight: ')).toBe(true)
  })

  it('a_record_whose_issue_is_zero_is_skipped_instead_of_attending_a_worktree', async () => {
    const harness = Harness.holdingARecordWhoseIssueIsZero()

    const known = await harness.conversations().known()

    expect(known).toEqual([])
    expect(harness.stderr).toHaveBeenCalledWith(expect.stringContaining(Harness.PATH))
  })

  it('a_record_whose_issue_is_one_is_the_smallest_one_that_attends_a_worktree', async () => {
    const known = await Harness.holdingARecordWhoseIssueIsOne().conversations().known()

    expect(known).toHaveLength(1)
    expect(known[0].issue).toBe(1)
  })

  it('a_record_that_is_a_json_array_is_skipped_instead_of_reading_fields_off_a_list', async () => {
    const harness = Harness.holdingARecordThatIsAJsonArray()

    const known = await harness.conversations().known()

    expect(known).toEqual([])
    expect(harness.stderr).toHaveBeenCalledWith(expect.stringContaining(Harness.PATH))
  })

  it('a_record_that_cannot_be_read_is_skipped_with_its_path_on_stderr', async () => {
    const harness = Harness.holdingARecordThatCannotBeRead()

    const known = await harness.conversations().known()

    expect(known).toEqual([])
    expect(harness.stderr).toHaveBeenCalledWith(expect.stringContaining(Harness.PATH))
  })

  it('a_directory_with_no_conversation_record_is_not_a_plan_and_says_nothing', async () => {
    const harness = Harness.holdingADirectoryWithNoConversationRecord()

    const known = await harness.conversations().known()

    expect(known).toEqual([])
    expect(harness.stderr).not.toHaveBeenCalled()
  })
})
