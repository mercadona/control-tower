import { describe, it, expect } from 'vitest'
import {
  PlanRequest, PlanRequestOutcome, PlanRefusal, PlanCollapse,
} from '../../src/infrastructure/start-plan-route.ts'
import { SliceMessageCollapse } from '../../src/infrastructure/slice-message-route.ts'
import { AnotherRoundCollapse } from '../../src/infrastructure/another-round-route.ts'
import { Refusal } from '../../src/infrastructure/http.ts'
import * as exceptions from '../../src/domain/exceptions.ts'

describe('PlanRefusal', () => {
  it('every_refusable_outcome_has_an_answer_so_adding_one_cannot_reach_the_client_as_a_crash', () => {
    const refusable = Object.values(PlanRequestOutcome).filter(
      (outcome) => outcome !== PlanRequestOutcome.ACCEPTED
    )

    expect(PlanRefusal.declaredOutcomes().sort()).toEqual(refusable.sort())
  })

  it('an_outcome_with_no_answer_raises_instead_of_being_served_as_a_blank_refusal', () => {
    expect(() => PlanRefusal.of({ outcome: 'invented' })).toThrow(/no refusal declared/)
  })

  it('the_rejected_field_names_reach_the_answer_instead_of_a_generic_sentence', () => {
    const refusal = PlanRefusal.of(PlanRequest.withUnknownFields(['b', 'a']))

    expect(refusal).toBeInstanceOf(Refusal)
    expect(refusal.status).toBe(400)
    expect(refusal.code).toBe(PlanRequestOutcome.UNKNOWN_FIELD)
    expect(refusal.detail).toBe('unknown field: b, a')
  })
})

