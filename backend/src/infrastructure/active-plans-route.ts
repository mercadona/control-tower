import type { Request, RequestHandler, Response } from 'express'
import { Answer } from './http.ts'
import type { PlanSessions } from './plan-events-route.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

export const ActivePlanPhase = Object.freeze({
  PLANNING: 'planning',
  IMPLEMENTING: 'implementing',
  UNCERTAIN: 'uncertain',
} as const)

export type ActivePlanPhaseValue = (typeof ActivePlanPhase)[keyof typeof ActivePlanPhase]

export const ActivePlansOutcome = Object.freeze({
  RECOVERY_INCONCLUSIVE: 'active-plans-recovery-inconclusive',
} as const)

export type ActivePlansOutcomeValue = (typeof ActivePlansOutcome)[keyof typeof ActivePlansOutcome]

type AskedPlan = { issue: number, repository: RepositoryName }

export type FoundActivePlan = { phase: ActivePlanPhaseValue, watch: PlanWatch }

export type ProjectedActivePlan = {
  phase: ActivePlanPhaseValue,
  request: { id: string | null, repo: string, path: string | undefined },
  plan: {
    id: string | null,
    repo: string,
    issue: { number: number, url: string },
    agent: string,
    branch: string,
    worktree: string,
  },
}

export type ActivePlanRecovering = { recover: () => Promise<string | null> }

export class ActivePlans {
  readonly sessions: PlanSessions
  readonly implementing: Map<string, PlanWatch>
  readonly uncertain: Map<string, PlanWatch>

  constructor({ sessions }: { sessions: PlanSessions }) {
    this.sessions = sessions
    this.implementing = new Map()
    this.uncertain = new Map()
  }

  static #keyFor(watch: PlanWatch): string {
    return `${watch.repository.text}#${watch.issue.number}`
  }

  rememberImplementing(watch: PlanWatch): void {
    const key = ActivePlans.#keyFor(watch)
    this.uncertain.delete(key)
    this.sessions.forget({ issue: watch.issue.number, repository: watch.repository })
    this.implementing.set(key, watch)
  }

  rememberUncertain(watch: PlanWatch): void {
    const key = ActivePlans.#keyFor(watch)
    this.implementing.delete(key)
    this.sessions.forget({ issue: watch.issue.number, repository: watch.repository })
    this.uncertain.set(key, watch)
  }

  find({ issue, repository }: AskedPlan): FoundActivePlan | null {
    const key = `${repository.text}#${issue}`
    const implementing = this.implementing.get(key)
    if (implementing !== undefined) {
      return { phase: ActivePlanPhase.IMPLEMENTING, watch: implementing }
    }
    const uncertain = this.uncertain.get(key)
    if (uncertain !== undefined) {
      return { phase: ActivePlanPhase.UNCERTAIN, watch: uncertain }
    }
    const watch = this.sessions.find({ issue, repository })

    return watch === null ? null : { phase: ActivePlanPhase.PLANNING, watch }
  }

  known(): ProjectedActivePlan[] {
    return [
      ...this.sessions.known().map((watch) => ActivePlans.#project(ActivePlanPhase.PLANNING, watch)),
      ...[...this.implementing.values()].map((watch) => ActivePlans.#project(ActivePlanPhase.IMPLEMENTING, watch)),
      ...[...this.uncertain.values()].map((watch) => ActivePlans.#project(ActivePlanPhase.UNCERTAIN, watch)),
    ]
  }

  static #project(phase: ActivePlanPhaseValue, watch: PlanWatch): ProjectedActivePlan {
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
  static readonly PATH = '/active-plans'
  static readonly METHOD = 'GET'

  static handledBy(activePlans: ActivePlans, recovery: ActivePlanRecovering | null = null): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const refusal = recovery === null ? null : await recovery.recover()
      if (refusal !== null) {
        Answer.refuse(response, 400, ActivePlansOutcome.RECOVERY_INCONCLUSIVE, refusal)
        return
      }
      Answer.send(response, 200, { plans: activePlans.known() })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', ActivePlansRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
