import { HarnessConversation, HeadlessPlanAgents } from './headless-plan-agents.ts'
import type { RecordRead } from './headless-plan-agents.ts'
import type { DiagnosticWriter } from './git-workspace.ts'

export type DirectoryListing = (path: string) => Promise<string[]>

export class HarnessAnswer {
  readonly conversations: readonly HarnessConversation[] | null
  readonly reason: string | null

  static answered(conversations: readonly HarnessConversation[]): HarnessAnswer {
    return new HarnessAnswer(conversations, null)
  }

  static refused(reason: string): HarnessAnswer {
    return new HarnessAnswer(null, reason)
  }

  constructor(conversations: readonly HarnessConversation[] | null, reason: string | null) {
    this.conversations = conversations
    this.reason = reason
    Object.freeze(this)
  }

  get wasAnswered(): boolean {
    return this.reason === null
  }
}

export class HarnessConversations {
  readonly list: DirectoryListing
  readonly read: RecordRead
  readonly stderr: DiagnosticWriter
  readonly runsIn: string

  constructor({ list, read, stderr, runsIn }: {
    list: DirectoryListing,
    read: RecordRead,
    stderr: DiagnosticWriter,
    runsIn: string,
  }) {
    this.list = list
    this.read = read
    this.stderr = stderr
    this.runsIn = runsIn
  }

  async known(): Promise<HarnessAnswer> {
    let agents: string[]
    try {
      agents = await this.list(this.runsIn)
    } catch (failure) {
      if (HarnessConversations.#isMissingRoot(failure)) return HarnessAnswer.answered([])

      return HarnessAnswer.refused(`${this.runsIn} cannot be listed: ${HarnessConversations.#messageOf(failure)}`)
    }

    const conversations: HarnessConversation[] = []
    for (const agent of agents) {
      const conversation = await this.#read(agent)
      if (conversation !== null) conversations.push(conversation)
    }

    return HarnessAnswer.answered(conversations)
  }

  async #read(agent: string): Promise<HarnessConversation | null> {
    const path = HeadlessPlanAgents.conversationPathFor({ runsIn: this.runsIn, agent })
    let text: string | null
    try {
      text = await this.read(path)
    } catch (failure) {
      if (HarnessConversations.#isStrayFile(failure)) return null
      this.stderr(`plans in flight: ${path} could not be read: ${HarnessConversations.#messageOf(failure)}\n`)

      return null
    }
    if (text === null) return null

    let record: unknown
    try {
      record = JSON.parse(text)
    } catch (failure) {
      this.stderr(`plans in flight: ${path} is not JSON: ${HarnessConversations.#messageOf(failure)}\n`)

      return null
    }
    if (!HarnessConversation.isWellFormed(record)) {
      this.stderr(`plans in flight: ${path} is not a well-formed record\n`)

      return null
    }

    const { worktree, issue, repository, startedAt } = record

    return new HarnessConversation({ agent, worktree, issue, repository, startedAt })
  }

  static #isMissingRoot(failure: unknown): boolean {
    return HarnessConversations.#codeOf(failure) === 'ENOENT'
  }

  static #isStrayFile(failure: unknown): boolean {
    return HarnessConversations.#codeOf(failure) === 'ENOTDIR'
  }

  static #codeOf(failure: unknown): string | undefined {
    const errno: NodeJS.ErrnoException | null = failure instanceof Error ? failure : null

    return errno?.code
  }

  static #messageOf(failure: unknown): string {
    return failure instanceof Error ? failure.message : String(failure)
  }
}
