import { describe, it, expect } from 'vitest'
import { AskPlanChanges, AskPlanChangesParams } from '../../src/application/actions/ask-plan-changes.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'

class PlanIssuesSpy {
  constructor() {
    this.asked = []
  }

  async askChanges({ issue, repository, changes }) {
    this.asked.push({ issue: issue.number, repository: repository.text, changes })
  }
}

const ISSUE = new PlanIssue({ number: 33, url: 'https://github.com/jjponz/repo-pulse/issues/33' })
const REPOSITORY = new RepositoryName('jjponz/repo-pulse')

describe('AskPlanChanges', () => {
  it('asks_the_issue_to_carry_the_changes_and_nothing_else', async () => {
    const planIssues = new PlanIssuesSpy()

    await new AskPlanChanges({ planIssues }).execute(
      new AskPlanChangesParams({ issue: ISSUE, repository: REPOSITORY, changes: 'parte la tarea 2' })
    )

    expect(planIssues.asked).toEqual([
      { issue: 33, repository: 'jjponz/repo-pulse', changes: 'parte la tarea 2' },
    ])
  })

  it('its_params_are_frozen_so_nobody_rewrites_what_was_asked_for_on_the_way', () => {
    const params = new AskPlanChangesParams({ issue: ISSUE, repository: REPOSITORY, changes: 'parte la tarea 2' })

    expect(Object.isFrozen(params)).toBe(true)
  })
})
