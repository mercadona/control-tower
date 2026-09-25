import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanRecoveryConflict } from '../../src/domain/exceptions.ts'
import type { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { CompletedRunDelivery, RefusedRunDelivery } from '../run-delivery-double.ts'
import { InProcessRun, type ScriptedStep } from './fixtures/in-process-run.ts'

class StateFiles {
  static async bytesOf(root: string): Promise<Record<string, string>> {
    const snapshot: Record<string, string> = {}
    for (const file of await StateFiles.#filesUnder(root)) {
      snapshot[relative(root, file).split(sep).join('/')] = await readFile(file, 'utf8')
    }
    return snapshot
  }

  static async #filesUnder(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    const nested = await Promise.all(entries.map(async (entry) => {
      const full = join(directory, entry.name)
      return entry.isDirectory() ? StateFiles.#filesUnder(full) : [full]
    }))
    return nested.flat()
  }
}

class RecoveryDiagnostic {
  static readonly #CALL_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

  static anonymized(text: string): string {
    return text.replace(RecoveryDiagnostic.#CALL_ID, '<call>')
  }
}

const DELIVERED_STEPS: readonly ScriptedStep[] = [
  'implement', 'controls', 'judge', 'commit', 'reconcile-clean', 'global', 'slice-judge', 'delivered',
]

describe('a restart over the same state', () => {
  const runs: InProcessRun[] = []

  afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.remove()))
  })

  it('a restart over the same state gives back the dispatched plan as uncertain and launches nothing', async () => {
    const run = await InProcessRun.create([])
    runs.push(run)
    const watch = await run.admitted()
    await run.recorded({
      watch,
      purpose: 'plan',
      requestId: null,
      argv: ['--session-id', watch.agent],
      execution: null,
      startedAt: new Date().toISOString(),
    })
    const before = await StateFiles.bytesOf(run.state)

    const { recovery, activePlans } = run.recovery()
    expect(await recovery.recover()).toBeNull()

    const [uncertain] = activePlans.known()
    const diagnostic = uncertain.diagnostic
    if (diagnostic === undefined) throw new Error('the recovered plan carries no diagnostic')
    expect(uncertain).toMatchObject({
      phase: 'uncertain',
      recovery: { action: 'inspect', detail: diagnostic },
    })
    expect(RecoveryDiagnostic.anonymized(diagnostic)).toBe(
      'incomplete call <call> is not owned by this API process; '
      + 'plan call <call> is incomplete within its recorded deadline',
    )
    expect(run.workers.launches).toBe(0)
    expect(run.workers.kills).toBe(0)
    expect(await StateFiles.bytesOf(run.state)).toEqual(before)

    await run.settled()
    expect(run.warnings).toEqual([])
  })

  it('a recovery pressed after a restart is refused as often as it is pressed, naming the ownership the restart took away', async () => {
    const run = await InProcessRun.create([])
    runs.push(run)
    const watch = await run.admitted()
    await run.recorded({
      watch,
      purpose: 'plan',
      requestId: null,
      argv: ['--session-id', watch.agent],
      execution: null,
      startedAt: new Date().toISOString(),
    })
    const located = { agent: watch.agent, issue: watch.issue.number, repository: watch.repository }

    const firstPress = await run.agents().recover(located).catch((cause: unknown) => cause)
    const secondPress = await run.agents().recover(located).catch((cause: unknown) => cause)

    for (const press of [firstPress, secondPress]) {
      expect(press).toBeInstanceOf(PlanRecoveryConflict)
      expect((press as Error).message.endsWith('; the planner is not owned by this API process')).toBe(true)
    }
    expect(run.workers.launches).toBe(0)

    const { recovery, activePlans } = run.recovery()
    expect(await recovery.recover()).toBeNull()
    expect(activePlans.known()).toEqual([expect.objectContaining({ phase: 'uncertain' })])

    await run.settled()
    expect(run.warnings).toEqual([])
  })

  it('a read of a publication neither waits for it nor starts it', async () => {
    const delivery = new CompletedRunDelivery()
    delivery.inspection = { kind: 'publishing', pullRequest: null, diagnostic: null }
    Object.assign(delivery, {
      deliver: async (watch: PlanWatch): Promise<void> => {
        delivery.delivered.push(watch)
        return new Promise<void>(() => {})
      },
    })
    const run = await InProcessRun.create(DELIVERED_STEPS, delivery)
    runs.push(run)
    await run.journaled(DELIVERED_STEPS)

    const { recovery, activePlans } = run.recovery()
    expect(await recovery.inspect()).toBeNull()

    expect(delivery.delivered).toEqual([])
    expect(activePlans.known()).toEqual([expect.objectContaining({ phase: 'implementing' })])

    await run.settled()
    expect(run.warnings).toEqual([])
  })

  it('the recovery clock hands a refused publication to a person instead of another start on the next tick', async () => {
    const delivery = new RefusedRunDelivery()
    const run = await InProcessRun.create(DELIVERED_STEPS, delivery)
    runs.push(run)
    const watch = await run.journaled(DELIVERED_STEPS)

    const { recovery, activePlans } = run.recovery()
    expect(await recovery.recover()).toBeNull()
    await run.settled()
    expect(await recovery.recover()).toBeNull()

    expect(delivery.asked).toEqual([watch])
    const [uncertain] = activePlans.known()
    expect(uncertain).toMatchObject({
      phase: 'uncertain',
      diagnostic: RefusedRunDelivery.REFUSAL,
      recovery: { action: 'continue', detail: RefusedRunDelivery.REFUSAL },
    })

    await run.settled()
    expect(run.warnings).toEqual([])
  })
})
