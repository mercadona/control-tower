import { DispatchClaims } from '../domain/ports/dispatch-claims.ts'
import { PlanIssueNotClaimed } from '../domain/exceptions.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import type { PlanIssue } from '../domain/value-objects/plan-issue.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { ProcessOutput, ToolRunner } from './tool-runner.ts'

type DispatchClaim = { issue: PlanIssue, repository: RepositoryName, root: CheckoutRoot }

export class DispatchCheckClaims extends DispatchClaims {
  readonly node: ToolRunner['run']
  readonly dispatchCheck: string

  constructor({ node, dispatchCheck }: { node: ToolRunner['run'], dispatchCheck: string }) {
    super()
    this.node = node
    this.dispatchCheck = dispatchCheck
  }

  static #argv(dispatchCheck: string, asked: DispatchClaim, operation: 'claim' | 'requeue'): string[] {
    return [
      dispatchCheck,
      String(asked.issue.number),
      '--repo',
      asked.repository.text,
      ...(operation === 'requeue' ? ['--requeue'] : []),
    ]
  }

  static #accepted(output: ProcessOutput, operation: 'claim' | 'requeue'): void {
    if (!output.failed) return

    throw new PlanIssueNotClaimed(
      `dispatch-check ${operation} exit ${output.code}: stdout ${JSON.stringify(output.stdout)}, stderr ${JSON.stringify(output.stderr)}`
    )
  }

  async #run(asked: DispatchClaim, operation: 'claim' | 'requeue'): Promise<void> {
    const output = await this.node(
      DispatchCheckClaims.#argv(this.dispatchCheck, asked, operation),
      { cwd: asked.root.text }
    )
    DispatchCheckClaims.#accepted(output, operation)
  }

  async claim(asked: DispatchClaim): Promise<void> {
    await this.#run(asked, 'claim')
  }

  async requeue(asked: DispatchClaim): Promise<void> {
    await this.#run(asked, 'requeue')
  }
}
