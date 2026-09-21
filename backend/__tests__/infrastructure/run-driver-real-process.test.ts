import { afterEach, describe, expect, it } from 'vitest'
import { RoleBytes } from '../../../plugin/scripts/role-bytes.js'
import { STEPS } from '../../../plugin/scripts/run-machine.js'
import { REPORT_SCHEMA, SLICE_VERDICT_SCHEMA, VERDICT_SCHEMA } from '../../../plugin/scripts/step-contracts.js'
import { RunDriverMother } from './fixtures/run-driver-mother.ts'

describe('run driver real process', () => {
  const fixtures: RunDriverMother[] = []

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  })

  it('a new admission reaches real machine delivery with one conversation', async () => {
    const fixture = await RunDriverMother.ready()
    fixtures.push(fixture)

    const evidence = await fixture.deliverThroughApi()

    expect(evidence.conversations).toEqual([evidence.admission.conversation])
    expect(evidence.roles).toEqual(['implement', 'judge', 'slice-judge'])
    expect(evidence.dispatches.map((dispatch) => dispatch.response.kind)).toEqual(['structured', 'file', 'file'])
    expect(new Set(evidence.callIds).size).toBe(evidence.callIds.length)
    expect(evidence.requests.every((request) => request.startsWith('run:'))).toBe(true)
    expect(evidence.measurements.every((measurement) => (
      measurement.conversation === evidence.admission.conversation
      && measurement.reported.total_cost_usd.scope === 'unverified-resume'
    ))).toBe(true)
    const implementations = evidence.modelCalls.filter((call) => call.role !== 'plan')
    expect(implementations.map((call) => call.conversation)).toEqual([
      evidence.admission.conversation,
      evidence.admission.conversation,
      evidence.admission.conversation,
    ])
    expect(implementations.map((call) => call.paths)).toEqual(evidence.dispatches.map((dispatch) => dispatch.paths))
    expect(implementations.map((call) => call.sha256)).toEqual(evidence.dispatches.map((dispatch) => (
      dispatch.sha256.map((hash, index) => dispatch.paths[index].includes('*') ? null : hash)
    )))
    for (let index = 0; index < implementations.length; index += 1) {
      const call = implementations[index]
      const dispatch = evidence.dispatches[index]
      const listed = `Read the listed files.\n${dispatch.paths.join('\n')}\n`
      expect(call.prompt).toBe(dispatch.response.kind === 'file'
        ? `${listed}Complete this role. Write your answer to the path on the last line of this file. Do not run CT commands or dispatch another agent.\n${dispatch.response.path}`
        : `${listed}Complete this role. Return the CLI response. Do not run CT commands or dispatch another agent.`)
      expect(call.argv.slice(-(dispatch.argv.length + 1), -1)).toEqual(dispatch.argv)
    }
    expect(evidence.dispatches[0].paths).toEqual(expect.arrayContaining(
      RoleBytes.filesOf(STEPS.IMPLEMENT).map((path) => expect.stringContaining(path)),
    ))
    expect(evidence.dispatches[0].argv).toContain(JSON.stringify(REPORT_SCHEMA))
    expect(evidence.dispatches[1].paths).toEqual(expect.arrayContaining(
      RoleBytes.filesOf(STEPS.JUDGE).map((path) => expect.stringContaining(path)),
    ))
    expect(evidence.dispatches[1].argv).not.toContain(JSON.stringify(VERDICT_SCHEMA))
    expect(evidence.dispatches[1].argv).not.toContain('--json-schema')
    expect(evidence.dispatches[2].paths).toEqual(expect.arrayContaining(
      RoleBytes.filesOf(STEPS.SLICE_JUDGE).map((path) => expect.stringContaining(path)),
    ))
    expect(evidence.dispatches[2].argv).not.toContain(JSON.stringify(SLICE_VERDICT_SCHEMA))
    expect(evidence.dispatches[2].argv).not.toContain('--json-schema')
    expect(evidence.attemptSteps).toEqual(evidence.consumingSteps)
    expect(evidence.pullRequestRefusals).toHaveLength(3)
    expect(evidence.pullRequestRefusals.every((stderr) => stderr.includes('unlisted gh request'))).toBe(true)
    expect(evidence.delivered).toContain('run delivered:')
    expect(evidence.publication).toContain(`Source: ${RunDriverMother.PLAN}`)
    const owned = fixture.holdOwnedProcess()
    await fixture.dispose()
    expect(fixture.disposedWith(owned)).toBe(true)
  }, 120_000)
})
