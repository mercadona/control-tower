import {
  EPIC_CONTEXT_HEADING,
  INHERITED_CONTEXT_HEADING,
  INHERITED_CONTEXT_PLACEHOLDER,
  GATES_HEADING,
  renderAcContent,
  renderDescription,
  renderGatesContent,
  renderProtectedLine,
} from '../../../plugin/scripts/groom.js'
import { gatesOf, LOOP_STATUS_LABELS } from '../../../plugin/scripts/groom.js'
import { STATUS_LADDER } from '../../../plugin/scripts/harvest.js'
import { gateLabels } from '../../../plugin/scripts/gates.js'
import { PlanIssues } from '../domain/ports/plan-issues.ts'
import { PlanIssue } from '../domain/value-objects/plan-issue.ts'
import { PlanIssueStatus } from '../domain/value-objects/plan-issue-status.ts'
import type { PlanIssueStatusValue } from '../domain/value-objects/plan-issue-status.ts'
import { ChangeAsked } from '../domain/value-objects/change-asked.ts'
import type { PlanComment } from '../domain/value-objects/plan-comment.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { UserStory } from '../domain/value-objects/user-story.ts'
import { UserStoryKey } from '../domain/value-objects/user-story-key.ts'
import { UserStoryUrl } from '../domain/value-objects/user-story-url.ts'
import { UserStoryReference } from '../domain/value-objects/user-story-reference.ts'
import {
  PlanIssueNotCreated, PlanIssueNotNamed, PlanIssueNotClaimed, PlanGoNotAnswered,
  PlanChangesNotRead, PlanChangesNotUnderstood, PlanChangesNotAsked, PlanStoryNotRead, PlanStoryNotUnderstood,
} from '../domain/exceptions.ts'
import { Gh } from './gh.ts'
import { Projection } from './projection.js'

type PlanIssueRow = {
  n: null,
  name: string,
  entrega: string,
  type: string,
  e2e: string,
  ac: string[],
  deps: string[],
  protected: string,
}

