import { join } from 'node:path'
import { PlanAgentFailure, PlanAgentNotLaunched, PlanAgentNotNamed } from '../domain/exceptions.ts'
import { PlanRecords } from '../domain/ports/plan-records.ts'
import { ConversationId } from '../domain/value-objects/conversation-id.ts'
import type { PlanBriefing } from '../domain/value-objects/plan-briefing.ts'
import { PlanIssue } from '../domain/value-objects/plan-issue.ts'
import { PlansInFlight } from '../domain/value-objects/plans-in-flight.ts'
import { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import { UserStoryReference } from '../domain/value-objects/user-story-reference.ts'
import { WorkspaceLocation } from '../domain/value-objects/workspace-location.ts'
import type { HeadlessFiles } from './headless-files.ts'

type JsonObject = Record<string, unknown>

class DispatchRecord {
  static readonly FIELDS = Object.freeze([
    'repository', 'issue', 'story', 'root', 'worktree', 'branch', 'startedAt',
  ])
  static readonly ISSUE_FIELDS = Object.freeze(['number', 'url'])
  static readonly #TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

  readonly repository: RepositoryName
  readonly issue: PlanIssue
  readonly story: ReturnType<typeof UserStoryReference.of> | null
  readonly root: string
  readonly worktree: string
  readonly branch: string
  readonly startedAt: string

  constructor(asked: {
    repository: RepositoryName,
    issue: PlanIssue,
    story: ReturnType<typeof UserStoryReference.of> | null,
    root: string,
    worktree: string,
    branch: string,
    startedAt: string,
  }) {
    this.repository = asked.repository
    this.issue = asked.issue
    this.story = asked.story
    this.root = asked.root
    this.worktree = asked.worktree
    this.branch = asked.branch
    this.startedAt = asked.startedAt
    Object.freeze(this)
  }

  static prepared(briefing: PlanBriefing, startedAt: string): DispatchRecord {
    return new DispatchRecord({
      repository: briefing.repository,
      issue: briefing.issue,
      story: briefing.story,
      root: DispatchRecord.#text('root', briefing.located.root),
      worktree: DispatchRecord.#text('worktree', briefing.located.path),
      branch: DispatchRecord.#text('branch', briefing.located.branch),
      startedAt: DispatchRecord.#time(startedAt),
    })
  }

  static from(text: string): DispatchRecord {
    const parsed: unknown = JSON.parse(text)
    DispatchRecord.#requireObject('dispatch record', parsed)
    DispatchRecord.#exactFields('dispatch record', parsed, DispatchRecord.FIELDS)
    const issue: unknown = parsed.issue
    DispatchRecord.#requireObject('issue', issue)
    DispatchRecord.#exactFields('issue', issue, DispatchRecord.ISSUE_FIELDS)
    const story = parsed.story
    if (story !== null && !UserStoryReference.isWellFormed(story)) {
      throw new Error(`story must be a user story reference or null, got ${JSON.stringify(story)}`)
    }

    return new DispatchRecord({
      repository: new RepositoryName(parsed.repository),
      issue: new PlanIssue({ number: issue.number, url: issue.url }),
      story: story === null ? null : UserStoryReference.of(story),
      root: DispatchRecord.#text('root', parsed.root),
      worktree: DispatchRecord.#text('worktree', parsed.worktree),
      branch: DispatchRecord.#text('branch', parsed.branch),
      startedAt: DispatchRecord.#time(parsed.startedAt),
    })
  }

  text(): string {
    return `${JSON.stringify({
      repository: this.repository.text,
      issue: { number: this.issue.number, url: this.issue.url },
      story: this.story === null ? null : this.story.text,
      root: this.root,
      worktree: this.worktree,
      branch: this.branch,
      startedAt: this.startedAt,
    }, null, 2)}\n`
  }

  watch(agent: ConversationId): PlanWatch {
    return new PlanWatch({
      story: this.story,
      issue: this.issue,
      located: new WorkspaceLocation({ root: this.root, path: this.worktree, branch: this.branch }),
      repository: this.repository,
      agent: agent.text,
    })
  }

  static #requireObject(name: string, value: unknown): asserts value is JsonObject {
    if (!DispatchRecord.#isJsonObject(value)) {
      throw new Error(`${name} must be a JSON object, got ${JSON.stringify(value)}`)
    }
  }

  static #isJsonObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  static #exactFields(name: string, value: JsonObject, fields: readonly string[]): void {
    const found = Object.keys(value).sort()
    const expected = [...fields].sort()
    if (found.length !== expected.length || found.some((field, index) => field !== expected[index])) {
      throw new Error(`${name} must contain exactly ${expected.join(', ')}, got ${found.join(', ')}`)
    }
  }

  static #text(name: string, value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${name} must be non-empty text, got ${JSON.stringify(value)}`)
    }
    return value
  }

  static #time(value: unknown): string {
    if (typeof value !== 'string' || !DispatchRecord.#TIMESTAMP.test(value)) {
      throw new Error(`startedAt must be an ISO timestamp, got ${JSON.stringify(value)}`)
    }
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
      throw new Error(`startedAt must be an ISO timestamp, got ${JSON.stringify(value)}`)
    }
    return value
  }
}

