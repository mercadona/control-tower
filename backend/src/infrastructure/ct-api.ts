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
import { fileURLToPath } from 'node:url'
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
import { DispatchRelay } from './dispatch-relay.ts'
import { PlanAgentBrief } from './plan-agent-brief.ts'
import { PlanContractProgress } from './plan-contract-progress.ts'
import { PlanSessions } from './plan-sessions.ts'
import { StreamPlanningActivities } from './stream-planning-activities.ts'
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
import { SessionChangeAnnouncements } from './session-change-announcements.ts'
import { CheckRepositoryPreparation } from '../application/actions/check-repository-preparation.ts'
import { ComposeWorktreeEnvironments } from './compose-worktree-environments.ts'
import { SessionPreparationReports } from './session-preparation-reports.ts'
import { SessionClosureAnnouncements } from './session-closure-announcements.ts'
import { CoordinatingSessionRecovery } from './coordinating-session-recovery.ts'
import { SessionHooksRoute } from './session-hooks-route.ts'
import { DiskEpicSpecs } from './disk-epic-specs.ts'
import { GitEpicBranch } from './git-epic-branch.ts'
import { GateKey } from './gate-key.ts'
import { WorkInFlight } from './work-in-flight.ts'
import { GhPublishedSpecs } from './gh-published-specs.ts'
import { GhEpicIssues } from './gh-epic-issues.ts'
import { CtGroomEpic } from './ct-groom-epic.ts'
import { StartMilestonePlan, StartMilestonePlanParams } from '../application/actions/start-milestone-plan.ts'
import { ContinuePlan } from '../application/actions/continue-plan.ts'
import { DeliverHeldMessages } from '../application/actions/deliver-held-messages.ts'
import { DriveRun } from '../application/actions/drive-run.ts'
import { ExecuteRunInstruction } from '../application/actions/execute-run-instruction.ts'
import { RecoverPlan } from '../application/actions/recover-plan.ts'
import { CleanupPlan } from '../application/actions/cleanup-plan.ts'
import { OpenCoordinatingSession } from '../application/actions/open-coordinating-session.ts'
import { OpenGroomSession } from '../application/actions/open-groom-session.ts'
import { AskGroomReview } from '../application/actions/ask-groom-review.ts'
import { CloseCoordinatingSession } from '../application/actions/close-coordinating-session.ts'
import { RecoverCoordinatingSession } from '../application/actions/recover-coordinating-session.ts'
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
import { StateRootMarker } from '../../../plugin/scripts/state-root-marker.js'
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
import { DiskSliceEscalations } from './disk-slice-escalations.ts'
import { ReadSliceEscalation } from '../application/queries/read-slice-escalation.ts'
import { RunJournal } from './run-journal.ts'
import { CtRunMachine } from './ct-run-machine.ts'
import { ClaudeRunMeasurements } from './claude-run-measurements.ts'
import { MeasuredAgentCalls } from './measured-agent-calls.ts'
import { DiskAgentMeasurements } from './disk-agent-measurements.ts'
import { ClaudeRunCalls } from './claude-run-calls.ts'
import { RunPlanAgents, RunProvenance } from './run-plan-agents.ts'
import { RunPlanRecovery } from './run-plan-recovery.ts'
import { WorkRecoveryClock } from './work-recovery-clock.ts'
import { ReadWorkProgress } from '../application/queries/read-work-progress.ts'
import { InspectedWorkInventory } from './inspected-work-inventory.ts'
import { CheckedRunDelivery } from './checked-run-delivery.ts'
import type { ProcessOutput } from './tool-runner.ts'
import type { ToolLaunch, ToolSleep } from './external-tool.ts'
import type { UserStories } from '../domain/ports/user-stories.ts'
import type { PlanAgents } from '../domain/ports/plan-agents.ts'
import type { PlanRecords } from '../domain/ports/plan-records.ts'
import type { DispatchClaims } from '../domain/ports/dispatch-claims.ts'

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

