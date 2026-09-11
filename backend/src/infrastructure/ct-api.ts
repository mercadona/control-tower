import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as after } from 'node:timers/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiServer, LOOPBACK } from './api-server.ts'
import { CmuxPlanAgents } from './cmux-plan-agents.ts'
import { AcliUserStories } from './acli-user-stories.ts'
import { GhUserStories } from './gh-user-stories.ts'
import { ReferredUserStories } from './referred-user-stories.ts'
import { GhPlanIssues } from './gh-plan-issues.ts'
import { GitWorkspace } from './git-workspace.ts'
import { DiskCheckoutRegistry } from './disk-checkout-registry.ts'
import { WorktreePlans } from './worktree-plans.ts'
import { DiskGoRegistry } from './disk-go-registry.ts'
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
import { ActivePlanRecovery } from './active-plan-recovery.ts'
import { DiskImplementationStartRegistry } from './disk-implementation-start-registry.ts'
import { CmuxWorkspaceQuery } from '../../../plugin/scripts/cmux.js'
import { StartPlan } from '../application/actions/start-plan.ts'
import { ImplementPlan } from '../application/actions/implement-plan.ts'
import { AskPlanChanges } from '../application/actions/ask-plan-changes.ts'
import { ReadPlanProgress, ReadPlanProgressParams } from '../application/queries/read-plan-progress.ts'
import { ReadImplementationProgress } from '../application/queries/read-implementation-progress.ts'
import { ReadImplementationHistory } from '../application/queries/read-implementation-history.ts'
import { ReadChangesAsked, ReadChangesAskedParams } from '../application/queries/read-changes-asked.ts'
import { ReadFixesAsked, ReadFixesAskedParams } from '../application/queries/read-fixes-asked.ts'
import { ReviewPlan, ReviewPlanParams } from '../application/actions/review-plan.ts'
import { RequestFixes, RequestFixesParams } from '../application/actions/request-fixes.ts'
import { SurveyWorkspaces, SurveyWorkspacesParams } from '../application/queries/survey-workspaces.ts'
import { ReadPlanStory, ReadPlanStoryParams } from '../application/queries/read-plan-story.ts'
import { SurveyExternalTools } from '../application/queries/survey-external-tools.ts'
import { InspectProject } from '../application/queries/inspect-project.ts'
import { GitDockerProjectSetup } from './git-docker-project-setup.ts'
import { MetricsDelivery } from '../domain/value-objects/metrics-delivery.ts'
import { HarvestDelivery, HarvestDeliveryParams } from '../application/actions/harvest-delivery.ts'
import { ProbedToolSessions } from './probed-tool-sessions.ts'
import { ToolRunner } from './tool-runner.ts'
import { Gh } from './gh.ts'
import { ExternalTool } from './external-tool.ts'
import { RetryPolicy, RetryBudget } from '../domain/policies/retry-policy.ts'
import { LaunchPolicy, LaunchBudget } from '../domain/policies/launch-policy.ts'
import { Invocation, InvocationOutcome } from './invocation.ts'
import { Baseline } from '../../../plugin/scripts/baseline.js'
import type { ProcessOutput } from './tool-runner.ts'
import type { ToolLaunch, ToolSleep } from './external-tool.ts'

type LaunchTool = (argv: string[], options?: { cwd?: string }) => Promise<ProcessOutput>

type ToolCollaborators = { launch: ToolLaunch, policy: RetryPolicy, sleep: ToolSleep }

class FrontendBuild {
  static readonly #HERE = dirname(fileURLToPath(import.meta.url))

  static root(): string {
    return join(FrontendBuild.#HERE, '..', '..', '..', 'frontend', 'dist')
  }
}

class PluginTree {
  static readonly #HERE = dirname(fileURLToPath(import.meta.url))

  static #root(): string {
    return join(PluginTree.#HERE, '..', '..', '..', 'plugin')
  }

