import { describe, it, expect } from 'vitest'

import {
  RESPONSE_KINDS,
  RESPONSE_KIND_OF_STEP,
  INPUT_KINDS,
  AnnouncedResponse,
  AnnouncedInput,
  MalformedAnnouncement,
} from '../scripts/step-announcement.js'
import { RoleBytes } from '../scripts/role-bytes.js'
import { STEPS } from '../scripts/run-machine.js'

describe('the response channel each dispatch step answers through', () => {
  it('every dispatch step declares the channel its role answers through', () => {
    expect(Object.keys(RESPONSE_KIND_OF_STEP).sort()).toEqual([...RoleBytes.STEPS].sort())
    expect(RESPONSE_KIND_OF_STEP[STEPS.IMPLEMENT]).toBe(RESPONSE_KINDS.STRUCTURED)
    expect(RESPONSE_KIND_OF_STEP[STEPS.JUDGE]).toBe(RESPONSE_KINDS.FILE)
    expect(RESPONSE_KIND_OF_STEP[STEPS.ADVISE]).toBe(RESPONSE_KINDS.STRUCTURED)
    expect(RESPONSE_KIND_OF_STEP[STEPS.SLICE_JUDGE]).toBe(RESPONSE_KINDS.FILE)
    expect(RESPONSE_KIND_OF_STEP[STEPS.RECONCILE]).toBe(RESPONSE_KINDS.EDITS)
  })

  it('a step with no declared channel is malformed', () => {
    expect(() => AnnouncedResponse.of(STEPS.CONTROLS, 'some/path')).toThrow(MalformedAnnouncement)
  })

  it('a file response without a path is malformed', () => {
    expect(() => AnnouncedResponse.of(STEPS.JUDGE, '')).toThrow(MalformedAnnouncement)
  })

  it('an edits response with a path is malformed', () => {
    expect(() => AnnouncedResponse.of(STEPS.RECONCILE, 'some/path')).toThrow(MalformedAnnouncement)
  })

  it('an input with an undeclared role is malformed', () => {
    expect(() => new AnnouncedInput({ role: 'undeclared-role', kind: INPUT_KINDS.LITERAL, path: 'some/path' }))
      .toThrow(MalformedAnnouncement)
  })
})
