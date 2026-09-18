import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { ActualHeadlessRuntime, Entrypoint, TheCoordinatingSession } from './fixtures/ct-api-process.ts'
import type { RecordedLaunch, StartedEntrypoint, StartedPlan } from './fixtures/ct-api-process.ts'

type ReadSession = { id: string, name: string }
type ReadTimelineEvent = { id: string, kind: string }
type ReadCoordinatingSession = {
  status: string,
  conversation?: string,
  session?: ReadSession,
  timeline?: ReadTimelineEvent[],
}
type ReadActivePlan = {
  phase: string,
  diagnostic?: string,
  recovery?: { action: string, detail: string },
  plan: { agent: string, branch: string, worktree: string, issue: { number: number } },
}

class TheApi {
  static async coordinatingSession(port: number): Promise<ReadCoordinatingSession> {
    return await (await fetch(`http://127.0.0.1:${port}/coordinating-session`)).json() as ReadCoordinatingSession
  }

  static async sessions(port: number): Promise<ReadSession[]> {
    const listed = await (await fetch(`http://127.0.0.1:${port}/sessions`)).json() as { sessions: ReadSession[] }

    return listed.sessions
  }

  static async activePlans(port: number): Promise<ReadActivePlan[]> {
    const listed = await (await fetch(`http://127.0.0.1:${port}/active-plans`)).json() as { plans: ReadActivePlan[] }

    return listed.plans
  }
}

class OnDisk {
  static async or(path: string, gone: string): Promise<string> {
    try {
      await access(path)

      return 'on-disk'
    } catch {
      return gone
    }
  }
}

class TheProcessTable {
  static readonly #SETTLE_MS = 250
  static readonly #DEADLINE_MS = 10_000

