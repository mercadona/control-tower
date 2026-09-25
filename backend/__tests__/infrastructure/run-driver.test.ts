import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { CallDescriptor } from '../../src/infrastructure/claude-calls.ts'
import { DiskAgentMeasurements } from '../../src/infrastructure/disk-agent-measurements.ts'
import { CompletedRunDelivery } from '../run-delivery-double.ts'
import { InProcessRun } from './fixtures/in-process-run.ts'

class Briefing {
  static forInProcessRun(checkout: string): PlanBriefing {
    return new PlanBriefing({
      story: null,
      issue: new PlanIssue({
        number: InProcessRun.ISSUE,
        url: `https://github.com/${InProcessRun.REPOSITORY}/issues/${InProcessRun.ISSUE}`,
      }),
      located: new WorkspaceLocation({ root: checkout, path: checkout, branch: 'feat/7' }),
      repository: new RepositoryName(InProcessRun.REPOSITORY),
    })
  }
}

class AwaitedDelivery extends CompletedRunDelivery {
  readonly settled: Promise<void>
  readonly #resolve: () => void

  constructor() {
    super()
    let resolve!: () => void
    this.settled = new Promise((released) => { resolve = released })
    this.#resolve = resolve
  }

  override async deliver(watch: PlanWatch): Promise<void> {
    await super.deliver(watch)
    this.#resolve()
  }
}

describe('a new admission drives the finite CT machine in process', () => {
  const runs: InProcessRun[] = []

  afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.remove()))
  })

  it('a new admission reaches machine delivery with one conversation', async () => {
    const delivery = new AwaitedDelivery()
    const run = await InProcessRun.create([
      'implement', 'controls', 'judge', 'commit', 'reconcile-clean', 'global', 'slice-judge', 'delivered',
    ], delivery)
    runs.push(run)

    const conversation = await run.agents().launch(Briefing.forInProcessRun(run.checkout))
    await delivery.settled

    expect(new Set(run.claude.asked.map((request) => request.conversation))).toEqual(new Set([conversation]))
    expect(run.claude.asked.map((request) => request.role)).toEqual(['plan', 'implement', 'ct-judge', 'ct-slice-judge'])
    expect(run.published.map((watch) => watch.agent)).toEqual([conversation])

    const callsRoot = join(run.state, 'harness', conversation, 'calls')
    const callIds = await readdir(callsRoot)
    const descriptors = await Promise.all(callIds.map(async (callId) => (
      CallDescriptor.from(await readFile(join(callsRoot, callId, CallDescriptor.FILE), 'utf8'))
    )))
    const measurements = await Promise.all(callIds.map(async (callId) => (
      JSON.parse(await readFile(join(callsRoot, callId, DiskAgentMeasurements.FILE), 'utf8')) as { execution: { kind: string } }
    )))

    expect(descriptors).toHaveLength(4)
    const runRequests = descriptors.filter((descriptor) => descriptor.purpose !== 'plan')
    expect(runRequests).toHaveLength(3)
    expect(runRequests.every((descriptor) => descriptor.requestId !== null && descriptor.requestId.startsWith('run:'))).toBe(true)
    expect(measurements).toHaveLength(descriptors.length)
    expect(measurements.every((measurement) => measurement.execution.kind === 'success')).toBe(true)
  })
})