export class GhPlanIssues extends PlanIssues {
  static CHANGES_TOKEN = '-REVIEW'
  static STATUS_PREFIX = 'status:'
  static #RUNGS = STATUS_LADDER as readonly PlanIssueStatusValue[]
  static #LABEL_BY_STATUS: ReadonlyMap<PlanIssueStatusValue, string> =
    new Map(GhPlanIssues.#RUNGS.map((named, at) => [named, LOOP_STATUS_LABELS[at]] as const))
  static #STATUS_BY_LABEL: ReadonlyMap<string, PlanIssueStatusValue> =
    new Map(GhPlanIssues.#RUNGS.map((named, at) => [LOOP_STATUS_LABELS[at], named] as const))
  static IN_PROGRESS_LABEL: string = GhPlanIssues.#LABEL_BY_STATUS.get(PlanIssueStatus.IN_PROGRESS)!
  static IN_REVIEW_LABEL: string = GhPlanIssues.#LABEL_BY_STATUS.get(PlanIssueStatus.IN_REVIEW)!
  static READY_LABEL: string = GhPlanIssues.#LABEL_BY_STATUS.get(PlanIssueStatus.READY)!
  static GO_TOKEN = '-OK'
  static #REF = /\/issues\/([1-9]\d*)\s*$/

  readonly gh: Gh
  readonly stderr: (line: string) => void

  constructor({ gh, stderr }: { gh: Gh, stderr: (line: string) => void }) {
    super()
    this.gh = gh
    this.stderr = stderr
  }

  static goBodyFor(nonce: string): string {
    return `${GhPlanIssues.GO_TOKEN} ${nonce}`
  }

  static goArgvFor({ issueNumber, repository, nonce }: {
    issueNumber: number,
    repository: RepositoryName,
    nonce: string,
  }): string[] {
    return [
      'issue', 'comment', String(issueNumber),
      '--repo', repository.text,
      '--body', GhPlanIssues.goBodyFor(nonce),
    ]
  }

  static changesCommentArgvFor({ issueNumber, repository, changes }: {
    issueNumber: number,
    repository: RepositoryName,
    changes: string,
  }): string[] {
    return [
      'issue', 'comment', String(issueNumber),
      '--repo', repository.text,
      '--body', `${GhPlanIssues.CHANGES_TOKEN} ${PlanIssueBody.quieted(changes)}`,
    ]
  }

  static changesArgvFor({ issue, repository }: {
    issue: PlanIssue,
    repository: RepositoryName,
  }): string[] {
    return [
      'issue', 'view', String(issue.number),
      '--repo', repository.text,
      '--json', 'comments',
    ]
  }

  static statusArgvFor({ issue, repository, adding, removing }: {
    issue: PlanIssue,
    repository: RepositoryName,
    adding: string,
    removing: string,
  }): string[] {
    return [
      'issue', 'edit', String(issue.number),
      '--repo', repository.text,
      '--add-label', adding,
      '--remove-label', removing,
    ]
  }

  static argvFor({ story, comment, repository }: {
    story: UserStory | null,
    comment: PlanComment | null,
    repository: RepositoryName,
  }): string[] {
    return [
      'issue', 'create',
      '--repo', repository.text,
      '--title', PlanIssueBody.titleFor({ story, comment }),
      '--body', PlanIssueBody.of({ story, comment }),
      ...PlanIssueBody.labels({ story, comment }).flatMap((label) => ['--label', label]),
    ]
  }

  static labelArgvFor(repository: RepositoryName, label: string): string[] {
    return ['label', 'create', label, '--repo', repository.text, '--force']
  }

  static labelsArgvFor({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): string[] {
    return ['issue', 'view', String(issueNumber), '--repo', repository.text, '--json', 'labels']
  }

  async open({ story, comment, repository }: {
    story: UserStory | null,
    comment: PlanComment | null,
    repository: RepositoryName,
  }): Promise<PlanIssue> {
    const outcome = await this.#sowing({
      argv: GhPlanIssues.argvFor({ story, comment, repository }),
      ours: PlanIssueBody.labels({ story, comment }),
      repository,
      safeToRepeat: false,
    })
    if (outcome.failed) {
      throw new PlanIssueNotCreated(`${Gh.BIN} issue create failed: ${outcome.stderr.trim()}`)
    }
    const url = outcome.stdout.trim().split('\n').pop() ?? ''
    const found = url.match(GhPlanIssues.#REF)
    if (found === null) {
      throw new PlanIssueNotNamed(
        `${Gh.BIN} did not name the issue it created, it printed ${JSON.stringify(outcome.stdout)}`
      )
    }

    return new PlanIssue({ number: Number(found[1]), url })
  }

  async claim({ issue, repository }: { issue: PlanIssue, repository: RepositoryName }): Promise<void> {
    await this.#sowForTheRelease(repository)
    const { outcome } = await this.#swapping({
      issue, repository,
      adding: GhPlanIssues.IN_PROGRESS_LABEL,
      removing: GhPlanIssues.READY_LABEL,
    })
    if (outcome.failed) {
      throw new PlanIssueNotClaimed(`${Gh.BIN} issue edit failed: ${outcome.stderr.trim()}`)
    }
  }

