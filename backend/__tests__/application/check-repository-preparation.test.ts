import { describe, expect, it } from 'vitest'
import { CheckRepositoryPreparation } from '../../src/application/actions/check-repository-preparation.ts'
import { WorktreeEnvironments } from '../../src/domain/ports/worktree-environments.ts'
import type { PreparationTarget } from '../../src/domain/ports/worktree-environments.ts'
import { PreparationReports } from '../../src/domain/ports/preparation-reports.ts'
import type { RepositoryPreparation } from '../../src/domain/value-objects/repository-preparation.ts'
import { PreparationMother } from '../preparation-mother.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class Environments extends WorktreeEnvironments {
  answer = PreparationMother.blocked()
  calls = 0
  override async inspect(): Promise<RepositoryPreparation> { this.calls++; return this.answer }
  override async prepare(): Promise<RepositoryPreparation> { return this.answer }
}

class Reports extends PreparationReports {
  readonly received: RepositoryPreparation[] = []
  override async announce(asked: PreparationTarget & { preparation: RepositoryPreparation }): Promise<void> {
    this.received.push(asked.preparation)
  }
}

describe('checking repository preparation', () => {
  it('delivers the same diagnostic to the coordinator and the caller, then checks again after a correction', async () => {
    const environments = new Environments()
    const reports = new Reports()
    const check = new CheckRepositoryPreparation({ environments, reports })
    const target = { root: new CheckoutRoot('/repo'), repository: new RepositoryName('owner/repo') }
    await expect(check.execute(target)).rejects.toThrow(environments.answer.summary)
    expect(reports.received).toEqual([environments.answer])
    environments.answer = PreparationMother.compatible()
    expect(await check.execute(target)).toBe(environments.answer)
    expect(environments.calls).toBe(2)
    expect(reports.received).toEqual([PreparationMother.blocked(), environments.answer])
  })

  it('a local configuration refusal is announced before the agent can start', async () => {
    const environments = new Environments()
    const reports = new Reports()
    const check = new CheckRepositoryPreparation({ environments, reports })
    await expect(check.prepare({ root: new CheckoutRoot('/repo'), repository: new RepositoryName('owner/repo'), path: '/repo/.worktrees/1' })).rejects.toThrow(environments.answer.summary)
    expect(reports.received).toEqual([environments.answer])
  })
})
