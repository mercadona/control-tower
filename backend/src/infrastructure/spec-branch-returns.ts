import { PlanFailure } from '../domain/exceptions.ts'
import { ReturnFromMergedSpecBranchParams } from '../application/actions/return-from-merged-spec-branch.ts'
import { RemoteBranchFate } from '../domain/value-objects/remote-branch-fate.ts'
import { Projection } from './projection.ts'
import type { ReturnFromMergedSpecBranch, SpecBranchReturned } from '../application/actions/return-from-merged-spec-branch.ts'
import type { RemoteBranchFateValue } from '../domain/value-objects/remote-branch-fate.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

class SpecBranchLine {
  static readonly #ON_THE_REMOTE = new Projection<string, RemoteBranchFateValue>('remote branch fate', [
    [RemoteBranchFate.REMOVED, 'was deleted here and on the remote'],
    [RemoteBranchFate.ABSENT, 'was deleted here, and the remote had already deleted it'],
    [RemoteBranchFate.KEPT, 'was deleted here, but the remote one moved past the merge and was kept'],
  ])

  static returned(root: CheckoutRoot, returned: SpecBranchReturned): string {
    return `spec branch: ${root.text} is back on ${returned.into}; ${returned.branch} merged and `
      + `${SpecBranchLine.#ON_THE_REMOTE.of(returned.remote)}\n`
  }

  static refused(root: CheckoutRoot, failure: PlanFailure): string {
    return `spec branch: ${root.text} could not go back to the default branch: ${failure.message}\n`
  }
}

export class SpecBranchReturns {
  readonly returning: Pick<ReturnFromMergedSpecBranch, 'execute'>
  readonly stderr: (line: string) => void
  readonly #toldRefusals = new Map<string, string>()

  constructor({ returning, stderr }: {
    returning: Pick<ReturnFromMergedSpecBranch, 'execute'>,
    stderr: (line: string) => void,
  }) {
    this.returning = returning
    this.stderr = stderr
  }

  async settle(root: CheckoutRoot, repository: RepositoryName): Promise<void> {
    let returned: SpecBranchReturned | null
    try {
      returned = await this.returning.execute(new ReturnFromMergedSpecBranchParams({ root, repository }))
    } catch (failure) {
      if (!(failure instanceof PlanFailure)) throw failure
      this.#tellOnce(root, SpecBranchLine.refused(root, failure))
      return
    }
    this.#toldRefusals.delete(root.text)
    if (returned !== null) this.stderr(SpecBranchLine.returned(root, returned))
  }

  #tellOnce(root: CheckoutRoot, line: string): void {
    if (this.#toldRefusals.get(root.text) === line) return
    this.#toldRefusals.set(root.text, line)
    this.stderr(line)
  }
}
