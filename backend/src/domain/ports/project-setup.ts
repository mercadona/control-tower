import type { PlanTarget } from '../value-objects/plan-target.ts'
import type { ProjectReadiness } from '../value-objects/project-readiness.ts'

export abstract class ProjectSetup {
  abstract inspect(target: PlanTarget): Promise<ProjectReadiness>
}
