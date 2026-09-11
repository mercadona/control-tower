import { PlanAgents } from '../domain/ports/plan-agents.ts'
import { PlanAgentNotLaunched } from '../domain/exceptions.ts'
import type { PlanAgentFailure } from '../domain/exceptions.ts'
import { Projection } from './projection.ts'
import type { PlanAgentBrief } from './plan-agent-brief.ts'
import type { RunSpec, StartedPid } from './detached-run.ts'
import type { PlanBriefing } from '../domain/value-objects/plan-briefing.ts'

export const HarnessStep = Object.freeze({
  WRITE_PLAN: 'write-plan',
  REVIEW_PLAN: 'review-plan',
  IMPLEMENT: 'implement',
  FIX_PULL_REQUEST: 'fix-pull-request',
} as const)

export type HarnessStepValue = (typeof HarnessStep)[keyof typeof HarnessStep]

export type ConversationRecord = {
  readonly worktree: string,
  readonly issue: number,
  readonly repository: string,
  readonly startedAt: number,
}

export type RecordRead = (path: string) => Promise<string | null>

export type RunStarter = {
  start(spec: RunSpec): StartedPid,
  stop(started: StartedPid): void,
}

type MakeDirectory = (path: string) => Promise<void>
type WriteRecord = (path: string, text: string) => Promise<void>
type Mint = () => string
type Clock = () => number

type PlanAgentFailureConstructor = new (reason: string) => PlanAgentFailure

class HarnessPaths {
  readonly directory: string
  readonly out: string
  readonly err: string
  readonly call: string

  constructor({ directory, out, err, call }: { directory: string, out: string, err: string, call: string }) {
    this.directory = directory
    this.out = out
    this.err = err
    this.call = call
    Object.freeze(this)
  }
}

export class HarnessCall {
  static readonly CALL_FILE = 'call.json'
  static readonly STREAM_FILE = 'stream.ndjson'
  static readonly ERROR_FILE = 'stderr.log'

  readonly step: HarnessStepValue
  readonly agent: string
  readonly issue: number
  readonly repository: string
  readonly model: string
  readonly argv: readonly string[]
  readonly pid: number
  readonly startedAt: number

  static pathsFor({ runsIn, agent, step, startedAt }: {
    runsIn: string,
    agent: string,
    step: HarnessStepValue,
    startedAt: number,
  }): HarnessPaths {
    const directory = `${runsIn}/${agent}/${step}-${startedAt}`

    return new HarnessPaths({
      directory,
      out: `${directory}/${HarnessCall.STREAM_FILE}`,
      err: `${directory}/${HarnessCall.ERROR_FILE}`,
      call: `${directory}/${HarnessCall.CALL_FILE}`,
    })
  }

  constructor({ step, agent, issue, repository, model, argv, pid, startedAt }: {
    step: HarnessStepValue,
    agent: string,
    issue: number,
    repository: string,
    model: string,
    argv: readonly string[],
    pid: number,
    startedAt: number,
  }) {
    this.step = step
    this.agent = agent
    this.issue = issue
    this.repository = repository
    this.model = model
    this.argv = argv
    this.pid = pid
    this.startedAt = startedAt
    Object.freeze(this)
  }

  get json() {
    return {
      step: this.step,
      agent: this.agent,
      issue: this.issue,
      repository: this.repository,
      model: this.model,
      argv: this.argv,
      pid: this.pid,
      startedAt: this.startedAt,
    }
  }
}

export class HarnessConversation {
  readonly agent: string
  readonly worktree: string
  readonly issue: number
  readonly repository: string
  readonly startedAt: number

  static isWellFormed(record: unknown): record is ConversationRecord {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) return false
    const { worktree, issue, repository, startedAt } = record as Record<string, unknown>

    return (
      typeof worktree === 'string' && worktree.length > 0 &&
      typeof repository === 'string' && repository.length > 0 &&
      typeof issue === 'number' && Number.isInteger(issue) && issue > 0 &&
      typeof startedAt === 'number' && Number.isInteger(startedAt) && startedAt > 0
    )
  }

  constructor({ agent, worktree, issue, repository, startedAt }: {
    agent: string,
    worktree: string,
    issue: number,
    repository: string,
    startedAt: number,
  }) {
    this.agent = agent
    this.worktree = worktree
    this.issue = issue
    this.repository = repository
    this.startedAt = startedAt
    Object.freeze(this)
  }

  get json(): ConversationRecord {
    return {
      worktree: this.worktree,
      issue: this.issue,
      repository: this.repository,
      startedAt: this.startedAt,
    }
  }
}

export class HeadlessPlanAgents extends PlanAgents {
  static readonly BIN = 'claude'
  static readonly PRINT = '-p'
  static readonly FORMAT: readonly string[] = ['--output-format', 'stream-json', '--verbose']
  static readonly PERMISSION: readonly string[] = ['--permission-mode', 'bypassPermissions']
  static readonly FALLBACK: readonly string[] = ['--fallback-model', 'opus']
  static readonly CONVERSATION_FILE = 'conversation.json'
  static readonly MODELS: Projection<string, HarnessStepValue> = new Projection<string, HarnessStepValue>('model', [
    [HarnessStep.WRITE_PLAN, 'fable'],
    [HarnessStep.REVIEW_PLAN, 'fable'],
    [HarnessStep.IMPLEMENT, 'sonnet'],
    [HarnessStep.FIX_PULL_REQUEST, 'sonnet'],
  ])

