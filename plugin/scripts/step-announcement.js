import { STEPS } from './run-machine.js'

export const ANNOUNCEMENT_VERSION = 1

export const RESPONSE_KINDS = Object.freeze({
  FILE: 'file',
  STRUCTURED: 'structured',
  EDITS: 'edits',
})

export const INPUT_KINDS = Object.freeze({
  LITERAL: 'literal',
  GLOB: 'glob',
})

export const INPUT_ROLES = Object.freeze({
  PACKAGE: 'package',
  BRIEF: 'brief',
  RUBRIC: 'rubric',
  PLAN: 'plan',
  CONTROLS_LOG: 'controls-log',
  GLOBAL_LOG: 'global-log',
  VERDICTS: 'verdicts',
  RECONCILIATION_PACKAGE: 'reconciliation-package',
})

export const RESPONSE_KIND_OF_STEP = Object.freeze({
  [STEPS.IMPLEMENT]: RESPONSE_KINDS.STRUCTURED,
  [STEPS.JUDGE]: RESPONSE_KINDS.FILE,
  [STEPS.ADVISE]: RESPONSE_KINDS.STRUCTURED,
  [STEPS.SLICE_JUDGE]: RESPONSE_KINDS.FILE,
  [STEPS.RECONCILE]: RESPONSE_KINDS.EDITS,
})

export class MalformedAnnouncement extends Error {
  constructor(detail) {
    super(`the announcement cannot be built: ${detail}`)
    this.detail = detail
  }
}

export class AnnouncedResponse {
  static of(step, path) {
    const kind = RESPONSE_KIND_OF_STEP[step]
    if (!kind) throw new MalformedAnnouncement(`the step "${step}" declares no response channel`)
    return new AnnouncedResponse({ kind, path })
  }

  constructor({ kind, path }) {
    switch (kind) {
      case RESPONSE_KINDS.FILE:
      case RESPONSE_KINDS.STRUCTURED:
        if (typeof path !== 'string' || path === '') {
          throw new MalformedAnnouncement(`a "${kind}" response needs a non-empty path`)
        }
        break
      case RESPONSE_KINDS.EDITS:
        if (path !== undefined && path !== null) {
          throw new MalformedAnnouncement('an "edits" response takes no path')
        }
        break
      default:
        throw new MalformedAnnouncement(`"${kind}" is not a declared response kind`)
    }
    this.kind = kind
    this.path = kind === RESPONSE_KINDS.EDITS ? null : path
    Object.freeze(this)
  }
}

export class AnnouncedInput {
  constructor({ role, kind, path }) {
    if (!Object.values(INPUT_ROLES).includes(role)) {
      throw new MalformedAnnouncement(`"${role}" is not a declared input role`)
    }
    if (!Object.values(INPUT_KINDS).includes(kind)) {
      throw new MalformedAnnouncement(`"${kind}" is not a declared input kind`)
    }
    if (typeof path !== 'string' || path === '') {
      throw new MalformedAnnouncement('an input needs a non-empty path')
    }
    this.role = role
    this.kind = kind
    this.path = path
    Object.freeze(this)
  }
}
