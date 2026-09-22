import { RunNotUnderstood } from '../domain/exceptions.ts'
import {
  ANNOUNCEMENT_KINDS, ANNOUNCEMENT_VERSION, CONSUMING_VERB_OF_STEP, DECLARED_INPUT_ROLES_OF_STEP,
  INPUT_KINDS, MANDATORY_INPUT_ROLES_OF_STEP, RESPONSE_KIND_OF_STEP,
} from '../../../plugin/scripts/step-announcement.js'
import { OUTCOMES, RUN_STATES } from '../../../plugin/scripts/run-machine.js'
import type { RunClosure } from '../domain/value-objects/run-instruction.ts'

export type { RunClosure }

export const RESPONSE_KIND_BY_STEP: Readonly<Record<string, string>> = RESPONSE_KIND_OF_STEP

export const CONSUMING_VERB_BY_STEP: Readonly<Record<string, string>> = CONSUMING_VERB_OF_STEP

export type AnnouncedInput = {
  readonly role: string,
  readonly kind: 'literal' | 'glob',
  readonly path: string,
}

type AnnouncementKind = 'step' | 'transition' | 'refusal'

export class RunAnnouncement {
  static readonly #KINDS: readonly string[] = Object.values(ANNOUNCEMENT_KINDS)
  static readonly #STATES: readonly string[] = Object.values(RUN_STATES)
  static readonly #OUTCOMES: readonly string[] = Object.values(OUTCOMES)

  readonly kind: AnnouncementKind
  readonly step: string
  readonly closure: RunClosure | null
  readonly diagnostic: string

  private constructor(asked: {
    kind: AnnouncementKind,
    step: string,
    closure: RunClosure | null,
    diagnostic: string,
  }) {
    this.kind = asked.kind
    this.step = asked.step
    this.closure = asked.closure
    this.diagnostic = asked.diagnostic
    Object.freeze(this)
  }

  static of(stdout: string): RunAnnouncement | null {
    if (!stdout.trimStart().startsWith('{')) return null
    const record = RunAnnouncement.#record(stdout)
    const kind = RunAnnouncement.#kindOf(record)
    const step = RunAnnouncement.#stepOf(record)
    const closure = kind === ANNOUNCEMENT_KINDS.STEP ? null : RunAnnouncement.#closureOf(record, kind)
    return new RunAnnouncement({
      kind,
      step,
      closure,
      diagnostic: RunAnnouncement.#diagnosticOf(kind, step, closure, record),
    })
  }

  static #record(stdout: string): Record<string, unknown> {
    let parsed: unknown
    try {
      parsed = JSON.parse(stdout)
    } catch (cause) {
      throw new RunNotUnderstood(`the announcement is not valid JSON: ${String(cause)}`)
    }
    if (!RunAnnouncement.#isRecord(parsed)) {
      throw new RunNotUnderstood(`the announcement is not a JSON object: ${stdout}`)
    }
    if (parsed.version !== ANNOUNCEMENT_VERSION) {
      throw new RunNotUnderstood(`the announcement version is not understood: ${stdout}`)
    }
    return parsed
  }

  static #kindOf(record: Record<string, unknown>): AnnouncementKind {
    const kind = record.kind
    if (!RunAnnouncement.#isKind(kind)) {
      throw new RunNotUnderstood(`the announcement kind is not declared: ${JSON.stringify(record)}`)
    }
    return kind
  }

  static #stepOf(record: Record<string, unknown>): string {
    const run = record.run
    const step = RunAnnouncement.#isRecord(run) ? run.step : undefined
    if (typeof step !== 'string' || step.length === 0) {
      throw new RunNotUnderstood(`the announcement names no step in ${JSON.stringify(record)}`)
    }
    return step
  }

  static #closureOf(record: Record<string, unknown>, kind: 'transition' | 'refusal'): RunClosure {
    const state = record.state
    if (typeof state !== 'string' || !RunAnnouncement.#STATES.includes(state)) {
      throw new RunNotUnderstood(`the announcement state is not declared: ${JSON.stringify(record)}`)
    }
    const outcome = record.outcome
    if (typeof outcome !== 'string' || !RunAnnouncement.#OUTCOMES.includes(outcome)) {
      throw new RunNotUnderstood(`the announcement outcome is not declared: ${JSON.stringify(record)}`)
    }
    const exit = record.exit
    if (!Number.isInteger(exit)) {
      throw new RunNotUnderstood(`the announcement exit code is not an integer: ${JSON.stringify(record)}`)
    }
    if (kind === ANNOUNCEMENT_KINDS.REFUSAL) {
      const detail = record.detail
      if (typeof detail !== 'string' || detail.length === 0) {
        throw new RunNotUnderstood(`the refusal has no detail: ${JSON.stringify(record)}`)
      }
    }
    return Object.freeze({
      state,
      outcome,
      exit: exit as number,
      task: RunAnnouncement.#taskOf(record),
      findings: RunAnnouncement.#textOr(record.findings),
      verdict: RunAnnouncement.#textOr(record.verdict),
    })
  }

  static #diagnosticOf(
    kind: AnnouncementKind,
    step: string,
    closure: RunClosure | null,
    record: Record<string, unknown>,
  ): string {
    if (closure === null || kind !== ANNOUNCEMENT_KINDS.REFUSAL) {
      return `ct-step announced a "${kind}" at step "${step}"`
    }
    return `ct-step refused: the run is ${closure.state} with outcome ${closure.outcome} `
      + `(exit ${closure.exit}) — ${String(record.detail)}`
  }

  static #isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  // A field that is absent, empty or not text is NOTHING, and never a reason to
  // refuse the announcement: the plugin lives in a cached copy outside this
  // repository, so a machine that has not pulled it sends refusals without
  // these keys. Rejecting those would turn an upgrade into an outage.
  static #textOr(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  // `run.task` has always been in the announcement. It is lifted onto the
  // closure because that is where the message that names it is composed from,
  // and RunMachine exposes no way to ask which task a run is on.
  static #taskOf(record: Record<string, unknown>): number | null {
    const run = record.run
    const task = RunAnnouncement.#isRecord(run) ? run.task : undefined
    return Number.isInteger(task) ? task as number : null
  }

  static #isKind(value: unknown): value is AnnouncementKind {
    return typeof value === 'string' && RunAnnouncement.#KINDS.includes(value)
  }
}

