import type { ReadinessFinding, ReadinessStatus } from './readiness-finding.ts'

export class ProjectReadiness {
  readonly repository: string
  readonly root: string
  readonly baseRevision: string | null
  readonly observedAt: string
  readonly findings: readonly ReadinessFinding[]

  constructor({ repository, root, baseRevision, observedAt, findings }: {
    repository: string, root: string, baseRevision: string | null,
    observedAt: string, findings: readonly ReadinessFinding[],
  }) {
    if (findings.length === 0) throw new Error('a readiness report must contain observations')
    this.repository = repository
    this.root = root
    this.baseRevision = baseRevision
    this.observedAt = observedAt
    this.findings = Object.freeze([...findings])
    Object.freeze(this)
  }

  get status(): ReadinessStatus {
    if (this.findings.some((finding) => finding.status === 'changes-required')) return 'changes-required'
    if (this.findings.some((finding) => finding.status === 'unverified')) return 'unverified'
    return 'ready'
  }
}
