import { describe, it, expect } from 'vitest'
import { ReadPlanStory, ReadPlanStoryParams } from '../../src/application/queries/read-plan-story.js'
import { PlanIssues } from '../../src/domain/ports/plan-issues.js'
import { PlanStoryNotRead } from '../../src/domain/exceptions.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.ts'

class PlanIssuesDouble extends PlanIssues {
  constructor(answer = null) {
    super()
    this.answer = answer
    this.asked = []
  }

  async storyOf(subject) {
    this.asked.push(subject)
    if (this.answer instanceof Error) throw this.answer

    return this.answer
  }
}

describe('ReadPlanStory', () => {
  const repository = new RepositoryName('josemerca/ct-loop-sandbox')
  const asking = (planIssues) => new ReadPlanStory({ planIssues })
    .execute(new ReadPlanStoryParams({ issueNumber: 42, repository }))

  it('the_story_the_issue_names_is_what_it_hands_back', async () => {
    const read = await asking(new PlanIssuesDouble(new UserStoryKey('MO_SHOP-42')))

    expect(read.story.text).toBe('MO_SHOP-42')
  })

  it('a_plan_asked_for_by_hand_hands_back_no_story_instead_of_a_made_up_one', async () => {
    expect((await asking(new PlanIssuesDouble())).story).toBeNull()
  })

  it('the_port_is_asked_about_the_issue_and_the_repository_it_was_given', async () => {
    const issues = new PlanIssuesDouble()

    await asking(issues)

    expect(issues.asked).toEqual([{ issueNumber: 42, repository }])
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanIssues().storyOf({ issueNumber: 42, repository }))
      .rejects.toThrow(/must implement storyOf/)
  })

  it('a_port_that_refuses_travels_out_instead_of_being_turned_into_no_story', async () => {
    const refusing = new PlanIssuesDouble(new PlanStoryNotRead('gh: not authenticated'))

    await expect(asking(refusing)).rejects.toBeInstanceOf(PlanStoryNotRead)
  })
})
