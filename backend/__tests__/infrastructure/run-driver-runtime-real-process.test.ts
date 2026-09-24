import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudeCodeTranscript } from '../../../plugin/scripts/claude-code-usage.js'
import { CompletedPlanCall, StartedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { CallDescriptor, StoredCompletion } from '../../src/infrastructure/claude-calls.ts'
import { ClaudePlanCalls } from '../../src/infrastructure/claude-plan-calls.ts'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.ts'

type CallRecord = {
  conversation: string,
  purpose: string,
  requestId: string | null,
  argv: string[],
}

class RuntimeProcess {
  static readonly #ENTRYPOINT = join(
    dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'infrastructure', 'ct-api.ts',
  )
  static readonly #WAIT_MS = 100
  static readonly #TRIES = 700
  readonly child: ChildProcess
  readonly port: Promise<number>
  stderr = ''

  constructor(environment: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, [RuntimeProcess.#ENTRYPOINT], {
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.port = this.#listeningPort()
  }

  kill(): void {
    for (const pid of this.#descendants(this.child.pid)) RuntimeProcess.#kill(pid)
    this.child.kill('SIGKILL')
  }

  diagnostics(): string {
    return this.stderr
  }

  static async until<T>(read: () => Promise<T | null>, diagnostic: () => string): Promise<T> {
    for (let attempt = 0; attempt < RuntimeProcess.#TRIES; attempt += 1) {
      const value = await read()
      if (value !== null) return value
      await new Promise((resolve) => setTimeout(resolve, RuntimeProcess.#WAIT_MS))
    }
    throw new Error(diagnostic())
  }

  async #listeningPort(): Promise<number> {
    let stdout = ''
    this.child.stderr?.on('data', (chunk) => { this.stderr += String(chunk) })
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the API did not listen: ${this.stderr}`)), 30_000)
      this.child.stdout?.on('data', (chunk) => {
        stdout += String(chunk)
        const end = stdout.indexOf('\n')
        if (end === -1) return
        clearTimeout(timer)
        resolve((JSON.parse(stdout.slice(0, end)) as { port: number }).port)
      })
      this.child.once('error', reject)
      this.child.once('close', (code) => reject(new Error(`the API exited ${String(code)}: ${this.stderr}`)))
    })
  }

  #descendants(pid: number | undefined): number[] {
    if (pid === undefined) return []
    let children: number[]
    try {
      children = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8', timeout: 5_000 })
        .split('\n').filter(Boolean).map(Number)
    } catch {
      children = []
    }
    return children.flatMap((child) => [child, ...this.#descendants(child)])
  }

  static #kill(pid: number): void {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      return
    }
  }
}

class EnvironmentPath {
  static value(): string {
    return process.env.PATH ?? '/usr/bin:/bin'
  }
}

class LegacyRuntimeFixture {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly PLANNER = '22222222-2222-4222-8222-222222222222'
  static readonly IMPLEMENTATION = '33333333-3333-4333-8333-333333333333'
  static readonly REVIEW = '701'
  static readonly CHANGES = 'Change the legacy runtime fixture'
  static readonly ISSUE = 41
  static readonly REPOSITORY = 'acme/widget'
  readonly base: string
  readonly state: string
  readonly worktree: string
  readonly calls: string
  readonly captures: string
  readonly baseline: string
  readonly reviewEnabled: string
  readonly process: RuntimeProcess

  private constructor(asked: {
    base: string,
    state: string,
    worktree: string,
    calls: string,
    captures: string,
    baseline: string,
    reviewEnabled: string,
    process: RuntimeProcess,
  }) {
    this.base = asked.base
    this.state = asked.state
    this.worktree = asked.worktree
    this.calls = asked.calls
    this.captures = asked.captures
    this.baseline = asked.baseline
    this.reviewEnabled = asked.reviewEnabled
    this.process = asked.process
  }

  static async start({ completedImplementation = false }: { completedImplementation?: boolean } = {}): Promise<LegacyRuntimeFixture> {
    const base = await mkdtemp(join(tmpdir(), 'ct-legacy-runtime-'))
    try {
      const state = join(base, 'state')
      const checkout = join(base, 'checkout')
      const worktree = join(checkout, '.worktrees', String(LegacyRuntimeFixture.ISSUE))
      const bin = join(base, 'bin')
      const captures = join(base, 'captures')
      const baseline = join(captures, 'review-baseline')
      const reviewEnabled = join(captures, 'review-enabled')
      const harness = join(state, 'control-tower', 'harness', LegacyRuntimeFixture.CONVERSATION)
      const calls = join(harness, 'calls')
      await Promise.all([
        mkdir(worktree, { recursive: true }),
        mkdir(calls, { recursive: true }),
        mkdir(bin),
        mkdir(captures),
      ])
      await writeFile(join(harness, 'dispatch.json'), `${JSON.stringify({
        repository: LegacyRuntimeFixture.REPOSITORY,
        issue: { number: LegacyRuntimeFixture.ISSUE, url: `https://github.com/acme/widget/issues/${LegacyRuntimeFixture.ISSUE}` },
        story: null,
        root: checkout,
        worktree,
        branch: `feat/${LegacyRuntimeFixture.ISSUE}`,
        startedAt: '2026-09-17T09:00:00.000Z',
      }, null, 2)}\n`)
      const transcript = join(state, ClaudeCodeTranscript.FOLDER, ClaudeCodeTranscript.folderFor(worktree))
      await mkdir(transcript, { recursive: true })
      await writeFile(
        join(transcript, `${LegacyRuntimeFixture.CONVERSATION}${ClaudeCodeTranscript.EXTENSION}`),
        '{"type":"user"}\n',
      )
      await LegacyRuntimeFixture.#calls(calls, worktree, completedImplementation)
      await LegacyRuntimeFixture.#executables(bin)
      const process = new RuntimeProcess({
        CT_API_PORT: '0', CLAUDE_CONFIG_DIR: state, SHELL: '/bin/sh',
        PATH: `${bin}:${EnvironmentPath.value()}`,
        CT_FIXTURE_CAPTURES: captures,
        CT_FIXTURE_REVIEW_BASELINE: baseline,
        CT_FIXTURE_REVIEW_ENABLED: reviewEnabled,
      })
      return new LegacyRuntimeFixture({
        base, state, worktree, calls, captures, baseline, reviewEnabled, process,
      })
    } catch (cause) {
      await rm(base, { recursive: true, force: true })
      throw cause
    }
  }

  async recovered(): Promise<unknown> {
    const port = await this.process.port
    return RuntimeProcess.until(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/active-plans`)
      if (response.status !== 200) return null
      const body = await response.json() as { plans: unknown[] }
      return body.plans.length === 1 ? body : null
    }, () => `legacy recovery did not settle: ${this.process.diagnostics()}`)
  }

  async bytes(): Promise<{ descriptor: string, prompt: string, admission: string | null, callNames: string[] }> {
    const directory = join(this.calls, LegacyRuntimeFixture.IMPLEMENTATION)
    let admission: string | null
    try {
      admission = await readFile(join(dirname(this.calls), 'run', 'admission.json'), 'utf8')
    } catch (cause) {
      if (!LegacyRuntimeFixture.#missing(cause)) throw cause
      admission = null
    }
    return {
      descriptor: await readFile(join(directory, CallDescriptor.FILE), 'utf8'),
      prompt: await readFile(join(directory, CallDescriptor.PROMPT), 'utf8'),
      admission,
      callNames: (await readdir(this.calls)).sort(),
    }
  }

  async exposeReviewAfterBaseline(): Promise<void> {
    await RuntimeProcess.until(async () => {
      try {
        await readFile(this.baseline, 'utf8')
        return true
      } catch (cause) {
        if (LegacyRuntimeFixture.#missing(cause)) return null
        throw cause
      }
    }, () => `legacy review baseline was not observed: ${this.process.diagnostics()}`)
    await writeFile(this.reviewEnabled, 'enabled\n')
  }

  async fixEvidence(): Promise<{
    descriptor: CallRecord,
    prompt: string,
    promptPath: string,
    capture: { conversation: string, argv: string[], prompt: string },
    admission: string | null,
    ghCalls: string[][],
    measurement: string,
  }> {
    return RuntimeProcess.until(async () => {
      try {
        const names = await readdir(this.calls)
        for (const name of names) {
          if (name === LegacyRuntimeFixture.PLANNER || name === LegacyRuntimeFixture.IMPLEMENTATION) continue
          const directory = join(this.calls, name)
          const descriptor = JSON.parse(await readFile(join(directory, CallDescriptor.FILE), 'utf8')) as CallRecord
          if (descriptor.purpose !== 'fix') continue
          await readFile(join(directory, CallDescriptor.COMPLETION), 'utf8')
          const capture = JSON.parse(
            await readFile(join(this.captures, 'fix.json'), 'utf8'),
          ) as { conversation: string, argv: string[], prompt: string }
          let admission: string | null
          try {
            admission = await readFile(join(dirname(this.calls), 'run', 'admission.json'), 'utf8')
          } catch (cause) {
            if (!LegacyRuntimeFixture.#missing(cause)) throw cause
            admission = null
          }
          const ghLines = (await readFile(join(this.captures, 'gh.jsonl'), 'utf8')).trim().split('\n')
          return {
            descriptor,
            prompt: await readFile(join(directory, CallDescriptor.PROMPT), 'utf8'),
            promptPath: join(directory, CallDescriptor.PROMPT),
            capture,
            admission,
            ghCalls: ghLines.filter(Boolean).map((line) => JSON.parse(line) as string[]),
            measurement: await readFile(join(directory, 'agent-measurements-v1.json'), 'utf8'),
          }
        }
        return null
      } catch (cause) {
        if (LegacyRuntimeFixture.#missing(cause)) return null
        throw cause
      }
    }, () => `the recovered legacy review was not delivered: ${this.process.diagnostics()}`)
  }

  async remove(): Promise<void> {
    this.process.kill()
    await rm(this.base, { recursive: true, force: true })
  }

  static async #calls(calls: string, worktree: string, completedImplementation: boolean): Promise<void> {
    const repository = new RepositoryName(LegacyRuntimeFixture.REPOSITORY)
    const brief = LegacyRuntimeFixture.#brief()
    const planner = new StartedPlanCall({
      conversation: LegacyRuntimeFixture.CONVERSATION, id: LegacyRuntimeFixture.PLANNER,
    })
    const implementation = new StartedPlanCall({
      conversation: LegacyRuntimeFixture.CONVERSATION, id: LegacyRuntimeFixture.IMPLEMENTATION,
    })
    const plannerArgv = LegacyRuntimeFixture.argv('--session-id')
    const implementationArgv = LegacyRuntimeFixture.argv('--resume')
    await LegacyRuntimeFixture.#save(calls, planner, new CallDescriptor({
      conversation: planner.conversation,
      purpose: 'plan',
      requestId: null,
      cwd: worktree,
      binary: 'claude',
      argv: plannerArgv,
      startedAt: '2026-09-17T09:00:01.000Z',
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
    }), brief.errandFor({
      issue: new PlanIssue({
        number: LegacyRuntimeFixture.ISSUE,
        url: `https://github.com/acme/widget/issues/${LegacyRuntimeFixture.ISSUE}`,
      }),
      repository,
    }), new CompletedPlanCall({
      call: planner,
      code: 0,
      signal: null,
      finishedAt: '2026-09-17T09:00:02.000Z',
      wallDurationMs: 1_000,
      execution: { kind: 'success' },
      measurement: { cost: { kind: 'unavailable', reason: 'fixture' }, turns: null, durationMs: null, unavailable: ['fixture'] },
    }))
    await LegacyRuntimeFixture.#save(calls, implementation, new CallDescriptor({
      conversation: implementation.conversation,
      purpose: 'implementation',
      requestId: `implementation:${LegacyRuntimeFixture.PLANNER}`,
      cwd: worktree,
      binary: 'claude',
      argv: implementationArgv,
      startedAt: '2026-09-17T09:00:03.000Z',
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
    }), LegacyRuntimeFixture.implementationErrand(brief, repository), completedImplementation
      ? new CompletedPlanCall({
          call: implementation,
          code: 0,
          signal: null,
          finishedAt: '2026-09-17T09:00:04.000Z',
          wallDurationMs: 1_000,
          execution: { kind: 'success' },
          measurement: {
            cost: { kind: 'unavailable', reason: 'fixture' },
            turns: null,
            durationMs: null,
            unavailable: ['fixture'],
          },
        })
      : null)
  }

  static async #save(
    calls: string,
    call: StartedPlanCall,
    descriptor: CallDescriptor,
    prompt: string,
    completion: CompletedPlanCall | null,
  ): Promise<void> {
    const directory = join(calls, call.id)
    await mkdir(directory)
    await writeFile(join(directory, CallDescriptor.FILE), descriptor.text())
    await writeFile(join(directory, CallDescriptor.PROMPT), prompt)
    await writeFile(join(directory, CallDescriptor.STREAM), '')
    await writeFile(join(directory, CallDescriptor.STDERR), '')
    if (completion !== null) {
      await writeFile(join(directory, CallDescriptor.COMPLETION), StoredCompletion.text(completion))
    }
  }

  static argv(mode: '--session-id' | '--resume'): string[] {
    return [
      '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
      '--allowedTools', ClaudePlanCalls.ALLOWED_TOOLS, '--model', 'opus', '--plugin-dir',
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'plugin'),
      mode, LegacyRuntimeFixture.CONVERSATION,
    ]
  }

  static implementationErrand(
    brief: PlanAgentBrief = LegacyRuntimeFixture.#brief(),
    repository: RepositoryName = new RepositoryName(LegacyRuntimeFixture.REPOSITORY),
  ): string {
    return brief.implementationErrandFor({ issueNumber: LegacyRuntimeFixture.ISSUE, repository })
  }

  static fixErrand(
    brief: PlanAgentBrief = LegacyRuntimeFixture.#brief(),
    repository: RepositoryName = new RepositoryName(LegacyRuntimeFixture.REPOSITORY),
  ): string {
    return brief.fixErrandFor({
      issueNumber: LegacyRuntimeFixture.ISSUE,
      repository,
      changes: LegacyRuntimeFixture.CHANGES,
    })
  }

  static #brief(): PlanAgentBrief {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    const plugin = join(root, 'plugin')
    return new PlanAgentBrief({
      dispatchCheck: join(plugin, 'scripts', 'dispatch-check.mjs'),
      conventions: join(plugin, 'conventions'),
      ctStep: join(plugin, 'scripts', 'ct-step.mjs'),
    })
  }

  static async #executables(bin: string): Promise<void> {
    await writeFile(join(bin, 'claude'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      "const path = require('node:path')",
      'const argv = process.argv.slice(2)',
      "const resumeAt = argv.indexOf('--resume')",
      'const conversation = argv[resumeAt + 1]',
      'const errand = argv[argv.length - 1]',
      "const errandMatch = /^Read the file at (.+) and do exactly what it says\\.$/.exec(errand)",
      "if (errandMatch === null) throw new Error('unexpected CLI errand: ' + JSON.stringify(errand))",
      "const prompt = fs.readFileSync(errandMatch[1], 'utf8')",
      "fs.writeFileSync(path.join(process.env.CT_FIXTURE_CAPTURES, 'fix.json'), JSON.stringify({ conversation, argv, prompt }))",
      "console.log(JSON.stringify({ type: 'result', subtype: 'success', session_id: conversation, is_error: false, total_cost_usd: 0, num_turns: 1, duration_ms: 1 }))",
    ].join('\n') + '\n', { mode: 0o755 })
    await writeFile(join(bin, 'gh'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      "const path = require('node:path')",
      'const argv = process.argv.slice(2)',
      "fs.appendFileSync(path.join(process.env.CT_FIXTURE_CAPTURES, 'gh.jsonl'), `${JSON.stringify(argv)}\\n`)",
      "if (argv[0] === 'pr' && argv[1] === 'list') console.log(JSON.stringify([{ number: 17, url: 'https://github.com/acme/widget/pull/17' }]))",
      "else if (argv[0] === 'issue' && argv[1] === 'view' && argv.includes('-q')) console.log(JSON.stringify(['status:in-review']))",
      "else if (argv[0] === 'issue' && argv[1] === 'view') console.log(JSON.stringify({ labels: [{ name: 'status:in-review' }] }))",
      "else if (argv[0] === 'api' && argv[1].endsWith('/reviews')) {",
      "  fs.writeFileSync(process.env.CT_FIXTURE_REVIEW_BASELINE, 'ready\\n')",
      "  console.log(fs.existsSync(process.env.CT_FIXTURE_REVIEW_ENABLED) ? JSON.stringify([[{ id: 701, state: 'CHANGES_REQUESTED', body: 'Change the legacy runtime fixture' }]]) : '[[]]')",
      '}',
      "else if (argv[0] === 'api' && argv[1].endsWith('/comments')) console.log('[[]]')",
      "else console.log('{}')",
    ].join('\n') + '\n', { mode: 0o755 })
  }

  static #missing(cause: unknown): boolean {
    return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT'
  }
}

