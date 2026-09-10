import {
  buildLauncherScript,
  buildTypedCommand,
  parseSentinel,
  sameDir,
  LAUNCHER_FILENAME,
  SENTINEL_FILENAME,
} from '../../../plugin/scripts/launch-sentinel.js'
import { shQuote } from '../../../plugin/scripts/shquote.js'
import { PlanAgents } from '../domain/ports/plan-agents.ts'
import { LaunchStep } from '../domain/policies/launch-policy.ts'
import type { LaunchPolicy } from '../domain/policies/launch-policy.ts'
import { PlanAgentNotLaunched, PlanAgentNotNamed, PlanAgentNotResumed } from '../domain/exceptions.ts'
import type { PlanAgentBrief } from './plan-agent-brief.ts'
import type { ToolLaunch } from './external-tool.ts'
import type { PlanBriefing } from '../domain/value-objects/plan-briefing.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { UserStoryKey } from '../domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../domain/value-objects/user-story-url.ts'

export type SentinelWrite = (path: string, text: string) => Promise<void>
export type SentinelRead = (path: string) => Promise<string | null>
export type SentinelRemove = (path: string) => Promise<void>
export type LaunchWait = () => Promise<void>
export type RealpathOf = (path: string) => string | null

type Sentinel = NonNullable<ReturnType<typeof parseSentinel>>

export class CmuxPlanAgents extends PlanAgents {
  static readonly BIN = 'cmux'
  static readonly AGENT = 'claude'
  static readonly MODEL = 'opus'
  static readonly #REF = /^OK\s+(workspace:\d+)\s*$/m
  static readonly NO_MOVE = 'no move declared for launch step'

  readonly realpathOf: RealpathOf
  readonly run: ToolLaunch
  readonly write: SentinelWrite
  readonly read: SentinelRead
  readonly remove: SentinelRemove
  readonly sleep: LaunchWait
  readonly runsIn: string
  readonly policy: LaunchPolicy
  readonly brief: PlanAgentBrief

  constructor({ run, write, read, remove, sleep, runsIn, policy, brief, realpathOf }: {
    run: ToolLaunch,
    write: SentinelWrite,
    read: SentinelRead,
    remove: SentinelRemove,
    sleep: LaunchWait,
    runsIn: string,
    policy: LaunchPolicy,
    brief: PlanAgentBrief,
    realpathOf: RealpathOf,
  }) {
    super()
    this.realpathOf = realpathOf
    this.run = run
    this.write = write
    this.read = read
    this.remove = remove
    this.sleep = sleep
    this.runsIn = runsIn
    this.policy = policy
    this.brief = brief
  }

  static readonly NAME_PREFIX = 'ct-plan-'
  static readonly NO_STORY_PREFIX = 'issue-'

  static nameFor({ story, repository, issueNumber }: {
    story: UserStoryKey | UserStoryUrl | null,
    repository: RepositoryName,
    issueNumber: number,
  }): string {
    return `${CmuxPlanAgents.NAME_PREFIX}${repository.text.replace(/\//g, '__')}-${
      story === null ? `${CmuxPlanAgents.NO_STORY_PREFIX}${issueNumber}` : story
    }`
  }

  static isHandle(value: unknown): value is string {
    return typeof value === 'string' && /^workspace:\d+$/.test(value)
  }

  static argvFor(briefing: PlanBriefing, typed: string): string[] {
    return [
      'new-workspace',
      '--name', CmuxPlanAgents.nameFor({
        story: briefing.story,
        repository: briefing.repository,
        issueNumber: briefing.issue.number,
      }),
      '--cwd', briefing.located.path,
      '--command', typed,
    ]
  }

  static sendArgvFor(handle: string, typed: string): string[] {
    return ['send', '--workspace', handle, typed]
  }

  static enterArgvFor(handle: string): string[] {
    return ['send-key', '--workspace', handle, 'Enter']
  }

  static scriptFor({ sentinelPath, errand, bin, issue, worktree }: {
    sentinelPath: string,
    errand: string,
    bin: string,
    issue: number,
    worktree: string,
  }): string {
    return buildLauncherScript({
      sentinelPath,
      agentCommand: `${bin} --model ${CmuxPlanAgents.MODEL} ${shQuote(errand)}`,
      agentBin: bin,
      issue,
      worktree,
    }, shQuote)
  }

