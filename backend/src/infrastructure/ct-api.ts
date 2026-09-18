import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import {
  mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn as spawnChild } from 'node:child_process'
import { setTimeout as after } from 'node:timers/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node-pty'
import { ApiServer, LOOPBACK } from './api-server.ts'
import { PtyLiveSessions } from './pty-live-sessions.ts'
import { AcliUserStories } from './acli-user-stories.ts'
import { GhUserStories } from './gh-user-stories.ts'
import { ReferredUserStories } from './referred-user-stories.ts'
import { GhPlanIssues } from './gh-plan-issues.ts'
import { GitWorkspace } from './git-workspace.ts'
import { DiskCheckoutRegistry } from './disk-checkout-registry.ts'
import { DispatchCheckHarvest } from './dispatch-check-harvest.ts'
import { HarvestClock } from './harvest-clock.ts'
import { PlanAgentBrief } from './plan-agent-brief.ts'
import { PlanContractProgress } from './plan-contract-progress.ts'
import { PlanEvents, PlanSessions } from './plan-events-route.ts'
import { ReviewWatch } from './review-watch.ts'
import { MemoryReviewLog } from './memory-review-log.ts'
import { GhPullRequests } from './gh-pull-requests.ts'
import { DispatchCheckWorkbench } from './dispatch-check-workbench.ts'
import { RunFileProgress } from './run-file-progress.ts'
import { MetricsFileHistory } from './metrics-file-history.ts'
import { ActivePlans } from './active-plans-route.ts'
import { ClaudeConversations } from './claude-conversations.ts'
import { LocalSettingsSessionHooks } from './local-settings-session-hooks.ts'
import { DiskConversationRecords } from './disk-conversation-records.ts'
import { CoordinatingSessions } from './coordinating-sessions.ts'
import { CoordinatingSessionRecovery } from './coordinating-session-recovery.ts'
import { SessionHooksRoute } from './session-hooks-route.ts'
import { DiskEpicSpecs } from './disk-epic-specs.ts'
import { GitEpicBranch } from './git-epic-branch.ts'
import { GateKey } from './gate-key.ts'
import { WorkInFlight } from './work-in-flight.ts'
import { GhPublishedSpecs } from './gh-published-specs.ts'
import { GhEpicIssues } from './gh-epic-issues.ts'
import { CtGroomEpic } from './ct-groom-epic.ts'
import { StartPlan } from '../application/actions/start-plan.ts'
import { StartMilestonePlan } from '../application/actions/start-milestone-plan.ts'
import { ContinuePlan } from '../application/actions/continue-plan.ts'
import { DriveRun } from '../application/actions/drive-run.ts'
import { ExecuteRunInstruction } from '../application/actions/execute-run-instruction.ts'
import { RecoverPlan } from '../application/actions/recover-plan.ts'
import { CleanupPlan } from '../application/actions/cleanup-plan.ts'
import { OpenCoordinatingSession } from '../application/actions/open-coordinating-session.ts'
import { OpenGroomSession } from '../application/actions/open-groom-session.ts'
import { CloseCoordinatingSession } from '../application/actions/close-coordinating-session.ts'
import { RecoverCoordinatingSession } from '../application/actions/recover-coordinating-session.ts'
import { ReadPlanProgress, ReadPlanProgressParams } from '../application/queries/read-plan-progress.ts'
import { ReadImplementationProgress } from '../application/queries/read-implementation-progress.ts'
import { ReadImplementationHistory } from '../application/queries/read-implementation-history.ts'
import { ReadSpecFreeze } from '../application/queries/read-spec-freeze.ts'
import { FreezeSpec } from '../application/actions/freeze-spec.ts'
import { PublishReslicing } from '../application/actions/publish-reslicing.ts'
import { ReadEpicGroom } from '../application/queries/read-epic-groom.ts'
import { GroomEpic } from '../application/actions/groom-epic.ts'
import { PromoteEpic } from '../application/actions/promote-epic.ts'
import { ReadFixesAsked, ReadFixesAskedParams } from '../application/queries/read-fixes-asked.ts'
import { RequestFixes, RequestFixesParams } from '../application/actions/request-fixes.ts'
import { SurveyWorkspaces, SurveyWorkspacesParams } from '../application/queries/survey-workspaces.ts'
import { SurveyExternalTools } from '../application/queries/survey-external-tools.ts'
import { ListLiveSessions } from '../application/queries/list-live-sessions.ts'
import { WatchLiveSession } from '../application/queries/watch-live-session.ts'
import { TypeIntoSession } from '../application/actions/type-into-session.ts'
import { ResizeSession } from '../application/actions/resize-session.ts'
import { MetricsDelivery } from '../domain/value-objects/metrics-delivery.ts'
import { HarvestDelivery, HarvestDeliveryParams } from '../application/actions/harvest-delivery.ts'
import { ProbedToolSessions } from './probed-tool-sessions.ts'
import { ToolRunner } from './tool-runner.ts'
import { Gh } from './gh.ts'
import { ExternalTool } from './external-tool.ts'
import { RetryPolicy, RetryBudget } from '../domain/policies/retry-policy.ts'
import { PlanFingerprint } from '../domain/policies/plan-fingerprint.ts'
import { SpecRevision } from '../domain/policies/spec-revision.ts'
import { Invocation, InvocationOutcome } from './invocation.ts'
import { Baseline } from '../../../plugin/scripts/baseline.js'
import { ClaudeCodeTranscript } from '../../../plugin/scripts/claude-code-usage.js'
import { HeadlessFiles } from './headless-files.ts'
import { DiskPlanRecords } from './disk-plan-records.ts'
import { ClaudeCalls } from './claude-calls.ts'
import { ClaudePlanCalls } from './claude-plan-calls.ts'
import { HeadlessPlanAgents } from './headless-plan-agents.ts'
import { RecordedPlanRecovery } from './recorded-plan-recovery.ts'
import { GhPlanPublication } from './gh-plan-publication.ts'
import { GhDispatchCandidates } from './gh-dispatch-candidates.ts'
import { DispatchCheckClaims } from './dispatch-check-claims.ts'
import { RunJournal } from './run-journal.ts'
import { CtRunMachine } from './ct-run-machine.ts'
import { ClaudeRunMeasurements } from './claude-run-measurements.ts'
import { ClaudeRunCalls } from './claude-run-calls.ts'
import { RunPlanAgents } from './run-plan-agents.ts'
import { RunPlanRecovery } from './run-plan-recovery.ts'
import type { ProcessOutput } from './tool-runner.ts'
import type { ToolLaunch, ToolSleep } from './external-tool.ts'
import type { UserStories } from '../domain/ports/user-stories.ts'
import type { PlanAgents } from '../domain/ports/plan-agents.ts'
import type { PlanRecords } from '../domain/ports/plan-records.ts'
import type { DispatchClaims } from '../domain/ports/dispatch-claims.ts'
import type { TerminalSpawn } from './pty-live-sessions.ts'

