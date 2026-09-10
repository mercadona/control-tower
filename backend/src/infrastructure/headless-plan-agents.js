import { PlanAgents } from '../domain/ports/plan-agents.js'
import { PlanAgentNotLaunched, PlanAgentNotNamed, PlanAgentNotResumed } from '../domain/exceptions.js'
import { Projection } from './projection.js'

export const HarnessStep = Object.freeze({
  WRITE_PLAN: 'write-plan',
  REVIEW_PLAN: 'review-plan',
  IMPLEMENT: 'implement',
  FIX_PULL_REQUEST: 'fix-pull-request',
})

class HarnessPaths {
  constructor({ directory, out, err, call }) {
    this.directory = directory
    this.out = out
    this.err = err
    this.call = call
    Object.freeze(this)
  }
}

export class HarnessCall {
  static CALL_FILE = 'call.json'
  static STREAM_FILE = 'stream.ndjson'
  static ERROR_FILE = 'stderr.log'

  static pathsFor({ runsIn, agent, step, startedAt }) {
    const directory = `${runsIn}/${agent}/${step}-${startedAt}`

    return new HarnessPaths({
      directory,
      out: `${directory}/${HarnessCall.STREAM_FILE}`,
      err: `${directory}/${HarnessCall.ERROR_FILE}`,
      call: `${directory}/${HarnessCall.CALL_FILE}`,
    })
  }

  constructor({ step, agent, issue, repository, model, argv, pid, startedAt }) {
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
  static isWellFormed(record) {
    return (
      record !== null &&
      typeof record === 'object' &&
      !Array.isArray(record) &&
      typeof record.worktree === 'string' && record.worktree.length > 0 &&
      typeof record.repository === 'string' && record.repository.length > 0 &&
      Number.isInteger(record.issue) && record.issue > 0 &&
      Number.isInteger(record.startedAt) && record.startedAt > 0
    )
  }

  constructor({ agent, worktree, issue, repository, startedAt }) {
    this.agent = agent
    this.worktree = worktree
    this.issue = issue
    this.repository = repository
    this.startedAt = startedAt
    Object.freeze(this)
  }

  get json() {
    return {
      worktree: this.worktree,
      issue: this.issue,
      repository: this.repository,
      startedAt: this.startedAt,
    }
  }
}

export class HeadlessPlanAgents extends PlanAgents {
  static TRANSPORT = 'headless'
  static BIN = 'claude'
  static PRINT = '-p'
  static FORMAT = ['--output-format', 'stream-json', '--verbose']
  static PERMISSION = ['--permission-mode', 'bypassPermissions']
  static FALLBACK = ['--fallback-model', 'opus']
  static CONVERSATION_FILE = 'conversation.json'
  static MODELS = new Projection('model', [
    [HarnessStep.WRITE_PLAN, 'fable'],
    [HarnessStep.REVIEW_PLAN, 'fable'],
    [HarnessStep.IMPLEMENT, 'sonnet'],
    [HarnessStep.FIX_PULL_REQUEST, 'sonnet'],
  ])

  static argvFor({ errand, step, pluginRoot, agent, resuming }) {
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

  constructor({ start, makeDirectory, write, read, mint, clock, brief, runsIn, pluginRoot }) {
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

  async launch(briefing) {
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

  async resume({ agent, issue, repository }) {
    await this.#continue({
      agent,
      issue,
      repository,
      step: HarnessStep.IMPLEMENT,
      errand: this.brief.implementationErrandFor({ issueNumber: issue, repository }),
    })
  }

  async review({ agent, issue, repository, changes }) {
    await this.#continue({
      agent,
      issue,
      repository,
      step: HarnessStep.REVIEW_PLAN,
      errand: this.brief.reviewErrandFor({ issueNumber: issue, repository, changes }),
    })
  }

  async fix({ agent, issue, repository, changes }) {
    await this.#continue({
      agent,
      issue,
      repository,
      step: HarnessStep.FIX_PULL_REQUEST,
      errand: this.brief.fixErrandFor({ issueNumber: issue, repository, changes }),
    })
  }

  async #continue({ agent, issue, repository, step, errand }) {
    const cwd = await this.#worktreeOf(agent)
    const argv = HeadlessPlanAgents.argvFor({
      errand, step, pluginRoot: this.pluginRoot, agent, resuming: true,
    })
    const startedAt = this.clock()
    const { directory, out, err, call } = HarnessCall.pathsFor({
      runsIn: this.runsIn, agent, step, startedAt,
    })

    await this.#ensureDirectory(directory, PlanAgentNotResumed)
    const started = this.#startRun({ argv, cwd, out, err }, PlanAgentNotResumed)

    await this.#recordCall({
      call, step, agent, issue, repository: repository.text,
      argv, started, startedAt, Failure: PlanAgentNotResumed,
    })
  }

  async #worktreeOf(agent) {
    const path = this.#conversationPathFor(agent)
    const text = await this.#readRecord(path)
    if (text === null) {
      throw new PlanAgentNotResumed(
        `${agent} never recorded a worktree at ${path}: launch was never called for it`
      )
    }

    let record
    try {
      record = JSON.parse(text)
    } catch (cause) {
      throw new PlanAgentNotNamed(
        `${agent} recorded a conversation at ${path} that is not JSON: ${cause.message}`
      )
    }
    if (!HarnessConversation.isWellFormed(record)) {
      throw new PlanAgentNotNamed(
        `${agent} recorded a conversation at ${path} that is not a well-formed record`
      )
    }

    return record.worktree
  }

  #conversationPathFor(agent) {
    return `${this.runsIn}/${agent}/${HeadlessPlanAgents.CONVERSATION_FILE}`
  }

  #startRun({ argv, cwd, out, err }, Failure) {
    try {
      return this.start.start({ argv, cwd, out, err })
    } catch (failure) {
      throw new Failure(failure.message)
    }
  }

  async #ensureDirectory(directory, Failure) {
    try {
      await this.makeDirectory(directory)
    } catch (failure) {
      throw new Failure(`the run directory ${directory} could not be made: ${failure.message}`)
    }
  }

  async #recordCall({ call, step, agent, issue, repository, argv, started, startedAt, Failure }) {
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

  async #writeRecord(path, text, Failure, started = null) {
    try {
      await this.write(path, text)
    } catch (failure) {
      if (started !== null) this.start.stop(started)
      throw new Failure(`${path} could not be written: ${failure.message}`)
    }
  }

  async #readRecord(path) {
    try {
      return await this.read(path)
    } catch (failure) {
      throw new PlanAgentNotResumed(`${path} could not be read: ${failure.message}`)
    }
  }
}
