import { describe, it, expect } from 'vitest'
import { ReadPlanningActivity, ReadPlanningActivityParams } from '../../src/application/queries/read-planning-activity.ts'
import { PlanningActivities } from '../../src/domain/ports/planning-activity.ts'
import { PlanningActivity, PlanningActivityState } from '../../src/domain/value-objects/planning-activity.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'

class PlanningActivitiesDouble extends PlanningActivities {
  readonly answer: PlanningActivity
  readonly asked: PlanWatch[] = []

  constructor(answer: PlanningActivity) {
    super()
    this.answer = answer
  }

  override async of(watch: PlanWatch): Promise<PlanningActivity> {
    this.asked.push(watch)
    return this.answer
  }
}

describe('ReadPlanningActivity', () => {
  const watch = new PlanWatch({
    story: null,
    issue: new PlanIssue({ number: 500, url: 'https://github.com/mercadona/control-tower-plugin/issues/500' }),
    located: new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/500', branch: 'feat/500' }),
    repository: new RepositoryName('mercadona/control-tower-plugin'),
    agent: '11111111-1111-4111-8111-111111111111',
  })

  it('what_the_port_answers_is_what_the_caller_gets_without_being_reinterpreted', async () => {
    const activity = new PlanningActivity({
      state: PlanningActivityState.RUNNING, runningMs: 1_000, toolCalls: 3, lastToolCall: null, lastText: null,
    })
    const activities = new PlanningActivitiesDouble(activity)

    const read = await new ReadPlanningActivity({ planningActivities: activities })
      .execute(new ReadPlanningActivityParams({ watch }))

    expect(read.activity).toBe(activity)
  })

  it('the_port_is_asked_about_the_watch_it_was_given', async () => {
    const activity = new PlanningActivity({
      state: PlanningActivityState.FINISHED, runningMs: 60_000, toolCalls: 0, lastToolCall: null, lastText: null,
    })
    const activities = new PlanningActivitiesDouble(activity)

    await new ReadPlanningActivity({ planningActivities: activities })
      .execute(new ReadPlanningActivityParams({ watch }))

    expect(activities.asked).toEqual([watch])
  })

})
