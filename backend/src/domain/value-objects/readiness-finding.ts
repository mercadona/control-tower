export type ReadinessStatus = 'ready' | 'changes-required' | 'unverified'

export class ReadinessFinding {
  readonly id: string
  readonly status: ReadinessStatus
  readonly evidence: readonly string[]
  readonly action: string | null

  constructor({ id, status, evidence, action }: {
    id: string, status: ReadinessStatus, evidence: readonly string[], action: string | null,
  }) {
    this.id = id
    this.status = status
    this.evidence = Object.freeze([...evidence])
    this.action = action
    Object.freeze(this)
  }
}
