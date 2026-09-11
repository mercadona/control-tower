import { describe, it, expect } from 'vitest'
import { PlanRequestOutcome, PlanCollapse } from '../../src/infrastructure/start-plan-route.ts'
import { ImplementRequestOutcome, ImplementCollapse } from '../../src/infrastructure/implement-plan-route.ts'
import { EventsRequestOutcome, PlanEvents } from '../../src/infrastructure/plan-events-route.ts'
import { ActivePlansOutcome } from '../../src/infrastructure/active-plans-route.ts'
import { ProgressRequestOutcome, ProgressCollapse } from '../../src/infrastructure/implement-progress-route.ts'
import { ReviewRequestOutcome, ReviewCollapse } from '../../src/infrastructure/review-plan-route.ts'

class RequestVocabularies {
  static readonly #ACCEPTED = 'accepted'

  static codes(): string[] {
    return [
      ...Object.values(PlanRequestOutcome),
      ...Object.values(ImplementRequestOutcome),
      ...Object.values(EventsRequestOutcome),
      ...Object.values(ProgressRequestOutcome),
      ...Object.values(ReviewRequestOutcome),
    ].filter((outcome) => outcome !== RequestVocabularies.#ACCEPTED)
  }
}

class SharedOnPurposeAcrossRequestVocabularies {
  static readonly CODES: readonly string[] = Object.freeze([
    PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT,
    PlanRequestOutcome.UNKNOWN_FIELD,
    PlanRequestOutcome.MALFORMED_REPO,
    ImplementRequestOutcome.MALFORMED_ISSUE,
    ImplementRequestOutcome.NO_LIVE_SESSION,
    ImplementRequestOutcome.UNCERTAIN_PHASE,
  ])
}

class Repeats {
  static within(codes: readonly string[]): string[] {
    const seen = new Map<string, number>()
    for (const code of codes) seen.set(code, (seen.get(code) ?? 0) + 1)
    return [...seen.entries()].filter(([, count]) => count > 1).map(([code]) => code)
  }
}

class CodesRememberedByHandFromHttpAndApiServer {
  static readonly VALUES: readonly string[] = Object.freeze([
    'not-found', 'method-not-allowed', 'foreign-origin', 'unsupported-media-type', 'body-too-large', 'request-failed',
    ActivePlansOutcome.RECOVERY_INCONCLUSIVE,
  ])
}

describe('the codes the api can emit', () => {
  it('a_code_repeated_across_request_vocabularies_is_a_finding_unless_it_is_declared_shared_on_purpose', () => {
    const repeated = Repeats.within(RequestVocabularies.codes())

    expect(repeated.sort()).toEqual([...SharedOnPurposeAcrossRequestVocabularies.CODES].sort())
  })

  it('every_code_the_api_emits_is_distinct_though_some_are_remembered_by_hand_and_not_watched_for_a_rename', () => {
    const codes = [
      ...new Set(RequestVocabularies.codes()),
      ...PlanCollapse.declaredCodes(),
      ...ImplementCollapse.declaredCodes(),
      ...ProgressCollapse.declaredCodes(),
      ReviewCollapse.CODE,
      ...CodesRememberedByHandFromHttpAndApiServer.VALUES,
      ...PlanEvents.declaredCodes(),
    ]

    expect(new Set(codes).size).toBe(codes.length)
  })
})
