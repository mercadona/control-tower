import { describe, expect, it } from 'vitest'
import { AuthorisedMilestones } from '../../src/domain/value-objects/authorised-milestones.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'

describe('AuthorisedMilestones', () => {
  it('a milestone is authorised once one of its open slices is ready, and is named once', () => {
    const authorised = AuthorisedMilestones.of([
      { milestone: 'The groom', status: PlanIssueStatus.READY },
      { milestone: 'The groom', status: PlanIssueStatus.READY },
      { milestone: 'The groom', status: PlanIssueStatus.IN_PROGRESS },
    ])

    expect(authorised.titles).toEqual(['The groom'])
  })

  it('a milestone whose slices are all in backlog or already under way is not authorised', () => {
    const authorised = AuthorisedMilestones.of([
      { milestone: 'Not groomed yet', status: PlanIssueStatus.BACKLOG },
      { milestone: 'Under way', status: PlanIssueStatus.IN_REVIEW },
    ])

    expect(authorised.titles).toEqual([])
  })

  it('a ready issue outside any milestone authorises nothing', () => {
    expect(AuthorisedMilestones.of([{ milestone: null, status: PlanIssueStatus.READY }]).titles).toEqual([])
  })

  it('several authorised milestones come back in the same order every sweep', () => {
    const authorised = AuthorisedMilestones.of([
      { milestone: 'The second epic', status: PlanIssueStatus.READY },
      { milestone: 'The first epic', status: PlanIssueStatus.READY },
    ])

    expect(authorised.titles).toEqual(['The first epic', 'The second epic'])
  })
})
