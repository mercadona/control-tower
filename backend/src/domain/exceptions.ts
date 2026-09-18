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

export class DispatchFailure extends PlanFailure {}

export class DispatchNotAvailable extends DispatchFailure {}

export class DispatchNotRead extends DispatchFailure {}

export class DispatchNotUnderstood extends DispatchFailure {}

export class PlanStoryFailure extends PlanFailure {}

export class PlanStoryNotRead extends PlanStoryFailure {}

export class PlanStoryNotUnderstood extends PlanStoryFailure {}

export class PlanGoNotAnswered extends PlanIssueFailure {}

export class PlanAgentFailure extends PlanFailure {}

export class PlanAgentNotLaunched extends PlanAgentFailure {}

export class PlanAgentNeverLaunched extends PlanAgentNotLaunched {
  readonly proof: import('./value-objects/plan-non-launch.ts').PlanNonLaunch

  constructor(proof: import('./value-objects/plan-non-launch.ts').PlanNonLaunch) {
    super(proof.diagnostic)
    this.proof = proof
  }
}

export class PlanAgentNotNamed extends PlanAgentFailure {}

export class PlanAgentNotResumed extends PlanAgentFailure {}

export class PlanRecoveryFailure extends PlanFailure {}

export class PlanRecoveryNotFound extends PlanRecoveryFailure {}

export class PlanRecoveryConflict extends PlanRecoveryFailure {}

export class PlanRecoveryNotRead extends PlanRecoveryFailure {}

export class PlanRecoveryNotUnderstood extends PlanRecoveryFailure {}

export class RunFailure extends PlanFailure {}

export class RunNotAdvanced extends RunFailure {}

export class RunNotUnderstood extends RunFailure {}

export class PlanCleanupFailure extends PlanFailure {}

export class PlanCleanupNotFound extends PlanCleanupFailure {}

export class PlanCleanupConflict extends PlanCleanupFailure {}

export class PlanCleanupNotRead extends PlanCleanupFailure {}

export class PlanCleanupNotUnderstood extends PlanCleanupFailure {}

export class WorkspaceFailure extends PlanFailure {}

export class WorkspaceNotPrepared extends WorkspaceFailure {}

export class WorkspaceNotCleaned extends WorkspaceNotPrepared {}

export class WorkspaceNotRead extends WorkspaceFailure {}

export class WorkspaceNotUnderstood extends WorkspaceFailure {}

export class CheckoutNotConfirmed extends WorkspaceFailure {}

export class CheckoutNotOnDefaultBranch extends WorkspaceFailure {}

export class CheckoutNotUpToDate extends WorkspaceFailure {}

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

export class ConversationFailure extends PlanFailure {}

export class ConversationNotStarted extends ConversationFailure {}

export class ConversationNotRecorded extends ConversationFailure {}

export class ConversationNotUnderstood extends ConversationFailure {}

export class SessionClosureFailure extends PlanFailure {}

export class SessionClosureNotRecorded extends SessionClosureFailure {}

export class SessionClosureNotUnderstood extends SessionClosureFailure {}

export class SessionTerminationUnconfirmed extends SessionClosureFailure {}

export class SessionNotTerminated extends SessionTerminationUnconfirmed {}

export class SessionOwnershipUnverifiable extends SessionNotTerminated {}

export class SessionTerminationPermissionDenied extends SessionNotTerminated {}

export class CoordinatingSessionTargetChanged extends SessionClosureFailure {}

export class SessionHooksFailure extends PlanFailure {}

export class SessionHooksNotWritten extends SessionHooksFailure {}

export class SessionHooksNotUnderstood extends SessionHooksFailure {}

export class SpecFreezeFailure extends PlanFailure {}

export class EpicSpecNotRead extends SpecFreezeFailure {}

export class EpicSpecNotUnderstood extends SpecFreezeFailure {}

export class EpicSpecNotWritten extends SpecFreezeFailure {}

export class EpicBranchNotPublished extends SpecFreezeFailure {}

export class EpicBranchNotUnderstood extends SpecFreezeFailure {}

export class EpicPullRequestNotOpened extends SpecFreezeFailure {}

export class PublishedSpecNotRead extends SpecFreezeFailure {}

export class PublishedSpecNotUnderstood extends SpecFreezeFailure {}

export class EpicGroomFailure extends PlanFailure {}

export class EpicNotGroomed extends EpicGroomFailure {}

export class GroomPlanNotUnderstood extends EpicGroomFailure {}

export class EpicIssuesFailure extends PlanFailure {}

export class EpicIssuesNotRead extends EpicIssuesFailure {}

export class EpicIssuesNotUnderstood extends EpicIssuesFailure {}

export class EpicIssueNotPromoted extends EpicIssuesFailure {}
