import { LOOP_BRANCH_PREFIX } from '../../../plugin/scripts/conventions.js'
import { PullRequests } from '../domain/ports/pull-requests.ts'
import { ChangeAsked } from '../domain/value-objects/change-asked.ts'
import { PullRequestNotRead, PullRequestNotUnderstood } from '../domain/exceptions.ts'
import { Gh } from './gh.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

type ReviewedPullRequest = { readonly number: number, readonly url: string }

type ReviewAsked = { readonly state: string, readonly body: string }

type AnchoredComment = {
  readonly body: string,
  readonly path: string,
  readonly line?: unknown,
  readonly pull_request_review_id?: unknown,
}

export class OpenPullRequest {
  readonly number: number
  readonly url: string

  constructor({ number, url }: { number: number, url: string }) {
    this.number = number
    this.url = url
    Object.freeze(this)
  }
}

export class GhPullRequests extends PullRequests {
  static readonly #ASKS = Object.freeze(['CHANGES_REQUESTED', 'COMMENTED'])
  static readonly #PAGE_SIZE = 'per_page=100'

  readonly gh: Gh

  constructor({ gh }: { gh: Gh }) {
    super()
    this.gh = gh
  }

  static #branchOf(issueNumber: number): string {
    return `${LOOP_BRANCH_PREFIX}${issueNumber}`
  }

  static #listArgvFor({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): string[] {
    return [
      'pr', 'list', '--repo', repository.text,
      '--head', GhPullRequests.#branchOf(issueNumber),
      '--state', 'open', '--json', 'number,url', '--limit', '1',
    ]
  }

  static #reviewsArgvFor({ pullRequest, repository }: {
    pullRequest: ReviewedPullRequest,
    repository: RepositoryName,
  }): string[] {
    return [
      'api', `repos/${repository.text}/pulls/${pullRequest.number}/reviews`,
      '-f', GhPullRequests.#PAGE_SIZE, '--paginate', '--slurp', '--method', 'GET',
    ]
  }

  static #commentsArgvFor({ pullRequest, repository }: {
    pullRequest: ReviewedPullRequest,
    repository: RepositoryName,
  }): string[] {
    return [
      'api', `repos/${repository.text}/pulls/${pullRequest.number}/comments`,
      '-f', GhPullRequests.#PAGE_SIZE, '--paginate', '--slurp', '--method', 'GET',
    ]
  }

  async openOf({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): Promise<ReviewedPullRequest | null> {
    const printed = await this.#read(GhPullRequests.#listArgvFor({ issueNumber, repository }))
    const listed = GhPullRequests.#arrayIn(printed, `the pull requests of ${GhPullRequests.#branchOf(issueNumber)}`)
    if (listed.length === 0) return null

    const found = listed[0]
    if (!GhPullRequests.#readsAsAPullRequest(found)) {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} named a pull request without the number and the url this reads, it printed ${JSON.stringify(printed)}`
      )
    }

    return new OpenPullRequest({ number: found.number, url: found.url })
  }

  async fixesAsked({ pullRequest, repository }: {
    pullRequest: ReviewedPullRequest,
    repository: RepositoryName,
  }): Promise<ChangeAsked[]> {
    const reviews = GhPullRequests.#pagesIn(
      await this.#read(GhPullRequests.#reviewsArgvFor({ pullRequest, repository })),
      `the reviews of #${pullRequest.number}`
    )
    const comments = GhPullRequests.#pagesIn(
      await this.#read(GhPullRequests.#commentsArgvFor({ pullRequest, repository })),
      `the comments of #${pullRequest.number}`
    )
    const anchored = GhPullRequests.#byReview(comments, pullRequest)

    return GhPullRequests.#asked(reviews, anchored, pullRequest)
  }

  static #asked(
    reviews: unknown[],
    anchored: Map<unknown, AnchoredComment[]>,
    pullRequest: ReviewedPullRequest
  ): ChangeAsked[] {
    const changes = []
    for (const review of [...reviews].sort((one, other) => GhPullRequests.#idOf(one, pullRequest) - GhPullRequests.#idOf(other, pullRequest))) {
      const id = GhPullRequests.#idOf(review, pullRequest)
      const carried = anchored.get(id) ?? []
      if (!GhPullRequests.#asksForAChange(review, carried, pullRequest)) continue

      changes.push(new ChangeAsked({ id: String(id), text: GhPullRequests.#textOf(review, carried), askedAt: null }))
    }

    return changes
  }

  static #asksForAChange(
    review: unknown,
    carried: AnchoredComment[],
    pullRequest: ReviewedPullRequest
  ): review is ReviewAsked {
    if (!GhPullRequests.#readsAsAReview(review)) {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} sent a review of #${pullRequest.number} without the state and the body this reads, it printed ${JSON.stringify(review)}`
      )
    }
    if (!GhPullRequests.#ASKS.includes(review.state)) return false

    return review.body.trim().length > 0 || carried.length > 0
  }

  static #textOf(review: ReviewAsked, carried: AnchoredComment[]): string {
    const parts = review.body.trim().length > 0 ? [review.body.trim()] : []
    parts.push(...carried.map((comment) => GhPullRequests.#anchored(comment)))

    return parts.join('\n')
  }

  static #anchored(comment: AnchoredComment): string {
    const line = comment.line
    const where = typeof line === 'number' && Number.isInteger(line) ? `${comment.path}:${line}` : comment.path

    return `${where}: ${comment.body.trim()}`
  }

  static #byReview(comments: unknown[], pullRequest: ReviewedPullRequest): Map<unknown, AnchoredComment[]> {
    const anchored = new Map<unknown, AnchoredComment[]>()
    for (const comment of comments) {
      if (!GhPullRequests.#readsAsAComment(comment)) {
        throw new PullRequestNotUnderstood(
          `${Gh.BIN} sent a comment of #${pullRequest.number} without the body and the path this reads, it printed ${JSON.stringify(comment)}`
        )
      }
      const id = comment.pull_request_review_id
      const carried = anchored.get(id) ?? []
      anchored.set(id, carried)
      carried.push(comment)
    }

    return anchored
  }

  static #idOf(review: unknown, pullRequest: ReviewedPullRequest): number {
    if (!GhPullRequests.#readsAsAnIdentifiedReview(review)) {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} sent a review of #${pullRequest.number} without the id this reads, it printed ${JSON.stringify(review)}`
      )
    }

    return review.id
  }

  static #readsAsAPullRequest(found: unknown): found is ReviewedPullRequest {
    if (typeof found !== 'object' || found === null) return false
    if (!('number' in found) || !('url' in found)) return false

    return typeof found.number === 'number' && Number.isInteger(found.number) &&
      typeof found.url === 'string'
  }

  static #readsAsAReview(review: unknown): review is ReviewAsked {
    if (typeof review !== 'object' || review === null) return false
    if (!('state' in review) || !('body' in review)) return false

    return typeof review.state === 'string' && typeof review.body === 'string'
  }

  static #readsAsAnIdentifiedReview(review: unknown): review is { readonly id: number } {
    if (typeof review !== 'object' || review === null || !('id' in review)) return false

    return typeof review.id === 'number' && Number.isInteger(review.id)
  }

  static #readsAsAComment(comment: unknown): comment is AnchoredComment {
    if (typeof comment !== 'object' || comment === null) return false
    if (!('body' in comment) || !('path' in comment)) return false

    return typeof comment.body === 'string' && typeof comment.path === 'string'
  }

  static #arrayIn(printed: string, what: string): unknown[] {
    let parsed: unknown
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} answered something that is not json for ${what}, it printed ${JSON.stringify(printed)}`
      )
    }
    if (!Array.isArray(parsed)) {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} answered ${what} without a list, it printed ${JSON.stringify(printed)}`
      )
    }

    return parsed
  }

  static #pagesIn(printed: string, what: string): unknown[] {
    return GhPullRequests.#arrayIn(printed, what).flat()
  }

  async #read(argv: string[]): Promise<string> {
    const outcome = await this.gh.run(argv, { safeToRepeat: true })
    if (outcome.failed) {
      throw new PullRequestNotRead(`${Gh.BIN} ${argv[0]} failed: ${outcome.stderr.trim()}`)
    }

    return outcome.stdout
  }
}
