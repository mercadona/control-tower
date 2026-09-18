import { issuesQueryFor, normalizeGraphqlIssues } from '../../../plugin/scripts/gh-issues.js'
import { buildDispatchInput, mapGhIssue } from '../../../plugin/scripts/gh-issue-map.js'
import { UNCAPPED, collectTokenHolders, planDispatch } from '../../../plugin/scripts/dispatch.js'
import { DispatchCandidates } from '../domain/ports/dispatch-candidates.ts'
import { DispatchNotAvailable, DispatchNotRead, DispatchNotUnderstood } from '../domain/exceptions.ts'
import { PlanIssue } from '../domain/value-objects/plan-issue.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { ProcessOutput } from './tool-runner.ts'
import type { Gh } from './gh.ts'

type GhMilestone = Readonly<{ number: number, title: string }>
type GhLabel = Readonly<{ name: string }>
type GhOpenIssue = Readonly<{
  number: number,
  url: string,
  title: string,
  body: string,
  milestone: GhMilestone | null,
  labels: GhLabel[],
}>
type GhClosedIssue = Readonly<{
  number: number,
  body: string,
  milestone: GhMilestone | null,
  labels: GhLabel[],
  stateReason: string | null,
}>

class GhPayload {
  readonly #source: Record<string, unknown>
  readonly context: string

  constructor(value: unknown, context: string) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new DispatchNotUnderstood(`${context} is not an object: ${JSON.stringify(value)}`)
    }
    this.#source = Object.fromEntries(Object.entries(value))
    this.context = context
  }

  value(key: string): unknown {
    return this.#source[key]
  }

  positiveInteger(key: string): number {
    const value = this.value(key)
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new DispatchNotUnderstood(`${this.context}.${key} is not a positive integer: ${JSON.stringify(value)}`)
    }

    return value
  }

  text(key: string): string {
    const value = this.value(key)
    if (typeof value !== 'string') {
      throw new DispatchNotUnderstood(`${this.context}.${key} is not text: ${JSON.stringify(value)}`)
    }

    return value
  }

  nonEmptyText(key: string): string {
    const value = this.text(key)
    if (value.length === 0) {
      throw new DispatchNotUnderstood(`${this.context}.${key} is empty: ${JSON.stringify(value)}`)
    }

    return value
  }

  nullableText(key: string): string | null {
    const value = this.value(key)
    if (value !== null && typeof value !== 'string') {
      throw new DispatchNotUnderstood(
        `${this.context}.${key} is neither text nor null: ${JSON.stringify(value)}`
      )
    }

    return value
  }
}

export class GhDispatchCandidates extends DispatchCandidates {
  readonly gh: Gh

  constructor({ gh }: { gh: Gh }) {
    super()
    this.gh = gh
  }

