import * as fs from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CallDescriptor, CallInvocation, ClaudeCalls } from '../../src/infrastructure/claude-calls.ts'
import { ClaudePlanCalls } from '../../src/infrastructure/claude-plan-calls.ts'
import { ClaudeRunMeasurements } from '../../src/infrastructure/claude-run-measurements.ts'
import { DiskAgentMeasurements } from '../../src/infrastructure/disk-agent-measurements.ts'
import { DiskPlanRecords } from '../../src/infrastructure/disk-plan-records.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { MeasuredAgentCalls } from '../../src/infrastructure/measured-agent-calls.ts'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.ts'
import { StartedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import type { LaunchedProcess, LaunchOptions } from '../../src/infrastructure/process-runner.ts'
import { InProcessWorkers } from './fixtures/in-process-workers.ts'
import { ScriptedClaude } from './fixtures/scripted-claude.ts'
import { Capture } from './fixtures/scripted-conversation.ts'

class Scenario {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly CALL = '22222222-2222-4222-8222-222222222222'
  static readonly WORKER = 'worker'
  static readonly UNSPAWNABLE_CONVERSATION = '77777777-7777-4777-8777-777777777777'
  static readonly UNSPAWNABLE_CALL = '88888888-8888-4888-8888-888888888888'

  static invocation(cwd: string): CallInvocation {
    return new CallInvocation({
      conversation: Scenario.CONVERSATION,
      purpose: 'plan',
      cwd,
      argv: ['--session-id', Scenario.CONVERSATION],
      prompt: 'Plan the scripted scenario.',
    })
  }

  static directory(root: string): string {
    return join(root, 'harness', Scenario.CONVERSATION, 'calls', Scenario.CALL)
  }

  static async ready(root: string, capture: Capture = Capture.read('claude', 'result-success')): Promise<{
    claude: ScriptedClaude,
    workers: InProcessWorkers,
    calls: ClaudeCalls,
  }> {
    const files = new HeadlessFiles({ root, fs, newId: () => 'temporary-record' })
    const claude = new ScriptedClaude(capture)
    const workers = new InProcessWorkers({ files, claude, worker: Scenario.WORKER })
    const calls = Scenario.calls(files, workers, () => Scenario.CALL)

    return { claude, workers, calls }
  }

  static calls(files: HeadlessFiles, workers: InProcessWorkers, newId: () => string): ClaudeCalls {
    return new ClaudeCalls({
      files,
      binary: '/usr/local/bin/claude',
      worker: Scenario.WORKER,
      spawn: workers.launch.bind(workers),
      env: {},
      newId,
      now: () => '2026-09-24T10:00:00.000Z',
      budgetMs: 60_000,
      killGraceMs: 5_000,
      acceptanceMs: 5_000,
      pollMs: 10,
      sleep: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    })
  }

  static measured(root: string, calls: ClaudeCalls): MeasuredAgentCalls<CallInvocation, CallDescriptor> {
    const files = new HeadlessFiles({ root, fs, newId: () => 'measurement-temporary' })
    return new MeasuredAgentCalls({
      executor: calls,
      reader: new ClaudeRunMeasurements({ files }),
      store: new DiskAgentMeasurements({ files }),
    })
  }

  static async unspawnableDescriptor(root: string): Promise<string> {
    const directory = join(root, 'harness', Scenario.UNSPAWNABLE_CONVERSATION, 'calls', Scenario.UNSPAWNABLE_CALL)
    await fs.mkdir(directory, { recursive: true })
    const path = join(directory, CallDescriptor.FILE)
    await fs.writeFile(path, `${JSON.stringify({
      conversation: Scenario.UNSPAWNABLE_CONVERSATION,
      purpose: 'plan',
      requestId: null,
      cwd: root,
      binary: join(root, 'nonexistent-claude'),
      argv: ['--session-id', Scenario.UNSPAWNABLE_CONVERSATION],
      startedAt: new Date().toISOString(),
      budgetMs: 2_000,
      killGraceMs: 100,
    }, null, 2)}\n`, 'utf8')
    await fs.writeFile(join(directory, CallDescriptor.PROMPT), 'local nonexistent-binary fixture', 'utf8')
    await fs.writeFile(join(root, 'harness', Scenario.UNSPAWNABLE_CONVERSATION, 'dispatch.json'), `${JSON.stringify({
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
}

class UnspawnableClaude extends ScriptedClaude {
  override launch(_binary: string, _argv: readonly string[], _options: LaunchOptions): LaunchedProcess {
    throw Object.assign(new Error('spawn /nonexistent-claude ENOENT'), { code: 'ENOENT' })
  }
}

describe('a real ClaudeCalls over InProcessWorkers', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('a call through the in-process worker completes from the captured result in the asked conversation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-in-process-workers-'))
    roots.push(root)
    const { claude, workers, calls } = await Scenario.ready(root)

    const call = await calls.start(Scenario.invocation(root))
    await workers.settled()
    const completed = await calls.wait(call)

    expect(completed.succeeded).toBe(true)
    expect(claude.asked).toHaveLength(1)
    expect(claude.asked[0].conversation).toBe(Scenario.CONVERSATION)
    expect(workers.launches).toBe(1)
  })

  it('a launch that is not the headless worker is refused as unscripted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-in-process-workers-'))
    roots.push(root)
    const { workers } = await Scenario.ready(root)

    expect(() => workers.launch('/bin/sh', ['-c', 'echo hi'], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] }))
      .toThrow(`nobody wrote an answer for /bin/sh -c echo hi in ${root}`)
    expect(workers.launches).toBe(0)
  })

  it('a claude that refuses and a claude whose output nobody can read complete apart', async () => {
    const refusedRoot = await mkdtemp(join(tmpdir(), 'ct-in-process-workers-'))
    const unreadableRoot = await mkdtemp(join(tmpdir(), 'ct-in-process-workers-'))
    roots.push(refusedRoot, unreadableRoot)

    const refused = await Scenario.ready(refusedRoot, Capture.read('claude', 'result-turn-limit'))
    const refusedCall = await refused.calls.start(Scenario.invocation(refusedRoot))
    await refused.workers.settled()
    const refusedCompletion = await refused.calls.wait(refusedCall)

    const unreadable = await Scenario.ready(unreadableRoot, Capture.read('claude', 'result-text'))
    const unreadableCall = await unreadable.calls.start(Scenario.invocation(unreadableRoot))
    await unreadable.workers.settled()
    const unreadableCompletion = await unreadable.calls.wait(unreadableCall)

    expect(refusedCompletion.execution).toEqual({ kind: 'error', diagnostic: 'Claude reported error_max_turns' })
    expect(refusedCompletion.code).toBe(1)
    expect(unreadableCompletion.execution).toEqual({ kind: 'unavailable', diagnostic: 'Claude stream ended with malformed JSON' })
    expect(unreadableCompletion.code).toBe(0)
  })

  it('output and completion reach the call record the worker publishes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-in-process-workers-'))
    roots.push(root)
    const { workers, calls } = await Scenario.ready(root)

    const call = await calls.start(Scenario.invocation(root))
    await workers.settled()
    const completed = await calls.wait(call)

    expect(completed.succeeded).toBe(true)
    expect(completed.signal).toBeNull()
    const directory = Scenario.directory(root)
    expect(await fs.readFile(join(directory, 'stream.ndjson'), 'utf8')).toContain('"subtype":"success"')
    expect(await fs.readFile(join(directory, 'stderr.log'), 'utf8')).toBe(Capture.read('claude', 'result-success').stderr)

    const measurements = join(directory, 'agent-measurements-v1.json')
    await expect(fs.access(measurements)).rejects.toMatchObject({ code: 'ENOENT' })

    const measured = Scenario.measured(root, calls)
    await measured.recover(Scenario.CONVERSATION)
    const first = await fs.readFile(measurements, 'utf8')
    await measured.completed(call)

    expect(JSON.parse(first)).toMatchObject({
      callId: Scenario.CALL, provider: 'claude-code',
      execution: { kind: 'success' }, wallDurationMs: completed.wallDurationMs,
    })
    expect(await fs.readFile(measurements, 'utf8')).toBe(first)
    expect(await fs.readdir(join(root, 'harness', Scenario.CONVERSATION, 'calls'))).toEqual([Scenario.CALL])
  })

  it('a started call tells the child the concrete path of its prompt file instead of a shell variable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-in-process-workers-'))
    roots.push(root)
    const { claude, workers, calls } = await Scenario.ready(root)
    const prompt = 'errand capture fixture prompt'
    const invocation = new CallInvocation({
      conversation: Scenario.CONVERSATION,
      purpose: 'plan',
      cwd: root,
      argv: ['--session-id', Scenario.CONVERSATION],
      prompt,
    })

    const call = await calls.start(invocation)
    await workers.settled()
    await calls.wait(call)

    const promptPath = join(Scenario.directory(root), CallDescriptor.PROMPT)
    expect(claude.asked).toHaveLength(1)
    expect(claude.asked[0].argv.at(-1)).toBe(CallDescriptor.opening(promptPath))
    expect(claude.asked[0].prompt).toBe(prompt)
    expect(claude.asked[0].argv.join(' ')).not.toContain(prompt)
  })

  it('a claude that cannot be spawned publishes a consumable child-spawn failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-in-process-workers-'))
    roots.push(root)
    const conversation = Scenario.UNSPAWNABLE_CONVERSATION
    const callId = Scenario.UNSPAWNABLE_CALL
    const descriptorPath = await Scenario.unspawnableDescriptor(root)
    const files = new HeadlessFiles({ root, fs, newId: () => 'temporary-record' })
    const workers = new InProcessWorkers({
      files,
      claude: new UnspawnableClaude(Capture.read('claude', 'result-success')),
      worker: Scenario.WORKER,
    })

    workers.launch(process.execPath, [Scenario.WORKER, descriptorPath], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    await workers.settled()

    const calls = Scenario.calls(files, workers, () => callId)
    const records = new DiskPlanRecords({
      files,
      newId: () => conversation,
      now: () => new Date().toISOString(),
      exists: async () => true,
    })
    const planCalls = new ClaudePlanCalls({
      calls,
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

    const watch = await records.recorded(conversation)
    expect(watch).toBeInstanceOf(PlanWatch)
    const proof = await records.nonLaunch(watch!)
    const call = new StartedPlanCall({ conversation, id: callId })
    const measured = Scenario.measured(root, calls)
    const completed = await measured.completed(call)
    await measured.recover(conversation)
    const recovery = await planCalls.recoveryFor(watch!)

    expect(proof).toMatchObject({ conversation, callId, source: 'child-spawn' })
    expect(completed).toMatchObject({
      call, code: null, signal: null,
      execution: { kind: 'child-spawn-failed', conversation, callId },
    })
    expect(completed?.succeeded).toBe(false)
    expect(JSON.parse(await fs.readFile(join(root, 'harness', conversation, 'calls', callId, 'agent-measurements-v1.json'), 'utf8')))
      .toMatchObject({
        execution: { kind: 'child-spawn-failed', conversation, callId },
        tokens: { input: null, output: null, cacheRead: null, cacheCreation: null },
        cost: { kind: 'unavailable' },
      })
    expect(recovery.action).toBe('cleanup')
    await expect(fs.access(join(root, 'nonexistent-claude'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
