export const PreparationState = Object.freeze({
  COMPATIBLE: 'compatible',
  NOT_APPLICABLE: 'not-applicable',
  REQUIRED: 'required',
  NOT_CHECKED: 'not-checked',
} as const)

export type PreparationStateValue = typeof PreparationState[keyof typeof PreparationState]

export class PreparationFinding {
  readonly path: string
  readonly reason: string
  readonly correction: string

  constructor(asked: { path: string, reason: string, correction: string }) {
    this.path = asked.path
    this.reason = asked.reason
    this.correction = asked.correction
    Object.freeze(this)
  }
}

export class RepositoryPreparation {
  readonly revision: string | null
  readonly state: PreparationStateValue
  readonly findings: readonly PreparationFinding[]
  readonly summary: string

  constructor(asked: { revision: string | null, state: PreparationStateValue, findings: readonly PreparationFinding[], summary: string }) {
    this.revision = asked.revision
    this.state = asked.state
    this.findings = Object.freeze([...asked.findings])
    this.summary = asked.summary
    Object.freeze(this)
  }

  permitsDispatch(): boolean {
    return this.state === PreparationState.COMPATIBLE || this.state === PreparationState.NOT_APPLICABLE
  }
}
