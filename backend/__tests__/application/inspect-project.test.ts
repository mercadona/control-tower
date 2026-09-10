import { describe, expect, it } from 'vitest'
import { InspectProject, InspectProjectParams } from '../../src/application/queries/inspect-project.ts'
import { ProjectSetup } from '../../src/domain/ports/project-setup.ts'
import { ProjectReadiness } from '../../src/domain/value-objects/project-readiness.ts'
import { ReadinessFinding } from '../../src/domain/value-objects/readiness-finding.ts'
import { PlanTarget } from '../../src/domain/value-objects/plan-target.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class SetupSpy extends ProjectSetup {
  readonly targets: PlanTarget[] = []

  async inspect(target: PlanTarget): Promise<ProjectReadiness> {
    this.targets.push(target)
    return new ProjectReadiness({
      repository: target.repository.text, root: target.root.text, baseRevision: null,
      observedAt: '2026-09-10T00:00:00.000Z',
      findings: [new ReadinessFinding({ id: 'base', status: 'unverified', evidence: ['origin/HEAD'], action: 'update-checkout' })],
    })
  }
}

describe('InspectProject', () => {
  it('inspects_the_requested_checkout_and_preserves_an_unverified_observation', async () => {
    const setup = new SetupSpy()
    const target = new PlanTarget({ repository: new RepositoryName('owner/project'), root: new CheckoutRoot('/repo') })
    const result = await new InspectProject({ setup }).execute(new InspectProjectParams({ target }))
    expect(setup.targets).toEqual([target])
    expect(result.report.status).toBe('unverified')
    expect(result.report.findings[0].action).toBe('update-checkout')
  })
})
