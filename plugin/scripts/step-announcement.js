import { STEPS, RUN_STATES, OUTCOMES } from './run-machine.js'

export const ANNOUNCEMENT_VERSION = 1

export const ANNOUNCEMENT_KINDS = Object.freeze({
  STEP: 'step',
  TRANSITION: 'transition',
  REFUSAL: 'refusal',
})

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

export const CONSUMING_VERB_OF_STEP = Object.freeze({
  [STEPS.IMPLEMENT]: 'report', [STEPS.CONTROLS]: 'controls', [STEPS.JUDGE]: 'verdict',
  [STEPS.ADVISE]: 'advice', [STEPS.COMMIT]: 'commit', [STEPS.RECONCILE]: 'reconcile',
  [STEPS.GLOBAL]: 'global', [STEPS.SLICE_JUDGE]: 'slice-verdict', [STEPS.E2E]: 'e2e',
})

export const MANDATORY_INPUT_ROLES_OF_STEP = Object.freeze({
  [STEPS.IMPLEMENT]: Object.freeze([INPUT_ROLES.RUBRIC, INPUT_ROLES.BRIEF]),
  [STEPS.JUDGE]: Object.freeze([INPUT_ROLES.PACKAGE, INPUT_ROLES.BRIEF]),
  [STEPS.ADVISE]: Object.freeze([INPUT_ROLES.PACKAGE]),
  [STEPS.SLICE_JUDGE]: Object.freeze([INPUT_ROLES.PACKAGE, INPUT_ROLES.PLAN, INPUT_ROLES.VERDICTS]),
  [STEPS.RECONCILE]: Object.freeze([INPUT_ROLES.RECONCILIATION_PACKAGE]),
})

export const DECLARED_INPUT_ROLES_OF_STEP = Object.freeze({
  [STEPS.IMPLEMENT]: Object.freeze([INPUT_ROLES.RUBRIC, INPUT_ROLES.BRIEF]),
  [STEPS.JUDGE]: Object.freeze([INPUT_ROLES.PACKAGE, INPUT_ROLES.BRIEF, INPUT_ROLES.CONTROLS_LOG]),
  [STEPS.ADVISE]: Object.freeze([INPUT_ROLES.PACKAGE]),
  [STEPS.SLICE_JUDGE]: Object.freeze([
    INPUT_ROLES.PACKAGE, INPUT_ROLES.PLAN, INPUT_ROLES.GLOBAL_LOG, INPUT_ROLES.VERDICTS,
  ]),
  [STEPS.RECONCILE]: Object.freeze([INPUT_ROLES.RECONCILIATION_PACKAGE]),
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

export class StepAnnouncement {
  #announcement

  constructor(announcement) {
    this.#announcement = Object.freeze(announcement)
    Object.freeze(this)
  }

  static dispatch({ issue, task, tasksTotal, step, attempt, agent, inputs, response, consuming }) {
    StepAnnouncement.#requireDeclared(step, STEPS, 'step')
    StepAnnouncement.#requireResponse(response)
    const announcement = {
      version: ANNOUNCEMENT_VERSION,
      kind: ANNOUNCEMENT_KINDS.STEP,
      run: StepAnnouncement.#stepRun({ issue, task, tasksTotal, step, attempt }),
      dispatch: StepAnnouncement.#dispatchBody({ agent, inputs, response }),
    }
    StepAnnouncement.#withConsuming(announcement, consuming)
    return new StepAnnouncement(announcement)
  }

  static program({ issue, task, tasksTotal, step, attempt, commands, consuming }) {
    StepAnnouncement.#requireDeclared(step, STEPS, 'step')
    const announcement = {
      version: ANNOUNCEMENT_VERSION,
      kind: ANNOUNCEMENT_KINDS.STEP,
      run: StepAnnouncement.#stepRun({ issue, task, tasksTotal, step, attempt }),
      commands,
    }
    StepAnnouncement.#withConsuming(announcement, consuming)
    return new StepAnnouncement(announcement)
  }

  static transition({ issue, task, tasksTotal, step, discards, state, outcome, exit }) {
    StepAnnouncement.#requireDeclared(step, STEPS, 'step')
    StepAnnouncement.#requireDeclared(state, RUN_STATES, 'run state')
    StepAnnouncement.#requireDeclared(outcome, OUTCOMES, 'outcome')
    return new StepAnnouncement({
      version: ANNOUNCEMENT_VERSION,
      kind: ANNOUNCEMENT_KINDS.TRANSITION,
      state,
      outcome,
      exit,
      run: StepAnnouncement.#closureRun({ issue, task, tasksTotal, step, discards }),
    })
  }

  static refusal({ issue, task, tasksTotal, step, discards, state, outcome, exit, detail, findings, verdict }) {
    StepAnnouncement.#requireDeclared(step, STEPS, 'step')
    StepAnnouncement.#requireDeclared(state, RUN_STATES, 'run state')
    StepAnnouncement.#requireDeclared(outcome, OUTCOMES, 'outcome')
    if (typeof detail !== 'string' || detail === '') {
      throw new MalformedAnnouncement('a refusal needs a non-empty detail')
    }
    const announcement = {
      version: ANNOUNCEMENT_VERSION,
      kind: ANNOUNCEMENT_KINDS.REFUSAL,
      state,
      outcome,
      exit,
      run: StepAnnouncement.#closureRun({ issue, task, tasksTotal, step, discards }),
      detail,
    }
    if (typeof findings === 'string' && findings !== '') announcement.findings = findings
    if (typeof verdict === 'string' && verdict !== '') announcement.verdict = verdict
    return new StepAnnouncement(announcement)
  }

  text() {
    return `${JSON.stringify(this.#announcement)}\n`
  }

  static #requireDeclared(value, vocabulary, label) {
    if (!Object.values(vocabulary).includes(value)) {
      throw new MalformedAnnouncement(`"${value}" is not a declared ${label}`)
    }
  }

  static #requireResponse(response) {
    if (response === undefined) {
      throw new MalformedAnnouncement('a dispatch step needs a response')
    }
  }

  static #stepRun({ issue, task, tasksTotal, step, attempt }) {
    return { issue, task, tasksTotal, step, attempt }
  }

  static #closureRun({ issue, task, tasksTotal, step, discards }) {
    return { issue, task, tasksTotal, step, discards }
  }

  static #dispatchBody({ agent, inputs, response }) {
    const dispatch = {}
    if (agent !== undefined && agent !== null) dispatch.agent = agent
    if (Array.isArray(inputs) && inputs.length > 0) dispatch.inputs = inputs
    dispatch.response = response
    return dispatch
  }

  static #withConsuming(announcement, consuming) {
    if (consuming && Array.isArray(consuming.argv) && consuming.argv.length > 0) {
      announcement.consuming = { argv: [...consuming.argv] }
    }
  }
}
