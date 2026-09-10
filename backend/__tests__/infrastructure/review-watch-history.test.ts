import { describe, expect, it, vi } from 'vitest'
import { ReviewWatch } from '../../src/infrastructure/review-watch.js'
import { ReadFixesAsked, ReadFixesAskedParams } from '../../src/application/queries/read-fixes-asked.ts'
import { PlanIssues } from '../../src/domain/ports/plan-issues.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import { ChangeAsked } from '../../src/domain/value-objects/change-asked.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'
import type { PlanIssueStatusValue } from '../../src/domain/value-objects/plan-issue-status.ts'
import type { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { Deferred, PlanWatchMother, ReviewWatchFixture } from '../fixtures/parallel-workflows.ts'

class ReviewIssues extends PlanIssues {
  status: PlanIssueStatusValue = PlanIssueStatus.IN_PROGRESS

  override async statusOf(): Promise<PlanIssueStatusValue> {
    return this.status
  }
}

class ReviewRequests extends PullRequests {
  readonly changes = [new ChangeAsked({ id: 'old-review', text: 'Already requested correction' })]

  override async openOf() {
    return { number: 57, url: 'https://github.com/owner/alpha/pull/57' }
  }

  override async fixesAsked(): Promise<ChangeAsked[]> {
    return [...this.changes]
  }
}

class FixingRecovery {
  readonly issues = new ReviewIssues()
  readonly requests = new ReviewRequests()
  readonly query = new ReadFixesAsked({ planIssues: this.issues, pullRequests: this.requests })
  readonly ticks: Deferred<void>[] = []
  readonly delivered = vi.fn()
  readonly subject = PlanWatchMother.of()
  readonly watcher = new ReviewWatch({
    asked: (watch: PlanWatch) => this.query.execute(new ReadFixesAskedParams(watch)),
    baseline: (watch: PlanWatch) => this.query.execute(new ReadFixesAskedParams({ ...watch, includeHistory: true })),
    review: this.delivered,
    sleep: () => {
      const tick = new Deferred<void>()
      this.ticks.push(tick)
      return tick.promise
    },
    stderr: vi.fn(), label: 'recovering pull request reviews',
  })

  async tick(index: number): Promise<void> {
    this.ticks[index]!.resolve()
    await ReviewWatchFixture.settle()
  }

  stop(): void {
    this.watcher.stop({ issue: this.subject.issue.number, repository: this.subject.repository })
    for (const tick of this.ticks) tick.resolve()
  }
}

describe('Recovering reviews while a correction is underway', () => {
  it('does not replay the old review when the corrected issue returns to review', async () => {
    const fixture = new FixingRecovery()
    const running = fixture.watcher.startRecovered(fixture.subject)
    try {
      await ReviewWatchFixture.settle()
      fixture.issues.status = PlanIssueStatus.IN_REVIEW
      await fixture.tick(0)

      expect(fixture.delivered).not.toHaveBeenCalled()

      fixture.requests.changes.push(new ChangeAsked({ id: 'new-review', text: 'A new correction' }))
      await fixture.tick(1)
      expect(fixture.delivered).toHaveBeenCalledExactlyOnceWith({
        agent: fixture.subject.agent, issue: fixture.subject.issue.number,
        repository: fixture.subject.repository, changes: 'A new correction',
      })
    } finally {
      fixture.stop()
      await running
    }
  })
})
