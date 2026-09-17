import { describe, expect, it } from 'vitest'
import { DispatchCheckClaims } from '../../src/infrastructure/dispatch-check-claims.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { PlanIssueNotClaimed } from '../../src/domain/exceptions.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'

class NodeDouble {
  static readonly DISPATCH_CHECK = '/plugin/scripts/dispatch-check.mjs'
  static readonly ISSUE = new PlanIssue({ number: 331, url: 'https://github.com/mercadona/control-tower-plugin/issues/331' })
  static readonly REPOSITORY = new RepositoryName('mercadona/control-tower-plugin')
  static readonly ROOT = new CheckoutRoot('/checkout/control-tower-plugin')

  readonly calls: { argv: string[], options: { cwd?: string } | undefined }[] = []
  readonly answer: ProcessOutput

  constructor(answer: ProcessOutput) {
    this.answer = answer
  }

  static exiting(code: number, stdout = '', stderr = ''): NodeDouble {
    return new NodeDouble(new ProcessOutput({ code, stdout, stderr }))
  }

  claims(): DispatchCheckClaims {
    return new DispatchCheckClaims({
      node: async (argv, options) => {
        this.calls.push({ argv, options })
        return this.answer
      },
      dispatchCheck: NodeDouble.DISPATCH_CHECK,
    })
  }

  claim(): Promise<void> {
    return this.claims().claim({
      issue: NodeDouble.ISSUE,
      repository: NodeDouble.REPOSITORY,
      root: NodeDouble.ROOT,
    })
  }

  requeue(): Promise<void> {
    return this.claims().requeue({
      issue: NodeDouble.ISSUE,
      repository: NodeDouble.REPOSITORY,
      root: NodeDouble.ROOT,
    })
  }
}

describe('DispatchCheckClaims', () => {
  it('only claim exit zero allows preparation', async () => {
    const accepted = NodeDouble.exiting(0)
    const orphaned = NodeDouble.exiting(4, 'claim stdout', 'orphaned claim')

    await expect(accepted.claim()).resolves.toBeUndefined()
    expect(accepted.calls).toEqual([{
      argv: [NodeDouble.DISPATCH_CHECK, '331', '--repo', 'mercadona/control-tower-plugin'],
      options: { cwd: '/checkout/control-tower-plugin' },
    }])
    await expect(orphaned.claim()).rejects.toThrow(PlanIssueNotClaimed)
    await expect(orphaned.claim()).rejects.toThrow(/exit 4[\s\S]*claim stdout[\s\S]*orphaned claim/)
  })

  it('requeue uses the checked edge and preserves refusals', async () => {
    const refused = NodeDouble.exiting(3, 'requeue stdout', 'workspace refused')

    const refusal = await refused.requeue().catch((cause) => cause)

    expect(refused.calls).toEqual([{
      argv: [NodeDouble.DISPATCH_CHECK, '331', '--repo', 'mercadona/control-tower-plugin', '--requeue'],
      options: { cwd: '/checkout/control-tower-plugin' },
    }])
    expect(refusal).toBeInstanceOf(PlanIssueNotClaimed)
    expect(refusal.message).toMatch(/exit 3[\s\S]*requeue stdout[\s\S]*workspace refused/)
  })
})
