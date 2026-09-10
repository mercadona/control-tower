import { CmuxPlanAgents } from './cmux-plan-agents.js'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { PlanIssue } from '../domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import { PlanStoryFailure, WorkspaceFailure } from '../domain/exceptions.ts'
import { PlansInFlight } from '../domain/value-objects/plans-in-flight.ts'

export class WorktreePlans {
  static #UNDER_A_CHECKOUT = /^(.+)\/\.worktrees\/[1-9]\d*$/

  constructor({ checkouts, survey, sessions, story, realpathOf, stderr }) {
    this.checkouts = checkouts
    this.survey = survey
    this.sessions = sessions
    this.story = story
    this.realpathOf = realpathOf
    this.stderr = stderr
  }

  static #urlOf({ repository, issueNumber }) {
    return `https://github.com/${repository.text}/issues/${issueNumber}`
  }

  static #opensAPlan(entry) {
    return entry !== null && typeof entry === 'object' && CmuxPlanAgents.isHandle(entry.ref) &&
      typeof entry.title === 'string' && entry.title.startsWith(CmuxPlanAgents.NAME_PREFIX)
  }

  #agentOf(knowable, worktree) {
    const canonical = this.#canonical(worktree)
    const attending = knowable.find((entry) =>
      WorktreePlans.#opensAPlan(entry) &&
      (entry.cwd === worktree || (canonical !== null && this.#canonical(entry.cwd) === canonical)))

    return attending === undefined ? null : attending.ref
  }

  #canonical(path) {
    return path === null ? null : this.realpathOf(path)
  }

  #toSurvey(knowable) {
    const registered = this.checkouts.known()
    if (registered === null) return null
    const roots = new Map(registered.map((root) => [root.text, root]))
    for (const entry of knowable) {
      if (!WorktreePlans.#opensAPlan(entry)) continue
      const found = entry.cwd.match(WorktreePlans.#UNDER_A_CHECKOUT)
      if (found === null) continue
      const named = this.#canonical(found[1]) ?? found[1]
      if (roots.has(named) || !CheckoutRoot.isWellFormed(named)) continue
      roots.set(named, new CheckoutRoot(named))
    }

    return [...roots.values()]
  }

  static #knowableIn(listed) {
    const knowable = listed.filter((entry) => entry !== null && typeof entry === 'object' && entry.cwdKnown === true)
    if (listed.length > 0 && knowable.length === 0) return null

    return knowable
  }

  async inFlight(known = []) {
    const listed = this.sessions()
    if (!listed.wasAnswered) return this.#refuse(listed.reason)
    const knowable = WorktreePlans.#knowableIn(listed.entries)
    if (knowable === null) return this.#refuse('cmux listed sessions and none of them exposes its directory')
    const roots = this.#toSurvey(knowable)
    if (roots === null) return this.#refuse('the checkouts it serves could not be read')
    const watches = []
    const failures = []
    if (listed.entries.some((entry) => WorktreePlans.#opensAPlan(entry) && entry.cwdKnown !== true)) {
      failures.push('a plan session does not expose its directory')
    }
    for (const root of roots) {
      try {
        for (const watch of await this.#of(root, knowable, known)) watches.push(watch)
      } catch (failure) {
        if (!(failure instanceof WorkspaceFailure)) throw failure
        failures.push(`${root.text} could not be surveyed: ${failure.message}`)
      }
    }
    for (const watch of known) {
      const stillListed = listed.entries.some((entry) => entry !== null && typeof entry === 'object' && entry.ref === watch.agent)
      const matched = watches.some((found) => found.agent === watch.agent &&
        found.repository.text === watch.repository.text && found.issue.number === watch.issue.number)
      if (stillListed && !matched) failures.push(`${watch.agent} is still listed but cannot be matched to its plan worktree`)
    }
    if (failures.length > 0) return this.#refuse(failures.join('; '), watches)

    return PlansInFlight.listed(watches)
  }

  #refuse(reason, watches = null) {
    this.stderr(`plans in flight: ${reason}, so no plan in flight can be recovered\n`)

    return watches === null ? PlansInFlight.refused(reason) : PlansInFlight.incomplete(watches, reason)
  }

  async #of(root, knowable, known) {
    const surveyed = await this.survey(root)
    const watches = []
    for (const prepared of surveyed.prepared) {
      const agent = this.#agentOf(knowable, prepared.located.path)
      if (agent === null) continue
      const remembered = known.find((watch) => watch.repository.text === surveyed.repository.text &&
        watch.issue.number === prepared.issueNumber)
      watches.push(new PlanWatch({
        story: remembered?.story ?? await this.#storyOf(prepared.issueNumber, surveyed.repository),
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