  async requeue({ issue, repository }: { issue: PlanIssue, repository: RepositoryName }): Promise<void> {
    const { argv, outcome } = await this.#swapping({
      issue, repository,
      adding: GhPlanIssues.READY_LABEL,
      removing: GhPlanIssues.IN_PROGRESS_LABEL,
    })
    if (outcome.failed) this.#warn({ issue, argv, said: outcome.stderr.trim() })
  }

  async changesAsked({ issue, repository }: {
    issue: PlanIssue,
    repository: RepositoryName,
  }): Promise<ChangeAsked[]> {
    const outcome = await this.gh.run(
      GhPlanIssues.changesArgvFor({ issue, repository }), { safeToRepeat: true }
    )
    if (outcome.failed) {
      throw new PlanChangesNotRead(`${Gh.BIN} issue view failed: ${outcome.stderr.trim()}`)
    }

    return GhPlanIssues.#changesIn(outcome.stdout, issue)
  }

  static #changesIn(printed: string, issue: PlanIssue): ChangeAsked[] {
    const asked: ChangeAsked[] = []
    for (const comment of GhPlanIssues.#commentsIn(printed, issue)) {
      const read = GhPlanIssues.#demandRead(comment, issue)
      if (!read.body.startsWith(GhPlanIssues.CHANGES_TOKEN)) continue

      asked.push(new ChangeAsked({
        id: read.id,
        text: read.body.slice(GhPlanIssues.CHANGES_TOKEN.length).trim(),
        askedAt: read.createdAt,
      }))
    }

    return asked
  }

  static #commentsIn(printed: string, issue: PlanIssue): unknown[] {
    let parsed
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new PlanChangesNotUnderstood(
        `${Gh.BIN} answered something that is not json for the comments of ${issue.number}, it printed ${JSON.stringify(printed)}`
      )
    }
    if (!Array.isArray(parsed?.comments)) {
      throw new PlanChangesNotUnderstood(
        `${Gh.BIN} answered without the comments of ${issue.number}, it printed ${JSON.stringify(printed)}`
      )
    }

    return parsed.comments
  }

  static #demandRead(comment: unknown, issue: PlanIssue): { id: string, body: string, createdAt: string } {
    const read = comment as { id?: unknown, body?: unknown, createdAt?: unknown } | null
    if (typeof read?.id === 'string' && typeof read?.body === 'string' && typeof read?.createdAt === 'string') {
      return { id: read.id, body: read.body, createdAt: read.createdAt }
    }

    throw new PlanChangesNotUnderstood(
      `${Gh.BIN} answered a comment of ${issue.number} without the id, the body and the date this reads, it printed ${JSON.stringify(comment)}`
    )
  }

  static #statusIn(printed: string, issueNumber: number): PlanIssueStatusValue {
    let parsed
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new PlanChangesNotUnderstood(
        `${Gh.BIN} answered something that is not json for the labels of ${issueNumber}, it printed ${JSON.stringify(printed)}`
      )
    }
    if (!Array.isArray(parsed?.labels)) {
      throw new PlanChangesNotUnderstood(
        `${Gh.BIN} answered without the labels of ${issueNumber}, it printed ${JSON.stringify(printed)}`
      )
    }
    const worn: string[] = parsed.labels
      .map((label: { name?: unknown } | null) => label?.name)
      .filter((name: unknown) => typeof name === 'string' && name.startsWith(GhPlanIssues.STATUS_PREFIX))
    if (worn.length === 0) return PlanIssueStatus.NONE
    if (worn.length > 1) {
      throw new PlanChangesNotUnderstood(
        `${issueNumber} wears more than one status label (${worn.join(', ')}), so which one it stands at cannot be read`
      )
    }
    const named = GhPlanIssues.#STATUS_BY_LABEL.get(worn[0])
    if (named === undefined) {
      throw new PlanChangesNotUnderstood(
        `${issueNumber} wears ${worn[0]}, which the loop does not declare: it stands at none of ${STATUS_LADDER.join(', ')}`
      )
    }

    return named
  }

  async answerGo({ issueNumber, repository, nonce }: {
    issueNumber: number,
    repository: RepositoryName,
    nonce: string,
  }): Promise<void> {
    const outcome = await this.gh.run(
      GhPlanIssues.goArgvFor({ issueNumber, repository, nonce }), { safeToRepeat: false }
    )
    if (outcome.failed) {
      throw new PlanGoNotAnswered(`${Gh.BIN} issue comment failed: ${outcome.stderr.trim()}`)
    }
  }

  async askChanges({ issue, repository, changes }: {
    issue: PlanIssue,
    repository: RepositoryName,
    changes: string,
  }): Promise<void> {
    const outcome = await this.gh.run(
      GhPlanIssues.changesCommentArgvFor({ issueNumber: issue.number, repository, changes }),
      { safeToRepeat: false }
    )
    if (outcome.failed) {
      throw new PlanChangesNotAsked(`${Gh.BIN} issue comment failed: ${outcome.stderr.trim()}`)
    }
  }

  static storyArgvFor({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): string[] {
    return ['issue', 'view', String(issueNumber), '--repo', repository.text, '--json', 'body']
  }

  async storyOf({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): Promise<UserStoryKey | UserStoryUrl | null> {
    const outcome = await this.gh.run(
      GhPlanIssues.storyArgvFor({ issueNumber, repository }), { safeToRepeat: true }
    )
    if (outcome.failed) {
      throw new PlanStoryNotRead(
        `${Gh.BIN} issue view --json body failed: ${outcome.stderr.trim()}`
      )
    }

    return PlanIssueBody.storyIn(GhPlanIssues.#viewIn(outcome.stdout, issueNumber))
  }

  static #viewIn(printed: string, issueNumber: number): { body: string } {
    let view
    try {
      view = JSON.parse(printed)
    } catch {
      throw new PlanStoryNotUnderstood(
        `${Gh.BIN} issue view --json body printed something that is not json for #${issueNumber}: ${JSON.stringify(printed)}`
      )
    }
    if (view === null || typeof view.body !== 'string') {
      throw new PlanStoryNotUnderstood(
        `${Gh.BIN} issue view --json body printed no body for #${issueNumber}: ${JSON.stringify(printed)}`
      )
    }

    return view
  }

  async statusOf({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): Promise<PlanIssueStatusValue> {
    const outcome = await this.gh.run(
      GhPlanIssues.labelsArgvFor({ issueNumber, repository }), { safeToRepeat: true }
    )
    if (outcome.failed) {
      throw new PlanChangesNotRead(`${Gh.BIN} issue view --json labels failed: ${outcome.stderr.trim()}`)
    }

    return GhPlanIssues.#statusIn(outcome.stdout, issueNumber)
  }

  async #sowForTheRelease(repository: RepositoryName): Promise<void> {
    const argv = GhPlanIssues.labelArgvFor(repository, GhPlanIssues.IN_REVIEW_LABEL)
    const outcome = await this.gh.run(argv, { safeToRepeat: true })
    if (outcome.failed) {
      throw new PlanIssueNotClaimed(
        `${GhPlanIssues.IN_REVIEW_LABEL} could not be sown in ${repository.text}, and dispatch-check --release cannot create it when the agent delivers: ${outcome.stderr.trim()}`
      )
    }
  }

  async #swapping({ issue, repository, adding, removing }: {
    issue: PlanIssue,
    repository: RepositoryName,
    adding: string,
    removing: string,
  }) {
    const argv = GhPlanIssues.statusArgvFor({ issue, repository, adding, removing })
    const outcome = await this.#sowing({ argv, ours: [adding], repository, safeToRepeat: true })

    return { argv, outcome }
  }

  #warn({ issue, argv, said }: { issue: PlanIssue, argv: string[], said: string }): void {
    this.stderr(
      `gh plan issues: ${issue} stays claimed because it could not be put back in the queue: ${said}. Run it yourself: ${Gh.BIN} ${argv.join(' ')}\n`
    )
  }

  async #sowing({ argv, ours, repository, safeToRepeat }: {
    argv: string[],
    ours: string[],
    repository: RepositoryName,
    safeToRepeat: boolean,
  }) {
    const sown = new Set<string>()
    let outcome = await this.gh.run(argv, { safeToRepeat })
    while (outcome.failed) {
      const missing = Gh.labelMissingIn(outcome.stderr)
      if (missing === null || !ours.includes(missing) || sown.has(missing)) break

      sown.add(missing)
      await this.gh.run(GhPlanIssues.labelArgvFor(repository, missing), { safeToRepeat: true })
      outcome = await this.gh.run(argv, { safeToRepeat })
    }

    return outcome
  }
}

