import { PlanAgents } from '../domain/ports/plan-agents.js'
import { PlanAgentNotLaunched, PlanAgentNotNamed, PlanAgentNotResumed } from '../domain/exceptions.js'

export const HarnessStep = Object.freeze({
  WRITE_PLAN: 'write-plan',
  REVIEW_PLAN: 'review-plan',
  IMPLEMENT: 'implement',
  FIX_PULL_REQUEST: 'fix-pull-request',
})

export class HarnessPaths {
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

export class HeadlessPlanAgents extends PlanAgents {
  static TRANSPORT = 'headless'
  static BIN = 'claude'
  static PRINT = '-p'
  static FORMAT = ['--output-format', 'stream-json', '--verbose']
  static PERMISSION = ['--permission-mode', 'bypassPermissions']
  static CONVERSATION_FILE = 'conversation.json'

  static argvFor({ errand, model, pluginRoot, agent, resuming }) {
    return [
      HeadlessPlanAgents.PRINT, errand,
      ...HeadlessPlanAgents.FORMAT,
      ...HeadlessPlanAgents.PERMISSION,
      '--model', model,
      '--plugin-dir', pluginRoot,
      ...(resuming ? ['--resume', agent] : ['--session-id', agent]),
    ]
  }

  constructor({ start, makeDirectory, write, read, mint, clock, brief, runsIn, model, pluginRoot }) {
    super()
    this.start = start
    this.makeDirectory = makeDirectory
    this.write = write
    this.read = read
    this.mint = mint
    this.clock = clock
    this.brief = brief
    this.runsIn = runsIn
    this.model = model
    this.pluginRoot = pluginRoot
  }

  async launch(briefing) {
    const agent = this.mint()
    const errand = this.brief.errandFor({ issue: briefing.issue, repository: briefing.repository })
    const argv = HeadlessPlanAgents.argvFor({
      errand, model: this.model, pluginRoot: this.pluginRoot, agent, resuming: false,
    })
    const startedAt = this.clock()
    const step = HarnessStep.WRITE_PLAN
    const { directory, out, err, call } = HarnessCall.pathsFor({
      runsIn: this.runsIn, agent, step, startedAt,
    })

    await this.#ensureDirectory(directory)
    await this.#writeRecord(
      this.#conversationPathFor(agent),
      JSON.stringify({ worktree: briefing.located.path })
    )
    const started = this.start.start({ argv, cwd: briefing.located.path, out, err })

    await this.#writeRecord(call, JSON.stringify(new HarnessCall({
      step,
      agent,
      issue: briefing.issue.number,
      repository: briefing.repository.text,
      model: this.model,
      argv,
      pid: started.pid,
      startedAt,
    }).json))

    return agent
  }

  async worktreeOf(agent) {
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
    if (record === null || typeof record.worktree !== 'string') {
      throw new PlanAgentNotNamed(`${agent} recorded a conversation at ${path} with no worktree`)
    }

    return record.worktree
  }

  #conversationPathFor(agent) {
    return `${this.runsIn}/${agent}/${HeadlessPlanAgents.CONVERSATION_FILE}`
  }

  async #ensureDirectory(directory) {
    try {
      await this.makeDirectory(directory)
    } catch (failure) {
      throw new PlanAgentNotLaunched(`the run directory ${directory} could not be made: ${failure.message}`)
    }
  }

  async #writeRecord(path, text) {
    try {
      await this.write(path, text)
    } catch (failure) {
      throw new PlanAgentNotLaunched(`${path} could not be written: ${failure.message}`)
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
