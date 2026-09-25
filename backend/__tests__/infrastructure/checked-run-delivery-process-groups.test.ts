import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import type { CheckedRunDelivery } from '../../src/infrastructure/checked-run-delivery.ts'
import { InProcessRun, type ScriptedStep } from './fixtures/in-process-run.ts'
import { LivingProcessGroups } from './fixtures/living-process-groups.ts'
import { Capture, ScriptedConversation } from './fixtures/scripted-conversation.ts'

const DELIVERED_STEPS: readonly ScriptedStep[] = [
  'implement', 'controls', 'judge', 'commit', 'reconcile-clean', 'global', 'slice-judge', 'delivered',
]

class LivePushScenario {
  static readonly SHA = 'c'.repeat(40)
  static readonly BRANCH = 'feat/7'
  static readonly PROCESS_GROUP = 4242
  static readonly #ATTEMPT = 'aaaaaaaa-0000-4000-8000-000000000001'

  static async arranged(alive: Iterable<number>): Promise<{
    run: InProcessRun, watch: PlanWatch, table: LivingProcessGroups, delivery: CheckedRunDelivery,
  }> {
    const run = await InProcessRun.create([])
    const watch = await run.journaled(DELIVERED_STEPS)
    await run.intended(watch, LivePushScenario.SHA)
    await LivePushScenario.#writePendingPush(run, watch)
    const table = new LivingProcessGroups(alive)
    const git = new ScriptedConversation().answering(
      { binary: 'git', argv: ['-C', run.checkout, 'ls-remote', '--heads', 'origin', `refs/heads/${LivePushScenario.BRANCH}`] },
      Capture.read('git', 'ls-remote-absent-branch'),
    )
    return { run, watch, table, delivery: run.checkedDelivery({ git, table }) }
  }

  static async #writePendingPush(run: InProcessRun, watch: PlanWatch): Promise<void> {
    const directory = join(run.state, 'harness', watch.agent, 'run', 'publication', 'push', LivePushScenario.#ATTEMPT)
    await mkdir(directory, { recursive: true })
    const argv = ['-C', run.checkout, 'push', 'origin', `${LivePushScenario.SHA}:refs/heads/${LivePushScenario.BRANCH}`]
    await writeFile(join(directory, 'request.json'), `${JSON.stringify({
      version: 1, attempt: 1, requestedAt: '2026-09-24T09:00:00.000Z', sha: LivePushScenario.SHA,
      branch: LivePushScenario.BRANCH, argv, cwd: run.checkout,
    })}\n`)
    await writeFile(join(directory, 'owner.json'), `${JSON.stringify({
      version: 2, attempt: 1, pid: LivePushScenario.PROCESS_GROUP, processGroup: LivePushScenario.PROCESS_GROUP,
      startedAt: '2026-09-24T09:00:01.000Z',
    })}\n`)
  }
}

describe('a living process group reads as publishing', () => {
  const runs: InProcessRun[] = []

  afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.remove()))
  })

  it('a living process group reads as publishing and never as uncertain', async () => {
    const { run, watch, delivery } = await LivePushScenario.arranged(
      [-LivePushScenario.PROCESS_GROUP, LivePushScenario.PROCESS_GROUP],
    )
    runs.push(run)

    expect(await delivery.inspect(watch)).toEqual({
      kind: 'publishing', pullRequest: null,
      diagnostic: `push process group ${LivePushScenario.PROCESS_GROUP} is still running`,
    })

    await run.settled()
    expect(run.warnings).toEqual([])
  })

  it('a dead leader with a living group still reads as publishing', async () => {
    const { run, watch, delivery } = await LivePushScenario.arranged([-LivePushScenario.PROCESS_GROUP])
    runs.push(run)

    expect(await delivery.inspect(watch)).toEqual({
      kind: 'publishing', pullRequest: null,
      diagnostic: `push process group ${LivePushScenario.PROCESS_GROUP} is still running`,
    })

    await run.settled()
    expect(run.warnings).toEqual([])
  })
})