  static commandOf(pid: number): string {
    try {
      return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  }

  static async settled(pids: readonly number[]): Promise<Set<number>> {
    let previous = TheProcessTable.#aliveAmong(pids)
    const deadline = Date.now() + TheProcessTable.#DEADLINE_MS
    while (Date.now() < deadline) {
      await new Promise((wake) => setTimeout(wake, TheProcessTable.#SETTLE_MS))
      const now = TheProcessTable.#aliveAmong(pids)
      if (TheProcessTable.#same(previous, now)) return now
      previous = now
    }
    throw new Error('the descendants of the crashed backend never stopped changing')
  }

  static #aliveAmong(pids: readonly number[]): Set<number> {
    return new Set(pids.filter((pid) => Entrypoint.alive(pid)))
  }

  static #same(left: Set<number>, right: Set<number>): boolean {
    return left.size === right.size && [...left].every((pid) => right.has(pid))
  }
}

class TheProcessesTheBackendOwned {
  static readonly WORKER = 'headless-call-worker'

  readonly terminal: number
  readonly worker: number
  readonly agent: number

  constructor(asked: { terminal: number, worker: number, agent: number }) {
    this.terminal = asked.terminal
    this.worker = asked.worker
    this.agent = asked.agent
  }

  static of(life: StartedEntrypoint, launch: RecordedLaunch): TheProcessesTheBackendOwned {
    const running = life.descendants()
      .map((pid) => ({ pid, command: TheProcessTable.commandOf(pid) }))
      .filter((found) => found.command !== '')
    const agent = launch.captured.pid
    const terminal = running
      .find((found) => found.command.includes(`--resume ${ActualHeadlessRuntime.COORDINATOR}`))?.pid
    const worker = running.find((found) => found.command.includes(TheProcessesTheBackendOwned.WORKER))?.pid
    if (terminal === undefined || worker === undefined || !running.some((found) => found.pid === agent)) {
      throw new Error(
        `the backend owned ${JSON.stringify(running.map((found) => found.command))}, `
        + `and a terminal, a worker and the agent ${agent} are not all among them`
      )
    }

    return new TheProcessesTheBackendOwned({ terminal, worker, agent })
  }

  all(): number[] {
    return [this.terminal, this.worker, this.agent]
  }
}

class ALifeOfTheBackend {
  readonly coordinating: ReadCoordinatingSession
  readonly sessions: readonly ReadSession[]
  readonly plans: readonly ReadActivePlan[]

  constructor(asked: {
    coordinating: ReadCoordinatingSession, sessions: readonly ReadSession[], plans: readonly ReadActivePlan[],
  }) {
    this.coordinating = asked.coordinating
    this.sessions = asked.sessions
    this.plans = asked.plans
  }

  static async readBy(port: number): Promise<ALifeOfTheBackend> {
    return new ALifeOfTheBackend({
      coordinating: await TheApi.coordinatingSession(port),
      sessions: await TheApi.sessions(port),
      plans: await TheApi.activePlans(port),
    })
  }

  onlyPlan(): ReadActivePlan {
    if (this.plans.length !== 1) throw new Error(`the backend knows ${this.plans.length} active plans instead of one`)

    return this.plans[0]
  }

  terminalId(): string {
    if (this.sessions.length !== 1) throw new Error(`the backend holds ${this.sessions.length} sessions instead of one`)

    return this.sessions[0].id
  }

  timelineIds(): string[] {
    return (this.coordinating.timeline ?? []).map((event) => event.id)
  }
}

class ADispatchedPlan {
  static readonly COMMENT = 'Plan the loose fixture'

  static async by(port: number, runtime: ActualHeadlessRuntime): Promise<RecordedLaunch> {
    const answered = await Entrypoint.startPlan(port, JSON.stringify({
      user_comment: ADispatchedPlan.COMMENT,
      repo: ActualHeadlessRuntime.REPOSITORY,
      path: runtime.root,
    }))
    const said = await answered.text()
    if (answered.status !== 202) throw new Error(`the plan was refused with ${answered.status}: ${said}`)

    return runtime.launchFor(JSON.parse(said) as StartedPlan, await runtime.launches(1))
  }
}

class ABackendThatCrashed {
  readonly runtime: ActualHeadlessRuntime
  readonly launch: RecordedLaunch
  readonly owned: TheProcessesTheBackendOwned
  readonly survivors: Set<number>
  readonly before: ALifeOfTheBackend
  readonly after: ALifeOfTheBackend
  readonly secondLife: StartedEntrypoint

  constructor(asked: {
    runtime: ActualHeadlessRuntime,
    launch: RecordedLaunch,
    owned: TheProcessesTheBackendOwned,
    survivors: Set<number>,
    before: ALifeOfTheBackend,
    after: ALifeOfTheBackend,
    secondLife: StartedEntrypoint,
  }) {
    this.runtime = asked.runtime
    this.launch = asked.launch
    this.owned = asked.owned
    this.survivors = asked.survivors
    this.before = asked.before
    this.after = asked.after
    this.secondLife = asked.secondLife
  }

  static async andStartedAgain(runtime: ActualHeadlessRuntime): Promise<ABackendThatCrashed> {
    const firstLife = await Entrypoint.started(runtime.environment())
    await TheCoordinatingSession.recoveredBy(firstLife.port)
    const launch = await ADispatchedPlan.by(firstLife.port, runtime)
    const before = await ALifeOfTheBackend.readBy(firstLife.port)
    const owned = TheProcessesTheBackendOwned.of(firstLife, launch)

    await firstLife.crash()

    const survivors = await TheProcessTable.settled(owned.all())
    const secondLife = await Entrypoint.recovering(runtime.environment())

    return new ABackendThatCrashed({
      runtime, launch, owned, survivors, before,
      after: await ALifeOfTheBackend.readBy(secondLife.port),
      secondLife,
    })
  }

  async relaunches(): Promise<number> {
    return (await this.runtime.launches(1)).length - 1
  }
}

class TheRecoveryOffer {
  static readonly AFTER_THE_FIRST_PRESS_MS = 8_000
  static readonly AFTER_THE_SECOND_PRESS_MS = 4_000

  static async pressedOn(crashed: ABackendThatCrashed): Promise<number> {
    const plan = crashed.after.onlyPlan()
    const answered = await fetch(`http://127.0.0.1:${crashed.secondLife.port}/recover-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: ActualHeadlessRuntime.REPOSITORY, issue: plan.plan.issue.number, agent: plan.plan.agent,
      }),
    })
    const said = await answered.text()
    if (JSON.parse(said).agent !== plan.plan.agent) throw new Error(`the recovery answered for another agent: ${said}`)

    return answered.status
  }

  static async waited(milliseconds: number): Promise<void> {
    await new Promise((wake) => setTimeout(wake, milliseconds))
  }
}

class WhatPressingTheRecoveryChanges {
  static async of(asked: {
    crashed: ABackendThatCrashed,
    presses: readonly number[],
    settled: ALifeOfTheBackend,
  }): Promise<Record<string, string>> {
    const was = asked.crashed.after.onlyPlan()
    const now = asked.settled.onlyPlan()

    return {
      everyPress: [...new Set(asked.presses)].join(' and '),
      phase: `${was.phase} then ${now.phase}`,
      recoveryOffered: `${was.recovery?.action} then ${now.recovery?.action}`,
      diagnostic: was.diagnostic === now.diagnostic ? 'the one it already had' : 'a new one',
      orphanWorker: WhatPressingTheRecoveryChanges.#liveness(asked.crashed.owned.worker),
      orphanAgent: WhatPressingTheRecoveryChanges.#liveness(asked.crashed.owned.agent),
      relaunch: `${await asked.crashed.relaunches()} further launch`,
      headlessDescendant: asked.crashed.secondLife.descendants()
        .some((pid) => TheProcessTable.commandOf(pid).includes(TheProcessesTheBackendOwned.WORKER))
        ? 'started again' : 'none',
    }
  }

  static #liveness(pid: number): string {
    return Entrypoint.alive(pid) ? 'still running' : 'gone'
  }
}

class WhatARestartGivesBack {
  static readonly #UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

  static async of(asked: {
    before: ALifeOfTheBackend,
    after: ALifeOfTheBackend,
    owned: TheProcessesTheBackendOwned,
    survivors: Set<number>,
    launch: RecordedLaunch,
    runtime: ActualHeadlessRuntime,
    relaunches: number,
  }): Promise<Record<string, string>> {
    const before = asked.before.onlyPlan()
    const after = asked.after.onlyPlan()
    const harness = join(asked.runtime.state, 'control-tower', 'harness', after.plan.agent)

    return {
      coordinatingConversation: WhatARestartGivesBack.#same(
        asked.before.coordinating.conversation, asked.after.coordinating.conversation
      ),
      coordinatingTimeline: WhatARestartGivesBack.#grown(asked.before.timelineIds(), asked.after.timelineIds()),
      coordinatingTerminal: WhatARestartGivesBack.#same(asked.before.terminalId(), asked.after.terminalId()),
      coordinatingTerminalProcess: WhatARestartGivesBack.#outliving(asked.owned.terminal, asked.survivors),
      dispatchedPlan: WhatARestartGivesBack.#same(before.plan.agent, after.plan.agent),
      dispatchedPlanBranch: WhatARestartGivesBack.#same(before.plan.branch, after.plan.branch),
      dispatchedPlanPhase: `${before.phase} then ${after.phase}`,
      dispatchedPlanDiagnostic: WhatARestartGivesBack.#anonymous(after.diagnostic),
      dispatchedPlanRecovery: `${after.recovery?.action}: ${WhatARestartGivesBack.#anonymous(after.recovery?.detail)}`,
      dispatchedPlanWorker: WhatARestartGivesBack.#outliving(asked.owned.worker, asked.survivors),
      dispatchedPlanAgentProcess: WhatARestartGivesBack.#outliving(asked.owned.agent, asked.survivors),
      dispatchRecord: await OnDisk.or(join(harness, 'dispatch.json'), 'gone'),
      dispatchedPlanPrompt: await OnDisk.or(asked.launch.promptPath, 'gone'),
      dispatchedPlanWorktree: await OnDisk.or(after.plan.worktree, 'gone'),
      dispatchedPlanRelaunch: `${asked.relaunches} further launch`,
    }
  }

  static #same(before: string | undefined, after: string | undefined): string {
    if (before === undefined || after === undefined) return 'never there'

    return before === after ? 'the same one' : 'a different one'
  }

  static #grown(before: readonly string[], after: readonly string[]): string {
    const kept = before.every((id, at) => after[at] === id)
    if (!kept) return 'rewritten'

    return after.length > before.length ? `${before.length} kept and ${after.length - before.length} appended` : 'kept'
  }

  static #outliving(pid: number, survivors: Set<number>): string {
    return survivors.has(pid) ? 'orphaned and still running' : 'died with the backend'
  }