  static dispatchCheck(): string {
    return join(PluginTree.#root(), 'scripts', 'dispatch-check.mjs')
  }

  static conventions(): string {
    return join(PluginTree.#root(), 'conventions')
  }

  static ctStep(): string {
    return join(PluginTree.#root(), 'scripts', 'ct-step.mjs')
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
    } catch {
      return false
    }
  }
}

class CtApi {
  static readonly #USAGE =
    `usage: make run-backend (no arguments; set ${Invocation.PORT_VARIABLE} to pick a port, 0 for an ephemeral one; set ${Invocation.HARVEST_TABLE_VARIABLE} to ${Invocation.HARVEST_TABLE_SHAPE} so every harvest loads its row into BigQuery)`
  static readonly #BAD_USAGE = 2
  static readonly #CANNOT_LISTEN = 1
  static readonly #PROCESS_TIMEOUT_MS = 30_000
  static readonly #HARVEST_TIMEOUT_MS = 6 * 60 * 1000
  static readonly #BASELINE_TIMEOUT_MS = 10 * 60 * 1000
  static readonly #SHELL = 'sh'
  static readonly #SECONDS_FOR_GH_IN_A_HARVEST = 60
  static readonly #SECONDS_BETWEEN_SWEEPS = 60
  static readonly #CLOCK_STOPPED = 1
  static readonly #RETRIES = 3
  static readonly #SECONDS_BETWEEN_RETRIES = 2
  static readonly #PROBES_PER_SEND = 20
  static readonly #RESENDS = 1
  static readonly #SECONDS_BETWEEN_PROBES = 1
  static readonly #SECONDS_BETWEEN_READS = 2
  static readonly #SECONDS_BETWEEN_ASKS = 30
  static readonly #LAUNCH_DIRECTORY = 'ct-plan'

  static #refuseUsage(reason: string | null): never {
    process.stderr.write(`${reason}\n${CtApi.#USAGE}\n`)
    process.exit(CtApi.#BAD_USAGE)
  }

  static #refuseListen(reason: string): never {
    process.stderr.write(`${reason}\n`)
    process.exit(CtApi.#CANNOT_LISTEN)
  }

  static #tool(
    bin: string,
    { budgetMs = CtApi.#PROCESS_TIMEOUT_MS, env }: { budgetMs?: number, env?: NodeJS.ProcessEnv } = {}
  ): LaunchTool {
    const runner = new ToolRunner({ bin, budgetMs, env })
    return (argv, options) => runner.run(argv, options)
  }

  static #baseline(): Baseline {
    const shell = CtApi.#tool(CtApi.#SHELL, { budgetMs: CtApi.#BASELINE_TIMEOUT_MS })

    return new Baseline({ run: (command: string, cwd: string) => shell(['-c', command], { cwd }) })
  }

  static #talkingTo<T>(bin: string, Tool: new (collaborators: ToolCollaborators) => T): T {
    return new Tool({
      launch: CtApi.#tool(bin),
      policy: new RetryPolicy({
        budget: new RetryBudget({
          attempts: CtApi.#RETRIES,
          waitSeconds: CtApi.#SECONDS_BETWEEN_RETRIES,
        }),
      }),
      sleep: (seconds) => CtApi.#waiting(seconds),
    })
  }

  static #waiting(seconds: number): Promise<void> {
    return after(seconds * 1000)
  }

