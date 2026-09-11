import { HarnessConversation, HeadlessPlanAgents } from './headless-plan-agents.js'

export class HarnessConversations {
  constructor({ list, read, stderr, runsIn }) {
    this.list = list
    this.read = read
    this.stderr = stderr
    this.runsIn = runsIn
  }

  async known() {
    let agents
    try {
      agents = await this.list(this.runsIn)
    } catch (failure) {
      if (failure.code === 'ENOENT') return []
      this.stderr(`plans in flight: ${this.runsIn} could not be listed, so what is in flight could not be known: ${failure.message}\n`)

      return null
    }

    const conversations = []
    for (const agent of agents) {
      const conversation = await this.#read(agent)
      if (conversation !== null) conversations.push(conversation)
    }

    return conversations
  }

  #pathFor(agent) {
    return HeadlessPlanAgents.conversationPathFor({ runsIn: this.runsIn, agent })
  }

  async #read(agent) {
    const path = this.#pathFor(agent)
    let text
    try {
      text = await this.read(path)
    } catch (failure) {
      if (failure.code === 'ENOTDIR') return null
      this.stderr(`plans in flight: ${path} could not be read: ${failure.message}\n`)

      return null
    }
    if (text === null) return null

    let record
    try {
      record = JSON.parse(text)
    } catch (failure) {
      this.stderr(`plans in flight: ${path} is not JSON: ${failure.message}\n`)

      return null
    }
    if (!HarnessConversation.isWellFormed(record)) {
      this.stderr(`plans in flight: ${path} is not a well-formed record\n`)

      return null
    }

    const { worktree, issue, repository, startedAt } = record

    return new HarnessConversation({ agent, worktree, issue, repository, startedAt })
  }
}
