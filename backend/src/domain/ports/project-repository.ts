import type { InspectionBudget } from '../value-objects/inspection-budget.ts'
import type { RepositoryIdentity } from '../value-objects/repository-identity.ts'
import type { RepositoryObservations } from '../value-objects/repository-observations.ts'

export abstract class ProjectRepository {
  abstract identify(root: string, budget: InspectionBudget): Promise<RepositoryIdentity>
  abstract observe(root: string, budget: InspectionBudget): Promise<RepositoryObservations>
}
