import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RequestFixes, RequestFixesParams } from '../../src/application/actions/request-fixes.ts'
import { PlanIssues } from '../../src/domain/ports/plan-issues.ts'
import { ReviewLog } from '../../src/domain/ports/review-log.ts'
import { Workbench } from '../../src/domain/ports/workbench.ts'
import { ChangeAsked } from '../../src/domain/value-objects/change-asked.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanIssueStatus, type PlanIssueStatusValue } from '../../src/domain/value-objects/plan-issue-status.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { ReviewWatch, type ChangesAsked } from '../../src/infrastructure/review-watch.ts'
import { InProcessRun } from './fixtures/in-process-run.ts'
import { ScriptedOracle } from './fixtures/scripted-oracle.ts'

class AnsweringPlanIssues extends PlanIssues {
  readonly asked: Array<{ issueNumber: number, repository: RepositoryName }> = []

  override async statusOf(subject: { issueNumber: number, repository: RepositoryName }): Promise<PlanIssueStatusValue> {
    this.asked.push(subject)
    return PlanIssueStatus.IN_REVIEW
  }
}

class RecordingWorkbench extends Workbench {
  readonly asked: Array<{ issueNumber: number, repository: RepositoryName }> = []

  override async reopen(subject: { issueNumber: number, repository: RepositoryName }): Promise<void> {
    this.asked.push(subject)
  }
}

class ReviewAskedOnceThenFrozen {
  static readonly REVIEW_ID = '701'
  static readonly CHANGES = 'Address the legacy conversation review.'
  #calls = 0

