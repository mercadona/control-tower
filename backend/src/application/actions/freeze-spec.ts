import { EpicSpec } from '../../domain/value-objects/epic-spec.ts'
import { EpicSpecNotUnderstood } from '../../domain/exceptions.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { EpicSpecs } from '../../domain/ports/epic-specs.ts'
import type { EpicBranch } from '../../domain/ports/epic-branch.ts'
import type { PullRequests } from '../../domain/ports/pull-requests.ts'
import type { FreezeFinding } from '../../domain/value-objects/freeze-finding.ts'

type ReviewedPullRequest = { readonly number: number, readonly url: string }

export class FreezeSpecParams {
  readonly root: CheckoutRoot
  readonly repository: RepositoryName

  constructor(asked: { root: CheckoutRoot, repository: RepositoryName }) {
    this.root = asked.root
    this.repository = asked.repository
    Object.freeze(this)
  }
}

export const FreezeOutcome = Object.freeze({
  FROZEN: 'frozen',
  NO_SPEC: 'no-spec',
  ALREADY_FROZEN: 'already-frozen',
  NOT_FREEZABLE: 'not-freezable',
} as const)

export type FreezeOutcomeValue = (typeof FreezeOutcome)[keyof typeof FreezeOutcome]

export class SpecFrozen {
  readonly outcome: FreezeOutcomeValue
  readonly findings: FreezeFinding[]
  readonly on: string | null
  readonly pullRequest: ReviewedPullRequest | null

  constructor({ outcome, findings, on, pullRequest }: {
    outcome: FreezeOutcomeValue,
    findings: FreezeFinding[],
    on: string | null,
    pullRequest: ReviewedPullRequest | null,
  }) {
    this.outcome = outcome
    this.findings = findings
    this.on = on
    this.pullRequest = pullRequest
    Object.freeze(this)
  }
}

export class FreezeSpec {
  readonly specs: EpicSpecs
  readonly branch: EpicBranch
  readonly pullRequests: PullRequests
  readonly now: () => Date

  constructor({ specs, branch, pullRequests, now }: {
    specs: EpicSpecs, branch: EpicBranch, pullRequests: PullRequests, now: () => Date,
  }) {
    this.specs = specs
    this.branch = branch
    this.pullRequests = pullRequests
    this.now = now
  }

  async execute(params: FreezeSpecParams): Promise<SpecFrozen> {
    const spec = await this.specs.mostRecent(params.root)
    if (spec === null) {
      return new SpecFrozen({ outcome: FreezeOutcome.NO_SPEC, findings: [], on: null, pullRequest: null })
    }
    if (!spec.isFrozen() && !spec.isFreezable()) {
      return new SpecFrozen({ outcome: FreezeOutcome.NOT_FREEZABLE, findings: spec.findings(), on: null, pullRequest: null })
    }
    const design = spec.design()
    if (design === null) {
      throw new EpicSpecNotUnderstood(
        `${spec.path} does not name its design document under ${EpicSpec.HANDOFF_LINE}, so gate 1 cannot publish half the epic`
      )
    }

    const branch = await this.branch.publishable(params.root)
    const paths = [design, spec.path]
    if (await this.#delivered({ params, spec, branch })) {
      return new SpecFrozen({ outcome: FreezeOutcome.ALREADY_FROZEN, findings: [], on: null, pullRequest: null })
    }
    const on = spec.isFrozen() ? spec.frozenOn()! : await this.#writtenAndCommitted({ params, spec, paths })
    if (!(await this.branch.pushed({ root: params.root, branch }))) {
      await this.branch.push({ root: params.root, branch })
    }

    return new SpecFrozen({
      outcome: FreezeOutcome.FROZEN,
      findings: [],
      on,
      pullRequest: await this.#pullRequest({ params, spec, design, branch, on }),
    })
  }

  async #delivered({ params, spec, branch }: {
    params: FreezeSpecParams, spec: EpicSpec, branch: string,
  }): Promise<boolean> {
    if (!spec.isFrozen()) return false
    if (!(await this.branch.pushed({ root: params.root, branch }))) return false

    return await this.pullRequests.openOfBranch({ branch, repository: params.repository }) !== null
  }

  async #writtenAndCommitted({ params, spec, paths }: {
    params: FreezeSpecParams, spec: EpicSpec, paths: string[],
  }): Promise<string> {
    const on = EpicSpec.dateOf(this.now())
    await this.specs.rewrite({ root: params.root, spec, text: spec.frozenAt(on) })
    try {
      await this.branch.commit({
        root: params.root,
        paths,
        message: `Freeze the execution spec of ${spec.title()} (${on})`,
      })
    } catch (cause) {
      if (!(await this.branch.committed({ root: params.root, paths }))) {
        await this.specs.rewrite({ root: params.root, spec, text: spec.text })
      }
      throw cause
    }

    return on
  }

  async #pullRequest({ params, spec, design, branch, on }: {
    params: FreezeSpecParams, spec: EpicSpec, design: string, branch: string, on: string,
  }): Promise<ReviewedPullRequest> {
    const standing = await this.pullRequests.openOfBranch({ branch, repository: params.repository })
    if (standing !== null) return standing

    return await this.pullRequests.open({
      repository: params.repository,
      branch,
      title: `${spec.title()} — design and execution spec`,
      body: [
        `The epic's two documents, with the execution spec frozen on ${on}.`,
        '',
        `- ${design}`,
        `- ${spec.path}`,
        '',
        "Control Tower's gate 1 wrote the state line and committed both. The groom stays refused until this pull request merges.",
      ].join('\n'),
    })
  }
}