export class DiskPlanRecords extends PlanRecords {
  static readonly DIRECTORY = 'harness'

  readonly files: HeadlessFiles
  readonly newId: () => string
  readonly now: () => string
  readonly exists: (path: string) => Promise<boolean>

  constructor(asked: {
    files: HeadlessFiles,
    newId: () => string,
    now: () => string,
    exists: (path: string) => Promise<boolean>,
  }) {
    super()
    this.files = asked.files
    this.newId = asked.newId
    this.now = asked.now
    this.exists = asked.exists
  }

  async prepare(briefing: PlanBriefing): Promise<PlanWatch> {
    const existing = this.#matching(await this.#descriptors(), {
      issue: briefing.issue.number, repository: briefing.repository,
    })
    if (existing !== null) {
      throw new PlanAgentNotLaunched(
        `the prepared plan for ${briefing.issue} in ${briefing.repository} already exists at ${this.files.dispatchPath(existing.agent)}`
      )
    }

    let agent: ConversationId
    let record: DispatchRecord
    try {
      agent = new ConversationId(this.newId())
      record = DispatchRecord.prepared(briefing, this.now())
    } catch (cause) {
      throw new PlanAgentNotNamed(`the prepared plan could not be named: ${String(cause)}`)
    }
    const path = this.files.dispatchPath(agent.text)
    try {
      await this.files.writeOnce(path, record.text())
    } catch (cause) {
      if (DiskPlanRecords.#hasCode(cause, 'EEXIST')) await this.#recordAt(agent)
      throw new PlanAgentNotLaunched(`${path} could not be written: ${String(cause)}`)
    }
    return record.watch(agent)
  }

  async find(asked: { issue: number, repository: RepositoryName }): Promise<PlanWatch | null> {
    const found = this.#matching(await this.#descriptors(), asked)
    if (found === null) return null
    if (!(await this.#exists(found.located.path))) return null
    return found
  }

  async inFlight(): Promise<PlansInFlight> {
    try {
      const watches = await this.#descriptors()
      const existing: PlanWatch[] = []
      for (const watch of watches) {
        if (await this.#exists(watch.located.path)) existing.push(watch)
      }
      return PlansInFlight.listed(existing)
    } catch (cause) {
      if (cause instanceof PlanAgentFailure) return PlansInFlight.refused(cause.message)
      throw cause
    }
  }

  async #descriptors(): Promise<PlanWatch[]> {
    const directory = join(this.files.root, DiskPlanRecords.DIRECTORY)
    let names: string[]
    try {
      names = await this.files.list(directory)
    } catch (cause) {
      throw new PlanAgentNotLaunched(`${directory} could not be listed: ${String(cause)}`)
    }
    const watches: PlanWatch[] = []
    for (const name of names) {
      let agent: ConversationId
      try {
        agent = new ConversationId(name)
      } catch (cause) {
        throw new PlanAgentNotNamed(`${this.files.dispatchPath(name)} cannot name a prepared plan: ${String(cause)}`)
      }
      const watch = await this.#recordAt(agent)
      if (watch !== null) watches.push(watch)
    }
    DiskPlanRecords.#refuseDuplicates(watches)
    return watches
  }

  async #recordAt(agent: ConversationId): Promise<PlanWatch | null> {
    const path = this.files.dispatchPath(agent.text)
    let text: string | null
    try {
      text = await this.files.read(path)
    } catch (cause) {
      throw new PlanAgentNotLaunched(`${path} could not be read: ${String(cause)}`)
    }
    if (text === null) return null
    try {
      return DispatchRecord.from(text).watch(agent)
    } catch (cause) {
      throw new PlanAgentNotNamed(`${path} cannot be read as a prepared plan: ${String(cause)}`)
    }
  }

  async #exists(path: string): Promise<boolean> {
    try {
      return await this.exists(path)
    } catch (cause) {
      throw new PlanAgentNotLaunched(`${path} could not be checked: ${String(cause)}`)
    }
  }

  #matching(watches: readonly PlanWatch[], asked: {
    issue: number, repository: RepositoryName,
  }): PlanWatch | null {
    return watches.find((watch) => (
      watch.issue.number === asked.issue && watch.repository.text === asked.repository.text
    )) ?? null
  }

  static #refuseDuplicates(watches: readonly PlanWatch[]): void {
    const identities = new Set<string>()
    for (const watch of watches) {
      const identity = `${watch.repository.text}#${watch.issue.number}`
      if (identities.has(identity)) {
        throw new PlanAgentNotNamed(`more than one prepared plan names ${identity}`)
      }
      identities.add(identity)
    }
  }

  static #hasCode(cause: unknown, code: string): boolean {
    return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === code
  }
}
