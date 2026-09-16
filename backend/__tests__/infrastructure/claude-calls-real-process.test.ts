import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StartedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { ClaudeCalls } from '../../src/infrastructure/claude-calls.ts'
import { ClaudePlanCalls } from '../../src/infrastructure/claude-plan-calls.ts'
import { DiskPlanRecords } from '../../src/infrastructure/disk-plan-records.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.ts'

class RealCallMother {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly CALL = '22222222-2222-4222-8222-222222222222'
  static readonly WORKER = new URL('../../src/infrastructure/headless-call-worker.ts', import.meta.url).pathname
  static readonly FIXTURE = new URL('fixtures/headless-child.ts', import.meta.url).pathname
  static readonly groups = new Set<number>()

  static directory(root: string): string {
    return join(root, 'harness', RealCallMother.CONVERSATION, 'calls', RealCallMother.CALL)
  }

  static async descriptor(root: string, argv: readonly string[], budgetMs: number, killGraceMs: number): Promise<string> {
    const directory = RealCallMother.directory(root)
    await fs.mkdir(directory, { recursive: true })
    const path = join(directory, 'call.json')
    await writeFile(path, `${JSON.stringify({
      conversation: RealCallMother.CONVERSATION,
      purpose: 'plan',
      requestId: RealCallMother.CALL,
      cwd: root,
      binary: process.execPath,
      argv,
      startedAt: new Date().toISOString(),
      budgetMs,
      killGraceMs,
    }, null, 2)}\n`, 'utf8')
    await writeFile(join(directory, 'prompt.md'), 'local fixture prompt', 'utf8')
    return path
  }

