import { ChildProcess } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentDefinition } from '../../../plugin/scripts/judge-agent-definition.js'
import { RoleBytes } from '../../../plugin/scripts/role-bytes.js'
import { STEPS } from '../../../plugin/scripts/run-machine.js'
import {
  ADVICE_SCHEMA,
  IMPLEMENTER_MODEL,
  IMPLEMENTER_TOOLS,
  REPORT_SCHEMA,
} from '../../../plugin/scripts/step-contracts.js'
import { RunNotAdvanced } from '../../src/domain/exceptions.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { CompletedPlanCall, StartedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { RunInstruction } from '../../src/domain/value-objects/run-instruction.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { CallDescriptor, ClaudeCalls, StoredCompletion } from '../../src/infrastructure/claude-calls.ts'
import { ClaudeRunCalls } from '../../src/infrastructure/claude-run-calls.ts'
import { ClaudeRunMeasurements } from '../../src/infrastructure/claude-run-measurements.ts'
import { MeasuredAgentCalls } from '../../src/infrastructure/measured-agent-calls.ts'
import { DiskAgentMeasurements } from '../../src/infrastructure/disk-agent-measurements.ts'
import { CtRunMachine } from '../../src/infrastructure/ct-run-machine.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { RunDispatch } from '../../src/infrastructure/run-dispatch.ts'
import { RunJournal } from '../../src/infrastructure/run-journal.ts'

type Role = RunDispatch['role']
type Response = RunDispatch['response']
type Script = Readonly<{
  stream: string,
  completion: 'success' | 'failed' | 'pending',
  written?: Readonly<{ path: string, text: string }>,
}>

class AcceptedWorker extends ChildProcess {}

class DispatchingMachine extends CtRunMachine {
  readonly dispatches: ReadonlyMap<string, RunDispatch>

  constructor(files: HeadlessFiles, pluginRoot: string, dispatches: readonly RunDispatch[]) {
    super({
      journal: new RunJournal({
        files,
        newId: () => { throw new Error('journal identity is not requested') },
        now: () => { throw new Error('the journal clock is not asked') },
      }),
      node: async () => { throw new Error('oracle execution is not requested') },
      git: async () => { throw new Error('git execution is not requested') },
      read: async () => { throw new Error('machine file reads are not requested') },
      ctStep: join(pluginRoot, 'scripts', 'ct-step.mjs'),
      dispatchCheck: join(pluginRoot, 'scripts', 'dispatch-check.mjs'),
      pluginRoot,
    })
    this.dispatches = new Map(dispatches.map((dispatch) => [dispatch.ticket, dispatch]))
  }

  override async dispatch(_watch: PlanWatch, ticket: string): Promise<RunDispatch> {
    const dispatch = this.dispatches.get(ticket)
    if (dispatch === undefined) throw new Error(`unlisted dispatch ticket: ${ticket}`)
    return dispatch
  }
}

class RunCallMother {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly STARTED_AT = '2026-09-17T08:00:00.000Z'
  static readonly FINISHED_AT = '2026-09-17T08:00:02.000Z'
  static readonly roots: string[] = []
  static readonly repositoryRoot = join(import.meta.dirname, '..', '..', '..')
  static readonly pluginRoot = join(RunCallMother.repositoryRoot, 'plugin')

