export class PlanFailure extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = new.target.name
  }
}

export class UserStoryFailure extends PlanFailure {}

export class UserStoryNotRead extends UserStoryFailure {}

export class UserStoryNotUnderstood extends UserStoryFailure {}

export class PlanIssueFailure extends PlanFailure {}

export class PlanIssueNotCreated extends PlanIssueFailure {}

export class PlanIssueNotNamed extends PlanIssueFailure {}

export class PlanIssueNotClaimed extends PlanIssueFailure {}

export class PlanStoryFailure extends PlanFailure {}

export class PlanStoryNotRead extends PlanStoryFailure {}

export class PlanStoryNotUnderstood extends PlanStoryFailure {}

export class PlanGoNotAnswered extends PlanIssueFailure {}

export class PlanAgentFailure extends PlanFailure {}

export class PlanAgentNotLaunched extends PlanAgentFailure {}

export class PlanAgentNotNamed extends PlanAgentFailure {}

export class PlanAgentNotResumed extends PlanAgentFailure {}

export class WorkspaceFailure extends PlanFailure {}

export class WorkspaceNotPrepared extends WorkspaceFailure {}

export class WorkspaceNotRead extends WorkspaceFailure {}

export class WorkspaceNotUnderstood extends WorkspaceFailure {}

export class CheckoutNotConfirmed extends WorkspaceFailure {}

export class PlanProgressFailure extends PlanFailure {}

export class PlanProgressNotRead extends PlanProgressFailure {}

export class ImplementationProgressFailure extends PlanFailure {}

export class ImplementationProgressNotRead extends ImplementationProgressFailure {}

export class ImplementationHistoryFailure extends PlanFailure {}

export class ImplementationHistoryNotRead extends ImplementationHistoryFailure {}

export class PlanStatusFailure extends PlanFailure {}

export class PlanStatusNotRead extends PlanStatusFailure {}

export class PlanStatusNotUnderstood extends PlanStatusFailure {}

export class GoFailure extends PlanFailure {}

export class GoNotRecorded extends GoFailure {}

export class HarvestFailure extends PlanFailure {}

export class HarvestNotRead extends HarvestFailure {}

export class HarvestNotUnderstood extends HarvestFailure {}

export class PullRequestFailure extends PlanFailure {}

export class PullRequestNotRead extends PullRequestFailure {}

export class PullRequestNotUnderstood extends PullRequestFailure {}

export class WorkbenchFailure extends PlanFailure {}

export class SliceNotReopened extends WorkbenchFailure {}

export class ReopenNotUnderstood extends WorkbenchFailure {}