describe('PlanCollapse', () => {
  const FAMILIES = [
    'PlanFailure', 'UserStoryFailure', 'PlanIssueFailure', 'PlanAgentFailure', 'WorkspaceFailure',
    'PlanProgressFailure', 'PlanningActivityFailure', 'PlanStatusFailure', 'HarvestFailure',
    'ImplementationProgressFailure', 'ImplementationHistoryFailure', 'PullRequestFailure', 'WorkbenchFailure',
    'ConversationFailure', 'SessionHooksFailure', 'SpecFreezeFailure', 'EpicGroomFailure',
    'EpicIssuesFailure', 'DispatchFailure', 'PlanRecoveryFailure', 'PlanCleanupFailure', 'SessionClosureFailure',
    'RunFailure', 'EscalationFailure', 'WorkProgressFailure',
  ]

  const RAISED_ONLY_BY_THE_DISPATCH_RELAY_OR_STARTUP_RECOVERY = [
    'PlanIssueNotClaimed', 'DispatchNotAvailable', 'DispatchWaitsBehind', 'DispatchNotRead', 'DispatchNotUnderstood',
    'PlanAgentNeverLaunched', 'PlanAgentNotLaunched', 'PlanAgentNotNamed',
    'WorkspaceNotPrepared', 'WorkspaceNotCleaned', 'ConversationNotUnderstood',
  ]

  const ANSWERED_BY_THE_SLICE_MESSAGE_ROUTE = SliceMessageCollapse.declaredFailures()
  const ANSWERED_BY_THE_ANOTHER_ROUND_ROUTE = AnotherRoundCollapse.declaredFailures()

  const startingAPlan = ([name, thrown]: [string, { prototype: object }]) =>
    thrown.prototype instanceof exceptions.PlanFailure &&
    !FAMILIES.includes(name) &&
    !RAISED_ONLY_BY_THE_DISPATCH_RELAY_OR_STARTUP_RECOVERY.includes(name) &&
    !ANSWERED_BY_THE_SLICE_MESSAGE_ROUTE.includes(name) &&
    !ANSWERED_BY_THE_ANOTHER_ROUND_ROUTE.includes(name) &&
    !(thrown.prototype instanceof exceptions.PlanProgressFailure) &&
    !(thrown.prototype instanceof exceptions.PlanningActivityFailure) &&
    !(thrown.prototype instanceof exceptions.WorkProgressFailure) &&
    !(thrown.prototype instanceof exceptions.PlanStatusFailure) &&
    !(thrown.prototype instanceof exceptions.HarvestFailure) &&
    !(thrown.prototype instanceof exceptions.ImplementationProgressFailure) &&
    !(thrown.prototype instanceof exceptions.ImplementationHistoryFailure) &&
    !(thrown.prototype instanceof exceptions.WorkbenchFailure) &&
    !(thrown.prototype instanceof exceptions.PlanRecoveryFailure) &&
    !(thrown.prototype instanceof exceptions.PlanCleanupFailure) &&
    !(thrown.prototype instanceof exceptions.SessionClosureFailure) &&
    !(thrown.prototype instanceof exceptions.RunFailure) &&
    !(thrown.prototype instanceof exceptions.EscalationFailure)

  it('every_way_the_plan_can_collapse_has_a_refusal_declared_so_adding_one_cannot_reach_the_client_as_a_crash', () => {
    const ways = Object.entries(exceptions).filter(startingAPlan).map(([name]) => name)

    expect(PlanCollapse.declaredFailures().sort()).toEqual(ways.sort())
  })

  it('every_way_the_plan_can_collapse_has_a_code_distinct_from_every_other_one', () => {
    const codes = PlanCollapse.declaredCodes()

    expect(new Set(codes).size).toBe(codes.length)
  })

  it('a_failure_of_reading_the_status_of_an_issue_has_no_refusal_declared_here_because_it_only_reaches_stderr', () => {
    expect(PlanCollapse.declaredFailures()).not.toContain('PlanStatusNotRead')
    expect(PlanCollapse.declaredFailures()).not.toContain('PlanStatusNotUnderstood')
    expect(() => PlanCollapse.of(new exceptions.PlanStatusNotRead('gh: not authenticated')))
      .toThrow(/no refusal declared/)
  })

  it('a_failure_only_the_dispatch_relay_or_startup_recovery_raises_has_no_refusal_declared_here_because_neither_answers_a_request', () => {
    for (const name of RAISED_ONLY_BY_THE_DISPATCH_RELAY_OR_STARTUP_RECOVERY) {
      expect(PlanCollapse.declaredFailures()).not.toContain(name)
    }
    expect(() => PlanCollapse.of(new exceptions.DispatchNotAvailable('no issue is eligible')))
      .toThrow(/no refusal declared/)
  })

  it('a_failure_of_watching_a_plan_has_no_refusal_declared_here_because_it_travels_down_the_stream_that_is_already_open', () => {
    expect(PlanCollapse.declaredFailures()).not.toContain('PlanProgressNotRead')
    expect(() => PlanCollapse.of(new exceptions.PlanProgressNotRead('git refused')))
      .toThrow(/no refusal declared/)
  })

  it('a_failure_of_harvesting_has_no_refusal_declared_here_because_the_sweep_answers_no_request', () => {
    expect(PlanCollapse.declaredFailures()).not.toContain('HarvestNotRead')
    expect(PlanCollapse.declaredFailures()).not.toContain('HarvestNotUnderstood')
    expect(() => PlanCollapse.of(new exceptions.HarvestNotRead('gh refused')))
      .toThrow(/no refusal declared/)
  })

  it('a_failure_of_reopening_has_no_refusal_declared_here_because_the_watcher_reads_it_from_the_error_log_not_from_a_request', () => {
    expect(PlanCollapse.declaredFailures()).not.toContain('SliceNotReopened')
    expect(PlanCollapse.declaredFailures()).not.toContain('ReopenNotUnderstood')
    expect(() => PlanCollapse.of(new exceptions.SliceNotReopened('dispatch-check refused')))
      .toThrow(/no refusal declared/)
  })

  it('every_way_the_plan_can_collapse_answers_400_because_the_code_carries_the_distinction_now', () => {
    const causes = [
      new exceptions.UserStoryNotRead('acli is not authenticated'),
      new exceptions.WorkspaceNotRead('no such remote'),
      new exceptions.CheckoutNotConfirmed('owner/name: /repo holds someone/else'),
      new exceptions.UserStoryNotUnderstood('nope'),
      new exceptions.WorkspaceNotUnderstood('nope'),
    ]

    expect(causes.map((cause) => PlanCollapse.of(cause).status)).toEqual(Array(causes.length).fill(400))
  })

  it('a_tool_that_refused_the_call_names_the_specific_way_it_refused_and_keeps_what_it_said', () => {
    const collapse = PlanCollapse.of(new exceptions.UserStoryNotRead('acli is not authenticated'))

    expect(collapse).toBeInstanceOf(Refusal)
    expect(collapse.code).toBe('user-story-not-read')
    expect(collapse.detail).toBe('acli is not authenticated')
  })

  it('a_checkout_that_does_not_hold_the_repository_asked_for_names_the_field_to_fix_and_keeps_what_git_said', () => {
    const collapse = PlanCollapse.of(new exceptions.CheckoutNotConfirmed('owner/name: /repo holds someone/else'))

    expect(collapse).toBeInstanceOf(Refusal)
    expect(collapse.code).toBe('checkout-not-confirmed')
    expect(collapse.detail).toBe('path must be a git checkout of owner/name: /repo holds someone/else')
  })

  it('a_tool_that_answered_something_we_cannot_read_has_its_own_code_too', () => {
    expect(PlanCollapse.of(new exceptions.UserStoryNotUnderstood('nope')).code).toBe('user-story-not-understood')
    expect(PlanCollapse.of(new exceptions.WorkspaceNotUnderstood('nope')).code).toBe('workspace-not-understood')
  })

  it('a_family_is_not_a_way_of_collapsing_so_answering_one_raises_instead_of_guessing', () => {
    expect(() => PlanCollapse.of(new exceptions.PlanFailure('nope'))).toThrow(/no refusal declared/)
  })

  it('internal run failures do not hide public refusal gaps', () => {
    class RunPublicProbe extends exceptions.PlanFailure {}
    const runTypes = [
      exceptions.RunFailure,
      exceptions.RunNotAdvanced,
      exceptions.RunNotUnderstood,
    ]
    const runFailures = runTypes.map((RunType) => new RunType(`internal ${RunType.name}`))

    expect(FAMILIES).toContain('RunFailure')
    expect(runFailures.map((failure) => failure.constructor.name)).toEqual([
      'RunFailure', 'RunNotAdvanced', 'RunNotUnderstood',
    ])
    expect(runTypes.every((RunType) => !startingAPlan([RunType.name, RunType]))).toBe(true)
    expect(PlanCollapse.declaredFailures()).not.toContain('RunFailure')
    expect(PlanCollapse.declaredFailures()).not.toContain('RunNotAdvanced')
    expect(PlanCollapse.declaredFailures()).not.toContain('RunNotUnderstood')
    for (const failure of runFailures) {
      expect(() => PlanCollapse.of(failure)).toThrow(/no refusal declared/)
    }

    expect(startingAPlan(['RunPublicProbe', RunPublicProbe])).toBe(true)
    expect(() => PlanCollapse.of(new RunPublicProbe('public probe'))).toThrow(/no refusal declared/)
  })

  it('an unknown launch subtype has no inherited refusal', () => {
    class UnknownLaunchFailure extends exceptions.PlanAgentNotLaunched {}

    expect(() => PlanCollapse.of(new UnknownLaunchFailure('unknown'))).toThrow(/no refusal declared/)
  })
})