  static async scenario(dispatches: readonly RunDispatch[], scripts: ReadonlyMap<string, Script>): Promise<RunCallScenario> {
    const root = await mkdtemp(join(tmpdir(), 'ct-claude-run-calls-'))
    RunCallMother.roots.push(root)
    const checkout = join(root, 'checkout')
    const state = join(root, 'state')
    await fs.mkdir(checkout, { recursive: true })
    const files = new HeadlessFiles({ root: state, fs, newId: RunCallMother.identities('temporary') })
    const launch = new ScriptedClaude(files, scripts)
    const calls = new ClaudeCalls({
      files,
      binary: '/usr/local/bin/claude',
      worker: '/backend/src/infrastructure/headless-call-worker.ts',
      spawn: launch.spawn,
      env: { CT_PHASE_PROMPT: '/coordinator.md', CT_SESSION_HOOKS_URL: 'http://hooks' },
      newId: RunCallMother.identities('call'),
      now: () => RunCallMother.STARTED_AT,
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
      acceptanceMs: 10_000,
      pollMs: 250,
      sleep: async () => launch.completePending(),
    })
    const watch = new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: 332, url: 'https://github.com/mercadona/control-tower/issues/332' }),
      located: new WorkspaceLocation({ root: checkout, path: checkout, branch: 'feat/332' }),
      repository: new RepositoryName('mercadona/control-tower'),
      agent: RunCallMother.CONVERSATION,
    })
    const runCalls = new ClaudeRunCalls({
      calls: new MeasuredAgentCalls({
        executor: calls,
        reader: new ClaudeRunMeasurements({ files }),
        store: new DiskAgentMeasurements({ files }),
      }),
      machine: new DispatchingMachine(files, RunCallMother.pluginRoot, dispatches),
      files,
      pluginRoot: RunCallMother.pluginRoot,
    })
    return new RunCallScenario({ files, calls, launch, runCalls, watch })
  }

  static dispatch(asked: {
    ticket: string,
    role: Role,
    paths: readonly string[],
    argv: readonly string[],
    response: Response,
  }): RunDispatch {
    return new RunDispatch({
      ticket: asked.ticket,
      role: asked.role,
      paths: asked.paths,
      argv: asked.argv,
      response: asked.response,
    })
  }

  static stream(structured: 'present' | 'missing', value: unknown = { accepted: true }): string {
    return `${JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: RunCallMother.CONVERSATION,
      is_error: false,
      total_cost_usd: 0.25,
      num_turns: 1,
      duration_ms: 2_000,
      ...(structured === 'present' ? { structured_output: value } : {}),
    })}\n`
  }

  static failedStream(): string {
    return `${JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
      session_id: RunCallMother.CONVERSATION,
      is_error: true,
      total_cost_usd: 0.5,
      num_turns: 4,
      duration_ms: 3_000,
    })}\n`
  }

  static roleFiles(step: string): readonly string[] {
    return RoleBytes.filesOf(step).map((path) => join(RunCallMother.pluginRoot, path))
  }

  static definition(step: string): AgentDefinition {
    return AgentDefinition.parse(readFileSync(join(RunCallMother.pluginRoot, RoleBytes.filesOf(step)[0]), 'utf8'))
  }

  static definedArgv(step: string, schema?: object): readonly string[] {
    const definition = RunCallMother.definition(step)
    const tools = definition.tools.join(', ')
    return [
      '--tools', tools,
      '--allowedTools', tools,
      '--model', definition.model,
      '--agents', JSON.stringify(definition.toClaudeAgents()),
      '--agent', definition.name,
      ...(schema === undefined ? [] : ['--json-schema', JSON.stringify(schema)]),
    ]
  }

  static completion(call: StartedPlanCall, kind: 'success' | 'failed'): CompletedPlanCall {
    const failed = kind === 'failed'
    return new CompletedPlanCall({
      call,
      code: 0,
      signal: null,
      finishedAt: RunCallMother.FINISHED_AT,
      wallDurationMs: 2_000,
      execution: failed ? { kind: 'error', diagnostic: 'Claude reported error_max_turns' } : { kind: 'success' },
      measurement: {
        cost: { kind: 'reported', totalUsd: failed ? 0.5 : 0.25, attribution: 'unverified-resume' },
        turns: failed ? 4 : 1,
        durationMs: failed ? 3_000 : 2_000,
        unavailable: [],
      },
    })
  }

  static identities(prefix: string): () => string {
    let next = 0
    return () => `${prefix}-${++next}`
  }

  static async clean(): Promise<void> {
    await Promise.all(RunCallMother.roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  }
}

class ScriptedClaude {
  readonly files: HeadlessFiles
  readonly scripts: ReadonlyMap<string, Script>
  readonly descriptors: string[] = []
  readonly pending: Array<{ directory: string, call: StartedPlanCall, script: Script }> = []

  constructor(files: HeadlessFiles, scripts: ReadonlyMap<string, Script>) {
    this.files = files
    this.scripts = scripts
  }

