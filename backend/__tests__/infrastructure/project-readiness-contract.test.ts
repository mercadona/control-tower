import { describe, expect, expectTypeOf, it } from 'vitest'
import type { ReadinessId, ReadinessAction, ReadinessStatus } from '../../src/domain/value-objects/readiness-finding.ts'
import { CHECK_LABELS, NEXT_ACTIONS, STATUS_LABELS } from '../../../frontend/src/app/project-readiness/ProjectReadiness.types.ts'
import type { ReadinessStatus as FrontendReadinessStatus } from '../../../frontend/src/app/project-readiness/ProjectReadiness.types.ts'

describe('Project readiness vocabulary contract', () => {
  it('keeps_every_backend_identifier_and_action_named_in_the_frontend', () => {
    expectTypeOf<keyof typeof CHECK_LABELS>().toEqualTypeOf<ReadinessId>()
    expectTypeOf<keyof typeof NEXT_ACTIONS>().toEqualTypeOf<ReadinessAction>()
    expectTypeOf<FrontendReadinessStatus>().toEqualTypeOf<ReadinessStatus>()
    expect(Object.values(CHECK_LABELS).every((label) => label.trim().length > 0)).toBe(true)
    expect(Object.values(NEXT_ACTIONS).every((action) => action.trim().length > 0)).toBe(true)
    expect(Object.values(STATUS_LABELS).every((status) => status.trim().length > 0)).toBe(true)
  })
})