type LaunchTool = (argv: string[], options?: { cwd?: string }) => Promise<ProcessOutput>

type ToolCollaborators = { launch: ToolLaunch, policy: RetryPolicy, sleep: ToolSleep }

export type ApiRuntime = {
  tool: (options: { bin: string, budgetMs: number, env?: NodeJS.ProcessEnv }) => Pick<ToolRunner, 'run' | 'runWholeOutput'>,
  spawn: typeof spawnChild,
  terminal: TerminalSpawn,
  signal: (pid: number, signal: NodeJS.Signals | 0) => void,
  inspectProcessTable?: (signal: AbortSignal) => Promise<string>,
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>,
  home: () => string,
  out: (text: string) => void,
  err: (text: string) => void,
}

export class ApiInvocationFailure extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

class ProductionRuntime {
  static create(): ApiRuntime {
    return {
      tool: (options) => new ToolRunner(options),
      spawn: spawnChild,
      terminal: spawn,
      signal: (pid, signal) => { process.kill(pid, signal) },
      sleep: (milliseconds, signal) => after(milliseconds, undefined, { signal }),
      home: homedir,
      out: (text) => { process.stdout.write(text) },
      err: (text) => { process.stderr.write(text) },
    }
  }
}

class FrontendBuild {
  static readonly #HERE = dirname(fileURLToPath(import.meta.url))