  readonly spawn = ((_binary: string, argv: readonly string[]) => {
    const descriptorPath = argv[1]
    const descriptor = CallDescriptor.from(readFileSync(descriptorPath, 'utf8'))
    const script = this.scripts.get(descriptor.requestId ?? '')
    if (script === undefined) throw new Error(`unlisted Claude request: ${String(descriptor.requestId)}`)
    const directory = dirname(descriptorPath)
    const call = new StartedPlanCall({ conversation: descriptor.conversation, id: basename(directory) })
    this.descriptors.push(descriptorPath)
    writeFileSync(join(directory, CallDescriptor.STREAM), script.stream)
    if (script.written !== undefined) {
      writeFileSync(join(descriptor.cwd, script.written.path), script.written.text)
    }
    if (script.completion === 'pending') this.pending.push({ directory, call, script })
    else this.writeCompletion(directory, call, script.completion)
    const worker = new AcceptedWorker()
    queueMicrotask(() => worker.emit('message', { kind: 'accepted' }))
    return worker
  }) as typeof import('node:child_process').spawn

  async completePending(): Promise<void> {
    const pending = this.pending.shift()
    if (pending === undefined) throw new Error('no pending Claude call was scripted')
    this.writeCompletion(pending.directory, pending.call, 'success')
  }

  private writeCompletion(directory: string, call: StartedPlanCall, kind: 'success' | 'failed'): void {
    writeFileSync(join(directory, CallDescriptor.COMPLETION), StoredCompletion.text(RunCallMother.completion(call, kind)))
  }
}

class RunCallScenario {
  readonly files: HeadlessFiles
  readonly calls: ClaudeCalls
  readonly launch: ScriptedClaude
  readonly runCalls: ClaudeRunCalls
  readonly watch: PlanWatch

  constructor(asked: {
    files: HeadlessFiles,
    calls: ClaudeCalls,
    launch: ScriptedClaude,
    runCalls: ClaudeRunCalls,
    watch: PlanWatch,
  }) {
    this.files = asked.files
    this.calls = asked.calls
    this.launch = asked.launch
    this.runCalls = asked.runCalls
    this.watch = asked.watch
  }

  async perform(ticket: string): Promise<void> {
    await this.runCalls.perform(this.watch, new RunInstruction({ kind: 'call', ticket }))
  }

  descriptor(index = 0): CallDescriptor {
    return CallDescriptor.from(readFileSync(this.launch.descriptors[index], 'utf8'))
  }

  call(index = 0): StartedPlanCall {
    const directory = dirname(this.launch.descriptors[index])
    return new StartedPlanCall({ conversation: RunCallMother.CONVERSATION, id: basename(directory) })
  }

  async seedUnowned(dispatch: RunDispatch, stream: string): Promise<StartedPlanCall> {
    const call = new StartedPlanCall({ conversation: RunCallMother.CONVERSATION, id: 'unowned-call' })
    const directory = this.files.callDirectory(call)
    await fs.mkdir(directory, { recursive: true })
    const prompt = RunCallScenario.prompt(dispatch)
    const descriptor = new CallDescriptor({
      conversation: call.conversation,
      purpose: 'implementation',
      requestId: `run:${dispatch.ticket}`,
      cwd: this.watch.located.path,
      binary: '/usr/local/bin/claude',
      argv: RunCallScenario.argv(dispatch, join(directory, CallDescriptor.PROMPT)),
      startedAt: RunCallMother.STARTED_AT,
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
    })
    await writeFile(join(directory, CallDescriptor.PROMPT), prompt, 'utf8')
    await writeFile(join(directory, CallDescriptor.FILE), descriptor.text(), 'utf8')
    await writeFile(join(directory, CallDescriptor.STREAM), stream, 'utf8')
    return call
  }

  static prompt(dispatch: RunDispatch): string {
    const listed = `Read the listed files.\n${dispatch.paths.join('\n')}\n`
    if (dispatch.response.kind !== 'file') {
      return `${listed}Complete this role. Return the CLI response. Do not run CT commands or dispatch another agent.`
    }
    return `${listed}Complete this role. Write your answer to the path on the last line of this file. Do not run CT commands or dispatch another agent.\n${dispatch.response.path}`
  }

  static argv(dispatch: RunDispatch, promptPath: string): readonly string[] {
    return [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'acceptEdits',
      '--plugin-dir', RunCallMother.pluginRoot,
      '--resume', RunCallMother.CONVERSATION,
      ...dispatch.argv,
      CallDescriptor.opening(promptPath),
    ]
  }
}