  static #startPlan(
    workspace: GitWorkspace,
    planAgents: CmuxPlanAgents,
    planIssues: GhPlanIssues,
    checkouts: DiskCheckoutRegistry,
    gh: Gh
  ): StartPlan {
    return new StartPlan({
      userStories: new ReferredUserStories({
        jira: new AcliUserStories({ acli: CtApi.#talkingTo(AcliUserStories.BIN, ExternalTool) }),
        github: new GhUserStories({ gh }),
      }),
      planIssues,
      workspace,
      planAgents,
      checkouts,
    })
  }

  static #askCmux() {
    return CmuxWorkspaceQuery.ask({ requireComplete: true })
  }

  static #toolSessions(environment: NodeJS.ProcessEnv): ProbedToolSessions {
    const probes = ProbedToolSessions.PROBES.map((row) => row.probe).filter((probe) => probe !== null)
    const clients = Object.fromEntries(
      probes.map((bin): [string, ExternalTool] => [bin, CtApi.#talkingTo(bin, ExternalTool)])
    )

    return new ProbedToolSessions({
      clients,
      lookUp: (bin) => Invocation.lookUp(bin, environment),
      cmuxAnswers: () => CtApi.#askCmux().wasAnswered,
    })
  }

  static #harvestClock({ workspace, checkouts, environment, harvestTable }: {
    workspace: GitWorkspace,
    checkouts: DiskCheckoutRegistry,
    environment: NodeJS.ProcessEnv,
    harvestTable: string | null,
  }): HarvestClock {
    const surveyWorkspaces = new SurveyWorkspaces({ workspace })
    const harvestDelivery = new HarvestDelivery({
      harvest: new DispatchCheckHarvest({
        node: CtApi.#tool(process.execPath, {
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
      checkouts: () => checkouts.known(),
      survey: (root) => surveyWorkspaces.execute(new SurveyWorkspacesParams({ root })),
      harvest: (prepared, repository) =>
        harvestDelivery.execute(new HarvestDeliveryParams({ prepared, repository })),
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_SWEEPS),
      stderr: (line) => process.stderr.write(line),
    })
  }

  static #sweepUntilItBreaks(clock: HarvestClock): void {
    clock.start().catch((failure) => {
      process.stderr.write(`harvest sweep: the clock stopped sweeping and nothing else will: ${failure.stack}\n`)
      process.exit(CtApi.#CLOCK_STOPPED)
    })
  }

  static #readPlanProgress(git: LaunchTool, log: MemoryReviewLog): ReadPlanProgress {
    return new ReadPlanProgress({
      planProgress: new PlanContractProgress({
        node: CtApi.#tool(process.execPath),
        git,
        dispatchCheck: PluginTree.dispatchCheck(),
      }),
      reviewLog: log,
    })
  }

  static #planEvents(readPlanProgress: ReadPlanProgress): PlanEvents {
    return new PlanEvents({
      read: (session) => readPlanProgress.execute(new ReadPlanProgressParams(session)),
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_READS),
    })
  }

  static #planReviews(planIssues: GhPlanIssues, planAgents: CmuxPlanAgents, log: MemoryReviewLog): ReviewWatch {
    const readChangesAsked = new ReadChangesAsked({ planIssues })
    const reviewPlan = new ReviewPlan({ planAgents })

    return new ReviewWatch({
      asked: (watch) => readChangesAsked.execute(new ReadChangesAskedParams(watch)),
      review: (params) => reviewPlan.execute(new ReviewPlanParams(params)),
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_ASKS),
      stderr: (line) => process.stderr.write(line),
      label: 'plan review watch',
      log,
    })
  }

  static #pullRequestReviews(
    pullRequests: GhPullRequests,
    planIssues: GhPlanIssues,
    planAgents: CmuxPlanAgents,
    workbench: DispatchCheckWorkbench
  ): ReviewWatch {
    const readFixesAsked = new ReadFixesAsked({ pullRequests, planIssues })
    const requestFixes = new RequestFixes({ workbench, planAgents })

    return new ReviewWatch({
      asked: (watch) => readFixesAsked.execute(new ReadFixesAskedParams(watch)),
      review: (params) => requestFixes.execute(new RequestFixesParams(params)),
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_ASKS),
      stderr: (line) => process.stderr.write(line),
      label: 'pull request review watch',
      log: new MemoryReviewLog(),
    })
  }

  static #messageOf(failure: unknown): string {
    return failure instanceof Error ? failure.message : String(failure)
  }

  static async run(argv: string[], environment: NodeJS.ProcessEnv): Promise<void> {
    const asked = Invocation.from(argv, environment, homedir())
    if (asked.outcome !== InvocationOutcome.READY || asked.port === null || asked.stateRoot === null) {
      CtApi.#refuseUsage(asked.reason)
    }
    const git = CtApi.#tool(GitWorkspace.BIN)
    const workspace = new GitWorkspace({
      run: git,
      write: Disk.write,
      read: Disk.read,
      stderr: (line) => process.stderr.write(line),
      baseline: CtApi.#baseline(),
    })
    const checkouts = new DiskCheckoutRegistry({
      read: (path) => readFileSync(path, 'utf8'),
      stat: statSync,
      write: Disk.atomicWriteSync,
      stderr: (line) => process.stderr.write(line),
      root: asked.stateRoot,
    })
    const planAgents = new CmuxPlanAgents({
      run: CtApi.#tool(CmuxPlanAgents.BIN),
      write: Disk.write,
      read: Disk.read,
      remove: Disk.remove,
      realpathOf: Disk.realpathOf,
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_PROBES),
      runsIn: join(tmpdir(), CtApi.#LAUNCH_DIRECTORY),
      policy: new LaunchPolicy({
        budget: new LaunchBudget({ attempts: CtApi.#PROBES_PER_SEND, resends: CtApi.#RESENDS }),
      }),
      brief: new PlanAgentBrief({
        dispatchCheck: PluginTree.dispatchCheck(),
        conventions: PluginTree.conventions(),
        ctStep: PluginTree.ctStep(),
      }),
    })
    const gh = CtApi.#talkingTo(Gh.BIN, Gh)
    const planIssues = new GhPlanIssues({
      gh,
      stderr: (line) => process.stderr.write(line),
    })
    const pullRequests = new GhPullRequests({ gh })
    const workbench = new DispatchCheckWorkbench({
      node: CtApi.#tool(process.execPath),
      dispatchCheck: PluginTree.dispatchCheck(),
    })
    const sessions = new PlanSessions()
    const planReviewLog = new MemoryReviewLog()
    const readPlanProgress = CtApi.#readPlanProgress(git, planReviewLog)
    const reviews = CtApi.#planReviews(planIssues, planAgents, planReviewLog)
    const activePlans = new ActivePlans({ sessions })
    const implementationStarts = new DiskImplementationStartRegistry({
      read: (path) => readFileSync(path, 'utf8'),
      stat: statSync,
      write: Disk.atomicWrite,
      root: asked.stateRoot,
    })
    const goRegistry = new DiskGoRegistry({
      random: randomBytes,
      read: (path) => readFileSync(path, 'utf8'),
      stat: statSync,
      write: Disk.write,
      root: asked.stateRoot,
    })
    const pullRequestReviews = CtApi.#pullRequestReviews(pullRequests, planIssues, planAgents, workbench)
    const runFileProgress = new RunFileProgress({ read: Disk.read, exists: Disk.exists })
    const metricsFileHistory = new MetricsFileHistory({ read: Disk.read, exists: Disk.exists })
    const surveyWorkspaces = new SurveyWorkspaces({ workspace })
    const readPlanStory = new ReadPlanStory({ planIssues })
    const recovery = new ActivePlanRecovery({
      plans: new WorktreePlans({
        checkouts,
        survey: async (root) => (await surveyWorkspaces.execute(new SurveyWorkspacesParams({ root }))).survey,
        sessions: () => CtApi.#askCmux(),
        realpathOf: Disk.realpathOf,
        story: async (subject) => (await readPlanStory.execute(new ReadPlanStoryParams(subject))).story,
        stderr: (line) => process.stderr.write(line),
      }),
      checkouts,
      implementationStarts,
      goRegistry,
      implementationProgress: runFileProgress,
      sessions,
      reviews,
      pullRequestReviews,
      activePlans,
    })
    const server = new ApiServer({
      port: asked.port,
      startPlan: CtApi.#startPlan(workspace, planAgents, planIssues, checkouts, gh),
      reviews,
      pullRequestReviews,
      implementPlan: new ImplementPlan({
        goRegistry,
        planIssues,
        planAgents,
      }),
      askPlanChanges: new AskPlanChanges({ planIssues }),
      implementProgress: new ReadImplementationProgress({
        implementationProgress: runFileProgress,
        pullRequests,
        planIssues,
      }),
      implementHistory: new ReadImplementationHistory({ implementationHistory: metricsFileHistory }),
      planEvents: CtApi.#planEvents(readPlanProgress),
      readPlanProgress,
      sessions,
      activePlans,
      externalTools: new SurveyExternalTools({
        toolSessions: CtApi.#toolSessions(environment),
        metricsDelivery: MetricsDelivery.to(asked.harvestTable),
      }),
      inspectProject: new InspectProject({ setup: new GitDockerProjectSetup({
        run: (bin, argv, cwd, budgetMs) => new ToolRunner({
          bin, budgetMs, ownedProcessGroup: { maxBufferBytes: 128 * 1024 },
        }).run(argv, { cwd }),
        now: Date.now, budgetMs: 30_000, commandBudgetMs: 2_000,
        maxFiles: 24, maxContainers: 12,
      }) }),
      implementationStarts,
      recovery,
      stderr: (line) => process.stderr.write(line),
      frontendRoot: FrontendBuild.root(),
    })
    let port: number
    try {
      port = await server.start()
    } catch (error) {
      CtApi.#refuseListen(`could not listen on ${LOOPBACK}: ${CtApi.#messageOf(error)}`)
    }
    process.stdout.write(`${JSON.stringify({ port })}\n`)
    await recovery.recover()
    CtApi.#sweepUntilItBreaks(CtApi.#harvestClock({
      workspace, checkouts, environment, harvestTable: asked.harvestTable,
    }))
  }
}

await CtApi.run(process.argv.slice(2), process.env)