  static root(): string {
    return join(FrontendBuild.#HERE, '..', '..', '..', 'frontend', 'dist')
  }
}

class PluginTree {
  static readonly #HERE = dirname(fileURLToPath(import.meta.url))

  static root(): string {
    return join(PluginTree.#HERE, '..', '..', '..', 'plugin')
  }

  static dispatchCheck(): string {
    return join(PluginTree.root(), 'scripts', 'dispatch-check.mjs')
  }

  static conventions(): string {
    return join(PluginTree.root(), 'conventions')
  }

  static ctStep(): string {
    return join(PluginTree.root(), 'scripts', 'ct-step.mjs')
  }

  static ctGroom(): string {
    return join(PluginTree.root(), 'scripts', 'ct-groom.mjs')
  }
}

class Disk {
  static realpathOf(path: string): string | null {
    try {
      return realpathSync(path)
    } catch {
      return null
    }
  }

  static async write(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }

  static async atomicWrite(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, text)
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  static async read(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8')
    } catch (failure) {
      if (Disk.#isMissing(failure)) return null
      throw failure
    }
  }

  static #isMissing(failure: unknown): boolean {
    const errno: NodeJS.ErrnoException | null = failure instanceof Error ? failure : null

    return errno?.code === 'ENOENT'
  }

  static atomicWriteSync(path: string, text: string): void {
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, text)
      renameSync(temporary, path)
    } finally {
      rmSync(temporary, { force: true })
    }
  }

  static async remove(path: string): Promise<void> {
    await rm(path, { force: true })
  }

  static async exists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch (failure) {
      if (Disk.#isMissing(failure)) return false
      throw failure
    }
  }

  static async list(path: string): Promise<string[] | null> {
    try {
      return await readdir(path)
    } catch (failure) {
      if (Disk.#isMissing(failure)) return null
      throw failure
    }
  }
}

export class CtApi {
  readonly #runtime: ApiRuntime
  readonly #stopped = new AbortController()
  #server: ApiServer | null = null
  #reviews: ReviewWatch | null = null
  #sweeping: Promise<void> = Promise.resolve()
  #port: number | null = null

  constructor(runtime: ApiRuntime) {
    this.#runtime = runtime
  }

  get port(): number | null { return this.#port }

  get finished(): Promise<void> { return this.#sweeping }

  static async run(argv: string[], environment: NodeJS.ProcessEnv, runtime = ProductionRuntime.create()): Promise<CtApi> {
    const api = new CtApi(runtime)
    try {
      await api.#start(argv, environment)
      return api
    } catch (failure) {
      await api.close()
      throw failure
    }
  }

  async close(): Promise<void> {
    this.#reviews?.live.clear()
    await this.#server?.stop()
    this.#stopped.abort()
    await this.#sweeping
  }

  static readonly #USAGE =
    `usage: make run-backend (no arguments; set ${Invocation.PORT_VARIABLE} to pick a port, 0 for an ephemeral one; set ${Invocation.HARVEST_TABLE_VARIABLE} to ${Invocation.HARVEST_TABLE_SHAPE} so every harvest loads its row into BigQuery)`
  static readonly #BAD_USAGE = 2
  static readonly #CANNOT_LISTEN = 1
  static readonly #PROCESS_TIMEOUT_MS = 30_000
  static readonly #HARVEST_TIMEOUT_MS = 6 * 60 * 1000
  static readonly #GROOM_TIMEOUT_MS = 6 * 60 * 1000
  static readonly #PLAN_CALL_TIMEOUT_MS = 7_200_000
  static readonly #PLAN_CALL_KILL_GRACE_MS = 5_000
  static readonly #PLAN_CALL_ACCEPTANCE_MS = 10_000
  static readonly #PLAN_CALL_POLL_MS = 250
  static readonly #BASELINE_TIMEOUT_MS = 10 * 60 * 1000
  static readonly #SHELL = 'sh'
  static readonly #SECONDS_FOR_GH_IN_A_HARVEST = 60
  static readonly #SECONDS_BETWEEN_SWEEPS = 60
  static readonly #CLOCK_STOPPED = 1
  static readonly #RETRIES = 3
  static readonly #SECONDS_BETWEEN_RETRIES = 2
  static readonly #SECONDS_BETWEEN_READS = 2
  static readonly #SECONDS_BETWEEN_ASKS = 30
  static readonly #SESSION_TERM_GRACE_MS = 2_000
  static readonly #SESSION_KILL_GRACE_MS = 2_000
  static readonly #SESSION_TERMINATION_POLL_MS = 25

  #refuseUsage(reason: string | null): never {
    const message = `${reason}\n${CtApi.#USAGE}\n`
    this.#runtime.err(message)
    throw new ApiInvocationFailure(CtApi.#BAD_USAGE, message)
  }

  #refuseListen(reason: string): never {
    this.#runtime.err(`${reason}\n`)
    throw new ApiInvocationFailure(CtApi.#CANNOT_LISTEN, reason)
  }

  #tool(
    bin: string,
    { budgetMs = CtApi.#PROCESS_TIMEOUT_MS, env }: { budgetMs?: number, env?: NodeJS.ProcessEnv } = {}
  ): LaunchTool {
    const runner = this.#runtime.tool({ bin, budgetMs, env })
    return (argv, options) => runner.run(argv, options)
  }

  #baseline(): Baseline {
    const shell = this.#tool(CtApi.#SHELL, { budgetMs: CtApi.#BASELINE_TIMEOUT_MS })

    return new Baseline({ run: (command: string, cwd: string) => shell(['-c', command], { cwd }) })
  }

  #talkingTo<T>(bin: string, Tool: new (collaborators: ToolCollaborators) => T): T {
    const runner = this.#runtime.tool({ bin, budgetMs: CtApi.#PROCESS_TIMEOUT_MS })
    return new Tool({
      launch: (argv: string[]) => argv.includes('--paginate')
        ? runner.runWholeOutput(argv)
        : runner.run(argv),
      policy: new RetryPolicy({
        budget: new RetryBudget({
          attempts: CtApi.#RETRIES,
          waitSeconds: CtApi.#SECONDS_BETWEEN_RETRIES,
        }),
      }),
      sleep: (seconds) => this.#waiting(seconds),
    })
  }