describe('run driver production runtime', () => {
  const legacyFixtures: LegacyRuntimeFixture[] = []

  afterEach(async () => {
    await Promise.all(legacyFixtures.splice(0).map((fixture) => fixture.remove()))
  })

  it('legacy record recovery preserves original call argv and response identity', async () => {
    const fixture = await LegacyRuntimeFixture.start()
    legacyFixtures.push(fixture)
    const before = await fixture.bytes()

    const recovered = await fixture.recovered()
    const after = await fixture.bytes()

    const metricPath = join(fixture.calls, LegacyRuntimeFixture.PLANNER, 'agent-measurements-v1.json')
    expect(JSON.parse(await readFile(metricPath, 'utf8'))).toMatchObject({
      provider: 'claude-code', callId: LegacyRuntimeFixture.PLANNER, purpose: 'plan',
    })
    await rm(metricPath)
    await fixture.recovered()
    await fixture.recovered()
    await expect(readFile(metricPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    expect(after).toEqual(before)
    expect(after.admission).toBeNull()
    expect(after.callNames).toEqual([LegacyRuntimeFixture.IMPLEMENTATION, LegacyRuntimeFixture.PLANNER].sort())
    expect(JSON.parse(after.descriptor)).toMatchObject({
      conversation: LegacyRuntimeFixture.CONVERSATION,
      purpose: 'implementation',
      requestId: `implementation:${LegacyRuntimeFixture.PLANNER}`,
      argv: LegacyRuntimeFixture.argv('--resume'),
    })
    expect(after.prompt).toBe(LegacyRuntimeFixture.implementationErrand())
    expect(recovered).toEqual({ plans: [expect.objectContaining({
      plan: expect.objectContaining({ agent: LegacyRuntimeFixture.CONVERSATION }),
    })] })
  }, 120_000)

  it('a new review request resumes the completed legacy conversation through the runtime watcher', async () => {
    const fixture = await LegacyRuntimeFixture.start({ completedImplementation: true })
    legacyFixtures.push(fixture)
    await fixture.recovered()
    await fixture.exposeReviewAfterBaseline()

    const evidence = await fixture.fixEvidence()
    const expectedArgv = [...LegacyRuntimeFixture.argv('--resume'), CallDescriptor.opening(evidence.promptPath)]
    const expectedPrompt = LegacyRuntimeFixture.fixErrand()

    expect(evidence.admission).toBeNull()
    expect(JSON.parse(evidence.measurement)).toMatchObject({
      version: 1, provider: 'claude-code', purpose: 'fix',
      conversation: LegacyRuntimeFixture.CONVERSATION,
      requestId: LegacyRuntimeFixture.REVIEW,
      execution: { kind: 'success' },
    })
    expect(evidence.descriptor).toMatchObject({
      conversation: LegacyRuntimeFixture.CONVERSATION,
      purpose: 'fix',
      requestId: LegacyRuntimeFixture.REVIEW,
      argv: expectedArgv,
    })
    expect(evidence.prompt).toBe(expectedPrompt)
    expect(evidence.capture).toEqual({
      conversation: LegacyRuntimeFixture.CONVERSATION,
      argv: expectedArgv,
      prompt: expectedPrompt,
    })
    expect(evidence.ghCalls).toEqual(expect.arrayContaining([
      ['pr', 'list', '--repo', LegacyRuntimeFixture.REPOSITORY, '--head', `feat/${LegacyRuntimeFixture.ISSUE}`, '--state', 'open', '--json', 'number,url', '--limit', '1'],
      ['api', `repos/${LegacyRuntimeFixture.REPOSITORY}/pulls/17/reviews`, '-f', 'per_page=100', '--paginate', '--slurp', '--method', 'GET'],
      ['issue', 'edit', String(LegacyRuntimeFixture.ISSUE), '--repo', LegacyRuntimeFixture.REPOSITORY, '--add-label', 'status:in-progress', '--remove-label', 'status:in-review'],
    ]))
  }, 120_000)
})
