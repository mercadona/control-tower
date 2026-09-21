import { afterEach, describe, expect, it } from 'vitest'
import { ADVICE_SCHEMA, ADVISOR_TOOLS, RECONCILER_TOOLS } from '../../../plugin/scripts/step-contracts.js'
import { RunDriverMother } from './fixtures/run-driver-mother.ts'

describe('CT run machine real process', () => {
  const fixtures: RunDriverMother[] = []

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  })

  it('a stale oracle ticket returns the real wrong-step exit nine', async () => {
    const fixture = await RunDriverMother.ready()
    fixtures.push(fixture)

    const stale = await fixture.consumeStaleTicket()

    expect(stale.code).toBe(9)
    expect(stale.instruction.work).toEqual({
      kind: 'refused',
      detail: expect.stringContaining('ct-step exited 9 without announcing a run state'),
      closure: null,
    })
  })

  it('two real vetoes produce advice and the third plugin brief', async () => {
    const fixture = await RunDriverMother.ready()
    fixtures.push(fixture)

    const evidence = await fixture.reachThirdAttempt()

    expect(evidence.advicePackage).toContain('attempt 1')
    expect(evidence.advicePackage).toContain('attempt 2')
    expect(evidence.thirdBrief).toContain('## Advice for this attempt')
    expect(evidence.thirdBrief).toContain(evidence.approach)
    expect(evidence.thirdBrief).toContain('`work.txt`')
    expect(evidence.advisor.consumer.callId).not.toBe('')
    expect(evidence.advisor.consumer.conversation).toBe(RunDriverMother.CONVERSATION)
    expect(evidence.advisor.consumer.paths).toEqual(evidence.advisor.producer.paths)
    expect(evidence.advisor.consumer.sha256).toEqual(evidence.advisor.producer.sha256)
    expect(evidence.advisor.consumer.argv).toEqual(evidence.advisor.producer.invocationArgv)
    expect(evidence.advisor.consumer.prompt).toBe(
      `Read the listed files.\n${evidence.advisor.producer.paths.join('\n')}\nComplete this role. Return the CLI response. Do not run CT commands or dispatch another agent.`,
    )
    expect(evidence.advisor.producer.response).toEqual({
      kind: 'structured', path: expect.stringContaining('advice.json'),
    })
    expect(evidence.advisor.requestId).toBe(`run:${evidence.advisor.producer.ticket}`)
    expect(evidence.advisor.producer.argv).toEqual(expect.arrayContaining([
      '--tools', ADVISOR_TOOLS, '--allowedTools', ADVISOR_TOOLS,
      '--agent', 'ct-advisor', '--json-schema', JSON.stringify(ADVICE_SCHEMA),
    ]))
  }, 60_000)

  it('a real merge conflict uses the prepared reconciler package', async () => {
    const fixture = await RunDriverMother.conflictingBase()
    fixtures.push(fixture)

    const evidence = await fixture.reconcileConflict()

    expect(evidence.promptPaths).toContain(evidence.packagePath)
    expect(evidence.package).toContain('## Conflicted files')
    expect(evidence.conflictBytes).toContain('<<<<<<<')
    expect(evidence.stagedTaskDiff).toContain('synthetic model response')
    expect(evidence.sliceDiff).toContain('work.txt')
    expect(evidence.delivered).toContain('"kind":"transition","state":"delivered"')
    expect(evidence.promptPaths).toEqual(evidence.reconciler.consumer.paths)
    expect(evidence.reconciler.consumer.callId).not.toBe('')
    expect(evidence.reconciler.consumer.conversation).toBe(RunDriverMother.CONVERSATION)
    expect(evidence.reconciler.consumer.paths).toEqual(evidence.reconciler.producer.paths)
    expect(evidence.reconciler.consumer.sha256).toEqual(evidence.reconciler.producer.sha256)
    expect(evidence.reconciler.consumer.argv).toEqual(evidence.reconciler.producer.invocationArgv)
    expect(evidence.reconciler.consumer.prompt).toBe(
      `Read the listed files.\n${evidence.reconciler.producer.paths.join('\n')}\nComplete this role. Return the CLI response. Do not run CT commands or dispatch another agent.`,
    )
    expect(evidence.reconciler.producer.response).toEqual({ kind: 'edits' })
    expect(evidence.reconciler.requestId).toBe(`run:${evidence.reconciler.producer.ticket}`)
    expect(evidence.reconciler.producer.argv).toEqual(expect.arrayContaining([
      '--tools', RECONCILER_TOOLS, '--allowedTools', RECONCILER_TOOLS, '--agent', 'ct-reconciler',
    ]))
  }, 60_000)
})
