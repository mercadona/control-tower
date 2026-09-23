import { describe, expect, it } from 'vitest'
import { CheckRepositoryPreparation } from '../../src/application/actions/check-repository-preparation.ts'
import { RepositoryPreparations } from '../../src/domain/ports/repository-preparations.ts'
import type { PreparationTarget } from '../../src/domain/ports/repository-preparations.ts'
import { PreparationAnnouncements } from '../../src/domain/ports/preparation-announcements.ts'
import type { RepositoryPreparation } from '../../src/domain/value-objects/repository-preparation.ts'
import { PreparationMother } from '../preparation-mother.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class Preparations extends RepositoryPreparations {
  answer = PreparationMother.blocked()
  calls = 0
  override async inspect(): Promise<RepositoryPreparation> { this.calls++; return this.answer }
  override async prepare(): Promise<RepositoryPreparation> { return this.answer }
}

class Announcements extends PreparationAnnouncements {
  readonly received: RepositoryPreparation[] = []
  override async announce(asked: PreparationTarget & { preparation: RepositoryPreparation }): Promise<void> {
    this.received.push(asked.preparation)
  }
}

describe('checking repository preparation', () => {
  it('delivers the same diagnostic to the coordinator and the caller, then checks again after a correction', async () => {
    const preparations = new Preparations()
    const announcements = new Announcements()
    const check = new CheckRepositoryPreparation({ preparations, announcements })
    const target = { root: new CheckoutRoot('/repo'), repository: new RepositoryName('owner/repo') }
    await expect(check.execute(target)).rejects.toThrow(preparations.answer.summary)
    expect(announcements.received).toEqual([preparations.answer])
    preparations.answer = PreparationMother.compatible()
    expect(await check.execute(target)).toBe(preparations.answer)
    expect(preparations.calls).toBe(2)
    expect(announcements.received).toEqual([PreparationMother.blocked(), preparations.answer])
  })

  it('a local configuration refusal is announced before the agent can start', async () => {
    const preparations = new Preparations()
    const announcements = new Announcements()
    const check = new CheckRepositoryPreparation({ preparations, announcements })
    await expect(check.prepare({ root: new CheckoutRoot('/repo'), repository: new RepositoryName('owner/repo'), path: '/repo/.worktrees/1' })).rejects.toThrow(preparations.answer.summary)
    expect(announcements.received).toEqual([preparations.answer])
  })
})
