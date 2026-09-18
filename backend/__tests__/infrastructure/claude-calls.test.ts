import { ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanAgentNeverLaunched, PlanAgentNotLaunched, PlanAgentNotNamed } from '../../src/domain/exceptions.ts'
import { StartedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import { CallDescriptor, CallInvocation, ClaudeCalls } from '../../src/infrastructure/claude-calls.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { HeadlessCallWorker } from '../../src/infrastructure/headless-call-worker.ts'

class FakeChild extends ChildProcess {
  constructor(pid: number) {
    super()
    Object.defineProperty(this, 'pid', { value: pid })
  }

  accepted(): void {
    this.emit('spawn')
  }

  closed(code: number | null, signal: NodeJS.Signals | null): void {
    this.emit('close', code, signal)
  }

  failed(cause: Error): void {
    this.emit('error', cause)
  }
}

class ManualClock {
  nowMs: number
  readonly scheduled: { callback: () => void, at: number, cancelled: boolean, cancel: () => void }[] = []

  constructor(nowMs: number) {
    this.nowMs = nowMs
  }

  now = (): string => new Date(this.nowMs).toISOString()

  schedule = (callback: () => void, delayMs: number): { cancel: () => void } => {
    const timer = {
      callback,
      at: this.nowMs + delayMs,
      cancelled: false,
      cancel: (): void => { timer.cancelled = true },
    }
    this.scheduled.push(timer)
    return timer
  }

  cancel = (timer: object): void => {
    const scheduled = this.scheduled.find((candidate) => candidate === timer)
    if (scheduled !== undefined) scheduled.cancelled = true
  }

  advance(ms: number): void {
    const target = this.nowMs + ms
    for (;;) {
      const due = this.scheduled
        .filter((timer) => !timer.cancelled && timer.at <= target)
        .sort((left, right) => left.at - right.at)[0]
      if (due === undefined) break
      this.nowMs = due.at
      due.cancelled = true
      due.callback()
    }
    this.nowMs = target
  }
}

class CallMother {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly CALL = '22222222-2222-4222-8222-222222222222'
  static readonly STARTED_AT = '2026-09-15T10:00:00.000Z'
  static readonly RESULT = `${JSON.stringify({
    type: 'result', subtype: 'success', session_id: CallMother.CONVERSATION,
    is_error: false, total_cost_usd: 1.25, num_turns: 2, duration_ms: 3000,
  })}\n`

  static invocation(over: { argv?: readonly string[], prompt?: string } = {}): CallInvocation {
    return new CallInvocation({
      conversation: CallMother.CONVERSATION,
      purpose: 'plan',
      cwd: '/checkout/.worktrees/331',
      argv: over.argv ?? ['-p', '--session-id', CallMother.CONVERSATION],
      prompt: over.prompt ?? 'Plan the recorded issue.',
    })
  }

  static files(root: string, over: Partial<HeadlessFiles> = {}): HeadlessFiles {
    return Object.assign(new HeadlessFiles({ root, fs, newId: () => 'temporary-record' }), over)
  }

  static calls(root: string, spawn: typeof import('node:child_process').spawn, over: {
    files?: HeadlessFiles,
    now?: () => string,
    sleep?: (ms: number) => Promise<void>,
  } = {}): ClaudeCalls {
    return new ClaudeCalls({
      files: over.files ?? CallMother.files(root),
      binary: '/usr/local/bin/claude',
      worker: '/backend/src/infrastructure/headless-call-worker.ts',
      spawn,
      env: { PATH: '/usr/bin', CT_PHASE_PROMPT: '/coordinator.md', CT_SESSION_HOOKS_URL: 'http://hooks' },
      newId: () => CallMother.CALL,
      now: over.now ?? (() => CallMother.STARTED_AT),
      budgetMs: 100,
      killGraceMs: 20,
      acceptanceMs: 50,
      pollMs: 10,
      sleep: over.sleep ?? (async () => {}),
    })
  }

  static descriptor(root: string, over: Record<string, unknown> = {}): string {
    return `${JSON.stringify({
      conversation: CallMother.CONVERSATION,
      purpose: 'plan',
      requestId: null,
      cwd: root,
      binary: process.execPath,
      argv: ['--session-id', CallMother.CONVERSATION],
      startedAt: CallMother.STARTED_AT,
      budgetMs: 100,
      killGraceMs: 20,
      ...over,
    }, null, 2)}\n`
  }

  static async prepared(root: string, over: Record<string, unknown> = {}): Promise<string> {
    const directory = join(root, 'harness', CallMother.CONVERSATION, 'calls', CallMother.CALL)
    await fs.mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'call.json'), CallMother.descriptor(root, over), 'utf8')
    await writeFile(join(directory, 'prompt.md'), 'A recorded prompt', 'utf8')
    return join(directory, 'call.json')
  }

  static call(): StartedPlanCall {
    return new StartedPlanCall({ conversation: CallMother.CONVERSATION, id: CallMother.CALL })
  }

  static completionPath(root: string): string {
    return join(root, 'harness', CallMother.CONVERSATION, 'calls', CallMother.CALL, 'completion.json')
  }

  static successfulCompletion(asked: {
    code?: number | null,
    signal?: string | null,
    measurement?: Record<string, unknown>,
  } = {}): string {
    return CallMother.#storedCompletion({
      code: asked.code === undefined ? 0 : asked.code,
      signal: asked.signal === undefined ? null : asked.signal,
      execution: { kind: 'success' },
      measurement: asked.measurement,
    })
  }

  static errorCompletion(asked: { code: number | null, signal: string | null }): string {
    return CallMother.#storedCompletion({
      ...asked,
      execution: { kind: 'error', diagnostic: 'Claude reported error_max_turns' },
    })
  }

  static unavailableCompletion(asked: { code: number | null, signal: string | null }): string {
    return CallMother.#storedCompletion({
      ...asked,
      execution: { kind: 'unavailable', diagnostic: 'Claude did not report a result' },
    })
  }

  static unavailableMeasurement(): Record<string, unknown> {
    return {
      cost: { kind: 'unavailable', reason: 'total_cost_usd was unavailable' },
      turns: null,
      durationMs: null,
      unavailable: ['total_cost_usd was unavailable', 'num_turns was unavailable', 'duration_ms was unavailable'],
    }
  }

  static zeroMeasurement(): Record<string, unknown> {
    return {
      cost: { kind: 'reported', totalUsd: 0, attribution: 'initial-invocation' },
      turns: 0,
      durationMs: 0,
      unavailable: [],
    }
  }

  static #storedCompletion(asked: {
    code: number | null,
    signal: string | null,
    execution: Record<string, unknown>,
    measurement?: Record<string, unknown>,
  }): string {
    return `${JSON.stringify({
      code: asked.code,
      signal: asked.signal,
      finishedAt: CallMother.STARTED_AT,
      wallDurationMs: 0,
      execution: asked.execution,
      measurement: asked.measurement ?? CallMother.zeroMeasurement(),
    })}\n`
  }

  static descriptorWithoutRequest(root: string): string {
    const descriptor = JSON.parse(CallMother.descriptor(root)) as Record<string, unknown>
    delete descriptor.requestId
    return `${JSON.stringify(descriptor, null, 2)}\n`
  }

  static worker(root: string, child: FakeChild, clock: ManualClock, asked: {
    present: () => boolean,
    signals: NodeJS.Signals[],
  }): HeadlessCallWorker {
    return new HeadlessCallWorker({
      files: CallMother.files(root),
      spawn: (() => child) as typeof import('node:child_process').spawn,
      kill: (_pid, signal) => {
        if (signal === 0) {
          if (!asked.present()) throw Object.assign(new Error('missing'), { code: 'ESRCH' })
          return
        }
        asked.signals.push(signal)
      },
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
      acknowledge: () => {},
    })
  }

  static async settled(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }

  static async completion(path: string): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
      } catch (cause) {
        if (cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') {
          await CallMother.settled()
          continue
        }
        throw cause
      }
    }
    const stderr = await readFile(join(path, '..', 'stderr.log'), 'utf8').catch(() => '')
    throw new Error(`completion was not published at ${path}: ${stderr}`)
  }
}

