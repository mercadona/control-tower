import { EpicGroom } from '../domain/ports/epic-groom.ts'
import { GroomPlan, GroomPlanIssue } from '../domain/value-objects/groom-plan.ts'
import { EpicNotGroomed, GroomPlanNotUnderstood } from '../domain/exceptions.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import type { EpicSpec } from '../domain/value-objects/epic-spec.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { ProcessOutput, ToolRunner } from './tool-runner.ts'

type Grooming = { root: CheckoutRoot, spec: EpicSpec, repository: RepositoryName, milestone: string }

export class CtGroomEpic extends EpicGroom {
  static readonly COMMAND = 'ct-groom.mjs'
  static readonly NO_DIVERGENCE = 0
  static readonly UNRECONCILED_DIVERGENCE = 3

  readonly node: ToolRunner['run']
  readonly ctGroom: string

  constructor({ node, ctGroom }: { node: ToolRunner['run'], ctGroom: string }) {
    super()
    this.node = node
    this.ctGroom = ctGroom
  }

  static argvFor({ ctGroom, spec, repository, milestone, dryRun }: {
    ctGroom: string,
    spec: string,
    repository: RepositoryName,
    milestone: string,
    dryRun: boolean,
  }): string[] {
    return [
      ctGroom, spec, '--repo', repository.text, '--milestone', milestone,
      ...(dryRun ? ['--dry-run'] : []),
    ]
  }

  async planned(asked: Grooming): Promise<GroomPlan> {
    const said = await this.#groom(asked, true)

    return CtGroomEpic.#planIn(said.stdout, asked.milestone)
  }

  async run(asked: Grooming): Promise<void> {
    await this.#groom(asked, false)
  }

  async #groom(asked: Grooming, dryRun: boolean): Promise<ProcessOutput> {
    const said = await this.node(
      CtGroomEpic.argvFor({
        ctGroom: this.ctGroom, spec: asked.spec.path, repository: asked.repository,
        milestone: asked.milestone, dryRun,
      }),
      { cwd: asked.root.text }
    )
    if (said.code === CtGroomEpic.NO_DIVERGENCE || said.code === CtGroomEpic.UNRECONCILED_DIVERGENCE) return said

    throw new EpicNotGroomed(said.stderr.trim())
  }

  static #planIn(printed: string, milestoneAsked: string): GroomPlan {
    let parsed: unknown
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new GroomPlanNotUnderstood(
        `${CtGroomEpic.COMMAND} --dry-run printed something that is not json for "${milestoneAsked}": ${JSON.stringify(printed)}`
      )
    }
    const candidate = parsed as { milestone?: unknown, issues?: unknown } | null
    if (candidate === null || typeof candidate !== 'object'
      || typeof candidate.milestone !== 'string' || !Array.isArray(candidate.issues)) {
      throw new GroomPlanNotUnderstood(
        `${CtGroomEpic.COMMAND} --dry-run printed no plan for "${milestoneAsked}": ${JSON.stringify(printed)}`
      )
    }

    return new GroomPlan({
      milestone: candidate.milestone,
      issues: candidate.issues.map((issue) => CtGroomEpic.#issueIn(issue, milestoneAsked)),
    })
  }

  static #issueIn(issue: unknown, milestoneAsked: string): GroomPlanIssue {
    const candidate = issue as { order?: unknown, title?: unknown, labels?: unknown } | null
    if (candidate === null || typeof candidate !== 'object'
      || typeof candidate.order !== 'number' || typeof candidate.title !== 'string'
      || !Array.isArray(candidate.labels) || candidate.labels.some((label) => typeof label !== 'string')) {
      throw new GroomPlanNotUnderstood(
        `${CtGroomEpic.COMMAND} --dry-run printed an issue with no order, title or labels for "${milestoneAsked}": ${JSON.stringify(issue)}`
      )
    }

    return new GroomPlanIssue({ order: candidate.order, title: candidate.title, labels: candidate.labels as string[] })
  }
}