export { ChangeAsked }

export class PlanIssueBody {
  static DESCRIPTION_HEADING = '## Descripción'
  static PROTECTED_HEADING = '## Out of scope / Protected'
  static AC_HEADING = '## Acceptance criteria (EARS, 1:1 con tests)'
  static COMMENT_SECTION = 'Comentario de quien pide el plan'
  static COMMENT_HEADING = `## ${PlanIssueBody.COMMENT_SECTION}`
  static NO_STORY_LINE = '> Plan asked for by hand: there is no ticket behind it.'
  static STORY_LINE = '> Historia de usuario: '
  static ISSUE_LINE = '> Issue de GitHub: '
  static NO_STORY_EPIC_CONTEXT = '_This plan does not come from any ticket._'
  static NO_HEADLINE = '_The comment brings no first line that sums up what is being asked for._'
  static HEADLINE_LIMIT = 72
  static HEADLINE_CUT = '…'
  static #ACTIVE =
    /((?<![\w])[\w.-]+\/[\w.-]+#\d+|(?<![\w])#\d+|(?<![\w.])@[A-Za-z0-9][A-Za-z0-9-]*|https?:\/\/\S*github\.com\/\S+)/g
  static #CODE_SPAN = /(`[^`]*`)/
  static CHANGES_LINE =
    `> To ask for changes to the plan, comment on this issue starting with \`${GhPlanIssues.CHANGES_TOKEN}\`: ` +
    'whatever you write after it is what gets asked of the agent, and it will publish the redone plan right here.'

  static #LINE_BY_KIND = new Projection('plan issue story line', [
    [UserStoryKey, (key: UserStoryKey) => `${PlanIssueBody.STORY_LINE}${PlanIssueBody.quieted(key.text)}`],
    [UserStoryUrl, (key: UserStoryUrl) => `${PlanIssueBody.ISSUE_LINE}${PlanIssueBody.quieted(key.text)}`],
  ])

  static #TITLE_BY_KIND = new Projection('plan issue title', [
    [UserStoryKey, (story: UserStory) => `${story.key.text} ${story.summary}`],
    [UserStoryUrl, (story: UserStory & { key: UserStoryUrl }) =>
      `${story.key.repository.text}#${story.key.number} ${story.summary}`],
  ])

  static labels({ story, comment }: {
    story: UserStory | null,
    comment: PlanComment | null,
  }): string[] {
    return [...gateLabels(gatesOf(PlanIssueBody.rowFor({ story, comment })).gates), GhPlanIssues.READY_LABEL]
  }

  static storyIn({ body }: { body: string }): UserStoryKey | UserStoryUrl | null {
    const [firstLine] = body.split('\n')
    const marker = [PlanIssueBody.STORY_LINE, PlanIssueBody.ISSUE_LINE]
      .find((candidate) => firstLine.startsWith(candidate))
    if (marker === undefined) return null
    const unfenced = PlanIssueBody.#unfenced(firstLine.slice(marker.length).trim())

    return UserStoryReference.isWellFormed(unfenced) ? UserStoryReference.of(unfenced) : null
  }

  static #unfenced(text: string): string {
    const found = text.match(/^`([^`]*)`$/)

    return found === null ? text : found[1]
  }

  static titleFor({ story, comment }: {
    story: UserStory | null,
    comment: PlanComment | null,
  }): string {
    return story === null
      ? PlanIssueBody.headlineOf(comment!)
      : PlanIssueBody.#TITLE_BY_KIND.of(story.key.constructor)(story)
  }

  static headlineOf(comment: PlanComment): string {
    const line = comment.text.split('\n').find((candidate) => candidate.trim().length > 0)
    const collapsed = String(line).replace(/\s+/g, ' ').trim()

    return collapsed.length > PlanIssueBody.HEADLINE_LIMIT
      ? `${collapsed.slice(0, PlanIssueBody.HEADLINE_LIMIT - 1)}${PlanIssueBody.HEADLINE_CUT}`
      : collapsed
  }

  static rowFor({ story, comment }: {
    story: UserStory | null,
    comment: PlanComment | null,
  }): PlanIssueRow {
    const name = story === null ? PlanIssueBody.headlineOf(comment!) : story.summary

    return {
      n: null,
      name,
      entrega: PlanIssueBody.quieted(name),
      type: '',
      e2e: '',
      ac: [],
      deps: [],
      protected: '',
    }
  }

  static #EMPTY_EPIC_CONTEXT_BY_KIND = new Projection('plan issue empty epic context', [
    [UserStoryKey, (story: UserStory) =>
      `_${story.key.text} brings no description in Jira: the user story is unwritten._`],
    [UserStoryUrl, (story: UserStory & { key: UserStoryUrl }) =>
      `_Issue ${story.key.repository.text}#${story.key.number} brings no body and no comments: ` +
      'there is nothing written to start from._'],
  ])

  static #epicContextOf(story: UserStory | null): string {
    if (story === null) return PlanIssueBody.NO_STORY_EPIC_CONTEXT

    return story.hasDescription()
      ? PlanIssueBody.quieted(story.description)
      : PlanIssueBody.#EMPTY_EPIC_CONTEXT_BY_KIND.of(story.key.constructor)(story)
  }

  static quieted(text: string): string {
    return text
      .split(PlanIssueBody.#CODE_SPAN)
      .map((piece: string, index: number) => (
        index % 2 === 1 ? piece : piece.replace(PlanIssueBody.#ACTIVE, '`$1`')
      ))
      .join('')
  }

  static of({ story, comment }: {
    story: UserStory | null,
    comment: PlanComment | null,
  }): string {
    const row = PlanIssueBody.rowFor({ story, comment })

    return [
      story === null
        ? PlanIssueBody.NO_STORY_LINE
        : PlanIssueBody.#LINE_BY_KIND.of(story.key.constructor)(story.key),
      PlanIssueBody.CHANGES_LINE,
      '',
      PlanIssueBody.DESCRIPTION_HEADING,
      renderDescription(row) ??
        (story === null ? PlanIssueBody.NO_HEADLINE : `_${story.key} brings no summary in Jira._`),
      '',
      ...(comment === null ? [] : [PlanIssueBody.COMMENT_HEADING, PlanIssueBody.quieted(comment.text), '']),
      EPIC_CONTEXT_HEADING,
      PlanIssueBody.#epicContextOf(story),
      '',
      INHERITED_CONTEXT_HEADING,
      INHERITED_CONTEXT_PLACEHOLDER,
      '',
      PlanIssueBody.AC_HEADING,
      renderAcContent(row.ac),
      '',
      GATES_HEADING,
      renderGatesContent(row),
      '',
      PlanIssueBody.PROTECTED_HEADING,
      renderProtectedLine(row),
      '',
    ].join('\n')
  }
}
