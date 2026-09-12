import { describe, expect, it, vi } from 'vitest'
import { HarnessAnswer, HarnessConversations } from '../../src/infrastructure/harness-conversations.ts'
import { HarnessConversation, HeadlessPlanAgents } from '../../src/infrastructure/headless-plan-agents.ts'
import type { DirectoryListing } from '../../src/infrastructure/harness-conversations.ts'
import type { RecordRead } from '../../src/infrastructure/headless-plan-agents.ts'

class Harness {
  static readonly RUNS_IN = '/state/harness'
  static readonly AGENT = '11111111-2222-3333-4444-555555555555'
  static readonly OTHER_AGENT = '66666666-7777-8888-9999-000000000000'
  static readonly WORKTREE = '/repo/.worktrees/42'
  static readonly OTHER_WORKTREE = '/repo/.worktrees/7'
  static readonly REPOSITORY = 'josemerca/ct-loop-sandbox'
  static readonly ISSUE = 42
  static readonly STARTED_AT = 1_700_000_000_000
  static readonly NOT_JSON_TEXT = 'not-json{'
  static readonly PATH = Harness.#pathFor(Harness.AGENT)

  readonly agentNames: string[]
  readonly listFailure: NodeJS.ErrnoException | null
  readonly texts: Map<string, string>
  readonly readFailures: Map<string, NodeJS.ErrnoException>
  readonly noRecordAgents: string[]
  readonly stderr = vi.fn()
  readonly listCalls: string[] = []
  readonly readCalls: string[] = []

  constructor({
    agentNames = [], listFailure = null, texts = new Map<string, string>(),
    readFailures = new Map<string, NodeJS.ErrnoException>(), noRecordAgents = [],
  }: {
    agentNames?: string[],
    listFailure?: NodeJS.ErrnoException | null,
    texts?: Map<string, string>,
    readFailures?: Map<string, NodeJS.ErrnoException>,
    noRecordAgents?: string[],
  } = {}) {
    this.agentNames = agentNames
    this.listFailure = listFailure
    this.texts = texts
    this.readFailures = readFailures
    this.noRecordAgents = noRecordAgents
  }

