import { Answer } from './http.js'

export const ActivePlanPhase = Object.freeze({
  PLANNING: 'planning',
  IMPLEMENTING: 'implementing',
  UNCERTAIN: 'uncertain',
})

export const ActivePlansOutcome = Object.freeze({
  RECOVERY_INCONCLUSIVE: 'active-plans-recovery-inconclusive',
})

export class ActivePlans {
  constructor({ sessions }) {
    this.sessions = sessions
    this.implementing = new Map()
    this.uncertain = new Map()
    this.pendingImplementations = new Set()
  }

  static #keyFor(watch) {
    return `${watch.repository.text}#${watch.issue.number}`
  }

  rememberImplementing(watch) {
    const key = ActivePlans.#keyFor(watch)
    this.uncertain.delete(key)
    this.sessions.forget({ issue: watch.issue.number, repository: watch.repository })
    this.implementing.set(key, watch)
  }

  rememberUncertain(watch) {
    const key = ActivePlans.#keyFor(watch)
    this.implementing.delete(key)
    this.sessions.forget({ issue: watch.issue.number, repository: watch.repository })
    this.uncertain.set(key, watch)
  }

  find({ issue, repository }) {
    const key = `${repository.text}#${issue}`
    if (this.implementing.has(key)) {
      return { phase: ActivePlanPhase.IMPLEMENTING, watch: this.implementing.get(key) }
    }
    if (this.uncertain.has(key)) {
      return { phase: ActivePlanPhase.UNCERTAIN, watch: this.uncertain.get(key) }
    }
    const watch = this.sessions.find({ issue, repository })

    return watch === null ? null : { phase: ActivePlanPhase.PLANNING, watch }
  }

  snapshot() {
    const watches = [...this.sessions.known(), ...this.implementing.values(), ...this.uncertain.values()]
    return new Map(watches.map((watch) => [ActivePlans.#keyFor(watch),
      this.find({ issue: watch.issue.number, repository: watch.repository })]))
  }

  isUnchanged(captured) {
    const current = this.find({ issue: captured.watch.issue.number, repository: captured.watch.repository })
    return current !== null && current.watch === captured.watch && current.phase === captured.phase &&
      !this.pendingImplementations.has(captured.watch)
  }

  beginImplementation(watch) {
    this.pendingImplementations.add(watch)
  }

  endImplementation(watch) {
    this.pendingImplementations.delete(watch)
  }

  forgetIfUnchanged(captured) {
    if (!this.isUnchanged(captured)) return false
    const key = ActivePlans.#keyFor(captured.watch)
    this.sessions.forget({ issue: captured.watch.issue.number, repository: captured.watch.repository })
    this.implementing.delete(key)
    this.uncertain.delete(key)
    return true
  }

  known() {
    return [
      ...this.sessions.known().map((watch) => ActivePlans.#project(ActivePlanPhase.PLANNING, watch)),
      ...this.implementing.values().map((watch) => ActivePlans.#project(ActivePlanPhase.IMPLEMENTING, watch)),
      ...this.uncertain.values().map((watch) => ActivePlans.#project(ActivePlanPhase.UNCERTAIN, watch)),
    ]
  }

  static #project(phase, watch) {
    return {
      phase,
      request: {
        id: watch.storyText(),
        repo: watch.repository.text,
        path: watch.located.root,
      },
      plan: {
        id: watch.storyText(),
        repo: watch.repository.text,
        issue: { number: watch.issue.number, url: watch.issue.url },
        agent: watch.agent,
        branch: watch.located.branch,
        worktree: watch.located.path,
      },
    }
  }
}

export class ActivePlansRoute {
  static PATH = '/active-plans'
  static METHOD = 'GET'

  static handledBy(activePlans, recovery = null) {
    return async (request, response) => {
      const refusal = recovery === null ? null : await recovery.recover()
      if (refusal !== null) {
        Answer.refuse(response, 400, ActivePlansOutcome.RECOVERY_INCONCLUSIVE, refusal)
        return
      }
      Answer.send(response, 200, { plans: activePlans.known() })
    }
  }

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', ActivePlansRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
