import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DriveRun, DriveRunParams } from '../../src/application/actions/drive-run.ts'
import { ExecuteRunInstruction } from '../../src/application/actions/execute-run-instruction.ts'
import { RecoverPlan, RecoverPlanParams } from '../../src/application/actions/recover-plan.ts'
import { PlanAgents } from '../../src/domain/ports/plan-agents.ts'
import { RunCalls } from '../../src/domain/ports/run-calls.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import type { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import type { RunInstruction } from '../../src/domain/value-objects/run-instruction.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { RunPlanAgents, SilentChangeAnnouncements } from '../../src/infrastructure/run-plan-agents.ts'
import { InProcessRun } from './fixtures/in-process-run.ts'

describe('run recovery in process', () => {
  const runs: InProcessRun[] = []

  afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.remove()))
  })

  it('established recovery consumes rewritten citations and dirty scope amendments once', async () => {
    const outcomes: Array<{ kind: string, publications: number, launches: number, consumptions: number }> = []
    for (const kind of ['rewritten-citation', 'dirty-scope-amendment'] as const) {
      const run = await InProcessRun.create(['implement', 'judge'])
      runs.push(run)
      const initial = run.agents()
      const watch = await initial.records.prepare(new PlanBriefing({
        story: null,
        issue: new PlanIssue({
          number: InProcessRun.ISSUE,
          url: `https://github.com/${InProcessRun.REPOSITORY}/issues/${InProcessRun.ISSUE}`,
        }),
        located: new WorkspaceLocation({ root: run.checkout, path: run.checkout, branch: 'feat/7' }),
        repository: new RepositoryName(InProcessRun.REPOSITORY),
      }))
      await initial.journal.admit(watch)
      const planner = await initial.calls.start(watch, 'plan', null)
      await initial.calls.wait(planner)

      let completedTicket: string | null = null
      const cutCalls = new class extends RunCalls {
        override async perform(cutWatch: PlanWatch, instruction: RunInstruction): Promise<void> {
          await initial.driver.step.calls.perform(cutWatch, instruction)
          if (instruction.work.kind === 'call') completedTicket = instruction.work.ticket
          throw new Error('labelled fixture cut after completed role')
        }
      }()
      const establishing = new DriveRun({
        calls: initial.calls,
        publication: initial.driver.publication,
        machine: initial.machine,
        delivery: initial.delivery,
        step: new ExecuteRunInstruction({ machine: initial.machine, calls: cutCalls }),
        messages: initial.driver.messages,
        escalations: initial.driver.escalations,
      })
      await establishing.execute(new DriveRunParams({ watch, planner })).catch((cause: unknown) => {
        if (!(cause instanceof Error) || cause.message !== 'labelled fixture cut after completed role') throw cause
      })
      if (completedTicket === null) throw new Error('recovery cut did not complete a role')

      const callsDirectory = join(run.state, 'harness', watch.agent, 'calls')
      const launchesBeforeRecovery = (await readdir(callsDirectory)).length

      if (kind === 'rewritten-citation') {
        await writeFile(join(run.checkout, 'AGENTS.md'), '# Rewritten cited source span\n')
      } else {
        const planPath = join(run.checkout, InProcessRun.PLAN)
        const plan = await readFile(planPath, 'utf8')
        await writeFile(planPath, plan.replace(
          '**Files:** `work.txt` (modify).',
          '**Files:** `work.txt` (modify), `AGENTS.md` (modify).',
        ))
      }

      const publicationsBefore = run.published.length
      const rebuilt = run.agents()
      let release!: () => void
      let cancel!: (cause: Error) => void
      const nextRoleGate = new Promise<void>((resolve, reject) => { release = resolve; cancel = reject })
      const recoveryCalls = new class extends RunCalls {
        override async perform(recoveryWatch: PlanWatch, instruction: RunInstruction): Promise<void> {
          if (instruction.work.kind !== 'call' || instruction.work.ticket !== completedTicket) {
            release()
            throw new Error('labelled fixture cut before the next role')
          }
          await rebuilt.driver.step.calls.perform(recoveryWatch, instruction)
        }
      }()
      const driver = new DriveRun({
        calls: rebuilt.calls,
        publication: rebuilt.driver.publication,
        machine: rebuilt.machine,
        delivery: rebuilt.delivery,
        step: new ExecuteRunInstruction({ machine: rebuilt.machine, calls: recoveryCalls }),
        messages: rebuilt.driver.messages,
        escalations: rebuilt.driver.escalations,
      })
      const agents = new RunPlanAgents({
        legacy: new PlanAgents(),
        records: rebuilt.records,
        calls: rebuilt.calls,
        transport: rebuilt.transport,
        driver,
        machine: rebuilt.machine,
        journal: rebuilt.journal,
        delivery: rebuilt.delivery,
        announcements: new SilentChangeAnnouncements(),
        newId: rebuilt.newId,
        nowMs: rebuilt.nowMs,
        stderr: (line) => cancel(new Error(line.trim())),
      })
      const recover = new RecoverPlan({ agents })
      const params = new RecoverPlanParams({ agent: watch.agent, issue: watch.issue.number, repository: watch.repository })
      await recover.execute(params)
      await recover.execute(params)
      await nextRoleGate

      const entries = await rebuilt.journal.entries(watch)
      const consumptions = entries.filter((entry) => {
        const request = JSON.parse(entry.request) as { argv: string[] }
        return request.argv[1] === 'report'
      }).length
      const launchesAfterRecovery = (await readdir(callsDirectory)).length
      outcomes.push({
        kind,
        publications: run.published.length - publicationsBefore,
        launches: launchesAfterRecovery - launchesBeforeRecovery,
        consumptions,
      })
    }

    expect(outcomes).toEqual([
      expect.objectContaining({ kind: 'rewritten-citation', publications: 0, launches: 0, consumptions: 1 }),
      expect.objectContaining({ kind: 'dirty-scope-amendment', publications: 0, launches: 0, consumptions: 1 }),
    ])
  })

  it('a later fix result overrides delivered journal evidence after restart', async () => {
    const steps = [
      'implement', 'controls', 'judge', 'commit', 'reconcile-clean', 'global', 'slice-judge', 'delivered',
    ] as const

    const failedRun = await InProcessRun.create([])
    runs.push(failedRun)
    const failedWatch = await failedRun.journaled(steps)
    await failedRun.recorded({
      watch: failedWatch,
      execution: { kind: 'error', diagnostic: 'synthetic fix failed after delivery' },
    })
    const failed = failedRun.recovery()
    expect(await failed.recovery.recover()).toBeNull()
    const failedProjected = failed.activePlans.known()[0]
    expect(failedProjected.phase).toBe('uncertain')
    expect(failedProjected.diagnostic).toBe('synthetic fix failed after delivery')
    expect(failedProjected.recovery).toEqual({ action: 'inspect', detail: 'synthetic fix failed after delivery' })
    expect(failed.reviews.started).toBe(0)
    expect(failedRun.workers.launches).toBe(0)
    expect(failedRun.oracle.asked).toEqual([])

    const successfulRun = await InProcessRun.create([])
    runs.push(successfulRun)
    const successfulWatch = await successfulRun.journaled(steps)
    await successfulRun.recorded({ watch: successfulWatch, execution: { kind: 'success' } })
    const successful = successfulRun.recovery()
    expect(await successful.recovery.recover()).toBeNull()
    const successfulProjected = successful.activePlans.known()[0]
    expect(successfulProjected.phase).toBe('implementing')
    expect(successful.reviews.started).toBeGreaterThan(0)
    expect(successfulRun.workers.launches).toBe(0)
    expect(successfulRun.oracle.asked).toEqual([])
  })
})