  readonly start: RunStarter
  readonly makeDirectory: MakeDirectory
  readonly write: WriteRecord
  readonly read: RecordRead
  readonly mint: Mint
  readonly clock: Clock
  readonly brief: PlanAgentBrief
  readonly runsIn: string
  readonly pluginRoot: string

  static conversationPathFor({ runsIn, agent }: { runsIn: string, agent: string }): string {
    return `${runsIn}/${agent}/${HeadlessPlanAgents.CONVERSATION_FILE}`
  }

  static argvFor({ errand, step, pluginRoot, agent, resuming }: {
    errand: string,
    step: string,
    pluginRoot: string,
    agent: string,
    resuming: boolean,
  }): string[] {
    return [
      HeadlessPlanAgents.PRINT, errand,
      ...HeadlessPlanAgents.FORMAT,
      ...HeadlessPlanAgents.PERMISSION,
      ...HeadlessPlanAgents.FALLBACK,
      '--model', HeadlessPlanAgents.MODELS.of(step),
      '--plugin-dir', pluginRoot,
      ...(resuming ? ['--resume', agent] : ['--session-id', agent]),
    ]
  }

  constructor({ start, makeDirectory, write, read, mint, clock, brief, runsIn, pluginRoot }: {
    start: RunStarter,
    makeDirectory: MakeDirectory,
    write: WriteRecord,
    read: RecordRead,
    mint: Mint,
    clock: Clock,
    brief: PlanAgentBrief,
    runsIn: string,
    pluginRoot: string,
  }) {
    super()
    this.start = start
    this.makeDirectory = makeDirectory
    this.write = write
    this.read = read
    this.mint = mint
    this.clock = clock
    this.brief = brief
    this.runsIn = runsIn
    this.pluginRoot = pluginRoot
  }

  async launch(briefing: PlanBriefing): Promise<string> {
    const agent = this.mint()
    const errand = this.brief.errandFor({ issue: briefing.issue, repository: briefing.repository })
    const step = HarnessStep.WRITE_PLAN
    const argv = HeadlessPlanAgents.argvFor({
      errand, step, pluginRoot: this.pluginRoot, agent, resuming: false,
    })
    const startedAt = this.clock()
    const { directory, out, err, call } = HarnessCall.pathsFor({
      runsIn: this.runsIn, agent, step, startedAt,
    })

    await this.#ensureDirectory(directory, PlanAgentNotLaunched)
    await this.#writeRecord(
      this.#conversationPathFor(agent),
      JSON.stringify(new HarnessConversation({
        agent,
        worktree: briefing.located.path,
        issue: briefing.issue.number,
        repository: briefing.repository.text,
        startedAt,
      }).json),
      PlanAgentNotLaunched
    )
    const started = this.#startRun({ argv, cwd: briefing.located.path, out, err }, PlanAgentNotLaunched)

    await this.#recordCall({
      call, step, agent, issue: briefing.issue.number, repository: briefing.repository.text,
      argv, started, startedAt, Failure: PlanAgentNotLaunched,
    })

    return agent
  }

  #conversationPathFor(agent: string): string {
    return HeadlessPlanAgents.conversationPathFor({ runsIn: this.runsIn, agent })
  }

  #startRun({ argv, cwd, out, err }: RunSpec, Failure: PlanAgentFailureConstructor): StartedPid {
    try {
      return this.start.start({ argv, cwd, out, err })
    } catch (failure) {
      throw new Failure(HeadlessPlanAgents.#messageOf(failure))
    }
  }

  async #ensureDirectory(directory: string, Failure: PlanAgentFailureConstructor): Promise<void> {
    try {
      await this.makeDirectory(directory)
    } catch (failure) {
      throw new Failure(
        `the run directory ${directory} could not be made: ${HeadlessPlanAgents.#messageOf(failure)}`
      )
    }
  }

  async #recordCall({ call, step, agent, issue, repository, argv, started, startedAt, Failure }: {
    call: string,
    step: HarnessStepValue,
    agent: string,
    issue: number,
    repository: string,
    argv: readonly string[],
    started: StartedPid,
    startedAt: number,
    Failure: PlanAgentFailureConstructor,
  }): Promise<void> {
    await this.#writeRecord(call, JSON.stringify(new HarnessCall({
      step,
      agent,
      issue,
      repository,
      model: HeadlessPlanAgents.MODELS.of(step),
      argv,
      pid: started.pid,
      startedAt,
    }).json), Failure, started)
  }

  async #writeRecord(
    path: string, text: string, Failure: PlanAgentFailureConstructor, started: StartedPid | null = null
  ): Promise<void> {
    try {
      await this.write(path, text)
    } catch (failure) {
      if (started !== null) this.start.stop(started)
      throw new Failure(`${path} could not be written: ${HeadlessPlanAgents.#messageOf(failure)}`)
    }
  }

  static #messageOf(failure: unknown): string {
    return failure instanceof Error ? failure.message : String(failure)
  }
}
