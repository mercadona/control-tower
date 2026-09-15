import { resolveStatus, extractOrder } from '../../../plugin/scripts/gh-issue-map.js'
import { EpicIssues } from '../domain/ports/epic-issues.ts'
import { EpicIssue } from '../domain/value-objects/epic-issue.ts'
import { EpicIssuesListing } from '../domain/value-objects/epic-issues-listing.ts'
import { EpicIssuesNotRead, EpicIssuesNotUnderstood, EpicIssueNotPromoted } from '../domain/exceptions.ts'
import { GhPlanIssues } from './gh-plan-issues.ts'
import { Gh } from './gh.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

type RawEpicIssue = {
  readonly number: number,
  readonly url: string,
  readonly title: string,
  readonly labels: { readonly name: string }[],
  readonly state: string,
  readonly body: string,
}

export class GhEpicIssues extends EpicIssues {
  static readonly LIMIT = 200
  static readonly PAGING_CEILING = 1600
  static readonly OPEN = 'OPEN'

  readonly gh: Gh

  constructor({ gh }: { gh: Gh }) {
    super()
    this.gh = gh
  }

  static listArgvFor(
    { repository, milestone, limit }: { repository: RepositoryName, milestone: string, limit: number }
  ): string[] {
    return [
      'issue', 'list',
      '--repo', repository.text,
      '--milestone', milestone,
      '--state', 'all',
      '--limit', String(limit),
      '--json', 'number,url,title,labels,state,body',
    ]
  }

  static promoteArgvFor({ repository, issue }: { repository: RepositoryName, issue: EpicIssue }): string[] {
    return [
      'issue', 'edit', String(issue.number),
      '--repo', repository.text,
      '--add-label', GhPlanIssues.READY_LABEL,
      '--remove-label', GhPlanIssues.BACKLOG_LABEL,
    ]
  }

  async listOf(
    { repository, milestone }: { repository: RepositoryName, milestone: string }
  ): Promise<EpicIssuesListing> {
    let limit = GhEpicIssues.LIMIT
    for (;;) {
      const outcome = await this.gh.run(
        GhEpicIssues.listArgvFor({ repository, milestone, limit }), { safeToRepeat: true }
      )
      if (outcome.failed) {
        throw new EpicIssuesNotRead(`${Gh.BIN} issue list failed: ${outcome.stderr.trim()}`)
      }

      const raw = GhEpicIssues.#issuesIn(outcome.stdout)
      if (raw.length < limit) {
        return new EpicIssuesListing({
          issues: raw.map((one) => GhEpicIssues.#toEpicIssue(one)).sort((one, other) => one.number - other.number),
          exhausted: true,
          reason: null,
        })
      }
      if (limit >= GhEpicIssues.PAGING_CEILING) {
        return new EpicIssuesListing({
          issues: [],
          exhausted: false,
          reason: `${Gh.BIN} issue list answered exactly as many issues as it was asked for at every limit up ` +
            `to the ceiling of ${GhEpicIssues.PAGING_CEILING}: the milestone "${milestone}" may hold more issues than ` +
            'this backend could read',
        })
      }
      limit *= 2
    }
  }

  async promote({ repository, issue }: { repository: RepositoryName, issue: EpicIssue }): Promise<void> {
    const outcome = await this.gh.run(
      GhEpicIssues.promoteArgvFor({ repository, issue }), { safeToRepeat: true }
    )
    if (outcome.failed) {
      throw new EpicIssueNotPromoted(`${Gh.BIN} issue edit failed for #${issue.number}: ${outcome.stderr.trim()}`)
    }
  }

  static #toEpicIssue(raw: RawEpicIssue): EpicIssue {
    return new EpicIssue({
      number: raw.number,
      url: raw.url,
      title: raw.title,
      status: resolveStatus(raw.labels.map((label) => label.name)).status,
      isOpen: raw.state === GhEpicIssues.OPEN,
      order: extractOrder(raw.body),
    })
  }

  static #issuesIn(printed: string): RawEpicIssue[] {
    let parsed: unknown
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new EpicIssuesNotUnderstood(
        `${Gh.BIN} answered something that is not json for the epic's issues, it printed ${JSON.stringify(printed)}`
      )
    }
    if (!Array.isArray(parsed) || !parsed.every(GhEpicIssues.#readsAsAnIssue)) {
      throw new EpicIssuesNotUnderstood(
        `${Gh.BIN} answered the epic's issues without the shape this reads, it printed ${JSON.stringify(printed)}`
      )
    }

    return parsed
  }

  static #readsAsAnIssue(candidate: unknown): candidate is RawEpicIssue {
    if (typeof candidate !== 'object' || candidate === null) return false
    const { number, url, title, labels, state, body } = candidate as Record<string, unknown>

    return typeof number === 'number' && typeof url === 'string' && typeof title === 'string' &&
      Array.isArray(labels) && labels.every((label) => typeof label?.name === 'string') &&
      typeof state === 'string' && typeof body === 'string'
  }
}