  #waiting(seconds: number): Promise<void> {
    return this.#runtime.sleep(seconds * 1000, this.#stopped.signal)
  }

  static #headlessEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return Object.fromEntries(Object.entries(environment).filter(([name, value]) => (
      value !== undefined
      && name !== ClaudeConversations.PROMPT_VARIABLE
      && name !== ClaudeConversations.HOOKS_URL_VARIABLE
      && name !== 'CLAUDE_CODE_SESSION_ID'
    )))
  }

  #userStories(gh: Gh): UserStories {
    return new ReferredUserStories({
      jira: new AcliUserStories({ acli: this.#talkingTo(AcliUserStories.BIN, ExternalTool) }),
      github: new GhUserStories({ gh }),
    })
  }

  static #startPlan(
    workspace: GitWorkspace,
    planAgents: PlanAgents,
    planIssues: GhPlanIssues,
    checkouts: DiskCheckoutRegistry,
    userStories: UserStories,
    records: PlanRecords,
    claims: DispatchClaims,
  ): StartPlan {
    return new StartPlan({
      userStories,
      planIssues,
      workspace,
      planAgents,
      checkouts,
      records,
      claims,
    })
  }

  #toolSessions(environment: NodeJS.ProcessEnv): ProbedToolSessions {
    const probes = ProbedToolSessions.PROBES.map((row) => row.probe).filter((probe) => probe !== null)
    const clients = Object.fromEntries(
      probes.map((bin): [string, ExternalTool] => [bin, this.#talkingTo(bin, ExternalTool)])
    )

    return new ProbedToolSessions({
      clients,
      lookUp: (bin) => Invocation.lookUp(bin, environment),
    })
  }

  #harvestClock({ workspace, checkouts, environment, harvestTable }: {
    workspace: GitWorkspace,
    checkouts: DiskCheckoutRegistry,
    environment: NodeJS.ProcessEnv,
    harvestTable: string | null,
  }): HarvestClock {
    const surveyWorkspaces = new SurveyWorkspaces({ workspace })
    const harvestDelivery = new HarvestDelivery({
      harvest: new DispatchCheckHarvest({
        node: this.#tool(process.execPath, {
          budgetMs: CtApi.#HARVEST_TIMEOUT_MS,
          env: Invocation.harvestEnvironment(environment, {
            ghTimeoutMs: CtApi.#SECONDS_FOR_GH_IN_A_HARVEST * 1000,
          }),
        }),
        dispatchCheck: PluginTree.dispatchCheck(),
        harvestTable,
      }),
    })

    return new HarvestClock({
      checkouts: () => checkouts.known()?.map((checkout) => checkout.root) ?? null,
      survey: (root) => surveyWorkspaces.execute(new SurveyWorkspacesParams({ root })),
      harvest: (prepared, repository) =>
        harvestDelivery.execute(new HarvestDeliveryParams({ prepared, repository })),
      sleep: () => this.#waiting(CtApi.#SECONDS_BETWEEN_SWEEPS),
      stderr: this.#runtime.err,
    })
  }

  async #sweepUntilStopped(clock: HarvestClock): Promise<void> {
    try {
      while (!this.#stopped.signal.aborted) {
        await clock.sweep()
        await this.#waiting(CtApi.#SECONDS_BETWEEN_SWEEPS)
      }
    } catch (failure) {
      if (this.#stopped.signal.aborted && failure instanceof Error && failure.name === 'AbortError') return
      this.#runtime.err(`harvest sweep: the clock stopped sweeping and nothing else will: ${failure instanceof Error ? failure.stack : CtApi.#messageOf(failure)}\n`)
      throw new ApiInvocationFailure(CtApi.#CLOCK_STOPPED, CtApi.#messageOf(failure))
    }
  }

  #readPlanProgress(git: LaunchTool): ReadPlanProgress {
    return new ReadPlanProgress({
      planProgress: new PlanContractProgress({
        node: this.#tool(process.execPath),
        git,
        dispatchCheck: PluginTree.dispatchCheck(),
      }),
    })
  }

  #planEvents(readPlanProgress: ReadPlanProgress): PlanEvents {
    return new PlanEvents({
      read: (session) => readPlanProgress.execute(new ReadPlanProgressParams(session)),
      stopped: () => this.#stopped.signal.aborted,
      sleep: async () => {
        try {
          await this.#waiting(CtApi.#SECONDS_BETWEEN_READS)
        } catch (failure) {
          if (this.#stopped.signal.aborted && failure instanceof Error && failure.name === 'AbortError') return
          throw failure
        }
      },
    })
  }

  #pullRequestReviews(
    pullRequests: GhPullRequests,
    planIssues: GhPlanIssues,
    planAgents: PlanAgents,
    workbench: DispatchCheckWorkbench
  ): ReviewWatch {
    const readFixesAsked = new ReadFixesAsked({ pullRequests, planIssues })
    const requestFixes = new RequestFixes({ workbench, planAgents })

    return new ReviewWatch({
      asked: (watch) => readFixesAsked.execute(new ReadFixesAskedParams(watch)),
      review: (params) => requestFixes.execute(new RequestFixesParams(params)),
      sleep: () => this.#waiting(CtApi.#SECONDS_BETWEEN_ASKS),
      stderr: this.#runtime.err,
      label: 'pull request review watch',
      log: new MemoryReviewLog(),
    })
  }

  static #messageOf(failure: unknown): string {
    return failure instanceof Error ? failure.message : String(failure)
  }

  async #start(argv: string[], environment: NodeJS.ProcessEnv): Promise<void> {
    const asked = Invocation.from(argv, environment, this.#runtime.home())
    if (asked.outcome !== InvocationOutcome.READY || asked.port === null || asked.stateRoot === null) {
      this.#refuseUsage(asked.reason)
    }
    const git = this.#tool(GitWorkspace.BIN)
    const gh = this.#talkingTo(Gh.BIN, Gh)
    const workspace = new GitWorkspace({
      run: git,
      gh,
      write: Disk.write,
      read: Disk.read,
      lstat: fs.lstat,
      stderr: this.#runtime.err,
      baseline: this.#baseline(),
    })
    const checkouts = new DiskCheckoutRegistry({
      read: (path) => readFileSync(path, 'utf8'),
      stat: statSync,
      write: Disk.atomicWriteSync,
      stderr: this.#runtime.err,
      root: asked.stateRoot,
    })
    const files = new HeadlessFiles({ root: asked.stateRoot, fs, newId: randomUUID })
    const records = new DiskPlanRecords({
      files,
      newId: randomUUID,
      now: () => new Date().toISOString(),
      exists: Disk.exists,
    })
    const calls = new ClaudeCalls({
      files,
      binary: ClaudeConversations.BIN,
      worker: fileURLToPath(new URL('./headless-call-worker.ts', import.meta.url)),
      spawn: this.#runtime.spawn,
      env: CtApi.#headlessEnvironment(environment),
      newId: randomUUID,
      now: () => new Date().toISOString(),
      budgetMs: CtApi.#PLAN_CALL_TIMEOUT_MS,
      killGraceMs: CtApi.#PLAN_CALL_KILL_GRACE_MS,
      acceptanceMs: CtApi.#PLAN_CALL_ACCEPTANCE_MS,
      pollMs: CtApi.#PLAN_CALL_POLL_MS,
      sleep: (milliseconds) => this.#runtime.sleep(milliseconds, this.#stopped.signal),
    })
    const brief = new PlanAgentBrief({
      dispatchCheck: PluginTree.dispatchCheck(),
      conventions: PluginTree.conventions(),
      ctStep: PluginTree.ctStep(),
    })
    const planCalls = new ClaudePlanCalls({
      calls,
      brief,
      pluginRoot: PluginTree.root(),
      resumable: async (watch) => new ClaudeCodeTranscript({
        claudeDirectory: Invocation.configuredIn(environment, this.#runtime.home()),
        cwd: watch.located.path,
        listNames: (path: string) => readdirSync(path),
        readText: (path: string) => readFileSync(path, 'utf8'),
      }).read(watch.agent) !== null,
      records,
      nowMs: Date.now,
    })
    const userStories = this.#userStories(gh)
    const planIssues = new GhPlanIssues({
      gh,
      stderr: this.#runtime.err,
    })
    const pullRequests = new GhPullRequests({ gh })
    const workbench = new DispatchCheckWorkbench({
      node: this.#tool(process.execPath),
      dispatchCheck: PluginTree.dispatchCheck(),
    })
    const sessions = new PlanSessions()
    const readPlanProgress = this.#readPlanProgress(git)
    const activePlans = new ActivePlans({ sessions })
    const planProgress = new PlanContractProgress({
      node: this.#tool(process.execPath),
      git,
      dispatchCheck: PluginTree.dispatchCheck(),
    })
    const publication = new GhPlanPublication({
      gh,
      git,
      progress: planProgress,
      files,
      digest: (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
    })
    const continuation = new ContinuePlan({ calls: planCalls, publication })
    const legacyPlanAgents = new HeadlessPlanAgents({
      records,
      calls: planCalls,
      continuation,
      newId: randomUUID,
      stderr: this.#runtime.err,
    })
    const journal = new RunJournal({ files, newId: randomUUID })
    const oracleRunner = this.#runtime.tool({ bin: process.execPath, budgetMs: CtApi.#PLAN_CALL_TIMEOUT_MS })
    const runGitRunner = this.#runtime.tool({ bin: GitWorkspace.BIN, budgetMs: CtApi.#PROCESS_TIMEOUT_MS })
    const machine = new CtRunMachine({
      journal,
      node: oracleRunner.runWholeOutput.bind(oracleRunner),
      git: runGitRunner.runWholeOutput.bind(runGitRunner),
      read: Disk.read,
      ctStep: PluginTree.ctStep(),
      dispatchCheck: PluginTree.dispatchCheck(),
      pluginRoot: PluginTree.root(),
    })
    const measurements = new ClaudeRunMeasurements({ files, calls })
    const runCalls = new ClaudeRunCalls({
      calls,
      machine,
      measurements,
      files,
      pluginRoot: PluginTree.root(),
    })
    const driver = new DriveRun({
      calls: planCalls,
      publication,
      machine,
      step: new ExecuteRunInstruction({ machine, calls: runCalls }),
    })
    const planAgents = new RunPlanAgents({
      legacy: legacyPlanAgents,
      records,
      calls: planCalls,
      transport: calls,
      driver,
      machine,
      journal,
      measurements,
      newId: randomUUID,
      nowMs: Date.now,
      stderr: this.#runtime.err,
    })
    const claims = new DispatchCheckClaims({
      node: this.#tool(process.execPath),
      dispatchCheck: PluginTree.dispatchCheck(),
    })
    const pullRequestReviews = this.#pullRequestReviews(pullRequests, planIssues, planAgents, workbench)
    this.#reviews = pullRequestReviews
    const runFileProgress = new RunFileProgress({ read: Disk.read, exists: Disk.exists })
    const metricsFileHistory = new MetricsFileHistory({ read: Disk.read, exists: Disk.exists })
    const legacyRecovery = new RecordedPlanRecovery({
      records,
      calls: planCalls,
      ownership: calls,
      checkouts,
      activePlans,
      reviews: pullRequestReviews,
    })
    const recovery = new RunPlanRecovery({
      legacy: legacyRecovery,
      records,
      calls: planCalls,
      transport: calls,
      machine,
      journal,
      agents: planAgents,
      checkouts,
      activePlans,
      reviews: pullRequestReviews,
      nowMs: Date.now,
    })
    const liveSessions = new PtyLiveSessions({
      spawn: this.#runtime.terminal, newId: randomUUID, stderr: this.#runtime.err,
      signal: this.#runtime.signal,
      inspectProcessTable: this.#runtime.inspectProcessTable,
      sleep: (milliseconds) => this.#runtime.sleep(milliseconds, this.#stopped.signal),
      now: Date.now,
      termGraceMs: CtApi.#SESSION_TERM_GRACE_MS,
      killGraceMs: CtApi.#SESSION_KILL_GRACE_MS,
      pollMs: CtApi.#SESSION_TERMINATION_POLL_MS,
    })
    let listeningPort: number | null = null
    const claudeConversations = new ClaudeConversations({
      liveSessions,
      shell: environment.SHELL,
      env: environment,
      claudeDirectory: Invocation.configuredIn(environment, this.#runtime.home()),
      pluginRoot: PluginTree.root(),
      listNames: (path) => readdirSync(path),
      readText: (path) => readFileSync(path, 'utf8'),
      newId: randomUUID,
      hooksUrl: () => `http://${LOOPBACK}:${listeningPort}${SessionHooksRoute.PATH}`,
    })
    const sessionHooks = new LocalSettingsSessionHooks({ read: Disk.read, write: Disk.write })
    const conversationRecords = new DiskConversationRecords({
      read: Disk.read,
      write: Disk.atomicWrite,
      root: asked.stateRoot,
      newId: randomUUID,
      now: () => new Date().toISOString(),
    })
    const coordinatingSessions = new CoordinatingSessions({
      liveSessions,
      stderr: this.#runtime.err,
      records: conversationRecords,
      newId: randomUUID,
      now: () => new Date().toISOString(),
    })
    const openCoordinatingSession = new OpenCoordinatingSession({
      userStories,
      workspace,
      conversations: claudeConversations,
      sessionHooks,
      records: conversationRecords,
    })
    const recoverCoordinatingSession = new RecoverCoordinatingSession({
      conversations: claudeConversations,
      sessionHooks,
      records: conversationRecords,
      liveSessions,
      newId: randomUUID,
      now: () => new Date().toISOString(),
      stderr: this.#runtime.err,
    })
    const closeCoordinatingSession = new CloseCoordinatingSession({
      records: conversationRecords,
      liveSessions,
    })
    const epicSpecs = new DiskEpicSpecs({ list: Disk.list, read: Disk.read, write: Disk.write })
    const openGroomSession = new OpenGroomSession({
      specs: epicSpecs,
      conversations: claudeConversations,
      sessionHooks,
      records: conversationRecords,
    })
    const epicBranch = new GitEpicBranch({ run: git })
    const gateKey = new GateKey({ random: randomBytes })
    const readSpecFreeze = new ReadSpecFreeze({ specs: epicSpecs, branch: epicBranch, pullRequests })
    const freezeSpec = new FreezeSpec({
      specs: epicSpecs, branch: epicBranch, pullRequests, now: () => new Date(),
    })
    const specRevisions = new SpecRevision({
      digest: (text) => createHash('sha1').update(text, 'utf8').digest('hex'),
    })
    const publishReslicing = new PublishReslicing({
      specs: epicSpecs, branch: epicBranch, pullRequests, revisions: specRevisions,
    })
    const publishedSpecs = new GhPublishedSpecs({ gh, revisions: specRevisions })
    const epicIssues = new GhEpicIssues({ gh })
    const groomRunner = this.#runtime.tool({ bin: process.execPath, budgetMs: CtApi.#GROOM_TIMEOUT_MS })
    const epicGroom = new CtGroomEpic({
      node: (argv, options) => groomRunner.run(argv, options),
      wholeOutput: (argv, options) => groomRunner.runWholeOutput(argv, options),
      ctGroom: PluginTree.ctGroom(),
    })
    const planFingerprint = new PlanFingerprint({
      digest: (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
    })
    const readEpicGroom = new ReadEpicGroom({
      specs: epicSpecs,
      published: publishedSpecs,
      issues: epicIssues,
      groom: epicGroom,
      branch: epicBranch,
      pullRequests,
      fingerprint: planFingerprint,
      revisions: specRevisions,
    })
    const groomEpic = new GroomEpic({ read: readEpicGroom, groom: epicGroom, fingerprint: planFingerprint })
    const promoteEpic = new PromoteEpic({ read: readEpicGroom, issues: epicIssues })
    const startMilestonePlan = new StartMilestonePlan({
      candidates: new GhDispatchCandidates({ gh }),
      claims,
      workspace,
      agents: planAgents,
      records,
      checkouts,
    })
    const server = new ApiServer({
      port: asked.port,
      startPlan: CtApi.#startPlan(workspace, planAgents, planIssues, checkouts, userStories, records, claims),
      startMilestonePlan,
      startsInFlight: new WorkInFlight(),
      recoverPlan: new RecoverPlan({ agents: planAgents }),
      cleanupPlan: new CleanupPlan({ records, workspace, claims, planIssues }),
      implementProgress: new ReadImplementationProgress({
        implementationProgress: runFileProgress,
        pullRequests,
        planIssues,
      }),
      implementHistory: new ReadImplementationHistory({ implementationHistory: metricsFileHistory }),
      planEvents: this.#planEvents(readPlanProgress),
      sessions,
      activePlans,
      externalTools: new SurveyExternalTools({
        toolSessions: this.#toolSessions(environment),
        metricsDelivery: MetricsDelivery.to(asked.harvestTable),
      }),
      recovery,
      listLiveSessions: new ListLiveSessions({ liveSessions }),
      liveSessions,
      watchLiveSession: new WatchLiveSession({ liveSessions }),
      typeIntoSession: new TypeIntoSession({ liveSessions }),
      resizeSession: new ResizeSession({ liveSessions }),
      openCoordinatingSession,
      openGroomSession,
      closeCoordinatingSession,
      coordinatingSessions,
      readSpecFreeze,
      freezeSpec,
      gateKey,
      freezesInFlight: new WorkInFlight(),
      publishReslicing,
      reslicingsInFlight: new WorkInFlight(),
      readEpicGroom,
      groomEpic,
      epicGroomInFlight: new WorkInFlight(),
      promoteEpic,
      stderr: this.#runtime.err,
      frontendRoot: FrontendBuild.root(),
    })
    this.#server = server
    let port: number
    coordinatingSessions.beginRecovery()
    try {
      port = await server.start()
    } catch (error) {
      this.#refuseListen(`could not listen on ${LOOPBACK}: ${CtApi.#messageOf(error)}`)
    }
    listeningPort = port
    this.#port = port
    this.#runtime.out(`${JSON.stringify({ port })}\n`)
    CoordinatingSessionRecovery.remember(
      await recoverCoordinatingSession.execute(), coordinatingSessions, this.#runtime.err
    )
    await recovery.recover()
    this.#sweeping = this.#sweepUntilStopped(this.#harvestClock({
      workspace, checkouts, environment, harvestTable: asked.harvestTable,
    }))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const api = await CtApi.run(process.argv.slice(2), process.env)
    await api.finished
  } catch (failure) {
    if (!(failure instanceof ApiInvocationFailure)) throw failure
    process.exit(failure.code)
  }
}