class CtApi {
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
  static readonly #SECONDS_BETWEEN_ASKS = 30
  static readonly #SESSION_TERM_GRACE_MS = 2_000
  static readonly #SESSION_KILL_GRACE_MS = 2_000
  static readonly #SESSION_TERMINATION_POLL_MS = 25

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
    const runner = new ToolRunner({ bin, budgetMs: CtApi.#PROCESS_TIMEOUT_MS })
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
      sleep: (seconds) => CtApi.#waiting(seconds),
    })
  }

  static #waiting(seconds: number): Promise<void> {
    return after(seconds * 1000)
  }

  static #headlessEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return Object.fromEntries(Object.entries(environment).filter(([name, value]) => (
      value !== undefined
      && name !== ClaudeConversations.PROMPT_VARIABLE
      && name !== ClaudeConversations.HOOKS_URL_VARIABLE
      && name !== 'CLAUDE_CODE_SESSION_ID'
    )))
  }

  static #userStories(gh: Gh): UserStories {
    return new ReferredUserStories({
      jira: new AcliUserStories({ acli: CtApi.#talkingTo(AcliUserStories.BIN, ExternalTool) }),
      github: new GhUserStories({ gh }),
    })
  }

  static #toolSessions(environment: NodeJS.ProcessEnv): ProbedToolSessions {
    const probes = ProbedToolSessions.PROBES.map((row) => row.probe).filter((probe) => probe !== null)
    const clients = Object.fromEntries(
      probes.map((bin): [string, ExternalTool] => [bin, CtApi.#talkingTo(bin, ExternalTool)])
    )

    return new ProbedToolSessions({
      clients,
      lookUp: (bin) => Invocation.lookUp(bin, environment),
    })
  }

  static #harvestClock({ workspace, checkouts, environment, harvestTable, relay }: {
    workspace: GitWorkspace,
    checkouts: DiskCheckoutRegistry,
    environment: NodeJS.ProcessEnv,
    harvestTable: string | null,
    relay: DispatchRelay,
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
      checkouts: () => checkouts.known()?.map((checkout) => checkout.root) ?? null,
      survey: (root) => surveyWorkspaces.execute(new SurveyWorkspacesParams({ root })),
      harvest: (prepared, repository) =>
        harvestDelivery.execute(new HarvestDeliveryParams({ prepared, repository })),
      relay: (root, repository) => relay.relay(root, repository),
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

  static #pullRequestReviews(
    pullRequests: GhPullRequests,
    planIssues: GhPlanIssues,
    requestFixes: RequestFixes,
  ): ReviewWatch {
    const readFixesAsked = new ReadFixesAsked({ pullRequests, planIssues })

    return new ReviewWatch({
      asked: (watch) => readFixesAsked.execute(new ReadFixesAskedParams(watch)),
      review: (params) => requestFixes.execute(new RequestFixesParams(params)),
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_ASKS),
      stderr: (line) => process.stderr.write(line),
      label: 'pull request review watch',
      log: new MemoryReviewLog(),
    })
  }

  static #publishStateRoot(root: string, environment: NodeJS.ProcessEnv): void {
    const path = StateRootMarker.pathIn({ configDir: Invocation.configuredIn(environment, homedir()) })
    try {
      Disk.atomicWriteSync(path, StateRootMarker.contentFor(root, { pid: process.pid, at: new Date().toISOString() }))
    } catch (failure) {
      process.stderr.write(`warning: the state root could not be published at ${path} (${CtApi.#messageOf(failure)}), so a plugin command resolving a different root cannot tell, and reports an empty loop instead of a disagreement\n`)
    }
  }

  static #messageOf(failure: unknown): string {
    return failure instanceof Error ? failure.message : String(failure)
  }

  static async run(argv: string[], environment: NodeJS.ProcessEnv): Promise<void> {
    const asked = Invocation.from(argv, environment, homedir())
    if (asked.outcome !== InvocationOutcome.READY || asked.port === null || asked.stateRoot === null) {
      CtApi.#refuseUsage(asked.reason)
    }
    CtApi.#publishStateRoot(asked.stateRoot, environment)
    const git = CtApi.#tool(GitWorkspace.BIN)
    const gh = CtApi.#talkingTo(Gh.BIN, Gh)
    const docker = new ToolRunner({ bin: 'docker', budgetMs: CtApi.#PROCESS_TIMEOUT_MS })
    const preparation = new CheckRepositoryPreparation({
      environments: new ComposeWorktreeEnvironments({ git, make: CtApi.#tool('make'), docker: (argv, cwd) => docker.run(argv, { cwd }), files: fs }),
      reports: new SessionPreparationReports({
        sessions: () => coordinatingSessions, stderr: (line) => process.stderr.write(line),
      }),
    })
    const workspace = new GitWorkspace({
      preparation,
      run: git,
      gh,
      write: Disk.write,
      read: Disk.read,
      lstat: fs.lstat,
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
    const files = new HeadlessFiles({ root: asked.stateRoot, fs, newId: randomUUID })
    const records = new DiskPlanRecords({
      files,
      newId: randomUUID,
      now: () => new Date().toISOString(),
      exists: Disk.exists,
    })
    const executor = new ClaudeCalls({
      files,
      binary: ClaudeConversations.BIN,
      worker: fileURLToPath(new URL('./headless-call-worker.ts', import.meta.url)),
      spawn: spawnChild,
      env: CtApi.#headlessEnvironment(environment),
      newId: randomUUID,
      now: () => new Date().toISOString(),
      budgetMs: CtApi.#PLAN_CALL_TIMEOUT_MS,
      killGraceMs: CtApi.#PLAN_CALL_KILL_GRACE_MS,
      acceptanceMs: CtApi.#PLAN_CALL_ACCEPTANCE_MS,
      pollMs: CtApi.#PLAN_CALL_POLL_MS,
      sleep: (milliseconds) => after(milliseconds),
    })
    const calls = new MeasuredAgentCalls({
      executor,
      reader: new ClaudeRunMeasurements({ files }),
      store: new DiskAgentMeasurements({ files }),
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
        claudeDirectory: Invocation.configuredIn(environment, homedir()),
        cwd: watch.located.path,
        listNames: (path: string) => readdirSync(path),
        readText: (path: string) => readFileSync(path, 'utf8'),
      }).read(watch.agent) !== null,
      records,
      nowMs: Date.now,
    })
    const userStories = CtApi.#userStories(gh)
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
    const planningActivities = new StreamPlanningActivities({ planCalls, files, nowMs: Date.now })
    const activePlans = new ActivePlans({ sessions })
    const planProgress = new PlanContractProgress({
      node: CtApi.#tool(process.execPath),
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
      stderr: (line) => process.stderr.write(line),
    })
    const journal = new RunJournal({ files, newId: randomUUID, now: () => new Date().toISOString() })
    const oracleRunner = new ToolRunner({ bin: process.execPath, budgetMs: CtApi.#PLAN_CALL_TIMEOUT_MS })
    const runGitRunner = new ToolRunner({ bin: GitWorkspace.BIN, budgetMs: CtApi.#PROCESS_TIMEOUT_MS })
    const machine = new CtRunMachine({
      journal,
      node: oracleRunner.runWholeOutput.bind(oracleRunner),
      git: runGitRunner.runWholeOutput.bind(runGitRunner),
      read: Disk.read,
      ctStep: PluginTree.ctStep(),
      dispatchCheck: PluginTree.dispatchCheck(),
      pluginRoot: PluginTree.root(),
    })
    const releaseRunner = new ToolRunner({ bin: process.execPath, budgetMs: CtApi.#HARVEST_TIMEOUT_MS })
    const runDelivery = new CheckedRunDelivery({
      journal,
      machine,
      git: runGitRunner.runWholeOutput.bind(runGitRunner),
      node: releaseRunner.runWholeOutput.bind(releaseRunner),
      gh,
      read: Disk.read,
      dispatchCheck: PluginTree.dispatchCheck(),
      newId: randomUUID,
      now: () => new Date().toISOString(),
    })
    const runCalls = new ClaudeRunCalls({
      calls,
      machine,
      files,
      pluginRoot: PluginTree.root(),
    })
    const escalations = new DiskSliceEscalations({
      read: Disk.read, exists: Disk.exists, write: Disk.atomicWrite,
    })
    const readSliceEscalation = new ReadSliceEscalation({ escalations })
    const driver = new DriveRun({
      calls: planCalls,
      publication,
      machine,
      delivery: runDelivery,
      step: new ExecuteRunInstruction({ machine, calls: runCalls }),
      messages: new DeliverHeldMessages({
        messages: journal, calls: planCalls, escalations,
      }),
      escalations: readSliceEscalation,
      announcements: new SessionClosureAnnouncements({ sessions: () => coordinatingSessions }),
      stderr: (line) => process.stderr.write(line),
    })
    const planAgents = new RunPlanAgents({
      legacy: legacyPlanAgents,
      records,
      calls: planCalls,
      transport: calls,
      driver,
      machine,
      journal,
      delivery: runDelivery,
      announcements: new SessionChangeAnnouncements({ sessions: () => coordinatingSessions }),
      newId: randomUUID,
      nowMs: Date.now,
      stderr: (line) => process.stderr.write(line),
    })
    const claims = new DispatchCheckClaims({
      node: CtApi.#tool(process.execPath),
      dispatchCheck: PluginTree.dispatchCheck(),
    })
    const requestFixes = new RequestFixes({ workbench, planAgents, planIssues })
    const pullRequestReviews = CtApi.#pullRequestReviews(pullRequests, planIssues, requestFixes)
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
      delivery: runDelivery,
      checkouts,
      activePlans,
      reviews: pullRequestReviews,
      nowMs: Date.now,
    })
    const liveSessions = new PtyLiveSessions({
      spawn, newId: randomUUID, stderr: (line) => process.stderr.write(line),
      signal: (pid, signal) => process.kill(pid, signal),
      sleep: (milliseconds) => after(milliseconds),
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
      claudeDirectory: Invocation.configuredIn(environment, homedir()),
      pluginRoot: PluginTree.root(),
      listNames: (path) => readdirSync(path),
      readText: (path) => readFileSync(path, 'utf8'),
      newId: randomUUID,
      hooksUrl: () => `http://${LOOPBACK}:${listeningPort}${SessionHooksRoute.PATH}`,
    })
    const sessionHooks = new LocalSettingsSessionHooks({ read: Disk.read, write: Disk.write, stateRoot: asked.stateRoot })
    const conversationRecords = new DiskConversationRecords({
      read: Disk.read,
      write: Disk.atomicWrite,
      root: asked.stateRoot,
      newId: randomUUID,
      now: () => new Date().toISOString(),
    })
    const coordinatingSessions = new CoordinatingSessions({
      liveSessions,
      stderr: (line) => process.stderr.write(line),
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
      checkouts,
    })
    const recoverCoordinatingSession = new RecoverCoordinatingSession({
      conversations: claudeConversations,
      sessionHooks,
      records: conversationRecords,
      liveSessions,
      checkouts,
      newId: randomUUID,
      now: () => new Date().toISOString(),
      stderr: (line) => process.stderr.write(line),
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
    const askGroomReview = new AskGroomReview({ specs: epicSpecs, liveSessions, admission: coordinatingSessions })
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
    const groomRunner = new ToolRunner({ bin: process.execPath, budgetMs: CtApi.#GROOM_TIMEOUT_MS })
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
    const promoteEpic = new PromoteEpic({ read: readEpicGroom, issues: epicIssues, preparation })
    const startsInFlight = new WorkInFlight()
    const startMilestonePlan = new StartMilestonePlan({
      preparation,
      candidates: new GhDispatchCandidates({ gh }),
      claims,
      workspace,
      agents: planAgents,
      records,
      checkouts,
    })
    const dispatchRelay = new DispatchRelay({
      spec: (root) => epicSpecs.mostRecent(root),
      dispatch: (relayed) => startMilestonePlan.execute(new StartMilestonePlanParams(relayed)),
      inFlight: startsInFlight,
      stderr: (line) => process.stderr.write(line),
    })
    const implementProgress = new ReadImplementationProgress({
      implementationProgress: runFileProgress,
      pullRequests,
      planIssues,
      records,
      delivery: runDelivery,
      isDriver: async (watch) => await planAgents.provenance(watch) === RunProvenance.DRIVER,
    })
    const server = new ApiServer({
      preparation,
      port: asked.port,
      startMilestonePlan,
      startsInFlight,
      sliceMessage: (changed) => requestFixes.execute(new RequestFixesParams(changed)),
      sliceHeldChange: (changed) => planAgents.hold(changed),
      anotherRound: (asked) => planAgents.anotherRound(asked),
      recoverPlan: new RecoverPlan({ agents: planAgents }),
      cleanupPlan: new CleanupPlan({ records, workspace, claims, planIssues }),
      workProgress: new ReadWorkProgress({
        inventory: new InspectedWorkInventory({ inspection: recovery, plans: activePlans }),
        plans: planProgress,
        activities: planningActivities,
        implementation: implementProgress,
      }),
      implementHistory: new ReadImplementationHistory({ implementationHistory: metricsFileHistory }),
      sliceEscalation: readSliceEscalation,
      sessions,
      activePlans,
      externalTools: new SurveyExternalTools({
        toolSessions: CtApi.#toolSessions(environment),
        metricsDelivery: MetricsDelivery.to(asked.harvestTable),
      }),
      recovery,
      inspection: recovery,
      maintenance: new WorkRecoveryClock({
        recovery,
        intervalMs: 2000,
        schedule: (run, milliseconds) => {
          const timer = setTimeout(run, milliseconds)
          return () => clearTimeout(timer)
        },
        report: (diagnostic) => process.stderr.write(`work recovery: ${diagnostic}\n`),
      }),
      listLiveSessions: new ListLiveSessions({ liveSessions }),
      liveSessions,
      watchLiveSession: new WatchLiveSession({ liveSessions }),
      typeIntoSession: new TypeIntoSession({ liveSessions }),
      resizeSession: new ResizeSession({ liveSessions }),
      openCoordinatingSession,
      openGroomSession,
      askGroomReview,
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
      stderr: (line) => process.stderr.write(line),
      frontendRoot: FrontendBuild.root(),
    })
    const callRestorationFailure = await recovery.restoreCalls()
    if (callRestorationFailure !== null) {
      process.stderr.write(`call measurement recovery failed: ${callRestorationFailure}\n`)
    }
    let port: number
    coordinatingSessions.beginRecovery()
    try {
      port = await server.start()
    } catch (error) {
      CtApi.#refuseListen(`could not listen on ${LOOPBACK}: ${CtApi.#messageOf(error)}`)
    }
    listeningPort = port
    process.stdout.write(`${JSON.stringify({ port })}\n`)
    CoordinatingSessionRecovery.remember(
      await recoverCoordinatingSession.execute(), coordinatingSessions, (line) => process.stderr.write(line)
    )
    CtApi.#sweepUntilItBreaks(CtApi.#harvestClock({
      workspace, checkouts, environment, harvestTable: asked.harvestTable, relay: dispatchRelay,
    }))
  }
}

await CtApi.run(process.argv.slice(2), process.env)