  static async failedDescriptor(root: string, conversation: string, call: string): Promise<string> {
    const directory = join(root, 'harness', conversation, 'calls', call)
    await fs.mkdir(directory, { recursive: true })
    const path = join(directory, 'call.json')
    await writeFile(path, `${JSON.stringify({
      conversation,
      purpose: 'plan',
      requestId: null,
      cwd: root,
      binary: join(root, 'nonexistent-claude'),
      argv: ['--session-id', conversation],
      startedAt: new Date().toISOString(),
      budgetMs: 2_000,
      killGraceMs: 100,
    }, null, 2)}\n`, 'utf8')
    await writeFile(join(directory, 'prompt.md'), 'local nonexistent-binary fixture', 'utf8')
    await writeFile(join(root, 'harness', conversation, 'dispatch.json'), `${JSON.stringify({
      repository: 'mercadona/control-tower-plugin',
      issue: { number: 331, url: 'https://github.com/mercadona/control-tower-plugin/issues/331' },
      story: null,
      root,
      worktree: root,
      branch: 'feat/331',
      startedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8')
    return path
  }

  static calls(root: string): ClaudeCalls {
    return new ClaudeCalls({
      files: new HeadlessFiles({ root, fs, newId: () => 'temporary-record' }),
      binary: process.execPath,
      worker: RealCallMother.WORKER,
      spawn,
      env: process.env,
      newId: () => RealCallMother.CALL,
      now: () => new Date().toISOString(),
      budgetMs: 2_000,
      killGraceMs: 100,
      acceptanceMs: 2_000,
      pollMs: 250,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    })
  }

  static call(): StartedPlanCall {
    return new StartedPlanCall({ conversation: RealCallMother.CONVERSATION, id: RealCallMother.CALL })
  }

  static launchWorkerAndExit(descriptor: string): Promise<void> {
    const source = [
      "import { spawn } from 'node:child_process'",
      `const worker = ${JSON.stringify(RealCallMother.WORKER)}`,
      `const descriptor = ${JSON.stringify(descriptor)}`,
      "const child = spawn(process.execPath, [worker, descriptor], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })",
      "if (child.pid !== undefined) process.stdout.write(String(child.pid))",
      'process.exit(0)',
    ].join(';')
    return new Promise((resolve, reject) => {
      const api = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      let diagnostic = ''
      api.stdout.setEncoding('utf8')
      api.stderr.setEncoding('utf8')
      api.stdout.on('data', (chunk: string) => { output += chunk })
      api.stderr.on('data', (chunk: string) => { diagnostic += chunk })
      api.on('close', (code) => {
        if (code !== 0) return reject(new Error(diagnostic || `API fixture exited ${String(code)}`))
        const pid = Number(output)
        if (Number.isInteger(pid)) RealCallMother.groups.add(pid)
        resolve()
      })
    })
  }

  static runWorker(descriptor: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = spawn(process.execPath, [RealCallMother.WORKER, descriptor], {
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      if (worker.pid !== undefined) RealCallMother.groups.add(worker.pid)
      let diagnostic = ''
      worker.stderr.setEncoding('utf8')
      worker.stderr.on('data', (chunk: string) => { diagnostic += chunk })
      worker.once('error', reject)
      worker.once('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(diagnostic || `worker exited ${String(code)}`))
      })
    })
  }

  static records(root: string): DiskPlanRecords {
    return new DiskPlanRecords({
      files: new HeadlessFiles({ root, fs, newId: () => 'temporary-record' }),
      newId: () => RealCallMother.CONVERSATION,
      now: () => new Date().toISOString(),
      exists: async () => true,
    })
  }

  static planCalls(root: string, records: DiskPlanRecords): ClaudePlanCalls {
    return new ClaudePlanCalls({
      calls: RealCallMother.calls(root),
      brief: new PlanAgentBrief({
        dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
        conventions: '/plugin/conventions',
        ctStep: '/plugin/scripts/ct-step.mjs',
      }),
      pluginRoot: '/plugin',
      resumable: async () => false,
      records,
      nowMs: () => Date.now(),
    })
  }

  static async eventuallyAbsent(pid: number): Promise<void> {
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      try {
        process.kill(pid, 0)
      } catch (cause) {
        if (RealCallMother.hasCode(cause, 'ESRCH')) return
        throw cause
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`process ${pid} remained present`)
  }

  static async eventuallyReadPid(path: string): Promise<number> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        return Number(await readFile(path, 'utf8'))
      } catch (cause) {
        if (!RealCallMother.hasCode(cause, 'ENOENT')) throw cause
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`process identity was not written at ${path}`)
  }

  static hasCode(cause: unknown, code: string): boolean {
    return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === code
  }

  static cleanup(): void {
    for (const pid of RealCallMother.groups) {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch (cause) {
        if (!RealCallMother.hasCode(cause, 'ESRCH')) throw cause
      }
    }
    RealCallMother.groups.clear()
  }
}

describe('ClaudeCalls with real local processes', () => {
  const roots: string[] = []

  afterEach(async () => {
    RealCallMother.cleanup()
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('output and completion survive API exit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-real-call-'))
    roots.push(root)
    const descriptor = await RealCallMother.descriptor(
      root,
      [RealCallMother.FIXTURE, 'success', RealCallMother.CONVERSATION, '--session-id', RealCallMother.CONVERSATION],
      30_000,
      100,
    )

    await RealCallMother.launchWorkerAndExit(descriptor)
    const completed = await RealCallMother.calls(root).wait(RealCallMother.call())

    expect(completed.succeeded).toBe(true)
    expect(completed.signal).toBeNull()
    expect(await readFile(join(RealCallMother.directory(root), 'stream.ndjson'), 'utf8')).toContain('"subtype":"success"')
    expect(await readFile(join(RealCallMother.directory(root), 'stderr.log'), 'utf8')).toBe('fixture stderr\n')
  })

  it('the surviving deadline terminates the child process group', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-real-call-'))
    roots.push(root)
    const descendantPidPath = join(root, 'descendant.pid')
    const resistantPidPath = join(root, 'resistant.pid')
    const groupPidPath = join(root, 'group.pid')
    const descriptor = await RealCallMother.descriptor(
      root,
      [
        RealCallMother.FIXTURE, 'descendant', groupPidPath, resistantPidPath, descendantPidPath,
        RealCallMother.CONVERSATION, '--session-id', RealCallMother.CONVERSATION,
      ],
      10_000,
      100,
    )

    await RealCallMother.launchWorkerAndExit(descriptor)
    RealCallMother.groups.add(await RealCallMother.eventuallyReadPid(groupPidPath))
    const completed = await RealCallMother.calls(root).wait(RealCallMother.call())
    const descendantPid = Number(await readFile(descendantPidPath, 'utf8'))
    RealCallMother.groups.add(descendantPid)
    await RealCallMother.eventuallyAbsent(descendantPid)

    expect(completed.succeeded).toBe(false)
    expect(completed.signal).toBe('SIGTERM')
    expect(completed.wallDurationMs).toBeGreaterThanOrEqual(10_000)
  })

  it('worker entrypoint publishes consumable child-spawn failure', async () => {
    const identities = [
      ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'],
      ['55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'],
    ] as const
    for (const [conversation, callId] of identities) {
      const root = await mkdtemp(join(tmpdir(), 'ct-worker-spawn-failure-'))
      roots.push(root)
      const descriptor = await RealCallMother.failedDescriptor(root, conversation, callId)

      await RealCallMother.runWorker(descriptor)

      const records = RealCallMother.records(root)
      const watch = await records.recorded(conversation)
      expect(watch).toBeInstanceOf(PlanWatch)
      const proof = await records.nonLaunch(watch!)
      const call = new StartedPlanCall({ conversation, id: callId })
      const completed = await RealCallMother.calls(root).completed(call)
      const recovery = await RealCallMother.planCalls(root, records).recoveryFor(watch!)
      expect(proof).toMatchObject({ conversation, callId, source: 'child-spawn' })
      expect(completed).toMatchObject({
        call,
        code: null,
        signal: null,
        execution: { kind: 'child-spawn-failed', conversation, callId },
      })
      expect(completed?.succeeded).toBe(false)
      expect(recovery.action).toBe('cleanup')
      await expect(fs.access(join(root, 'nonexistent-claude'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })
})
