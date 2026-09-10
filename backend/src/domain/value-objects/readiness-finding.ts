export type ReadinessStatus = 'ready' | 'changes-required' | 'unverified'
export type ReadinessId =
  | 'checkout' | 'base' | 'commands' | 'conventions' | 'test-workers'
  | 'checkout-drift' | 'git-ignore' | 'docker' | 'compose' | 'container-resources'
  | 'database-readiness' | 'worktree-config' | 'build-context' | 'container-mounts'
  | 'image-provenance' | 'execution' | 'inspection'
export type ReadinessAction =
  | 'confirm-checkout' | 'update-checkout' | 'declare-commands' | 'declare-conventions'
  | 'limit-workers' | 'inspect-command' | 'fix-ignore' | 'declare-compose'
  | 'start-docker' | 'review-compose' | 'limit-resources' | 'wait-for-database'
  | 'isolate-worktrees' | 'verify-dependencies' | 'recreate-environment'
  | 'verify-execution' | 'retry-inspection'

export class ReadinessFinding {
  readonly id: ReadinessId
  readonly status: ReadinessStatus
  readonly evidence: readonly string[]
  readonly action: ReadinessAction | null

  constructor({ id, status, evidence, action }: {
    id: ReadinessId, status: ReadinessStatus, evidence: readonly string[], action: ReadinessAction | null,
  }) {
    this.id = id
    this.status = status
    this.evidence = Object.freeze([...evidence])
    this.action = action
    Object.freeze(this)
  }
}
