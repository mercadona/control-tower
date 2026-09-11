import type { InspectionBudget } from '../value-objects/inspection-budget.ts'
import type { EnvironmentObservations } from '../value-objects/environment-observations.ts'

export abstract class ProjectEnvironment {
  abstract observe(root: string, file: string, budget: InspectionBudget): Promise<EnvironmentObservations>
}