describe('ClaudeCalls', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('descriptor provenance reuses the validated reader without writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-descriptor-'))
    roots.push(root)
    const descriptorPath = await CallMother.prepared(root, {
      purpose: 'implementation',
      requestId: `implementation:${CallMother.CALL}`,
      cwd: '/checkout/.worktrees/332',
      argv: ['-p', '--resume', CallMother.CONVERSATION],
    })
    const original = await readFile(descriptorPath, 'utf8')
    let writes = 0
    let spawns = 0
    const files = CallMother.files(root, {
      writeOnce: async () => { writes += 1 },
    })
    const calls = CallMother.calls(root, (() => {
      spawns += 1
      throw new Error('descriptor reads must not spawn')
    }) as typeof import('node:child_process').spawn, { files })

    const legacy = await calls.descriptorOf(CallMother.call())
    expect(legacy.requestId).toBe(`implementation:${CallMother.CALL}`)
    expect(legacy.purpose).toBe('implementation')
    expect(legacy.cwd).toBe('/checkout/.worktrees/332')
    expect(legacy.mode()).toBe('resume')
    expect(Object.isFrozen(legacy)).toBe(true)
    expect(calls.owns(CallMother.call())).toBe(false)

    await writeFile(descriptorPath, CallMother.descriptor(root, {
      purpose: 'implementation',
      requestId: 'run:33333333-3333-4333-8333-333333333333',
      cwd: '/checkout/.worktrees/332',
      argv: ['-p', '--resume', CallMother.CONVERSATION],
    }), 'utf8')
    const driverBytes = await readFile(descriptorPath, 'utf8')
    const driver = await calls.descriptorOf(CallMother.call())

    expect(driver.requestId).toBe('run:33333333-3333-4333-8333-333333333333')
    expect(driver.mode()).toBe('resume')
    expect(writes).toBe(0)
    expect(spawns).toBe(0)
    expect(calls.owns(CallMother.call())).toBe(false)
    expect(await readFile(descriptorPath, 'utf8')).toBe(driverBytes)
    expect(original).not.toBe(driverBytes)
  })

  it('descriptor provenance preserves read and identity failures', async () => {
    const missingRoot = await mkdtemp(join(tmpdir(), 'ct-claude-descriptor-missing-'))
    roots.push(missingRoot)
    await expect(CallMother.calls(
      missingRoot,
      (() => { throw new Error('must not spawn') }) as typeof import('node:child_process').spawn,
    ).descriptorOf(CallMother.call())).rejects.toBeInstanceOf(PlanAgentNotLaunched)

    const ioRoot = await mkdtemp(join(tmpdir(), 'ct-claude-descriptor-io-'))
    roots.push(ioRoot)
    const ioFailure = Object.assign(new Error('descriptor disk refused'), { code: 'EIO' })
    const ioFiles = CallMother.files(ioRoot, { read: async () => { throw ioFailure } })
    await expect(CallMother.calls(
      ioRoot,
      (() => { throw new Error('must not spawn') }) as typeof import('node:child_process').spawn,
      { files: ioFiles },
    ).descriptorOf(CallMother.call())).rejects.toMatchObject({
      constructor: PlanAgentNotLaunched,
      message: expect.stringContaining('descriptor disk refused'),
    })

    for (const [name, descriptor] of [
      ['malformed schema', CallMother.descriptorWithoutRequest(ioRoot)],
      ['wrong conversation', CallMother.descriptor(ioRoot, { conversation: '99999999-9999-4999-8999-999999999999' })],
      ['wrong resume identity', CallMother.descriptor(ioRoot, {
        purpose: 'implementation',
        requestId: 'run:33333333-3333-4333-8333-333333333333',
        argv: ['--resume', '99999999-9999-4999-8999-999999999999'],
      })],
    ] as const) {
      const root = await mkdtemp(join(tmpdir(), `ct-claude-descriptor-${name.replaceAll(' ', '-')}-`))
      roots.push(root)
      const path = await CallMother.prepared(root)
      await writeFile(path, descriptor.replaceAll(ioRoot, root), 'utf8')
      await expect(CallMother.calls(
        root,
        (() => { throw new Error('must not spawn') }) as typeof import('node:child_process').spawn,
      ).descriptorOf(CallMother.call())).rejects.toBeInstanceOf(PlanAgentNotNamed)
    }
  })

  it('call and prompt files exist before the first spawn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    let observed: { argv: readonly string[], env: NodeJS.ProcessEnv } | null = null
    const worker = new FakeChild(901)
    const spawn = ((binary: string, argv: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
      const directory = join(root, 'harness', CallMother.CONVERSATION, 'calls', CallMother.CALL)
      expect(readFileSync(join(directory, 'prompt.md'), 'utf8')).toBe('Plan the recorded issue.')
      expect(JSON.parse(readFileSync(join(directory, 'call.json'), 'utf8'))).toMatchObject({ requestId: null })
      observed = { argv, env: options.env ?? {} }
      expect(binary).toBe(process.execPath)
      queueMicrotask(() => worker.emit('message', { kind: 'accepted' }))
      return worker
    }) as unknown as typeof import('node:child_process').spawn
    const calls = CallMother.calls(root, spawn)

    const started = await calls.start(CallMother.invocation())
    const directory = join(root, 'harness', CallMother.CONVERSATION, 'calls', CallMother.CALL)

    expect(await readFile(join(directory, 'prompt.md'), 'utf8')).toBe('Plan the recorded issue.')
    expect(JSON.parse(await readFile(join(directory, 'call.json'), 'utf8'))).toEqual({
      conversation: CallMother.CONVERSATION,
      purpose: 'plan',
      requestId: null,
      cwd: '/checkout/.worktrees/331',
      binary: '/usr/local/bin/claude',
      argv: ['-p', '--session-id', CallMother.CONVERSATION, CallDescriptor.opening(join(directory, 'prompt.md'))],
      startedAt: CallMother.STARTED_AT,
      budgetMs: 100,
      killGraceMs: 20,
    })
    expect(observed).toMatchObject({
      argv: ['/backend/src/infrastructure/headless-call-worker.ts', join(directory, 'call.json')],
    })
    expect(started.id).toBe(CallMother.CALL)
    expect(observed).not.toMatchObject({ env: { CT_PHASE_PROMPT: expect.anything() } })
    expect(observed).not.toMatchObject({ env: { CT_SESSION_HOOKS_URL: expect.anything() } })
  })

  it('a failed record write launches nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    let launches = 0
    const files = CallMother.files(root, {
      writeOnce: async () => { throw new Error('disk full') },
    })
    const calls = CallMother.calls(root, (() => {
      launches += 1
      return new FakeChild(902)
    }) as typeof import('node:child_process').spawn, { files })

    const failed = calls.start(CallMother.invocation())
    await expect(failed).rejects.toBeInstanceOf(PlanAgentNotLaunched)
    await expect(failed).rejects.not.toBeInstanceOf(PlanAgentNotNamed)
    await expect(failed).rejects.toThrow('disk full')
    expect(launches).toBe(0)
  })

  it('spawn and acceptance failures preserve records', async () => {
    const spawnRoot = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(spawnRoot)
    const spawnFailure = CallMother.calls(spawnRoot, (() => { throw new Error('worker refused') }) as typeof import('node:child_process').spawn)
    const refused = spawnFailure.start(CallMother.invocation())
    await expect(refused).rejects.toBeInstanceOf(PlanAgentNotLaunched)
    await expect(refused).rejects.toBeInstanceOf(PlanAgentNeverLaunched)
    await expect(refused).rejects.not.toBeInstanceOf(PlanAgentNotNamed)
    await expect(refused).rejects.toThrow('worker refused')

    const spawnDirectory = join(spawnRoot, 'harness', CallMother.CONVERSATION, 'calls', CallMother.CALL)
    expect(await readFile(join(spawnDirectory, 'prompt.md'), 'utf8')).toBe('Plan the recorded issue.')
    expect(JSON.parse(await readFile(join(spawnDirectory, 'call.json'), 'utf8'))).toMatchObject({
      conversation: CallMother.CONVERSATION,
      purpose: 'plan',
      requestId: null,
    })

    let retryLaunches = 0
    const retry = CallMother.calls(spawnRoot, (() => {
      retryLaunches += 1
      return new FakeChild(908)
    }) as typeof import('node:child_process').spawn).start(CallMother.invocation())
    await expect(retry).rejects.toBeInstanceOf(PlanAgentNotLaunched)
    await expect(retry).rejects.not.toBeInstanceOf(PlanAgentNotNamed)
    await expect(retry).rejects.toThrow('unfinished call')
    expect(retryLaunches).toBe(0)

    const timeoutRoot = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(timeoutRoot)
    const timeoutDirectory = join(timeoutRoot, 'harness', CallMother.CONVERSATION, 'calls', CallMother.CALL)
    const waiting = CallMother.calls(timeoutRoot, (() => new FakeChild(909)) as typeof import('node:child_process').spawn)
    const unacknowledged = waiting.start(CallMother.invocation())
    await expect(unacknowledged).rejects.toBeInstanceOf(PlanAgentNotLaunched)
    await expect(unacknowledged).rejects.not.toBeInstanceOf(PlanAgentNotNamed)
    await expect(unacknowledged).rejects.toThrow('did not accept call')
    expect(await readFile(join(timeoutDirectory, 'prompt.md'), 'utf8')).toBe('Plan the recorded issue.')
    expect(JSON.parse(await readFile(join(timeoutDirectory, 'call.json'), 'utf8'))).toMatchObject({
      conversation: CallMother.CONVERSATION,
      purpose: 'plan',
      requestId: null,
    })
    await expect(readFile(join(timeoutRoot, 'harness', CallMother.CONVERSATION, 'non-launch.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('acceptance loss never authorizes cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    const calls = CallMother.calls(root, (() => new FakeChild(918)) as typeof import('node:child_process').spawn)

    await expect(calls.start(CallMother.invocation())).rejects.toThrow('did not accept call')

    await expect(readFile(join(root, 'harness', CallMother.CONVERSATION, 'non-launch.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('child spawn refusal records only initial non-launch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    const descriptor = await CallMother.prepared(root)
    const clock = new ManualClock(Date.parse(CallMother.STARTED_AT))
    const worker = new HeadlessCallWorker({
      files: CallMother.files(root),
      spawn: (() => { throw Object.assign(new Error('child refused'), { code: 'ENOENT' }) }) as typeof import('node:child_process').spawn,
      kill: () => {},
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
      acknowledge: () => {},
    })

    await worker.run(descriptor)

    expect(JSON.parse(await readFile(
      join(root, 'harness', CallMother.CONVERSATION, 'non-launch.json'),
      'utf8',
    ))).toEqual({
      conversation: CallMother.CONVERSATION,
      callId: CallMother.CALL,
      source: 'child-spawn',
      diagnostic: 'recorded child could not be spawned: child refused',
      observedAt: CallMother.STARTED_AT,
    })
    expect(JSON.parse(await readFile(CallMother.completionPath(root), 'utf8'))).toMatchObject({
      code: null,
      signal: null,
      finishedAt: CallMother.STARTED_AT,
      execution: {
        kind: 'child-spawn-failed',
        conversation: CallMother.CONVERSATION,
        callId: CallMother.CALL,
        diagnostic: 'recorded child could not be spawned: child refused',
      },
      measurement: {
        cost: { kind: 'unavailable' },
        turns: null,
        durationMs: null,
      },
    })
  })

  it('worker refuses descriptor location identity before spawning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    const foreignConversation = '33333333-3333-4333-8333-333333333333'
    const directory = join(root, 'harness', foreignConversation, 'calls', CallMother.CALL)
    await fs.mkdir(directory, { recursive: true })
    const descriptor = join(directory, 'call.json')
    await writeFile(descriptor, CallMother.descriptor(root), 'utf8')
    let spawns = 0
    const worker = new HeadlessCallWorker({
      files: CallMother.files(root),
      spawn: (() => { spawns += 1; return new FakeChild(921) }) as typeof import('node:child_process').spawn,
      kill: () => {},
      now: () => CallMother.STARTED_AT,
      schedule: () => ({ cancel: () => {} }),
      cancel: () => {},
      acknowledge: () => {},
    })

    await expect(worker.run(descriptor)).rejects.toThrow('differs from path')
    expect(spawns).toBe(0)
    await expect(readFile(join(directory, 'stream.ndjson'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('spawn error and close publish one truthful terminal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    const descriptor = await CallMother.prepared(root)
    const child = new FakeChild(919)
    const clock = new ManualClock(Date.parse(CallMother.STARTED_AT))
    let acknowledgements = 0
    const worker = new HeadlessCallWorker({
      files: CallMother.files(root),
      spawn: (() => {
        queueMicrotask(() => {
          child.failed(Object.assign(new Error('binary absent'), { code: 'ENOENT' }))
          child.closed(-2, null)
        })
        return child
      }) as typeof import('node:child_process').spawn,
      kill: () => {},
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
      acknowledge: () => { acknowledgements += 1 },
    })

    await worker.run(descriptor)

    const completion = JSON.parse(await readFile(CallMother.completionPath(root), 'utf8')) as Record<string, unknown>
    expect(completion).toMatchObject({
      code: null,
      signal: null,
      execution: {
        kind: 'child-spawn-failed',
        conversation: CallMother.CONVERSATION,
        callId: CallMother.CALL,
        diagnostic: 'recorded child could not be spawned: binary absent',
      },
    })
    expect(await readFile(join(root, 'harness', CallMother.CONVERSATION, 'non-launch.json'), 'utf8'))
      .toContain('recorded child could not be spawned: binary absent')
    expect(acknowledgements).toBe(0)
    expect(clock.scheduled.every((timer) => timer.cancelled)).toBe(true)
  })

  it('receipt write failure leaves terminal evidence without cleanup proof', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    const descriptor = await CallMother.prepared(root)
    const files = CallMother.files(root)
    const writeOnce = files.writeOnce.bind(files)
    files.writeOnce = async (path, text) => {
      if (path.endsWith('non-launch.json')) throw Object.assign(new Error('receipt disk full'), { code: 'ENOSPC' })
      await writeOnce(path, text)
    }
    const worker = new HeadlessCallWorker({
      files,
      spawn: (() => { throw Object.assign(new Error('binary absent'), { code: 'ENOENT' }) }) as typeof import('node:child_process').spawn,
      kill: () => {},
      now: () => CallMother.STARTED_AT,
      schedule: () => ({ cancel: () => {} }),
      cancel: () => {},
      acknowledge: () => {},
    })

    await worker.run(descriptor)

    expect(JSON.parse(await readFile(CallMother.completionPath(root), 'utf8'))).toMatchObject({
      execution: { kind: 'child-spawn-failed' },
    })
    await expect(readFile(join(root, 'harness', CallMother.CONVERSATION, 'non-launch.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(dirname(descriptor), 'stderr.log'), 'utf8')).toContain('receipt disk full')
  })

  it('completion write failure cannot publish cleanup proof', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    const descriptor = await CallMother.prepared(root)
    const files = CallMother.files(root)
    const writeOnce = files.writeOnce.bind(files)
    files.writeOnce = async (path, text) => {
      if (path.endsWith('completion.json')) throw Object.assign(new Error('completion disk full'), { code: 'ENOSPC' })
      await writeOnce(path, text)
    }
    const worker = new HeadlessCallWorker({
      files,
      spawn: (() => { throw Object.assign(new Error('binary absent'), { code: 'ENOENT' }) }) as typeof import('node:child_process').spawn,
      kill: () => {},
      now: () => CallMother.STARTED_AT,
      schedule: () => ({ cancel: () => {} }),
      cancel: () => {},
      acknowledge: () => {},
    })

    await worker.run(descriptor)

    await expect(readFile(CallMother.completionPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(root, 'harness', CallMother.CONVERSATION, 'non-launch.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(dirname(descriptor), 'stderr.log'), 'utf8')).toContain('completion disk full')
  })

  it('an error after spawn publishes ordinary failure without non-launch proof', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    const descriptor = await CallMother.prepared(root)
    const child = new FakeChild(920)
    let acknowledgements = 0
    const worker = new HeadlessCallWorker({
      files: CallMother.files(root),
      spawn: (() => {
        queueMicrotask(() => {
          child.accepted()
          child.failed(Object.assign(new Error('post-spawn failure'), { code: 'EIO' }))
        })
        return child
      }) as typeof import('node:child_process').spawn,
      kill: () => {},
      now: () => CallMother.STARTED_AT,
      schedule: () => ({ cancel: () => {} }),
      cancel: () => {},
      acknowledge: () => { acknowledgements += 1 },
    })

    await worker.run(descriptor)
    await worker.terminal()

    expect(JSON.parse(await readFile(CallMother.completionPath(root), 'utf8'))).toMatchObject({
      execution: { kind: 'unavailable' },
    })
    await expect(readFile(join(root, 'harness', CallMother.CONVERSATION, 'non-launch.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect(acknowledgements).toBe(1)
  })

  it('missing completion is uncertain rather than an automatic retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    const clock = new ManualClock(Date.parse(CallMother.STARTED_AT))
    await CallMother.prepared(root)
    const calls = CallMother.calls(root, (() => new FakeChild(903)) as typeof import('node:child_process').spawn, {
      now: clock.now,
      sleep: async (ms) => { clock.nowMs += ms },
    })
    const call = new StartedPlanCall({ conversation: CallMother.CONVERSATION, id: CallMother.CALL })

    const uncertain = calls.wait(call)
    await expect(uncertain).rejects.toBeInstanceOf(PlanAgentNotLaunched)
    await expect(uncertain).rejects.not.toBeInstanceOf(PlanAgentNotNamed)
    await expect(uncertain).rejects.toThrow('launch outcome is uncertain')
    expect(await calls.completed(call)).toBeNull()
  })

  it('completion round trips resumed totals without inventing attributable cost', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    const descriptor = await CallMother.prepared(root, {
      purpose: 'implementation', argv: ['--resume', CallMother.CONVERSATION],
    })
    const child = new FakeChild(904)
    const clock = new ManualClock(Date.parse(CallMother.STARTED_AT))
    const worker = CallMother.worker(root, child, clock, { present: () => false, signals: [] })
    await worker.run(descriptor)
    await writeFile(join(descriptor, '..', 'stream.ndjson'), CallMother.RESULT, 'utf8')
    child.accepted()
    child.closed(0, null)
    await CallMother.completion(join(descriptor, '..', 'completion.json'))

    const completed = await CallMother.calls(root, (() => child) as typeof import('node:child_process').spawn)
      .completed(new StartedPlanCall({ conversation: CallMother.CONVERSATION, id: CallMother.CALL }))

    expect(completed?.measurement.cost).toEqual({
      kind: 'reported', totalUsd: 1.25, attribution: 'unverified-resume',
    })
    expect(completed?.call.id).toBe(CallMother.CALL)
    expect(completed?.attributableCostUsd).toBeNull()
  })

  it('a resumed descriptor cannot restore initial cost attribution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    await CallMother.prepared(root, { argv: ['--resume', CallMother.CONVERSATION] })
    const directory = join(root, 'harness', CallMother.CONVERSATION, 'calls', CallMother.CALL)
    await writeFile(join(directory, 'completion.json'), `${JSON.stringify({
      code: 0,
      signal: null,
      finishedAt: CallMother.STARTED_AT,
      wallDurationMs: 0,
      execution: { kind: 'success' },
      measurement: {
        cost: { kind: 'reported', totalUsd: 1.25, attribution: 'initial-invocation' },
        turns: 2,
        durationMs: 3000,
        unavailable: [],
      },
    })}\n`, 'utf8')
    const calls = CallMother.calls(root, (() => new FakeChild(905)) as typeof import('node:child_process').spawn)

    const completion = calls.completed(CallMother.call())
    await expect(completion).rejects.toBeInstanceOf(PlanAgentNotNamed)
    await expect(completion).rejects.not.toBeInstanceOf(PlanAgentNotLaunched)
    await expect(completion).rejects.toThrow(directory)
    await expect(completion).rejects.toThrow('initial-invocation')
  })

  it('malformed completion differs from absence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    await CallMother.prepared(root)
    const calls = CallMother.calls(root, (() => new FakeChild(906)) as typeof import('node:child_process').spawn)
    const call = CallMother.call()
    expect(await calls.completed(call)).toBeNull()

    await writeFile(join(root, 'harness', CallMother.CONVERSATION, 'calls', CallMother.CALL, 'completion.json'), '{bad', 'utf8')
    const malformed = calls.completed(call)
    await expect(malformed).rejects.toBeInstanceOf(PlanAgentNotNamed)
    await expect(malformed).rejects.not.toBeInstanceOf(PlanAgentNotLaunched)
    await expect(malformed).rejects.toThrow(CallMother.completionPath(root))
    await expect(malformed).rejects.toThrow('SyntaxError')
  })

  it('stored completion rejects simultaneous exit code and signal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    await CallMother.prepared(root)
    const calls = CallMother.calls(root, (() => new FakeChild(911)) as typeof import('node:child_process').spawn)
    const path = CallMother.completionPath(root)
    const cases = [
      CallMother.successfulCompletion({ code: 0, signal: 'SIGKILL' }),
      CallMother.errorCompletion({ code: 1, signal: 'SIGTERM' }),
    ]

    for (const text of cases) {
      await writeFile(path, text, 'utf8')
      const completion = calls.completed(CallMother.call())
      await expect(completion).rejects.toBeInstanceOf(PlanAgentNotNamed)
      await expect(completion).rejects.not.toBeInstanceOf(PlanAgentNotLaunched)
      await expect(completion).rejects.toThrow(path)
      await expect(completion).rejects.toThrow(/code=.*signal=.*execution\.kind=/)
    }
  })

  it('stored success requires exit zero without a signal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    await CallMother.prepared(root)
    const calls = CallMother.calls(root, (() => new FakeChild(912)) as typeof import('node:child_process').spawn)
    const path = CallMother.completionPath(root)
    const invalid = [
      CallMother.successfulCompletion({ code: 1 }),
      CallMother.successfulCompletion({ code: null }),
      CallMother.successfulCompletion({ code: null, signal: 'SIGKILL' }),
    ]

    for (const text of invalid) {
      await writeFile(path, text, 'utf8')
      const completion = calls.completed(CallMother.call())
      await expect(completion).rejects.toBeInstanceOf(PlanAgentNotNamed)
      await expect(completion).rejects.toThrow(/code=.*signal=.*execution\.kind="success"/)
    }

    await writeFile(path, CallMother.successfulCompletion(), 'utf8')
    expect((await calls.completed(CallMother.call()))?.succeeded).toBe(true)
  })

  it('coherent non-success completion preserves execution and measurements', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    await CallMother.prepared(root)
    const calls = CallMother.calls(root, (() => new FakeChild(913)) as typeof import('node:child_process').spawn)
    const path = CallMother.completionPath(root)
    const cases = [
      { text: CallMother.errorCompletion({ code: 0, signal: null }), execution: { kind: 'error', diagnostic: 'Claude reported error_max_turns' } },
      { text: CallMother.unavailableCompletion({ code: 0, signal: null }), execution: { kind: 'unavailable', diagnostic: 'Claude did not report a result' } },
      { text: CallMother.unavailableCompletion({ code: null, signal: null }), execution: { kind: 'unavailable', diagnostic: 'Claude did not report a result' } },
      { text: CallMother.unavailableCompletion({ code: null, signal: 'SIGTERM' }), execution: { kind: 'unavailable', diagnostic: 'Claude did not report a result' } },
    ]

    for (const scenario of cases) {
      await writeFile(path, scenario.text, 'utf8')
      const completed = await calls.completed(CallMother.call())
      expect(completed?.execution).toEqual(scenario.execution)
      expect(completed?.measurement).toEqual(CallMother.zeroMeasurement())
      expect(completed?.succeeded).toBe(false)
    }
  })

  it('stored success survives unavailable numeric telemetry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    await CallMother.prepared(root)
    const calls = CallMother.calls(root, (() => new FakeChild(914)) as typeof import('node:child_process').spawn)
    await writeFile(CallMother.completionPath(root), CallMother.successfulCompletion({
      measurement: CallMother.unavailableMeasurement(),
    }), 'utf8')

    const completed = await calls.completed(CallMother.call())
    expect(completed?.succeeded).toBe(true)
    expect(completed?.attributableCostUsd).toBeNull()
    expect(completed?.measurement).toEqual(CallMother.unavailableMeasurement())
  })

  it('malformed descriptor differs from an operational read failure', async () => {
    let launches = 0
    const spawn = (() => {
      launches += 1
      return new FakeChild(915)
    }) as typeof import('node:child_process').spawn
    const foreign = '33333333-3333-4333-8333-333333333333'
    for (const descriptor of [
      '{bad',
      CallMother.descriptor('/checkout', { argv: ['--resume', 'another-conversation'] }),
      CallMother.descriptor('/checkout', { requestId: 7 }),
      CallMother.descriptor('/checkout', { requestId: '' }),
      CallMother.descriptorWithoutRequest('/checkout'),
      CallMother.descriptor('/checkout', {
        conversation: foreign,
        argv: ['--session-id', foreign],
      }),
    ]) {
      const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
      roots.push(root)
      const path = await CallMother.prepared(root)
      await writeFile(path, descriptor, 'utf8')
      const malformed = CallMother.calls(root, spawn).completed(CallMother.call())
      await expect(malformed).rejects.toBeInstanceOf(PlanAgentNotNamed)
      await expect(malformed).rejects.not.toBeInstanceOf(PlanAgentNotLaunched)
      await expect(malformed).rejects.toThrow(path)
    }

    const fixRoot = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(fixRoot)
    await CallMother.prepared(fixRoot, {
      purpose: 'fix',
      requestId: 'PRR_kwDOT9lB5c8AAAABRCF0GG',
      argv: ['--resume', CallMother.CONVERSATION],
    })
    expect(await CallMother.calls(fixRoot, spawn).completed(CallMother.call())).toBeNull()

    const nonFixRoot = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(nonFixRoot)
    await CallMother.prepared(nonFixRoot)
    expect(await CallMother.calls(nonFixRoot, spawn).completed(CallMother.call())).toBeNull()

    const descriptorReadRoot = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(descriptorReadRoot)
    const descriptorRead = CallMother.calls(descriptorReadRoot, spawn, {
      files: CallMother.files(descriptorReadRoot, { read: async () => { throw new Error('descriptor read refused') } }),
    }).completed(CallMother.call())
    await expect(descriptorRead).rejects.toBeInstanceOf(PlanAgentNotLaunched)
    await expect(descriptorRead).rejects.not.toBeInstanceOf(PlanAgentNotNamed)
    await expect(descriptorRead).rejects.toThrow('descriptor read refused')

    const completionReadRoot = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(completionReadRoot)
    await CallMother.prepared(completionReadRoot)
    const base = CallMother.files(completionReadRoot)
    const completionRead = CallMother.calls(completionReadRoot, spawn, {
      files: CallMother.files(completionReadRoot, {
        read: async (path) => {
          if (path === CallMother.completionPath(completionReadRoot)) throw new Error('completion read refused')
          return base.read(path)
        },
      }),
    }).completed(CallMother.call())
    await expect(completionRead).rejects.toBeInstanceOf(PlanAgentNotLaunched)
    await expect(completionRead).rejects.not.toBeInstanceOf(PlanAgentNotNamed)
    await expect(completionRead).rejects.toThrow('completion read refused')

    const missingRoot = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(missingRoot)
    const missing = CallMother.calls(missingRoot, spawn).completed(CallMother.call())
    await expect(missing).rejects.toBeInstanceOf(PlanAgentNotLaunched)
    await expect(missing).rejects.not.toBeInstanceOf(PlanAgentNotNamed)
    await expect(missing).rejects.toThrow('call.json is absent')
    expect(launches).toBe(0)
  })

  it('invalid invocation mode is translated before any write or launch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    let writes = 0
    let launches = 0
    const files = CallMother.files(root, {
      writeOnce: async () => { writes += 1 },
    })
    const calls = CallMother.calls(root, (() => {
      launches += 1
      return new FakeChild(916)
    }) as typeof import('node:child_process').spawn, { files })
    const invalid = [
      ['--session-id', CallMother.CONVERSATION, '--resume', CallMother.CONVERSATION],
      ['-p'],
      ['--session-id', '33333333-3333-4333-8333-333333333333'],
    ]

    for (const argv of invalid) {
      const start = calls.start(CallMother.invocation({ argv }))
      await expect(start).rejects.toBeInstanceOf(PlanAgentNotNamed)
      await expect(start).rejects.not.toBeInstanceOf(PlanAgentNotLaunched)
      await expect(start).rejects.toThrow(CallMother.CONVERSATION)
      await expect(start).rejects.toThrow(JSON.stringify(argv))
    }
    expect(writes).toBe(0)
    expect(launches).toBe(0)
  })

  it('conflicting immutable preparation differs from a failed record operation', async () => {
    let launches = 0
    const spawn = (() => {
      launches += 1
      return new FakeChild(917)
    }) as typeof import('node:child_process').spawn
    const partialRoot = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(partialRoot)
    const partialDirectory = join(partialRoot, 'harness', CallMother.CONVERSATION, 'calls', CallMother.CALL)
    await fs.mkdir(partialDirectory, { recursive: true })
    await writeFile(join(partialDirectory, 'prompt.md'), 'different prompt', 'utf8')
    const partial = CallMother.calls(partialRoot, spawn).start(CallMother.invocation())
    await expect(partial).rejects.toBeInstanceOf(PlanAgentNotLaunched)
    await expect(partial).rejects.not.toBeInstanceOf(PlanAgentNotNamed)
    await expect(partial).rejects.toThrow('call.json is absent')
    expect(await readFile(join(partialDirectory, 'prompt.md'), 'utf8')).toBe('different prompt')

    const malformedRoot = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(malformedRoot)
    const malformedDirectory = join(malformedRoot, 'harness', CallMother.CONVERSATION, 'calls', CallMother.CALL)
    await fs.mkdir(malformedDirectory, { recursive: true })
    await writeFile(join(malformedDirectory, 'prompt.md'), 'Plan the recorded issue.', 'utf8')
    await writeFile(join(malformedDirectory, 'call.json'), 'different descriptor', 'utf8')
    const malformed = CallMother.calls(malformedRoot, spawn).start(CallMother.invocation())
    await expect(malformed).rejects.toBeInstanceOf(PlanAgentNotNamed)
    await expect(malformed).rejects.not.toBeInstanceOf(PlanAgentNotLaunched)
    expect(await readFile(join(malformedDirectory, 'call.json'), 'utf8')).toBe('different descriptor')

    for (const existing of [
      { file: 'prompt.md', text: 'different prompt' },
      { file: 'call.json', text: 'different descriptor' },
    ]) {
      const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
      roots.push(root)
      const base = CallMother.files(root)
      const files = CallMother.files(root, {
        writeOnce: async (path, text) => {
          if (path.endsWith(existing.file)) {
            await fs.mkdir(dirname(path), { recursive: true })
            await writeFile(path, existing.text, 'utf8')
          }
          return base.writeOnce(path, text)
        },
      })
      const conflict = CallMother.calls(root, spawn, { files }).start(CallMother.invocation())
      await expect(conflict).rejects.toBeInstanceOf(PlanAgentNotNamed)
      await expect(conflict).rejects.not.toBeInstanceOf(PlanAgentNotLaunched)
      const path = join(root, 'harness', CallMother.CONVERSATION, 'calls', CallMother.CALL, existing.file)
      expect(await readFile(path, 'utf8')).toBe(existing.text)
    }

    for (const evidence of ['read-refused', 'disappeared']) {
      const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
      roots.push(root)
      const prompt = join(root, 'harness', CallMother.CONVERSATION, 'calls', CallMother.CALL, 'prompt.md')
      const base = CallMother.files(root)
      const files = CallMother.files(root, {
        writeOnce: async (path, text) => {
          if (path === prompt) {
            await fs.mkdir(dirname(path), { recursive: true })
            await writeFile(path, 'existing prompt', 'utf8')
          }
          return base.writeOnce(path, text)
        },
        read: async (path) => {
          if (path === prompt) {
            if (evidence === 'read-refused') throw new Error('immutable record read refused')
            return null
          }
          return base.read(path)
        },
      })
      const failed = CallMother.calls(root, spawn, { files }).start(CallMother.invocation())
      await expect(failed).rejects.toBeInstanceOf(PlanAgentNotLaunched)
      await expect(failed).rejects.not.toBeInstanceOf(PlanAgentNotNamed)
      await expect(failed).rejects.toThrow(evidence === 'read-refused' ? 'immutable record read refused' : 'is absent')
      expect(await readFile(prompt, 'utf8')).toBe('existing prompt')
    }
    expect(launches).toBe(0)
  })

  it('leader close before grace retains enforcement until the resistant group is escalated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    const descriptor = await CallMother.prepared(root)
    const child = new FakeChild(907)
    const clock = new ManualClock(Date.parse(CallMother.STARTED_AT))
    const signals: NodeJS.Signals[] = []
    const worker = CallMother.worker(root, child, clock, { present: () => true, signals })
    await worker.run(descriptor)
    child.closed(0, null)
    clock.advance(100)
    await CallMother.settled()
    const completion = join(descriptor, '..', 'completion.json')
    await expect(readFile(completion, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    clock.advance(20)
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect((await CallMother.completion(completion)).code).toBe(0)
  })

  it('leader close after escalation settles once despite a still observable group', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    const descriptor = await CallMother.prepared(root)
    const child = new FakeChild(908)
    const clock = new ManualClock(Date.parse(CallMother.STARTED_AT))
    const signals: NodeJS.Signals[] = []
    const files = CallMother.files(root)
    let publications = 0
    const writeOnce = files.writeOnce.bind(files)
    files.writeOnce = async (path, text) => {
      publications += 1
      await writeOnce(path, text)
    }
    const worker = new HeadlessCallWorker({
      files,
      spawn: (() => child) as typeof import('node:child_process').spawn,
      kill: (_pid, signal) => {
        if (signal === 0) return
        signals.push(signal)
      },
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
      acknowledge: () => {},
    })
    await worker.run(descriptor)
    clock.advance(120)
    child.closed(null, 'SIGKILL')
    const completed = await CallMother.completion(join(descriptor, '..', 'completion.json'))

    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(publications).toBe(1)
    expect(completed.signal).toBe('SIGKILL')
  })

  it('signal failures remain diagnostic without blocking settlement after escalation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-calls-'))
    roots.push(root)
    const descriptor = await CallMother.prepared(root)
    const child = new FakeChild(910)
    const clock = new ManualClock(Date.parse(CallMother.STARTED_AT))
    const worker = new HeadlessCallWorker({
      files: CallMother.files(root),
      spawn: (() => child) as typeof import('node:child_process').spawn,
      kill: (_pid, signal) => {
        if (signal !== 0) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
      },
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
      acknowledge: () => {},
    })
    await worker.run(descriptor)
    child.closed(0, null)
    clock.advance(120)

    const completed = await CallMother.completion(join(descriptor, '..', 'completion.json'))
    expect(completed).toMatchObject({
      measurement: {
        unavailable: [
          'Claude did not report a result',
          'SIGTERM could not be sent to process group: Error: operation not permitted',
          'SIGKILL could not be sent to process group: Error: operation not permitted',
        ],
      },
    })
  })
})