  static readonly #QUERIES: Readonly<Record<'open' | 'closed', string>> = Object.freeze({
    open: issuesQueryFor(['OPEN']),
    closed: issuesQueryFor(['CLOSED']),
  })

  static #argv(repository: RepositoryName, state: 'open' | 'closed'): string[] {
    const [owner, name] = repository.text.split('/')
    return [
      'api', 'graphql', '--paginate', '--slurp',
      '-f', `query=${GhDispatchCandidates.#QUERIES[state]}`,
      '-f', `owner=${owner}`, '-f', `name=${name}`,
    ]
  }

  static #isIssuePage(page: unknown): boolean {
    if (page === null || typeof page !== 'object') return false
    const nodes = new GhPayload(page, 'page').value('data')
    if (nodes === null || typeof nodes !== 'object') return false
    const repository = new GhPayload(nodes, 'page.data').value('repository')
    if (repository === null || typeof repository !== 'object') return false
    const issues = new GhPayload(repository, 'page.data.repository').value('issues')
    if (issues === null || typeof issues !== 'object') return false

    return Array.isArray(new GhPayload(issues, 'page.data.repository.issues').value('nodes'))
  }

  static #milestone(source: GhPayload): GhMilestone | null {
    if (source.value('milestone') === null) return null
    const milestone = new GhPayload(source.value('milestone'), `${source.context}.milestone`)

    return Object.freeze({
      number: milestone.positiveInteger('number'),
      title: milestone.text('title'),
    })
  }

  static #labels(source: GhPayload): GhLabel[] {
    const labels = source.value('labels')
    if (!Array.isArray(labels)) {
      throw new DispatchNotUnderstood(`${source.context}.labels is not an array: ${JSON.stringify(labels)}`)
    }

    return labels.map((value, index) => {
      const label = new GhPayload(value, `${source.context}.labels[${index}]`)
      return Object.freeze({ name: label.text('name') })
    })
  }

  static #entries(printed: string, state: 'open' | 'closed'): unknown[] {
    let parsed: unknown
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new DispatchNotUnderstood(`gh printed non-json ${state} issue pages: ${JSON.stringify(printed)}`)
    }
    if (!Array.isArray(parsed) || parsed.some((page) => !GhDispatchCandidates.#isIssuePage(page))) {
      throw new DispatchNotUnderstood(`gh printed malformed ${state} issue pages: ${JSON.stringify(parsed)}`)
    }

    return normalizeGraphqlIssues(parsed)
  }

  static #openIssues(printed: string): GhOpenIssue[] {
    return GhDispatchCandidates.#entries(printed, 'open').map((value, index) => {
      const context = `open issue ${index}`
      const source = new GhPayload(value, context)
      return Object.freeze({
        number: source.positiveInteger('number'),
        url: source.nonEmptyText('url'),
        title: source.text('title'),
        body: source.nullableText('body') ?? '',
        milestone: GhDispatchCandidates.#milestone(source),
        labels: GhDispatchCandidates.#labels(source),
      })
    })
  }

  static #closedIssues(printed: string): GhClosedIssue[] {
    return GhDispatchCandidates.#entries(printed, 'closed').map((value, index) => {
      const context = `closed issue ${index}`
      const source = new GhPayload(value, context)
      return Object.freeze({
        number: source.positiveInteger('number'),
        body: source.nullableText('body') ?? '',
        milestone: GhDispatchCandidates.#milestone(source),
        labels: GhDispatchCandidates.#labels(source),
        stateReason: source.nullableText('stateReason'),
      })
    })
  }

  static #readFailure(state: 'open' | 'closed', output: ProcessOutput): string | null {
    if (!output.failed) return null

    return `${state} issues exited ${output.code}: stdout ${JSON.stringify(output.stdout)}, stderr ${JSON.stringify(output.stderr)}`
  }

  static #selectedIssue(selected: { n: number }, openIssues: GhOpenIssue[]): PlanIssue {
    const raw = openIssues.find((issue) => issue.number === selected.n)
    if (raw === undefined) {
      throw new DispatchNotUnderstood(`the plugin selected an issue absent from the open issue table: ${selected.n}`)
    }

    return new PlanIssue({ number: raw.number, url: raw.url })
  }

  async admissible({ repository, milestone }: {
    repository: RepositoryName,
    milestone: string,
  }): Promise<readonly PlanIssue[]> {
    const [openOutput, closedOutput] = await Promise.all([
      this.gh.run(GhDispatchCandidates.#argv(repository, 'open'), { safeToRepeat: true }),
      this.gh.run(GhDispatchCandidates.#argv(repository, 'closed'), { safeToRepeat: true }),
    ])
    const failures = [
      GhDispatchCandidates.#readFailure('open', openOutput),
      GhDispatchCandidates.#readFailure('closed', closedOutput),
    ].filter((failure): failure is string => failure !== null)
    if (failures.length > 0) throw new DispatchNotRead(`gh could not read the complete issue table: ${failures.join('; ')}`)

    const openIssues = GhDispatchCandidates.#openIssues(openOutput.stdout)
    const closedIssues = GhDispatchCandidates.#closedIssues(closedOutput.stdout)
    const dispatchInput = buildDispatchInput(openIssues, closedIssues)
    const targetMilestoneNumbers = new Set(
      [...openIssues, ...closedIssues]
        .flatMap((issue) => issue.milestone?.title === milestone ? [String(issue.milestone.number)] : [])
    )
    const targetCollision = dispatchInput.orderCollisions.find(
      (collision: { epicKey: string }) => targetMilestoneNumbers.has(collision.epicKey)
    )
    if (targetCollision !== undefined) {
      throw new DispatchNotUnderstood(`the target milestone has duplicate table order: ${JSON.stringify(targetCollision)}`)
    }

    const targetIssueNumbers = new Set(
      openIssues.filter((issue) => issue.milestone?.title === milestone).map((issue) => issue.number)
    )
    const readyTarget = dispatchInput.issues.filter(
      (issue: { n: number, status: string }) => issue.status === 'ready' && targetIssueNumbers.has(issue.n)
    )
    const repositoryHolders = collectTokenHolders(openIssues.map((issue) => mapGhIssue(issue)))
    const issueByNumber = new Map<number, unknown>()
    for (const issue of [...readyTarget, ...repositoryHolders]) issueByNumber.set(issue.n, issue)
    const dispatch = planDispatch([...issueByNumber.values()], {
      mergedIssues: dispatchInput.mergedIssues,
      depStates: dispatchInput.depStates,
      cap: UNCAPPED,
    })
    if (dispatch.selected.length === 0) {
      throw new DispatchNotAvailable(`the plugin did not select a slice: ${JSON.stringify(dispatch.blockReason)}`)
    }

    return dispatch.selected.map(
      (selected: { n: number }) => GhDispatchCandidates.#selectedIssue(selected, openIssues)
    )
  }
}