  static #pathFor(agent: string): string {
    return HeadlessPlanAgents.conversationPathFor({ runsIn: Harness.RUNS_IN, agent })
  }

  static #enoent(): NodeJS.ErrnoException {
    return Object.assign(new Error('no such file or directory'), { code: 'ENOENT' })
  }

  static #eacces(): NodeJS.ErrnoException {
    return Object.assign(new Error('permission denied'), { code: 'EACCES' })
  }

  static #enotdir(): NodeJS.ErrnoException {
    return Object.assign(new Error('not a directory'), { code: 'ENOTDIR' })
  }

  static #recordFor({
    worktree = Harness.WORKTREE, issue = Harness.ISSUE, repository = Harness.REPOSITORY, startedAt = Harness.STARTED_AT,
  }: { worktree?: string, issue?: number, repository?: string, startedAt?: number } = {}): string {
    return JSON.stringify(new HarnessConversation({ agent: Harness.AGENT, worktree, issue, repository, startedAt }).json)
  }

  static empty(): Harness {
    return new Harness({ listFailure: Harness.#enoent() })
  }

  static unlistable(): Harness {
    return new Harness({ listFailure: Harness.#eacces() })
  }

  static holdingOneWellFormedRecord(): Harness {
    return new Harness({
      agentNames: [Harness.AGENT],
      texts: new Map([[Harness.AGENT, Harness.#recordFor()]]),
    })
  }

  static holdingARecordThatIsNotJSON(): Harness {
    return new Harness({
      agentNames: [Harness.AGENT, Harness.OTHER_AGENT],
      texts: new Map([
        [Harness.AGENT, Harness.NOT_JSON_TEXT],
        [Harness.OTHER_AGENT, Harness.#recordFor({ worktree: Harness.OTHER_WORKTREE })],
      ]),
    })
  }

  static holdingARecordWhoseIssueIsZero(): Harness {
    return new Harness({
      agentNames: [Harness.AGENT],
      texts: new Map([[Harness.AGENT, Harness.#recordFor({ issue: 0 })]]),
    })
  }

  static holdingARecordWhoseIssueIsOne(): Harness {
    return new Harness({
      agentNames: [Harness.AGENT],
      texts: new Map([[Harness.AGENT, Harness.#recordFor({ issue: 1 })]]),
    })
  }

  static holdingARecordThatIsAJsonArray(): Harness {
    return new Harness({
      agentNames: [Harness.AGENT],
      texts: new Map([[Harness.AGENT, JSON.stringify([Harness.WORKTREE])]]),
    })
  }

  static holdingARecordThatCannotBeRead(): Harness {
    return new Harness({
      agentNames: [Harness.AGENT],
      readFailures: new Map([[Harness.AGENT, Harness.#eacces()]]),
    })
  }

  static holdingADirectoryWithNoConversationRecord(): Harness {
    return new Harness({ agentNames: [Harness.AGENT], noRecordAgents: [Harness.AGENT] })
  }

  static holdingAStrayFileInsteadOfAnAgentDirectory(): Harness {
    return new Harness({
      agentNames: [Harness.AGENT],
      readFailures: new Map([[Harness.AGENT, Harness.#enotdir()]]),
    })
  }

  conversations(): HarnessConversations {
    const list: DirectoryListing = async (path) => {
      this.listCalls.push(path)
      if (this.listFailure !== null) throw this.listFailure

      return this.agentNames
    }
    const read: RecordRead = async (path) => {
      this.readCalls.push(path)
      const agent = this.agentNames.find((name) => Harness.#pathFor(name) === path)
      if (agent === undefined) throw new Error(`this double was never told what ${path} holds`)
      if (this.readFailures.has(agent)) throw this.readFailures.get(agent)
      if (this.noRecordAgents.includes(agent)) return null
      if (this.texts.has(agent)) return this.texts.get(agent) ?? null

      throw new Error(`this double was never told what ${path} holds`)
    }

    return new HarnessConversations({ list, read, stderr: this.stderr, runsIn: Harness.RUNS_IN })
  }
}

describe('HarnessConversations', () => {
  it('a_harness_root_that_cannot_be_listed_could_not_be_known_so_recovery_never_declares_zero_plans', async () => {
    const harness = Harness.unlistable()

    const known = await harness.conversations().known()

    expect(known.wasAnswered).toBe(false)
    expect(known.reason).toContain('permission denied')
  })

  it('a_state_root_with_no_harness_directory_is_zero_plans_and_not_an_answer_that_could_not_be_known', async () => {
    const harness = Harness.empty()

    const known = await harness.conversations().known()

    expect(known).toBeInstanceOf(HarnessAnswer)
    expect(known.wasAnswered).toBe(true)
    expect(known.conversations).toEqual([])
    expect(harness.stderr).not.toHaveBeenCalled()
  })

  it('a_record_names_its_plan_by_its_fields_and_its_agent_by_the_directory_it_sits_in', async () => {
    const harness = Harness.holdingOneWellFormedRecord()

    const known = await harness.conversations().known()

    const conversations = known.conversations ?? []
    expect(conversations).toHaveLength(1)
    const [conversation] = conversations
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

  it('the_root_that_could_not_be_listed_hands_its_reason_up_instead_of_writing_it_itself', async () => {
    const harness = Harness.unlistable()

    const known = await harness.conversations().known()

    expect(harness.stderr).not.toHaveBeenCalled()
    expect(known.reason).toContain(Harness.RUNS_IN)
  })

  it('a_record_that_is_not_json_is_skipped_with_its_path_on_stderr_and_the_other_plans_still_come_back', async () => {
    const harness = Harness.holdingARecordThatIsNotJSON()

    const known = await harness.conversations().known()

    const conversations = known.conversations ?? []
    expect(conversations).toHaveLength(1)
    expect(conversations[0].worktree).toBe(Harness.OTHER_WORKTREE)
    expect(harness.stderr).toHaveBeenCalledWith(expect.stringContaining(`${Harness.PATH} is not JSON`))
    expect(harness.stderr).toHaveBeenCalledWith(expect.stringMatching(/^plans in flight: /))
  })

  it('a_record_whose_issue_is_zero_is_skipped_instead_of_attending_a_worktree', async () => {
    const harness = Harness.holdingARecordWhoseIssueIsZero()

    const known = await harness.conversations().known()

    expect(known.conversations).toEqual([])
    expect(harness.stderr).toHaveBeenCalledWith(expect.stringContaining(`${Harness.PATH} is not a well-formed record`))
  })

  it('a_record_whose_issue_is_one_is_the_smallest_one_that_attends_a_worktree', async () => {
    const known = await Harness.holdingARecordWhoseIssueIsOne().conversations().known()

    const conversations = known.conversations ?? []
    expect(conversations).toHaveLength(1)
    expect(conversations[0].issue).toBe(1)
  })

  it('a_record_that_is_a_json_array_is_skipped_instead_of_reading_fields_off_a_list', async () => {
    const harness = Harness.holdingARecordThatIsAJsonArray()

    const known = await harness.conversations().known()

    expect(known.conversations).toEqual([])
    expect(harness.stderr).toHaveBeenCalledWith(expect.stringContaining(`${Harness.PATH} is not a well-formed record`))
  })

  it('a_record_that_cannot_be_read_is_skipped_with_its_path_on_stderr', async () => {
    const harness = Harness.holdingARecordThatCannotBeRead()

    const known = await harness.conversations().known()

    expect(known.conversations).toEqual([])
    expect(harness.stderr).toHaveBeenCalledWith(expect.stringContaining(`${Harness.PATH} could not be read`))
  })

  it('a_directory_with_no_conversation_record_is_not_a_plan_and_says_nothing', async () => {
    const harness = Harness.holdingADirectoryWithNoConversationRecord()

    const known = await harness.conversations().known()

    expect(known.conversations).toEqual([])
    expect(harness.stderr).not.toHaveBeenCalled()
  })

  it('a_stray_file_in_the_harness_root_is_not_a_plan_and_says_nothing', async () => {
    const harness = Harness.holdingAStrayFileInsteadOfAnAgentDirectory()

    const known = await harness.conversations().known()

    expect(known.conversations).toEqual([])
    expect(harness.stderr).not.toHaveBeenCalled()
  })
})
