import { PlanWatch } from '../src/domain/value-objects/plan-watch.ts'
import { PlanIssue } from '../src/domain/value-objects/plan-issue.ts'
import { RepositoryName } from '../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../src/domain/value-objects/workspace-location.ts'
import { PlanningActivity, PlanningToolCall } from '../src/domain/value-objects/planning-activity.ts'
import { ImplementationState } from '../src/domain/value-objects/implementation-state.ts'
import type { DeliveredPullRequest } from '../src/domain/value-objects/run-delivery.ts'

export class WorkProgressMother {
  static watch(repository = 'owner/name'): PlanWatch {
    return new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: 7, url: `https://github.com/${repository}/issues/7` }),
      repository: new RepositoryName(repository),
      agent: 'conversation-7',
      located: new WorkspaceLocation({ root: '/recorded/checkout', path: '/recorded/checkout/.worktrees/7', branch: 'feat/7' }),
    })
  }

  static activity(): PlanningActivity {
    return new PlanningActivity({
      state: 'running', runningMs: 3000, toolCalls: 2,
      lastToolCall: new PlanningToolCall({ name: 'Read', argument: 'src/main.ts' }), lastText: 'Reading conventions',
    })
  }

  static execution(): ImplementationState {
    return ImplementationState.of({ step: 'implement', task: 1, totalTasks: 3, name: 'Keep progress visible', attempt: 1, discards: 0 })
  }

  static readonly HARVESTED_AT = '2026-09-24T09:30:00.000Z'

  static pullRequest(): DeliveredPullRequest {
    return { number: 998, url: 'https://github.com/owner/name/pull/998' }
  }
}