  async ask(): Promise<ChangesAsked> {
    this.#calls += 1
    if (this.#calls === 1) return { changes: [] }
    if (this.#calls === 2) {
      return {
        changes: [new ChangeAsked({
          id: ReviewAskedOnceThenFrozen.REVIEW_ID, text: ReviewAskedOnceThenFrozen.CHANGES, askedAt: null,
        })],
      }
    }
    return new Promise<ChangesAsked>(() => {})
  }
}

describe('run driver runtime in process', () => {
  const runs: InProcessRun[] = []

  afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.remove()))
  })

  it('legacy record recovery preserves original call argv and response identity', async () => {
    const run = await InProcessRun.create([])
    runs.push(run)
    const agents = run.agents()
    const watch = await agents.records.prepare(new PlanBriefing({
      story: null,
      issue: new PlanIssue({
        number: InProcessRun.ISSUE,
        url: `https://github.com/${InProcessRun.REPOSITORY}/issues/${InProcessRun.ISSUE}`,
      }),
      located: new WorkspaceLocation({ root: run.checkout, path: run.checkout, branch: 'feat/7' }),
      repository: new RepositoryName(InProcessRun.REPOSITORY),
    }))
    const planner = await run.recorded({
      watch, purpose: 'plan', requestId: null, argv: ['--session-id', watch.agent],
      execution: { kind: 'success' }, startedAt: '2026-09-17T10:00:00.000Z',
    })
    await run.recorded({
      watch, purpose: 'implementation', requestId: `implementation:${planner.id}`, argv: ['--resume', watch.agent],
      execution: null, startedAt: '2026-09-17T10:00:01.000Z',
    })
    const identityOf = async (): Promise<unknown[]> => Promise.all(
      (await agents.transport.history(watch.agent)).map(async (recorded) => ({
        purpose: recorded.purpose,
        argv: (await agents.transport.descriptorOf(recorded.call)).argv,
        completion: recorded.completion,
      })),
    )
    const before = await identityOf()

    const { recovery, activePlans } = run.recovery()
    expect(await recovery.recover()).toBeNull()
    const firstKnown = activePlans.known()
    expect(await recovery.recover()).toBeNull()
    const secondKnown = activePlans.known()

    expect(secondKnown).toEqual(firstKnown)
    expect(firstKnown).toEqual([expect.objectContaining({
      phase: 'uncertain',
      plan: expect.objectContaining({ agent: watch.agent }),
    })])
    expect(await identityOf()).toEqual(before)
    expect(run.workers.launches).toBe(0)
  })

  it('a new review request resumes the completed legacy conversation through the review watcher', async () => {
    const ISSUE = 41
    const run = await InProcessRun.create([])
    runs.push(run)
    const repository = new RepositoryName(InProcessRun.REPOSITORY)
    const agents = run.agents()
    const watch = await agents.records.prepare(new PlanBriefing({
      story: null,
      issue: new PlanIssue({ number: ISSUE, url: `https://github.com/${InProcessRun.REPOSITORY}/issues/${ISSUE}` }),
      located: new WorkspaceLocation({ root: run.checkout, path: run.checkout, branch: `feat/${ISSUE}` }),
      repository,
    }))
    const planner = await run.recorded({
      watch, purpose: 'plan', requestId: null, argv: ['--session-id', watch.agent],
      execution: { kind: 'success' }, startedAt: '2026-09-17T10:00:00.000Z',
    })
    await run.recorded({
      watch, purpose: 'implementation', requestId: `implementation:${planner.id}`, argv: ['--resume', watch.agent],
      execution: { kind: 'success' }, startedAt: '2026-09-17T10:00:01.000Z',
    })

    const workbench = new RecordingWorkbench()
    const planIssues = new AnsweringPlanIssues()
    const requestFixes = new RequestFixes({ workbench, planAgents: agents, planIssues })
    const answered = new ReviewAskedOnceThenFrozen()
    let releaseDelivered!: () => void
    const delivered = new Promise<void>((resolve) => { releaseDelivered = resolve })
    const reviews = new ReviewWatch({
      asked: () => answered.ask(),
      review: async (params) => {
        await requestFixes.execute(new RequestFixesParams(params))
        releaseDelivered()
      },
      sleep: () => Promise.resolve(),
      stderr: (line) => { throw new Error(line) },
      label: 'in-process review fixture',
      log: new ReviewLog(),
    })

    const { recovery } = run.recovery(reviews)
    expect(await recovery.recover()).toBeNull()
    await delivered
    await run.workers.settled()
    const fix = (await agents.transport.history(watch.agent)).find((recorded) => recorded.purpose === 'fix')
    if (fix === undefined) throw new Error('the review delivery did not start a fix call')
    await agents.transport.wait(fix.call)

    expect(workbench.asked).toEqual([{ issueNumber: ISSUE, repository }])
    expect(planIssues.asked).toEqual([{ issueNumber: ISSUE, repository }])
  })

  it('recovery keeps recorded driver ownership without another launch', async () => {
    const run = await InProcessRun.create([])
    runs.push(run)
    const watch = await run.journaled(['implement', 'controls', 'refused'])
    const agents = run.agents()
    const entries = await agents.journal.entries(watch)
    await run.recorded({
      watch, purpose: 'implementation', requestId: `run:${entries[0].ticket}`, argv: ['--resume', watch.agent],
      execution: { kind: 'success' },
    })

    const callsDirectory = join(run.state, 'harness', watch.agent, 'calls')
    const callsBefore = (await readdir(callsDirectory)).sort()
    const journalBefore = JSON.stringify(await agents.journal.entries(watch))

    const { recovery, activePlans, reviews } = run.recovery()
    expect(await recovery.recover()).toBeNull()

    const callsAfter = (await readdir(callsDirectory)).sort()
    const journalAfter = JSON.stringify(await agents.journal.entries(watch))

    expect(callsAfter).toEqual(callsBefore)
    expect(journalAfter).toBe(journalBefore)
    expect(reviews.started).toBe(0)
    expect(run.workers.launches).toBe(0)
    expect(run.oracle.asked).toEqual([])

    const [uncertain] = activePlans.known()
    expect(uncertain.diagnostic).toContain(ScriptedOracle.REFUSAL)
    expect(uncertain).toMatchObject({
      phase: 'uncertain',
      recovery: { action: 'inspect', detail: uncertain.diagnostic },
    })
  })
})
