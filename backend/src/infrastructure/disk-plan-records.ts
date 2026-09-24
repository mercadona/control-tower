import { join } from 'node:path'
import { HarvestNotRecorded, PlanAgentFailure, PlanAgentNotLaunched, PlanAgentNotNamed } from '../domain/exceptions.ts'
import { PlanRecords } from '../domain/ports/plan-records.ts'
import { ConversationId } from '../domain/value-objects/conversation-id.ts'
import { HarvestedWork } from '../domain/value-objects/harvested-work.ts'
import type { PlanBriefing } from '../domain/value-objects/plan-briefing.ts'
import type { PlanNonLaunch } from '../domain/value-objects/plan-non-launch.ts'
import { StartedPlanCall } from '../domain/value-objects/plan-call.ts'
import { UnusedWorkspace } from '../domain/value-objects/unused-workspace.ts'
import { PlanIssue } from '../domain/value-objects/plan-issue.ts'
import { PlansInFlight } from '../domain/value-objects/plans-in-flight.ts'
import { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import { UserStoryReference } from '../domain/value-objects/user-story-reference.ts'
import { WorkspaceLocation } from '../domain/value-objects/workspace-location.ts'
import { HeadlessFiles } from './headless-files.ts'
import { CallDescriptor, StoredCompletion } from './claude-calls.ts'
import { NonLaunchRecord } from './non-launch-record.ts'

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

class CleanupEvidenceRecord {
  static readonly #FIELDS = Object.freeze(['conversation', 'baseSha', 'branch', 'worktree', 'checkedAt'])

  static text(evidence: UnusedWorkspace): string {
    return `${JSON.stringify({
      conversation: evidence.watch.agent,
      baseSha: evidence.baseSha,
      branch: evidence.watch.located.branch,
      worktree: evidence.watch.located.path,
      checkedAt: evidence.checkedAt,
    }, null, 2)}\n`
  }

  static read(text: string, watch: PlanWatch): UnusedWorkspace {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('cleanup evidence must be a JSON object')
    }
    const record = Object.fromEntries(Object.entries(parsed))
    const fields = Object.keys(record).sort()
    const expected = [...CleanupEvidenceRecord.#FIELDS].sort()
    if (fields.length !== expected.length || fields.some((field, index) => field !== expected[index])) {
      throw new Error(`cleanup evidence must contain exactly ${expected.join(', ')}, got ${fields.join(', ')}`)
    }
    if (record.conversation !== watch.agent || record.branch !== watch.located.branch
      || record.worktree !== watch.located.path) {
      throw new Error('cleanup evidence identity differs from its dispatch')
    }
    return new UnusedWorkspace({
      watch,
      baseSha: String(record.baseSha),
      checkedAt: String(record.checkedAt),
    })
  }
}

class HarvestReceiptRecord {
  static readonly VERSION = 1
  static readonly #FIELDS = Object.freeze(['at', 'version'])

  static text(harvestedAt: string): string {
    return `${JSON.stringify({ version: HarvestReceiptRecord.VERSION, at: harvestedAt }, null, 2)}\n`
  }

  static read(text: string, watch: PlanWatch): HarvestedWork {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('a harvest receipt must be a JSON object')
    }
    const record = Object.fromEntries(Object.entries(parsed))
    const fields = Object.keys(record).sort()
    if (fields.length !== HarvestReceiptRecord.#FIELDS.length
      || fields.some((field, index) => field !== HarvestReceiptRecord.#FIELDS[index])) {
      throw new Error(`a harvest receipt must contain exactly ${HarvestReceiptRecord.#FIELDS.join(', ')}, got ${fields.join(', ')}`)
    }
    if (record.version !== HarvestReceiptRecord.VERSION) {
      throw new Error(`a harvest receipt must be version ${HarvestReceiptRecord.VERSION}, got ${JSON.stringify(record.version)}`)
    }
    return new HarvestedWork({ watch, harvestedAt: String(record.at) })
  }
}

export class DiskPlanRecords extends PlanRecords {
  static readonly DIRECTORY = 'harness'
  static readonly RETIRED_DIRECTORY = 'retired-harness'
  static readonly NON_LAUNCH = 'non-launch.json'
  static readonly CLEANUP_EVIDENCE = 'cleanup-evidence.json'
  static readonly HARVEST_RECEIPT = 'harvest.json'

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
      if (HeadlessFiles.isSystemFailure(cause)) {
        throw new PlanAgentNotLaunched(`${path} could not be written: ${String(cause)}`)
      }
      throw cause
    }
    return record.watch(agent)
  }

  async recorded(agent: string): Promise<PlanWatch | null> {
    return this.#recordedIn(agent, DiskPlanRecords.DIRECTORY)
  }

  async retired(agent: string): Promise<PlanWatch | null> {
    return this.#recordedIn(agent, DiskPlanRecords.RETIRED_DIRECTORY)
  }

  async cleanupEvidence(watch: PlanWatch): Promise<UnusedWorkspace | null> {
    const path = join(
      this.files.root,
      DiskPlanRecords.DIRECTORY,
      watch.agent,
      DiskPlanRecords.CLEANUP_EVIDENCE,
    )
    const text = await this.#read(path)
    if (text === null) return null
    try {
      return CleanupEvidenceRecord.read(text, watch)
    } catch (cause) {
      throw new PlanAgentNotNamed(`${path} cannot be read as cleanup evidence: ${String(cause)}`)
    }
  }

  async recordCleanupEvidence(evidence: UnusedWorkspace): Promise<void> {
    const path = join(
      this.files.root,
      DiskPlanRecords.DIRECTORY,
      evidence.watch.agent,
      DiskPlanRecords.CLEANUP_EVIDENCE,
    )
    const text = CleanupEvidenceRecord.text(evidence)
    try {
      await this.files.writeOnce(path, text)
    } catch (cause) {
      if (!DiskPlanRecords.#hasCode(cause, 'EEXIST')) {
        if (HeadlessFiles.isSystemFailure(cause)) {
          throw new PlanAgentNotLaunched(`${path} could not be written: ${String(cause)}`)
        }
        throw cause
      }
      const existing = await this.#read(path)
      if (existing !== text) throw new PlanAgentNotNamed(`${path} contains conflicting cleanup evidence`)
    }
  }

  async archive(watch: PlanWatch): Promise<void> {
    const recorded = await this.recorded(watch.agent)
    if (recorded === null || !DiskPlanRecords.#sameIdentity(recorded, watch)) {
      throw new PlanAgentNotNamed(`active plan ${watch.agent} differs before retirement`)
    }
    const source = join(this.files.root, DiskPlanRecords.DIRECTORY, watch.agent)
    const destinationRoot = join(this.files.root, DiskPlanRecords.RETIRED_DIRECTORY)
    const destination = join(destinationRoot, watch.agent)
    try {
      await this.files.fs.mkdir(destinationRoot, { recursive: true })
      await this.files.fs.stat(destination)
      throw new PlanAgentNotNamed(`${destination} already exists`)
    } catch (cause) {
      if (!DiskPlanRecords.#hasCode(cause, 'ENOENT') && HeadlessFiles.isSystemFailure(cause)) {
        throw new PlanAgentNotLaunched(`${destination} could not be checked before retirement: ${String(cause)}`)
      }
      if (!DiskPlanRecords.#hasCode(cause, 'ENOENT')) {
        throw cause
      }
    }
    try {
      await this.files.fs.rename(source, destination)
    } catch (cause) {
      if (HeadlessFiles.isSystemFailure(cause)) {
        throw new PlanAgentNotLaunched(`${source} could not be retired to ${destination}: ${String(cause)}`)
      }
      throw cause
    }
  }

  async recordNonLaunch(watch: PlanWatch, proof: PlanNonLaunch): Promise<void> {
    const path = this.#nonLaunchPath(watch.agent)
    const text = NonLaunchRecord.text(proof)
    try {
      await this.files.writeOnce(path, text)
    } catch (cause) {
      if (!DiskPlanRecords.#hasCode(cause, 'EEXIST')) {
        if (HeadlessFiles.isSystemFailure(cause)) {
          throw new PlanAgentNotLaunched(`${path} could not be written: ${String(cause)}`)
        }
        throw cause
      }
      const existing = await this.#read(path)
      if (existing !== text) throw new PlanAgentNotNamed(`${path} contains conflicting non-launch evidence`)
    }
  }

  async nonLaunch(watch: PlanWatch): Promise<PlanNonLaunch | null> {
    const path = this.#nonLaunchPath(watch.agent)
    const text = await this.#read(path)
    if (text === null) return null
    let proof: PlanNonLaunch
    try {
      proof = NonLaunchRecord.read(text)
    } catch (cause) {
      throw new PlanAgentNotNamed(`${path} cannot be read as non-launch evidence: ${String(cause)}`)
    }
    await this.#validateNonLaunch(watch, proof, path)
    return proof
  }

  async find(asked: { issue: number, repository: RepositoryName }): Promise<PlanWatch | null> {
    const found = this.#matching(await this.#descriptors(), asked)
    if (found === null) return null
    if (!(await this.#exists(found.located.path)) && await this.cleanupEvidence(found) === null) return null
    return found
  }

  async recordHarvest(asked: { issue: number, repository: RepositoryName }): Promise<void> {
    let found: PlanWatch | null
    try {
      found = this.#matching(await this.#descriptors(), asked)
    } catch (cause) {
      if (!(cause instanceof PlanAgentFailure)) throw cause
      throw new HarvestNotRecorded(
        `the harvest of ${asked.repository.text}#${asked.issue} could not be recorded: ${cause.message}`
      )
    }
    if (found === null) return
    const path = this.#harvestReceiptPath(found.agent)
    try {
      await this.files.writeOnce(path, HarvestReceiptRecord.text(this.now()))
    } catch (cause) {
      throw new HarvestNotRecorded(`${path} could not be written: ${String(cause)}`)
    }
  }

  async harvested(asked: { issue: number, repository: RepositoryName }): Promise<HarvestedWork | null> {
    const found = this.#matching(await this.#descriptors(), asked)
    if (found === null) return null
    const path = this.#harvestReceiptPath(found.agent)
    const text = await this.#read(path)
    if (text === null) return null
    try {
      return HarvestReceiptRecord.read(text, found)
    } catch (cause) {
      throw new PlanAgentNotNamed(`${path} cannot be read as a harvest receipt: ${String(cause)}`)
    }
  }

  async inFlight(): Promise<PlansInFlight> {
    try {
      const watches = await this.#descriptors()
      const existing: PlanWatch[] = []
      for (const watch of watches) {
        if (await this.#exists(watch.located.path) || await this.cleanupEvidence(watch) !== null) existing.push(watch)
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
      if (HeadlessFiles.isSystemFailure(cause)) {
        throw new PlanAgentNotLaunched(`${directory} could not be listed: ${String(cause)}`)
      }
      throw cause
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
    return this.#recordAtIn(agent, DiskPlanRecords.DIRECTORY)
  }

  async #recordedIn(agent: string, directory: string): Promise<PlanWatch | null> {
    let conversation: ConversationId
    try {
      conversation = new ConversationId(agent)
    } catch (cause) {
      throw new PlanAgentNotNamed(`${agent} cannot name a prepared plan: ${String(cause)}`)
    }
    return this.#recordAtIn(conversation, directory)
  }

  async #recordAtIn(agent: ConversationId, directory: string): Promise<PlanWatch | null> {
    const path = join(this.files.root, directory, agent.text, 'dispatch.json')
    let text: string | null
    try {
      text = await this.files.read(path)
    } catch (cause) {
      if (HeadlessFiles.isSystemFailure(cause)) {
        throw new PlanAgentNotLaunched(`${path} could not be read: ${String(cause)}`)
      }
      throw cause
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
      if (HeadlessFiles.isSystemFailure(cause)) {
        throw new PlanAgentNotLaunched(`${path} could not be checked: ${String(cause)}`)
      }
      throw cause
    }
  }

  async #validateNonLaunch(watch: PlanWatch, proof: PlanNonLaunch, path: string): Promise<void> {
    if (proof.conversation !== watch.agent) {
      throw new PlanAgentNotNamed(`${path} identity differs from dispatch ${watch.agent}`)
    }
    const calls = join(this.files.root, DiskPlanRecords.DIRECTORY, watch.agent, 'calls')
    const names = await this.#list(calls)
    if (proof.callId === null) {
      if (proof.source !== 'before-worker' || names.length !== 0) {
        throw new PlanAgentNotNamed(`${path} conflicts with recorded call history`)
      }
      return
    }
    if (proof.source === 'before-worker' && names.length === 0) return
    if (names.length !== 1 || names[0] !== proof.callId) {
      throw new PlanAgentNotNamed(`${path} conflicts with recorded call history`)
    }
    const directory = join(calls, proof.callId)
    const stream = await this.#read(join(directory, CallDescriptor.STREAM))
    const completionText = await this.#read(join(directory, CallDescriptor.COMPLETION))
    if (stream !== null && stream.length > 0) {
      throw new PlanAgentNotNamed(`${path} conflicts with recorded launch evidence`)
    }
    const descriptorText = await this.#read(join(directory, CallDescriptor.FILE))
    if (descriptorText === null) {
      if (proof.source === 'before-worker' && completionText === null) return
      throw new PlanAgentNotNamed(`${path} has no descriptor for ${proof.source}`)
    }
    let descriptor: CallDescriptor
    try {
      descriptor = CallDescriptor.from(descriptorText)
    } catch (cause) {
      throw new PlanAgentNotNamed(`${path} conflicts with its call descriptor: ${String(cause)}`)
    }
    if (descriptor.conversation !== watch.agent || descriptor.purpose !== 'plan'
      || descriptor.cwd !== watch.located.path || descriptor.mode() !== 'initial') {
      throw new PlanAgentNotNamed(`${path} conflicts with recorded launch evidence`)
    }
    if (proof.source === 'child-spawn') {
      if (completionText === null) throw new PlanAgentNotNamed(`${path} has no child-spawn terminal evidence`)
      let completion
      try {
        completion = StoredCompletion.read(
          completionText,
          new StartedPlanCall({ conversation: watch.agent, id: proof.callId }),
          descriptor.mode(),
        )
      } catch (cause) {
        throw new PlanAgentNotNamed(`${path} conflicts with its child-spawn terminal: ${String(cause)}`)
      }
      if (completion.execution.kind !== 'child-spawn-failed'
        || completion.execution.conversation !== proof.conversation
        || completion.execution.callId !== proof.callId
        || completion.execution.diagnostic !== proof.diagnostic
        || completion.finishedAt !== proof.observedAt) {
        throw new PlanAgentNotNamed(`${path} conflicts with its child-spawn terminal`)
      }
      return
    }
    if (completionText !== null) throw new PlanAgentNotNamed(`${path} conflicts with recorded launch evidence`)
  }

  async #read(path: string): Promise<string | null> {
    try {
      return await this.files.read(path)
    } catch (cause) {
      if (HeadlessFiles.isSystemFailure(cause)) {
        throw new PlanAgentNotLaunched(`${path} could not be read: ${String(cause)}`)
      }
      throw cause
    }
  }

  async #list(path: string): Promise<string[]> {
    try {
      return await this.files.list(path)
    } catch (cause) {
      if (HeadlessFiles.isSystemFailure(cause)) {
        throw new PlanAgentNotLaunched(`${path} could not be listed: ${String(cause)}`)
      }
      throw cause
    }
  }

  #nonLaunchPath(agent: string): string {
    return join(this.files.root, DiskPlanRecords.DIRECTORY, agent, DiskPlanRecords.NON_LAUNCH)
  }

  #harvestReceiptPath(agent: string): string {
    return join(this.files.root, DiskPlanRecords.DIRECTORY, agent, DiskPlanRecords.HARVEST_RECEIPT)
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

  static #sameIdentity(left: PlanWatch, right: PlanWatch): boolean {
    return left.agent === right.agent
      && left.issue.number === right.issue.number
      && left.issue.url === right.issue.url
      && left.repository.text === right.repository.text
      && left.located.root === right.located.root
      && left.located.path === right.located.path
      && left.located.branch === right.located.branch
  }
}
