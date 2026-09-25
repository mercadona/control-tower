import { LOOP_STATUS_LABELS } from '../../../plugin/scripts/groom.js'
import { STATUS_LADDER } from '../../../plugin/scripts/harvest.js'
import { PlanIssues } from '../domain/ports/plan-issues.ts'
import { PlanIssueStatus } from '../domain/value-objects/plan-issue-status.ts'
import type { PlanIssueStatusValue } from '../domain/value-objects/plan-issue-status.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import { PlanStatusNotRead, PlanStatusNotUnderstood } from '../domain/exceptions.ts'
import { Gh } from './gh.ts'

export class GhPlanIssues extends PlanIssues {
  static STATUS_PREFIX = 'status:'
  static #RUNGS = STATUS_LADDER as readonly PlanIssueStatusValue[]
  static #LABEL_BY_STATUS: ReadonlyMap<PlanIssueStatusValue, string> =
    new Map(GhPlanIssues.#RUNGS.map((named, at) => [named, LOOP_STATUS_LABELS[at]] as const))
  static #STATUS_BY_LABEL: ReadonlyMap<string, PlanIssueStatusValue> =
    new Map(GhPlanIssues.#RUNGS.map((named, at) => [LOOP_STATUS_LABELS[at], named] as const))
  static BACKLOG_LABEL: string = GhPlanIssues.#LABEL_BY_STATUS.get(PlanIssueStatus.BACKLOG)!
  static READY_LABEL: string = GhPlanIssues.#LABEL_BY_STATUS.get(PlanIssueStatus.READY)!

  readonly gh: Gh

  constructor({ gh }: { gh: Gh }) {
    super()
    this.gh = gh
  }

  static labelsArgvFor({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): string[] {
    return ['issue', 'view', String(issueNumber), '--repo', repository.text, '--json', 'labels']
  }

  static #statusIn(printed: string, issueNumber: number): PlanIssueStatusValue {
    let parsed
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new PlanStatusNotUnderstood(
        `${Gh.BIN} answered something that is not json for the labels of ${issueNumber}, it printed ${JSON.stringify(printed)}`
      )
    }
    if (!Array.isArray(parsed?.labels)) {
      throw new PlanStatusNotUnderstood(
        `${Gh.BIN} answered without the labels of ${issueNumber}, it printed ${JSON.stringify(printed)}`
      )
    }
    const worn: string[] = parsed.labels
      .map((label: { name?: unknown } | null) => label?.name)
      .filter((name: unknown) => typeof name === 'string' && name.startsWith(GhPlanIssues.STATUS_PREFIX))
    if (worn.length === 0) return PlanIssueStatus.NONE
    if (worn.length > 1) {
      throw new PlanStatusNotUnderstood(
        `${issueNumber} wears more than one status label (${worn.join(', ')}), so which one it stands at cannot be read`
      )
    }
    const named = GhPlanIssues.#STATUS_BY_LABEL.get(worn[0])
    if (named === undefined) {
      throw new PlanStatusNotUnderstood(
        `${issueNumber} wears ${worn[0]}, which the loop does not declare: it stands at none of ${STATUS_LADDER.join(', ')}`
      )
    }

    return named
  }

  async statusOf({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): Promise<PlanIssueStatusValue> {
    const outcome = await this.gh.run(
      GhPlanIssues.labelsArgvFor({ issueNumber, repository }), { safeToRepeat: true }
    )
    if (outcome.failed) {
      throw new PlanStatusNotRead(`${Gh.BIN} issue view --json labels failed: ${outcome.stderr.trim()}`)
    }

    return GhPlanIssues.#statusIn(outcome.stdout, issueNumber)
  }
}