  static #anonymous(said: string | undefined): string {
    return (said ?? 'nothing said').replace(WhatARestartGivesBack.#UUID, '<call>')
  }
}

describe('a crash of the backend with work in flight', () => {
  afterEach(async () => {
    await Entrypoint.killAll()
  })

  it('gives back every record it had written, opens a new terminal, and leaves the headless call running unowned', async () => {
    const runtime = await ActualHeadlessRuntime.prepared()
    let owned: TheProcessesTheBackendOwned | null = null
    try {
      const crashed = await ABackendThatCrashed.andStartedAgain(runtime)
      owned = crashed.owned

      expect(await WhatARestartGivesBack.of({
        before: crashed.before,
        after: crashed.after,
        owned: crashed.owned,
        survivors: crashed.survivors,
        launch: crashed.launch,
        runtime,
        relaunches: await crashed.relaunches(),
      })).toEqual({
        coordinatingConversation: 'the same one',
        coordinatingTimeline: '1 kept and 1 appended',
        coordinatingTerminal: 'a different one',
        coordinatingTerminalProcess: 'died with the backend',
        dispatchedPlan: 'the same one',
        dispatchedPlanBranch: 'the same one',
        dispatchedPlanPhase: 'planning then uncertain',
        dispatchedPlanDiagnostic: 'incomplete call <call> is not owned by this API process; '
          + 'plan call <call> is incomplete within its recorded deadline',
        dispatchedPlanRecovery: 'observe: plan call <call> is incomplete within its recorded deadline',
        dispatchedPlanWorker: 'orphaned and still running',
        dispatchedPlanAgentProcess: 'orphaned and still running',
        dispatchRecord: 'on-disk',
        dispatchedPlanPrompt: 'on-disk',
        dispatchedPlanWorktree: 'on-disk',
        dispatchedPlanRelaunch: '0 further launch',
      })
    } finally {
      for (const pid of owned?.all() ?? []) await Entrypoint.killPid(pid)
      await Entrypoint.killAll()
      await runtime.remove()
    }
  }, 120_000)

  it('accepts the recovery as often as it is pressed and leaves the plan exactly as uncertain as it found it', async () => {
    const runtime = await ActualHeadlessRuntime.prepared()
    let owned: TheProcessesTheBackendOwned | null = null
    try {
      const crashed = await ABackendThatCrashed.andStartedAgain(runtime)
      owned = crashed.owned

      const presses = [await TheRecoveryOffer.pressedOn(crashed)]
      await TheRecoveryOffer.waited(TheRecoveryOffer.AFTER_THE_FIRST_PRESS_MS)
      presses.push(await TheRecoveryOffer.pressedOn(crashed))
      await TheRecoveryOffer.waited(TheRecoveryOffer.AFTER_THE_SECOND_PRESS_MS)

      expect(await WhatPressingTheRecoveryChanges.of({
        crashed, presses, settled: await ALifeOfTheBackend.readBy(crashed.secondLife.port),
      })).toEqual({
        everyPress: '202',
        phase: 'uncertain then uncertain',
        recoveryOffered: 'observe then observe',
        diagnostic: 'the one it already had',
        orphanWorker: 'still running',
        orphanAgent: 'still running',
        relaunch: '0 further launch',
        headlessDescendant: 'none',
      })
    } finally {
      for (const pid of owned?.all() ?? []) await Entrypoint.killPid(pid)
      await Entrypoint.killAll()
      await runtime.remove()
    }
  }, 120_000)
})