export class AnnouncedStep {
  static readonly #INPUT_KINDS: readonly string[] = Object.values(INPUT_KINDS)
  static readonly #MANDATORY_ROLES: Readonly<Record<string, readonly string[]>> = MANDATORY_INPUT_ROLES_OF_STEP
  static readonly #DECLARED_ROLES: Readonly<Record<string, readonly string[]>> = DECLARED_INPUT_ROLES_OF_STEP

  readonly step: string
  readonly commands: readonly string[] | null
  readonly argv: readonly string[]
  readonly inputs: readonly AnnouncedInput[]
  readonly responseKind: string | null
  readonly responsePath: string | null

  private constructor(asked: {
    step: string,
    commands: readonly string[] | null,
    argv: readonly string[],
    inputs: readonly AnnouncedInput[],
    responseKind: string | null,
    responsePath: string | null,
  }) {
    this.step = asked.step
    this.commands = asked.commands
    this.argv = asked.argv
    this.inputs = asked.inputs
    this.responseKind = asked.responseKind
    this.responsePath = asked.responsePath
    Object.freeze(this)
  }

  static read(stdout: string): AnnouncedStep | null {
    let value: unknown
    try {
      value = JSON.parse(stdout)
    } catch {
      return null
    }
    const announcement = AnnouncedStep.#object(value)
    if (announcement === undefined
      || announcement.version !== ANNOUNCEMENT_VERSION
      || announcement.kind !== ANNOUNCEMENT_KINDS.STEP) {
      return null
    }
    const step = AnnouncedStep.#object(announcement.run)?.step
    if (typeof step !== 'string') return null
    const consuming = AnnouncedStep.#object(announcement.consuming)
    if (AnnouncedStep.#malformed(announcement.commands) || AnnouncedStep.#malformed(consuming?.argv)) return null
    const commands = AnnouncedStep.#stringArray(announcement.commands)
    const argv = AnnouncedStep.#stringArray(consuming?.argv) ?? Object.freeze([])
    const dispatch = AnnouncedStep.#object(announcement.dispatch)
    const inputs = dispatch === undefined
      ? Object.freeze([])
      : AnnouncedStep.#inputs(dispatch.inputs, step)
    if (inputs === null) return null
    const response = AnnouncedStep.#object(dispatch?.response)
    return new AnnouncedStep({
      step,
      commands,
      argv,
      inputs,
      responseKind: typeof response?.kind === 'string' ? response.kind : null,
      responsePath: typeof response?.path === 'string' ? response.path : null,
    })
  }

  static #inputs(declared: unknown, step: string): readonly AnnouncedInput[] | null {
    const candidates: readonly unknown[] = Array.isArray(declared) ? declared : []
    const inputs: AnnouncedInput[] = []
    for (const candidate of candidates) {
      const input = AnnouncedStep.#input(candidate)
      if (input === null) return null
      inputs.push(input)
    }
    if (!AnnouncedStep.#carriesEveryMandatoryRole(inputs, step)) return null
    if (!AnnouncedStep.#carriesOnlyDeclaredRoles(inputs, step)) return null
    if (!AnnouncedStep.#namesEachRoleOnce(inputs)) return null
    return Object.freeze(inputs)
  }

  static #carriesEveryMandatoryRole(inputs: readonly AnnouncedInput[], step: string): boolean {
    const announced = new Set(inputs.map((input) => input.role))
    const mandatory = AnnouncedStep.#MANDATORY_ROLES[step] ?? []
    return mandatory.every((role) => announced.has(role))
  }

  static #carriesOnlyDeclaredRoles(inputs: readonly AnnouncedInput[], step: string): boolean {
    const declared = AnnouncedStep.#DECLARED_ROLES[step] ?? []
    return inputs.every((input) => declared.includes(input.role))
  }

  static #namesEachRoleOnce(inputs: readonly AnnouncedInput[]): boolean {
    return new Set(inputs.map((input) => input.role)).size === inputs.length
  }

  static #input(candidate: unknown): AnnouncedInput | null {
    const declared = AnnouncedStep.#object(candidate)
    const role = declared?.role
    const kind = declared?.kind
    const path = declared?.path
    if (typeof role !== 'string' || typeof path !== 'string' || !AnnouncedStep.#isInputKind(kind)) return null
    return Object.freeze({ role, kind, path })
  }

  static #isInputKind(value: unknown): value is AnnouncedInput['kind'] {
    return typeof value === 'string' && AnnouncedStep.#INPUT_KINDS.includes(value)
  }

  static #object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  }

  static #malformed(value: unknown): boolean {
    return value !== undefined && !AnnouncedStep.#isStringArray(value)
  }

  static #stringArray(value: unknown): readonly string[] | null {
    return AnnouncedStep.#isStringArray(value) ? Object.freeze([...value]) : null
  }

  static #isStringArray(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every((element) => typeof element === 'string')
  }
}
