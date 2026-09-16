import { describe, expect, it } from 'vitest'
import { RecoverPlan, RecoverPlanParams } from '../../src/application/actions/recover-plan.ts'
import { PlanAgents } from '../../src/domain/ports/plan-agents.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class PlanAgentsDouble extends PlanAgents {
  readonly recovered: RecoverPlanParams[] = []

  override async recover(params: RecoverPlanParams): Promise<void> {
    this.recovered.push(params)
  }
}

describe('RecoverPlan', () => {
  it('recovery delegates the original identity without creating another conversation', async () => {
    const agents = new PlanAgentsDouble()
    const recovery = new RecoverPlan({ agents })
    const params = new RecoverPlanParams({
      agent: '11111111-1111-4111-8111-111111111111',
      issue: 331,
      repository: new RepositoryName('mercadona/control-tower-plugin'),
    })

    await recovery.execute(params)

    expect(agents.recovered).toEqual([params])
    expect(Object.isFrozen(params)).toBe(true)
  })
})