afterEach(async () => RunCallMother.clean())

describe('ClaudeRunCalls', () => {
  it('one resumed call carries exact plugin paths tools and binary schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-role-inputs-'))
    RunCallMother.roots.push(root)
    const prepared = ['brief.md', 'review.md', 'advice.md', 'slice.md', 'reconcile.md']
      .map((name) => join(root, name))
    await Promise.all(prepared.map((path, index) => writeFile(path, `prepared-${index}\n`, 'utf8')))
    const before = await Promise.all(prepared.map((path) => readFile(path)))
    const responsePaths = ['implement.json', 'judge.json', 'advice.json', 'slice.json']
    const dispatches = [
      RunCallMother.dispatch({
        ticket: 'implement', role: 'implement',
        paths: [RunCallMother.roleFiles(STEPS.IMPLEMENT)[0], prepared[0], ...RunCallMother.roleFiles(STEPS.IMPLEMENT).slice(1)],
        argv: [
          '--tools', IMPLEMENTER_TOOLS,
          '--allowedTools', IMPLEMENTER_TOOLS,
          '--model', IMPLEMENTER_MODEL,
          '--json-schema', JSON.stringify(REPORT_SCHEMA),
        ],
        response: { kind: 'structured', path: responsePaths[0] },
      }),
      RunCallMother.dispatch({
        ticket: 'judge', role: 'judge', paths: [prepared[1], ...RunCallMother.roleFiles(STEPS.JUDGE)],
        argv: RunCallMother.definedArgv(STEPS.JUDGE), response: { kind: 'file', path: responsePaths[1] },
      }),
      RunCallMother.dispatch({
        ticket: 'advise', role: 'advise', paths: [prepared[2], ...RunCallMother.roleFiles(STEPS.ADVISE)],
        argv: RunCallMother.definedArgv(STEPS.ADVISE, ADVICE_SCHEMA),
        response: { kind: 'structured', path: responsePaths[2] },
      }),
      RunCallMother.dispatch({
        ticket: 'slice-judge', role: 'slice-judge', paths: [prepared[3], ...RunCallMother.roleFiles(STEPS.SLICE_JUDGE)],
        argv: RunCallMother.definedArgv(STEPS.SLICE_JUDGE), response: { kind: 'file', path: responsePaths[3] },
      }),
      RunCallMother.dispatch({
        ticket: 'reconcile', role: 'reconcile', paths: [prepared[4], ...RunCallMother.roleFiles(STEPS.RECONCILE)],
        argv: RunCallMother.definedArgv(STEPS.RECONCILE), response: { kind: 'edits' },
      }),
    ]
    const scripts = new Map(dispatches.map((dispatch): [string, Script] => [
      `run:${dispatch.ticket}`,
      {
        stream: RunCallMother.stream('present', { role: dispatch.role }),
        completion: dispatch.role === 'implement' ? 'pending' : 'success',
        ...(dispatch.response.kind === 'file'
          ? { written: { path: dispatch.response.path, text: `${dispatch.role} wrote its own answer\n` } }
          : {}),
      },
    ]))
    const scenario = await RunCallMother.scenario(dispatches, scripts)

    for (const dispatch of dispatches) await scenario.perform(dispatch.ticket)

    expect(scenario.launch.descriptors).toHaveLength(dispatches.length)
    dispatches.forEach((dispatch, index) => {
      const descriptor = scenario.descriptor(index)
      const promptPath = join(dirname(scenario.launch.descriptors[index]), CallDescriptor.PROMPT)
      expect(descriptor.purpose).toBe('implementation')
      expect(descriptor.requestId).toBe(`run:${dispatch.ticket}`)
      expect(descriptor.role).toBe(dispatch.role)
      expect(JSON.parse(readFileSync(join(dirname(scenario.launch.descriptors[index]), 'agent-measurements-v1.json'), 'utf8')))
        .toMatchObject({ role: dispatch.role })
      expect(descriptor.cwd).toBe(scenario.watch.located.path)
      expect(descriptor.argv).toEqual(RunCallScenario.argv(dispatch, promptPath))
      expect(readFileSync(promptPath, 'utf8')).toBe(RunCallScenario.prompt(dispatch))
    })
    expect(scenario.descriptor(1).argv).not.toContain('Agent')
    expect(await Promise.all(prepared.map((path) => readFile(path)))).toEqual(before)
  })

  it('a judge that wrote its verdict keeps its own bytes although the stream carried a structured output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-verdict-bytes-'))
    RunCallMother.roots.push(root)
    const responsePath = 'task-1-verdict.json'
    const dispatch = RunCallMother.dispatch({
      ticket: 'verdict', role: 'judge', paths: [join(root, 'review.diff')],
      argv: RunCallMother.definedArgv(STEPS.JUDGE), response: { kind: 'file', path: responsePath },
    })
    await writeFile(dispatch.paths[0], 'the review package\n', 'utf8')
    const streamed = { ruling: 'VETO', findings: ['the stream must not reach the verdict'] }
    const ruled = `${JSON.stringify({ ruling: 'PASS', findings: [] })}\n`
    const scenario = await RunCallMother.scenario([dispatch], new Map([
      ['run:verdict', {
        stream: RunCallMother.stream('present', streamed),
        completion: 'success',
        written: { path: responsePath, text: ruled },
      }],
    ]))
    const verdict = join(scenario.watch.located.path, responsePath)

    await scenario.perform('verdict')

    expect(await readFile(verdict, 'utf8')).toBe(ruled)
    expect(existsSync(join(scenario.files.callDirectory(scenario.call()), ClaudeRunCalls.RESPONSE))).toBe(false)
  })

  it('a judge that writes nothing is refused, and the verdict of the previous attempt at the task is gone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-stale-verdict-'))
    RunCallMother.roots.push(root)
    const responsePath = 'task-1-verdict.json'
    const ruled = `${JSON.stringify({ ruling: 'FAIL', findings: [{ severity: 'high', what: 'the first attempt' }] })}\n`
    const dispatches = ['first-attempt', 'second-attempt'].map((ticket) => RunCallMother.dispatch({
      ticket, role: 'judge', paths: [join(root, `${ticket}-review.diff`)],
      argv: RunCallMother.definedArgv(STEPS.JUDGE), response: { kind: 'file', path: responsePath },
    }))
    await Promise.all(dispatches.map((dispatch) => writeFile(dispatch.paths[0], 'the review package\n', 'utf8')))
    const scenario = await RunCallMother.scenario(dispatches, new Map([
      ['run:first-attempt', {
        stream: RunCallMother.stream('missing'),
        completion: 'success',
        written: { path: responsePath, text: ruled },
      }],
      ['run:second-attempt', { stream: RunCallMother.stream('missing'), completion: 'success' }],
    ]))
    const verdict = join(scenario.watch.located.path, responsePath)

    await scenario.perform('first-attempt')
    const judged = await readFile(verdict, 'utf8')
    await expect(scenario.perform('second-attempt')).rejects.toEqual(new RunNotAdvanced(
      'the judge completed without writing its response file: task-1-verdict.json',
    ))

    expect(judged).toBe(ruled)
    expect(existsSync(verdict)).toBe(false)
    expect(scenario.launch.descriptors).toHaveLength(2)
  })

  it('a replayed file dispatch makes no second call and keeps the verdict its own call wrote', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-file-replay-'))
    RunCallMother.roots.push(root)
    const responsePath = 'slice-verdict.json'
    const ruled = `${JSON.stringify({ ruling: 'PASS', findings: [] })}\n`
    const dispatch = RunCallMother.dispatch({
      ticket: 'replayed', role: 'slice-judge', paths: [join(root, 'slice-review.diff')],
      argv: RunCallMother.definedArgv(STEPS.SLICE_JUDGE), response: { kind: 'file', path: responsePath },
    })
    await writeFile(dispatch.paths[0], "the slice's review package\n", 'utf8')
    const scenario = await RunCallMother.scenario([dispatch], new Map([
      ['run:replayed', {
        stream: RunCallMother.stream('missing'),
        completion: 'success',
        written: { path: responsePath, text: ruled },
      }],
    ]))
    const verdict = join(scenario.watch.located.path, responsePath)

    await scenario.perform('replayed')
    await scenario.perform('replayed')

    expect(scenario.launch.descriptors).toHaveLength(1)
    expect(await readFile(verdict, 'utf8')).toBe(ruled)
  })

  it('a file response path outside the prepared workspace is refused before any call', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-escaping-file-'))
    RunCallMother.roots.push(root)
    const dispatch = RunCallMother.dispatch({
      ticket: 'escape', role: 'judge', paths: [join(root, 'review.diff')],
      argv: RunCallMother.definedArgv(STEPS.JUDGE),
      response: { kind: 'file', path: '../../../outside/verdict.json' },
    })
    await writeFile(dispatch.paths[0], 'the review package\n', 'utf8')
    const scenario = await RunCallMother.scenario([dispatch], new Map([
      ['run:escape', { stream: RunCallMother.stream('missing'), completion: 'success' }],
    ]))

    await expect(scenario.perform('escape')).rejects.toEqual(new RunNotAdvanced(
      'printed response path is outside the prepared workspace: ../../../outside/verdict.json',
    ))

    expect(scenario.launch.descriptors).toEqual([])
  })

  it('a file errand names the path on its last line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-file-errand-'))
    RunCallMother.roots.push(root)
    const responsePath = 'slice-verdict.json'
    const dispatch = RunCallMother.dispatch({
      ticket: 'errand', role: 'slice-judge', paths: [join(root, 'slice-review.diff')],
      argv: RunCallMother.definedArgv(STEPS.SLICE_JUDGE), response: { kind: 'file', path: responsePath },
    })
    await writeFile(dispatch.paths[0], "the slice's review package\n", 'utf8')
    const scenario = await RunCallMother.scenario([dispatch], new Map([
      ['run:errand', {
        stream: RunCallMother.stream('missing'),
        completion: 'success',
        written: { path: responsePath, text: 'the slice judge wrote its own answer\n' },
      }],
    ]))

    await scenario.perform('errand')

    expect(readFileSync(join(dirname(scenario.launch.descriptors[0]), CallDescriptor.PROMPT), 'utf8')).toBe([
      'Read the listed files.',
      dispatch.paths[0],
      'Complete this role. Write your answer to the path on the last line of this file. Do not run CT commands or dispatch another agent.',
      responsePath,
    ].join('\n'))
  })

  it('completed dispatch replay makes no second call and replaces stale response bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-replay-'))
    RunCallMother.roots.push(root)
    const input = join(root, 'brief.md')
    const responsePath = 'report.json'
    await writeFile(input, 'immutable input\n', 'utf8')
    const dispatch = RunCallMother.dispatch({
      ticket: 'replay', role: 'implement', paths: [input], argv: ['--model', IMPLEMENTER_MODEL],
      response: { kind: 'structured', path: responsePath },
    })
    const raw = { paths: ['changed.ts'], summary: 'Recorded response.' }
    const scenario = await RunCallMother.scenario([dispatch], new Map([
      ['run:replay', { stream: RunCallMother.stream('present', raw), completion: 'success' }],
    ]))
    const response = join(scenario.watch.located.path, responsePath)

    await scenario.perform('replay')
    const call = scenario.call()
    const evidence = join(scenario.files.callDirectory(call), 'response.json')
    const immutable = await readFile(evidence, 'utf8')
    await writeFile(response, 'stale model-written bytes\n', 'utf8')
    await scenario.perform('replay')

    await rm(join(scenario.files.callDirectory(call), 'agent-measurements-v1.json'))
    await new MeasuredAgentCalls({
      executor: scenario.calls,
      reader: new ClaudeRunMeasurements({ files: scenario.files }),
      store: new DiskAgentMeasurements({ files: scenario.files }),
    }).history(scenario.watch.agent)

    expect(scenario.launch.descriptors).toHaveLength(1)
    expect(await readFile(evidence, 'utf8')).toBe(immutable)
    expect(immutable).toBe(`${JSON.stringify(raw)}\n`)
    expect(await readFile(response, 'utf8')).toBe(immutable)
    expect(await readFile(join(scenario.files.callDirectory(call), ClaudeRunMeasurements.FILE), 'utf8'))
      .toContain('"scope": "unverified-resume"')
    expect(JSON.parse(await readFile(join(scenario.files.callDirectory(call), 'agent-measurements-v1.json'), 'utf8')))
      .toMatchObject({
        provider: 'claude-code', callId: call.id, requestId: 'run:replay', role: 'implement',
        execution: { kind: 'success' }, cost: { attribution: 'unverified-resume' },
      })
  })

  it('failed or unowned calls advance no verb and preserve measured evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-failures-'))
    RunCallMother.roots.push(root)
    const responsePath = 'response.json'
    const failed = RunCallMother.dispatch({
      ticket: 'failed', role: 'judge', paths: [join(root, 'judge.md')], argv: ['--model', 'opus'],
      response: { kind: 'structured', path: responsePath },
    })
    const unowned = RunCallMother.dispatch({
      ticket: 'unowned', role: 'judge', paths: [join(root, 'review.md')], argv: ['--model', 'opus'],
      response: { kind: 'structured', path: responsePath },
    })
    await Promise.all([...failed.paths, ...unowned.paths].map((path) => writeFile(path, 'input\n', 'utf8')))
    const scenario = await RunCallMother.scenario([failed, unowned], new Map([
      ['run:failed', { stream: RunCallMother.failedStream(), completion: 'failed' }],
    ]))
    const response = join(scenario.watch.located.path, responsePath)
    await writeFile(response, 'untouched\n', 'utf8')

    await expect(scenario.perform('failed')).rejects.toEqual(new RunNotAdvanced('Claude reported error_max_turns'))
    const failedCall = scenario.call()
    const measurements = await readFile(
      join(scenario.files.callDirectory(failedCall), ClaudeRunMeasurements.FILE), 'utf8',
    )
    expect(measurements).toContain('Claude reported error_max_turns')
    expect(measurements).toContain('"total_cost_usd"')
    expect(JSON.parse(await readFile(join(scenario.files.callDirectory(failedCall), 'agent-measurements-v1.json'), 'utf8')))
      .toMatchObject({ execution: { kind: 'error', diagnostic: 'Claude reported error_max_turns' } })
    await scenario.seedUnowned(unowned, RunCallMother.stream('present'))
    await expect(scenario.perform('unowned')).rejects.toEqual(
      new RunNotAdvanced('recorded call unowned-call is incomplete and is not owned by this API process'),
    )

    expect(scenario.launch.descriptors).toHaveLength(1)
    expect(await readFile(response, 'utf8')).toBe('untouched\n')
  })

  it('missing structured output reaches the plugin as a discard input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-missing-output-'))
    RunCallMother.roots.push(root)
    const missingResponsePath = 'missing.json'
    const malformedResponsePath = 'malformed.json'
    const missing = RunCallMother.dispatch({
      ticket: 'missing', role: 'advise', paths: [join(root, 'advice.md')], argv: ['--model', 'haiku'],
      response: { kind: 'structured', path: missingResponsePath },
    })
    const malformed = RunCallMother.dispatch({
      ticket: 'malformed', role: 'advise', paths: [join(root, 'other-advice.md')], argv: ['--model', 'haiku'],
      response: { kind: 'structured', path: malformedResponsePath },
    })
    await Promise.all([...missing.paths, ...malformed.paths].map((path) => writeFile(path, 'input\n', 'utf8')))
    const scenario = await RunCallMother.scenario([missing, malformed], new Map([
      ['run:missing', { stream: RunCallMother.stream('missing'), completion: 'success' }],
      ['run:malformed', { stream: '{malformed-json}\n', completion: 'success' }],
    ]))
    const missingResponse = join(scenario.watch.located.path, missingResponsePath)
    const malformedResponse = join(scenario.watch.located.path, malformedResponsePath)
    await writeFile(missingResponse, 'stale missing bytes\n', 'utf8')
    await writeFile(malformedResponse, 'stale malformed bytes\n', 'utf8')

    await scenario.perform('missing')
    await scenario.perform('malformed')

    expect(await readFile(missingResponse, 'utf8')).toBe('null\n')
    expect(await readFile(malformedResponse, 'utf8')).toBe('null\n')
    for (let index = 0; index < 2; index += 1) {
      expect(await readFile(join(scenario.files.callDirectory(scenario.call(index)), 'response.json'), 'utf8')).toBe('null\n')
    }
  })
})
