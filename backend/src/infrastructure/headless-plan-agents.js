import { PlanAgents } from '../domain/ports/plan-agents.js'

export const HarnessStep = Object.freeze({
  WRITE_PLAN: 'write-plan',
  REVIEW_PLAN: 'review-plan',
  IMPLEMENT: 'implement',
  FIX_PULL_REQUEST: 'fix-pull-request',
})

export class HarnessCall {
  static CALL_FILE = 'call.json'
  static STREAM_FILE = 'stream.ndjson'
  static ERROR_FILE = 'stderr.log'

  static pathsFor({ runsIn, agent, step, startedAt }) {
    const directory = `${runsIn}/${agent}/${step}-${startedAt}`

    return {
      directory,
      out: `${directory}/${HarnessCall.STREAM_FILE}`,
      err: `${directory}/${HarnessCall.ERROR_FILE}`,
      call: `${directory}/${HarnessCall.CALL_FILE}`,
    }
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

  constructor({ start, makeDirectory, write, mint, clock, brief, runsIn, model, pluginRoot }) {
    super()
    this.start = start
    this.makeDirectory = makeDirectory
    this.write = write
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
    const { directory, out, err, call } = HarnessCall.pathsFor({
      runsIn: this.runsIn, agent, step: HarnessStep.WRITE_PLAN, startedAt,
    })

    await this.makeDirectory(directory)
    const started = this.start.start({ argv, cwd: briefing.located.path, out, err })

    await this.write(call, JSON.stringify(new HarnessCall({
      step: HarnessStep.WRITE_PLAN,
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
}
