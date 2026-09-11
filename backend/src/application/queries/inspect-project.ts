import type { ProjectRepository } from '../../domain/ports/project-repository.ts'
import type { ProjectEnvironment } from '../../domain/ports/project-environment.ts'
import type { ProjectReadinessAssessment } from '../../domain/policies/project-readiness-assessment.ts'
import { InspectionBudget } from '../../domain/value-objects/inspection-budget.ts'
import type { InspectionLimits } from '../../domain/value-objects/inspection-budget.ts'
import type { PlanTarget } from '../../domain/value-objects/plan-target.ts'
import { ProjectReadiness } from '../../domain/value-objects/project-readiness.ts'
import type { RepositoryIdentity } from '../../domain/value-objects/repository-identity.ts'
import type { RepositoryObservations } from '../../domain/value-objects/repository-observations.ts'
import type { ReadinessFinding } from '../../domain/value-objects/readiness-finding.ts'

export class InspectProjectParams {
  readonly target: PlanTarget

  constructor({ target }: { target: PlanTarget }) {
    this.target = target
    Object.freeze(this)
  }
}

export class InspectProjectResult {
  readonly report: ProjectReadiness

  constructor({ report }: { report: ProjectReadiness }) {
    this.report = report
    Object.freeze(this)
  }
}

export class InspectProject {
  readonly repository: ProjectRepository
  readonly environment: ProjectEnvironment
  readonly assessment: ProjectReadinessAssessment
  readonly now: () => number
  readonly limits: InspectionLimits
  private active = false

  constructor({ repository, environment, assessment, now, limits }: {
    repository: ProjectRepository, environment: ProjectEnvironment, assessment: ProjectReadinessAssessment,
    now: () => number, limits: InspectionLimits,
  }) {
    this.repository = repository
    this.environment = environment
    this.assessment = assessment
    this.now = now
    this.limits = limits
  }

  async execute({ target }: InspectProjectParams): Promise<InspectProjectResult> {
    const budget = new InspectionBudget(this.now(), this.limits)
    if (this.active) return new InspectProjectResult({ report: this.assessment.busy(target, budget.startedAt) })
    this.active = true
    try {
      const identity = await this.repository.identify(target.root.text, budget)
      const identified = this.assessment.identity(target, identity)
      if (identified.status !== 'ready') return this.#result(target, budget, identity, null, [identified])
      const repository = await this.repository.observe(identity.root, budget)
      const findings = [identified, ...this.assessment.repository(repository)]
      if (repository.baseRevision !== null) {
        const file = repository.environmentFile
        if (file !== null) {
          const environment = await this.environment.observe(identity.root, file, budget)
          findings.push(...this.assessment.environment(identity.root, file, environment))
        }
        findings.push(this.assessment.execution())
      }
      return this.#result(target, budget, identity, repository, findings)
    } finally {
      this.active = false
    }
  }

  #result(target: PlanTarget, budget: InspectionBudget, identity: RepositoryIdentity,
    repository: RepositoryObservations | null, findings: readonly ReadinessFinding[]): InspectProjectResult {
    return new InspectProjectResult({ report: new ProjectReadiness({
      repository: target.repository.text, root: identity.root, baseRevision: repository?.baseRevision ?? null,
      observedAt: budget.startedAt, findings,
    }) })
  }
}
