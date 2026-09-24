import { describe, expect, it } from 'vitest'
import { SessionPreparationReports } from '../../src/infrastructure/session-preparation-reports.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { PreparationMother } from '../preparation-mother.ts'
import { LiveSessionNotLive } from '../../src/domain/ports/live-sessions.ts'

class Session {
  readonly sent: string[] = []
  target = 'target-1'
  repository = new RepositoryName('owner/repo')
  root = new CheckoutRoot('/repo')
  available = true
  failing = false

  gateCheckout() { return { target: this.target, conversation: { root: this.root, repository: this.repository } } }
  async announce(line: string): Promise<boolean> {
    if (!this.available) return false
    this.sent.push(line)
    if (this.failing) throw new LiveSessionNotLive('session-1')
    return true
  }
}

describe('preparation findings reach the matching coordinating session', () => {
  it('two failing worktrees are announced once each rather than on every dispatch sweep', async () => {
    const session = new Session()
    const adapter = new SessionPreparationReports({ sessions: () => session, stderr: () => {} })
    const target = { root: session.root, repository: session.repository, preparation: PreparationMother.blocked() }
    for (let sweep = 0; sweep < 2; sweep++) {
      await adapter.announce({ ...target, path: '/repo/.worktrees/1' })
      await adapter.announce({ ...target, path: '/repo/.worktrees/2' })
    }
    expect(session.sent).toHaveLength(2)
  })

  it('a finding whose submission failed after the paste is not remembered as announced, so the next sweep sends it again', async () => {
    const session = new Session()
    const adapter = new SessionPreparationReports({ sessions: () => session, stderr: () => {} })
    const asked = { root: session.root, repository: session.repository, preparation: PreparationMother.blocked() }
    session.failing = true
    await adapter.announce(asked)
    session.failing = false

    await adapter.announce(asked)

    expect(session.sent).toHaveLength(2)
  })

  it('a successful remote check does not erase a pending local preparation failure', async () => {
    const session = new Session()
    const adapter = new SessionPreparationReports({ sessions: () => session, stderr: () => {} })
    const target = { root: session.root, repository: session.repository }
    await adapter.announce({ ...target, path: '/repo/.worktrees/1', preparation: PreparationMother.blocked() })
    await adapter.announce({ ...target, preparation: PreparationMother.compatible() })
    expect(adapter.current(target)).toEqual([PreparationMother.blocked()])
    await adapter.announce({ ...target, path: '/repo/.worktrees/1', preparation: PreparationMother.compatible() })
    expect(adapter.current(target)).toEqual([])
  })

  it('includes the exact diagnosis and human approval requirement, without repeating an unchanged finding', async () => {
    const session = new Session()
    const diagnostics: string[] = []
    const adapter = new SessionPreparationReports({ sessions: () => session, stderr: (line) => diagnostics.push(line) })
    const asked = { root: session.root, repository: session.repository, preparation: PreparationMother.blocked() }
    await adapter.announce(asked)
    await adapter.announce(asked)
    expect(session.sent).toHaveLength(1)
    expect(session.sent[0]).toContain(asked.preparation.summary)
    expect(session.sent[0]).toContain('With their authorization')
    expect(session.sent[0]).toContain('A proposed correction or an open pull request is not evidence')
    expect(diagnostics).toEqual([])
  })

  it('does not send a repository diagnostic into another checkout conversation', async () => {
    const session = new Session()
    const diagnostics: string[] = []
    const adapter = new SessionPreparationReports({ sessions: () => session, stderr: (line) => diagnostics.push(line) })
    await adapter.announce({ root: new CheckoutRoot('/other'), repository: session.repository, preparation: PreparationMother.blocked() })
    expect(session.sent).toEqual([])
    expect(diagnostics[0]).toContain('no matching coordinating session')
  })

  it('an undelivered diagnostic can be delivered on a later check', async () => {
    const session = new Session()
    session.available = false
    const adapter = new SessionPreparationReports({ sessions: () => session, stderr: () => {} })
    const asked = { root: session.root, repository: session.repository, preparation: PreparationMother.blocked() }
    await adapter.announce(asked)
    session.available = true
    await adapter.announce(asked)
    expect(session.sent).toHaveLength(1)
    session.target = 'target-2'
    await adapter.announce(asked)
    expect(session.sent).toHaveLength(2)
  })
})
