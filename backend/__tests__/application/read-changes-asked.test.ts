import { describe, it, expect } from 'vitest'
import {
  ReadChangesAsked, ReadChangesAskedParams,
} from '../../src/application/queries/read-changes-asked.ts'
import { PlanIssues } from '../../src/domain/ports/plan-issues.ts'
import type { ChangeAsked } from '../../src/domain/value-objects/change-asked.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class PlanIssuesDouble extends PlanIssues {
  readonly answer: ChangeAsked[]
  readonly asked: { issue: PlanIssue, repository: RepositoryName }[]

  constructor(answer: ChangeAsked[] = []) {
    super()
    this.answer = answer
    this.asked = []
  }

  async changesAsked(subject: { issue: PlanIssue, repository: RepositoryName }): Promise<ChangeAsked[]> {
    this.asked.push(subject)
    return this.answer
  }
}

describe('ReadChangesAsked', () => {
  const issue = new PlanIssue({ number: 42, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/42' })
  const repository = new RepositoryName('josemerca/ct-loop-sandbox')
  const asking = (planIssues: PlanIssues) => new ReadChangesAsked({ planIssues })
    .execute(new ReadChangesAskedParams({ issue, repository }))

  it('what_it_hands_back_is_every_change_asked_for_in_the_order_the_issue_holds_them', async () => {
    const wanted = [
      {
        id: 'IC_kwDOT9lB5c8AAAABRB_tVQ',
        text: 'añade el caso de la issue sin descripción',
        askedAt: '2026-09-09T09:00:00Z',
      },
      {
        id: 'IC_kwDOT9lB5c8AAAABRCF0FA',
        text: 'y parte la tarea 3 en dos',
        askedAt: '2026-09-09T10:00:00Z',
      },
    ]

    const read = await asking(new PlanIssuesDouble(wanted))

    expect(read.changes).toEqual(wanted)
  })

  it('the_port_is_asked_about_the_issue_and_the_repository_it_was_given', async () => {
    const issues = new PlanIssuesDouble()

    await asking(issues)

    expect(issues.asked).toEqual([{ issue, repository }])
  })

  it('an_issue_with_nothing_asked_of_it_answers_an_empty_list_and_not_a_null', async () => {
    const read = await asking(new PlanIssuesDouble([]))

    expect(read.changes).toEqual([])
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanIssues().changesAsked({ issue, repository }))
      .rejects.toThrow(/must implement changesAsked/)
  })
})
