import { CmuxPlanAgents } from './cmux-plan-agents.js'
import { PlanIssue } from '../domain/value-objects/plan-issue.js'
import { PlanWatch } from '../domain/value-objects/plan-watch.js'
import { PlanFailure } from '../domain/exceptions.js'

export class WorktreePlans {
  constructor({ checkouts, survey, sessions, planIssues, stderr }) {
    this.checkouts = checkouts
    this.survey = survey
    this.sessions = sessions
    this.planIssues = planIssues
    this.stderr = stderr
  }

  static urlOf({ repository, issueNumber }) {
    return `https://github.com/${repository.text}/issues/${issueNumber}`
  }

  static agentOf(listed, worktree) {
    const attending = listed.find((entry) =>
      entry !== null && typeof entry === 'object' && entry.cwdKnown === true &&
      entry.cwd === worktree && CmuxPlanAgents.isHandle(entry.ref))

    return attending === undefined ? null : attending.ref
  }

  async inFlight() {
    const listed = this.sessions()
    if (listed === null) return null
    const watches = []
    for (const root of this.checkouts.known()) {
      for (const watch of await this.#of(root, listed)) watches.push(watch)
    }

    return watches
  }

  async #of(root, listed) {
    const surveyed = await this.#surveyed(root)
    if (surveyed === null) return []
    const watches = []
    for (const prepared of surveyed.prepared) {
      const agent = WorktreePlans.agentOf(listed, prepared.located.path)
      if (agent === null) continue
      watches.push(new PlanWatch({
        story: await this.#storyOf(prepared.issueNumber, surveyed.repository),
        issue: new PlanIssue({
          number: prepared.issueNumber,
          url: WorktreePlans.urlOf({ repository: surveyed.repository, issueNumber: prepared.issueNumber }),
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
      if (!(failure instanceof PlanFailure)) throw failure
      this.stderr(
        `plans in flight: ${root.text} could not be surveyed, so its plans are not recovered: ${failure.message}\n`
      )

      return null
    }
  }

  async #storyOf(issueNumber, repository) {
    try {
      return await this.planIssues.storyOf({ issueNumber, repository })
    } catch (failure) {
      if (!(failure instanceof PlanFailure)) throw failure
      this.stderr(`plans in flight: #${issueNumber} is recovered without its user story: ${failure.message}\n`)

      return null
    }
  }
}
