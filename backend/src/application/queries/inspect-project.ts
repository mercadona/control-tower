import type { ProjectSetup } from '../../domain/ports/project-setup.ts'
import type { PlanTarget } from '../../domain/value-objects/plan-target.ts'
import type { ProjectReadiness } from '../../domain/value-objects/project-readiness.ts'

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
  readonly setup: ProjectSetup

  constructor({ setup }: { setup: ProjectSetup }) { this.setup = setup }

  async execute({ target }: InspectProjectParams): Promise<InspectProjectResult> {
    return new InspectProjectResult({ report: await this.setup.inspect(target) })
  }
}
