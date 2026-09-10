import { CheckoutRoot } from '../domain/value-objects/checkout-root.js'
import { PlanIssue } from '../domain/value-objects/plan-issue.js'
import { PlanWatch } from '../domain/value-objects/plan-watch.js'
import { PlanStoryFailure, WorkspaceFailure } from '../domain/exceptions.js'

export class WorktreePlans {
  static #UNDER_A_CHECKOUT = /^(.+)\/\.worktrees\/[1-9]\d*$/

  constructor({ checkouts, survey, conversations, story, realpathOf, stderr }) {
    this.checkouts = checkouts
    this.survey = survey
    this.conversations = conversations
    this.story = story
    this.realpathOf = realpathOf
    this.stderr = stderr
  }

  static #urlOf({ repository, issueNumber }) {
    return `https://github.com/${repository.text}/issues/${issueNumber}`
  }

  #agentOf(known, prepared, repository) {
    const canonical = this.#canonical(prepared.located.path)
    const attending = known.filter((conversation) =>
      conversation.repository === repository.text &&
      (conversation.worktree === prepared.located.path ||
        (canonical !== null && this.#canonical(conversation.worktree) === canonical)))
    if (attending.length === 0) return null

    return attending.reduce((newest, conversation) =>
      conversation.startedAt > newest.startedAt ? conversation : newest
    ).agent
  }

  #canonical(path) {
    return path === null ? null : this.realpathOf(path)
  }

  #toSurvey(known) {
    const registered = this.checkouts.known()
    if (registered === null) return null
    const roots = new Map(registered.map((root) => [root.text, root]))
    for (const conversation of known) {
      const found = conversation.worktree.match(WorktreePlans.#UNDER_A_CHECKOUT)
      if (found === null) continue
      const named = this.#canonical(found[1]) ?? found[1]
      if (roots.has(named) || !CheckoutRoot.isWellFormed(named)) continue
      roots.set(named, new CheckoutRoot(named))
    }

    return [...roots.values()]
  }

  async inFlight() {
    const known = await this.conversations()
    if (known === null) return null
    const roots = this.#toSurvey(known)
    if (roots === null) return null
    const watches = []
    for (const root of roots) {
      for (const watch of await this.#of(root, known)) watches.push(watch)
    }

    return watches
  }

  async #of(root, known) {
    const surveyed = await this.#surveyed(root)
    if (surveyed === null) return []
    const watches = []
    for (const prepared of surveyed.prepared) {
      const agent = this.#agentOf(known, prepared, surveyed.repository)
      if (agent === null) continue
      watches.push(new PlanWatch({
        story: await this.#storyOf(prepared.issueNumber, surveyed.repository),
        issue: new PlanIssue({
          number: prepared.issueNumber,
          url: WorktreePlans.#urlOf({ repository: surveyed.repository, issueNumber: prepared.issueNumber }),
        }),
        located: prepared.located,
        repository: surveyed.repository,
        agent,
      }))
    }

    return watches
  }

  async #surveyed(root) {
    try {
      return await this.survey(root)
    } catch (failure) {
      if (!(failure instanceof WorkspaceFailure)) throw failure
      this.stderr(
        `plans in flight: ${root.text} could not be surveyed, so its plans are not recovered: ${failure.message}\n`
      )

      return null
    }
  }

  async #storyOf(issueNumber, repository) {
    try {
      return await this.story({ issueNumber, repository })
    } catch (failure) {
      if (!(failure instanceof PlanStoryFailure)) throw failure
      this.stderr(`plans in flight: #${issueNumber} is recovered without its user story: ${failure.message}\n`)

      return null
    }
  }
}
