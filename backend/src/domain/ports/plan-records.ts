import type { PlanBriefing } from '../value-objects/plan-briefing.ts'
import type { PlansInFlight } from '../value-objects/plans-in-flight.ts'
import type { PlanWatch } from '../value-objects/plan-watch.ts'
import type { PlanNonLaunch } from '../value-objects/plan-non-launch.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'
import type { UnusedWorkspace } from '../value-objects/unused-workspace.ts'

export class PlanRecords {
  async recorded(agent: string): Promise<PlanWatch | null> {
    throw new Error(`${this.constructor.name} must implement recorded(agent), asked for ${agent}`)
  }

  async retired(agent: string): Promise<PlanWatch | null> {
    throw new Error(`${this.constructor.name} must implement retired(agent), asked for ${agent}`)
  }

  async cleanupEvidence(watch: PlanWatch): Promise<UnusedWorkspace | null> {
    throw new Error(`${this.constructor.name} must implement cleanupEvidence(watch), asked for ${watch.agent}`)
  }

  async recordCleanupEvidence(evidence: UnusedWorkspace): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement recordCleanupEvidence(evidence), asked for ${evidence.watch.agent}`
    )
  }

  async archive(watch: PlanWatch): Promise<void> {
    throw new Error(`${this.constructor.name} must implement archive(watch), asked for ${watch.agent}`)
  }

  async recordNonLaunch(watch: PlanWatch, proof: PlanNonLaunch): Promise<void> {
    throw new Error(`${this.constructor.name} must implement recordNonLaunch(watch, proof), asked for ${watch.agent}`)
  }

  async nonLaunch(watch: PlanWatch): Promise<PlanNonLaunch | null> {
    throw new Error(`${this.constructor.name} must implement nonLaunch(watch), asked for ${watch.agent}`)
  }

  async prepare(briefing: PlanBriefing): Promise<PlanWatch> {
    throw new Error(`${this.constructor.name} must implement prepare(briefing), asked for ${briefing.issue}`)
  }

  async find(asked: { issue: number, repository: RepositoryName }): Promise<PlanWatch | null> {
    throw new Error(
      `${this.constructor.name} must implement find({ issue, repository }), asked for ${asked.issue} in ${asked.repository}`
    )
  }

  async inFlight(): Promise<PlansInFlight> {
    throw new Error(`${this.constructor.name} must implement inFlight()`)
  }
}
