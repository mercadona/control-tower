import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Deferred, PlanWatchMother, ReviewWatchFixture } from '../fixtures/parallel-workflows.ts'
import type { ChangeAsked } from '../../src/domain/value-objects/change-asked.ts'

describe('Replacing a review watcher', () => {
  let fixture: ReviewWatchFixture
  let pending: Deferred<{ changes: ChangeAsked[] }>

  beforeEach(() => {
    fixture = new ReviewWatchFixture()
    pending = new Deferred<{ changes: ChangeAsked[] }>()
    fixture.asked.mockReturnValueOnce(pending.promise)
  })

  afterEach(async () => {
    pending.resolve({ changes: [] })
    await fixture.stop()
  })

  it.each([false, true])('ignores a late old read after replacement with an explicit stop of %s', async (stopFirst) => {
    const old = PlanWatchMother.of()
    const replacement = PlanWatchMother.of('owner/alpha', 7, 'workspace:99')
    fixture.start(old)
    await fixture.tick(0)
    if (stopFirst) fixture.watch.stop({ issue: old.issue.number, repository: old.repository })
    fixture.start(replacement)

    pending.resolve({ changes: [ReviewWatchFixture.CHANGE] })
    await ReviewWatchFixture.settle()

    expect(fixture.review).not.toHaveBeenCalled()
    await fixture.tick(1)
    expect(fixture.review).toHaveBeenCalledExactlyOnceWith({
      agent: replacement.agent, issue: 7, repository: replacement.repository, changes: ReviewWatchFixture.CHANGE.text,
    })
  })

  it('does not let an obsolete loop failure stop the replacement', async () => {
    fixture.start(PlanWatchMother.of())
    await fixture.tick(0)
    const replacement = PlanWatchMother.of('owner/alpha', 7, 'workspace:99')
    fixture.start(replacement)

    pending.reject(new TypeError('old session read failed'))
    await ReviewWatchFixture.settle()
    await fixture.tick(1)

    expect(fixture.review).toHaveBeenCalledExactlyOnceWith({
      agent: replacement.agent, issue: 7, repository: replacement.repository, changes: ReviewWatchFixture.CHANGE.text,
    })
  })

  it('ends an obsolete recovered baseline without scheduling another read', async () => {
    fixture.start(PlanWatchMother.of(), true)
    fixture.start(PlanWatchMother.of('owner/alpha', 7, 'workspace:99'))

    pending.resolve({ changes: [] })
    await ReviewWatchFixture.settle()

    expect(fixture.ticks).toHaveLength(1)
  })
})
