import { afterEach, describe, expect, it } from 'vitest'
import { RunDriverMother } from './fixtures/run-driver-mother.ts'

describe('run recovery real process', () => {
  const fixtures: RunDriverMother[] = []

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  })

  it('established recovery consumes rewritten citations and dirty scope amendments once', async () => {
    const fixture = await RunDriverMother.ready()
    fixtures.push(fixture)

    const evidence = await fixture.recoverCompletedResponses()

    expect(evidence).toEqual([
      expect.objectContaining({ kind: 'rewritten-citation', publications: 0, launches: 0, consumptions: 1 }),
      expect.objectContaining({ kind: 'dirty-scope-amendment', publications: 0, launches: 0, consumptions: 1 }),
    ])
  }, 60_000)

  it('a later fix result overrides real delivered journal evidence after restart', async () => {
    const fixture = await RunDriverMother.ready()
    fixtures.push(fixture)

    const evidence = await fixture.recoverLaterFixes()

    expect(evidence.failed).toEqual(expect.objectContaining({
      phase: 'uncertain',
      diagnostic: 'synthetic fix failed after delivery',
      recovery: { action: 'inspect', detail: 'synthetic fix failed after delivery' },
      watching: false,
      calls: 0,
      verbs: 0,
    }))
    expect(evidence.successful).toEqual(expect.objectContaining({
      phase: 'implementing',
      watching: true,
      calls: 0,
      verbs: 0,
    }))
  }, 60_000)
})