  async launch(briefing: PlanBriefing): Promise<string> {
    const errand = this.brief.errandFor({ issue: briefing.issue, repository: briefing.repository })
    const directory = `${this.runsIn}/${briefing.repository.text.replace(/\//g, '__')}-${briefing.issue.number}`
    const launcherPath = `${directory}/${LAUNCHER_FILENAME}`
    const sentinelPath = `${directory}/${SENTINEL_FILENAME}`
    const typed = buildTypedCommand(launcherPath, shQuote)
    await this.remove(sentinelPath)
    await this.write(launcherPath, CmuxPlanAgents.scriptFor({
      sentinelPath,
      errand,
      bin: CmuxPlanAgents.AGENT,
      issue: briefing.issue.number,
      worktree: briefing.located.path,
    }))
    const handle = await this.#open(briefing, typed)
    await this.#confirm({ briefing, sentinelPath, typed, handle })

    return handle
  }

  async resume({ agent, issue, repository }: {
    agent: string,
    issue: number,
    repository: RepositoryName,
  }): Promise<void> {
    const errand = this.brief.implementationErrandFor({ issueNumber: issue, repository })
    await this.#type(CmuxPlanAgents.sendArgvFor(agent, errand))
    await this.#type(CmuxPlanAgents.enterArgvFor(agent))
  }

  async review({ agent, issue, repository, changes }: {
    agent: string,
    issue: number,
    repository: RepositoryName,
    changes: string,
  }): Promise<void> {
    const errand = this.brief.reviewErrandFor({ issueNumber: issue, repository, changes })
    await this.#type(CmuxPlanAgents.sendArgvFor(agent, errand))
    await this.#type(CmuxPlanAgents.enterArgvFor(agent))
  }

  async fix({ agent, issue, repository, changes }: {
    agent: string,
    issue: number,
    repository: RepositoryName,
    changes: string,
  }): Promise<void> {
    const errand = this.brief.fixErrandFor({ issueNumber: issue, repository, changes })
    await this.#type(CmuxPlanAgents.sendArgvFor(agent, errand))
    await this.#type(CmuxPlanAgents.enterArgvFor(agent))
  }

  async #type(argv: string[]): Promise<void> {
    const output = await this.run(argv)
    if (output.failed) {
      throw new PlanAgentNotResumed(`${CmuxPlanAgents.BIN} ${argv[0]} failed: ${output.stderr.trim()}`)
    }
  }

  async #open(briefing: PlanBriefing, typed: string): Promise<string> {
    const argv = CmuxPlanAgents.argvFor(briefing, typed)
    const output = await this.run(argv)
    if (output.failed) {
      throw new PlanAgentNotLaunched(`${CmuxPlanAgents.BIN} ${argv[0]} failed: ${output.stderr.trim()}`)
    }
    const printed = output.stdout
    const found = printed.match(CmuxPlanAgents.#REF)
    if (found === null) {
      throw new PlanAgentNotNamed(
        `cmux did not name the workspace it created, it printed ${JSON.stringify(printed)}`
      )
    }

    return found[1]
  }

  async #confirm({ briefing, sentinelPath, typed, handle }: {
    briefing: PlanBriefing,
    sentinelPath: string,
    typed: string,
    handle: string,
  }): Promise<void> {
    for (let probes = 1; ; probes += 1) {
      const seen = await this.#peek(sentinelPath)
      if (seen !== null) return this.#judge(seen, briefing)
      await this.sleep()
      const step = this.policy.afterProbing(probes)
      if (step === LaunchStep.KEEP_PROBING) continue
      if (step === LaunchStep.RESEND_THE_LINE) {
        await this.#resend(handle, typed)
        continue
      }
      if (step === LaunchStep.GIVE_UP) {
        throw new PlanAgentNotLaunched(
          `the cmux window opened but no sentinel ever appeared at ${sentinelPath}: the line never ran`
        )
      }
      throw new Error(`${CmuxPlanAgents.NO_MOVE} ${step}`)
    }
  }

  #judge(seen: Sentinel, briefing: PlanBriefing): void {
    if (!seen.claudeResolved) {
      throw new PlanAgentNotLaunched(
        `the shell of the session cannot find ${CmuxPlanAgents.AGENT} on its PATH, so no agent is writing anything`
      )
    }
    if (!sameDir(seen.cwd, briefing.located.path, this.realpathOf)) {
      throw new PlanAgentNotLaunched(
        `the session started in ${seen.cwd} and not in ${briefing.located.path}: whatever it writes misses this branch`
      )
    }
  }

  async #peek(sentinelPath: string): Promise<Sentinel | null> {
    const text = await this.read(sentinelPath)

    return text === null ? null : parseSentinel(text)
  }

  async #resend(handle: string, typed: string): Promise<void> {
    await this.run(CmuxPlanAgents.sendArgvFor(handle, typed))
    await this.run(CmuxPlanAgents.enterArgvFor(handle))
  }
}
