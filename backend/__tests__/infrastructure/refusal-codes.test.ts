import { describe, it, expect } from 'vitest'
import { PlanRequestOutcome, PlanCollapse } from '../../src/infrastructure/start-plan-route.ts'
import { ImplementRequestOutcome, ImplementCollapse } from '../../src/infrastructure/implement-plan-route.ts'
import { EventsRequestOutcome, PlanEvents } from '../../src/infrastructure/plan-events-route.ts'
import { ActivePlansOutcome } from '../../src/infrastructure/active-plans-route.ts'
import { ProgressRequestOutcome, ProgressCollapse } from '../../src/infrastructure/implement-progress-route.ts'
import { HistoryRequestOutcome, HistoryCollapse } from '../../src/infrastructure/implement-history-route.ts'
import { ReviewRequestOutcome, ReviewCollapse } from '../../src/infrastructure/review-plan-route.ts'

class RequestVocabularies {
  static readonly #ACCEPTED = 'accepted'

  static codes(): string[] {
    return [
      ...Object.values(PlanRequestOutcome),
      ...Object.values(ImplementRequestOutcome),
      ...Object.values(EventsRequestOutcome),
      ...Object.values(ProgressRequestOutcome),
      ...Object.values(HistoryRequestOutcome),
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
    ProgressRequestOutcome.MALFORMED_ROOT,
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

class EveryCodeTheApiEmits {
  static readonly KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

  static values(): string[] {
    return [
      ...new Set(RequestVocabularies.codes()),
      ...PlanCollapse.declaredCodes(),
      ...ImplementCollapse.declaredCodes(),
      ...ProgressCollapse.declaredCodes(),
      ...HistoryCollapse.declaredCodes(),
      ReviewCollapse.CODE,
      ...CodesRememberedByHandFromHttpAndApiServer.VALUES,
      ...PlanEvents.declaredCodes(),
    ]
  }

  static shapeless(): string[] {
    return EveryCodeTheApiEmits.values().filter((code) => !EveryCodeTheApiEmits.KEBAB_CASE.test(code ?? ''))
  }
}

describe('the codes the api can emit', () => {
  it('a_code_repeated_across_request_vocabularies_is_a_finding_unless_it_is_declared_shared_on_purpose', () => {
    const repeated = Repeats.within(RequestVocabularies.codes())

    expect(repeated.sort()).toEqual([...SharedOnPurposeAcrossRequestVocabularies.CODES].sort())
  })

  it('every_code_the_api_emits_is_distinct_though_some_are_remembered_by_hand_and_not_watched_for_a_rename', () => {
    const codes = EveryCodeTheApiEmits.values()

    expect(new Set(codes).size).toBe(codes.length)
  })

  it('a_code_the_guard_remembers_by_hand_that_no_longer_exists_falls_here_instead_of_passing_as_a_lone_undefined', () => {
    expect(EveryCodeTheApiEmits.shapeless()).toEqual([])
  })
})
