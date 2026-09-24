import type { Request, RequestHandler, Response } from 'express'
import { Answer } from './http.ts'
import type { PlanSessions } from './plan-sessions.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { RunClosure } from '../domain/value-objects/run-instruction.ts'
import { PlanRecoveryConflict } from '../domain/exceptions.ts'

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
export type ActivePlanRecovery = { action: 'observe' | 'continue' | 'cleanup' | 'inspect', detail: string }

export type FoundActivePlan =
  | { phase: typeof ActivePlanPhase.PLANNING, watch: PlanWatch }
  | { phase: typeof ActivePlanPhase.IMPLEMENTING, watch: PlanWatch, acceptsChange: boolean }
  | {
    phase: typeof ActivePlanPhase.UNCERTAIN,
    watch: PlanWatch,
    diagnostic: string | null,
    recovery: ActivePlanRecovery,
    refusal: RunClosure | null,
  }

export type ProjectedActivePlan = {
  phase: ActivePlanPhaseValue,
  acceptsChange: boolean,
  diagnostic?: string,
  refusal?: RunClosure,
  request: { id: string | null, repo: string, path: string | undefined },
  plan: {
    id: string | null,
    repo: string,
    issue: { number: number, url: string },
    agent: string,
    branch: string,
    worktree: string,
  },
  recovery?: ActivePlanRecovery,
}

export type ActivePlanRecovering = { recover: () => Promise<string | null> }
export type ActivePlanInspecting = { inspect: () => Promise<string | null> }

export class ActivePlans {
  readonly sessions: PlanSessions
  readonly implementing: Map<string, { watch: PlanWatch, acceptsChange: boolean }>
  readonly uncertain: Map<string, Extract<FoundActivePlan, { phase: typeof ActivePlanPhase.UNCERTAIN }>>

  constructor({ sessions }: { sessions: PlanSessions }) {
    this.sessions = sessions
    this.implementing = new Map()
    this.uncertain = new Map()
  }

  static #keyFor(watch: PlanWatch): string {
    return `${watch.repository.text}#${watch.issue.number}`
  }

  rememberImplementing(watch: PlanWatch, acceptsChange: boolean): void {
    const key = ActivePlans.#keyFor(watch)
    this.uncertain.delete(key)
    this.sessions.forget({ issue: watch.issue.number, repository: watch.repository })
    this.implementing.set(key, { watch, acceptsChange })
  }

  rememberPlanning(watch: PlanWatch): void {
    const key = ActivePlans.#keyFor(watch)
    this.implementing.delete(key)
    this.uncertain.delete(key)
    this.sessions.remember(watch)
  }

  rememberUncertain(
    watch: PlanWatch,
    diagnostic: string | null,
    recovery: ActivePlanRecovery,
    refusal: RunClosure | null = null,
  ): void {
    const key = ActivePlans.#keyFor(watch)
    this.implementing.delete(key)
    this.sessions.forget({ issue: watch.issue.number, repository: watch.repository })
    this.uncertain.set(key, {
      phase: ActivePlanPhase.UNCERTAIN,
      watch,
      diagnostic,
      recovery: Object.freeze({ ...recovery }),
      refusal,
    })
  }

  forget({ issue, repository }: AskedPlan): void {
    const key = `${repository.text}#${issue}`
    this.sessions.forget({ issue, repository })
    this.implementing.delete(key)
    this.uncertain.delete(key)
  }

  watches(): readonly PlanWatch[] {
    return [
      ...this.sessions.known(),
      ...[...this.implementing.values()].map((held) => held.watch),
      ...[...this.uncertain.values()].map((found) => found.watch),
    ]
  }

  find({ issue, repository }: AskedPlan): FoundActivePlan | null {
    const key = `${repository.text}#${issue}`
    const implementing = this.implementing.get(key)
    if (implementing !== undefined) {
      return {
        phase: ActivePlanPhase.IMPLEMENTING,
        watch: implementing.watch,
        acceptsChange: implementing.acceptsChange,
      }
    }
    const uncertain = this.uncertain.get(key)
    if (uncertain !== undefined) return uncertain
    const watch = this.sessions.find({ issue, repository })

    return watch === null ? null : { phase: ActivePlanPhase.PLANNING, watch }
  }

  known(): ProjectedActivePlan[] {
    return [
      ...this.sessions.known().map((watch) => ActivePlans.#project(ActivePlanPhase.PLANNING, watch)),
      ...[...this.implementing.values()].map((held) => (
        ActivePlans.#project(ActivePlanPhase.IMPLEMENTING, held.watch, null, null, held.acceptsChange)
      )),
      ...[...this.uncertain.values()].map((found) => (
        ActivePlans.#project(
          ActivePlanPhase.UNCERTAIN, found.watch, found.diagnostic, found.recovery, false, found.refusal,
        )
      )),
    ]
  }

  static #project(
    phase: ActivePlanPhaseValue,
    watch: PlanWatch,
    diagnostic: string | null = null,
    recovery: ActivePlanRecovery | null = null,
    acceptsChange: boolean = false,
    refusal: RunClosure | null = null,
  ): ProjectedActivePlan {
    const projected: ProjectedActivePlan = {
      phase,
      acceptsChange,
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
    if (diagnostic !== null) projected.diagnostic = diagnostic
    if (recovery !== null) projected.recovery = recovery
    if (refusal !== null) {
      projected.refusal = Object.freeze({
        state: refusal.state,
        outcome: refusal.outcome,
        exit: refusal.exit,
        task: refusal.task,
        findings: refusal.findings,
        verdict: refusal.verdict,
      })
    }
    return projected
  }
}

export class ActivePlansRoute {
  static readonly PATH = '/active-plans'
  static readonly METHOD = 'GET'

  static handledBy(activePlans: ActivePlans, inspection: ActivePlanInspecting | null = null): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      let refusal: string | null
      try {
        refusal = inspection === null ? null : await inspection.inspect()
      } catch (cause) {
        if (!(cause instanceof PlanRecoveryConflict)) throw cause
        refusal = cause.message
      }
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
