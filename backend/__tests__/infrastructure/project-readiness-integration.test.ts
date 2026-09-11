import { describe, expect, it } from 'vitest'
import { ReadinessWorld } from '../fixtures/readiness-world.ts'

describe('Project readiness through the source adapters', () => {
  it('reports_configuration_without_claiming_tests_or_worktrees_were_executed', async () => {
    const world = new ReadinessWorld()
    const report = await world.inspect()
    expect(report.baseRevision).toBe('a'.repeat(40))
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'test-workers', status: 'ready' }))
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'database-readiness', status: 'ready' }))
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'execution', status: 'unverified' }))
    expect(report.status).toBe('unverified')
    expect(world.commands.every(({ bin }) => ['git', 'docker'].includes(bin))).toBe(true)
    expect(world.commands.some(({ argv }) => ['up', 'build', 'exec', 'fetch'].some((verb) => argv.includes(verb)))).toBe(false)
    expect(world.commands.every(({ budgetMs }) => budgetMs > 0 && budgetMs <= 2_000)).toBe(true)
  })
})
