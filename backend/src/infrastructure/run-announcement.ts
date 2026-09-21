import { RunNotUnderstood } from '../domain/exceptions.ts'
import { ANNOUNCEMENT_KINDS, ANNOUNCEMENT_VERSION } from '../../../plugin/scripts/step-announcement.js'
import { OUTCOMES, RUN_STATES, STEPS } from '../../../plugin/scripts/run-machine.js'

export type RunClosure = {
  readonly state: string,
  readonly outcome: string,
  readonly exit: number,
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
      throw new RunNotUnderstood(`the announcement names no step: ${JSON.stringify(record)}`)
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
    return Object.freeze({ state, outcome, exit: exit as number })
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

  static #isKind(value: unknown): value is AnnouncementKind {
    return typeof value === 'string' && RunAnnouncement.#KINDS.includes(value)
  }
}

export class StepProse {
  static readonly #PREFIX = 'step: '
  static readonly #CUT = ' ('
  static readonly #STEPS: readonly string[] = Object.values(STEPS)

  static step(stdout: string): string | null {
    const line = stdout.split('\n').find((candidate) => candidate.startsWith(StepProse.#PREFIX))
    if (line === undefined) return null
    const cut = line.indexOf(StepProse.#CUT)
    const name = cut === -1 ? line.slice(StepProse.#PREFIX.length) : line.slice(StepProse.#PREFIX.length, cut)
    return StepProse.#STEPS.includes(name) ? name : null
  }
}
