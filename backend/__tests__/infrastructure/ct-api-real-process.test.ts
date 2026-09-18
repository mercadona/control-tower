import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClaudeCodeTranscript } from '../../../plugin/scripts/claude-code-usage.js'
import { ToolRunner } from '../../src/infrastructure/tool-runner.ts'

type Started = { port: number, saidLater: () => string }
type Refusal = { status: number | null, said: string[] }
type Failure = { code: string, detail: string }
type ToolRow = { tool: string, installed: boolean, session: string, fix: string | null }

type DeliveredMetrics = { enabled: boolean, variable: string, destination: string | null }

type SurveyedTools = { ready: boolean, tools: ToolRow[], metricsDelivery: DeliveredMetrics }
type StartedPlan = { agent: string, issue: { number: number } }
type CapturedLaunch = { argv: string[], prompt: string }
type RecordedLaunch = {
  agent: string,
  issue: number,
  call: { conversation: string, purpose: string, argv: string[] },
  promptPath: string,
  prompt: string,
  captured: CapturedLaunch,
}

class HostCheckout {
  static readonly #HERE = dirname(fileURLToPath(import.meta.url))
  static readonly #NAMED = /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/

  static path(): string {
    return HostCheckout.#HERE
  }

  static repository(): string {
    const url = execFileSync('git', ['-C', HostCheckout.#HERE, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
    const named = url.match(HostCheckout.#NAMED)
    if (named === null) {
      throw new Error(`the origin of this checkout is ${JSON.stringify(url)}, and no owner/name can be read out of it`)
    }

    return named[1] as string
  }
}

class Entrypoint {
  static readonly #PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'infrastructure', 'ct-api.ts')
  static readonly #ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  static readonly #TIMEOUT_MS = 30_000
  static readonly #spawned: ChildProcess[] = []

  static startPlan(port: number, body: string = '{"id":"ABC-123"}'): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/start-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  }

  static async killAll(): Promise<void> {
    const pids = new Set<number>()
    for (const child of Entrypoint.#spawned.splice(0)) {
      for (const descendant of Entrypoint.#descendantsOf(child.pid)) pids.add(descendant)
      if (child.pid !== undefined) pids.add(child.pid)
    }
    await Promise.all([...pids].map((pid) => Entrypoint.killPid(pid)))
  }

  static #descendantsOf(pid: number | undefined): number[] {
    if (pid === undefined) return []
    const direct = Entrypoint.#directChildrenOf(pid)

    return direct.flatMap((child) => [child, ...Entrypoint.#descendantsOf(child)])
  }

  static #directChildrenOf(pid: number): number[] {
    try {
      return execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .map(Number)
    } catch {
      return []
    }
  }

  static async killPid(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code === 'ESRCH') return
      throw failure
    }
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0)
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code === 'ESRCH') return
        throw failure
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`fixture process ${pid} did not exit within 5000ms`)
  }

  static refused(environment: NodeJS.ProcessEnv): Promise<Refusal> {
    const child = spawn(process.execPath, [Entrypoint.#PATH], {
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    Entrypoint.#spawned.push(child)
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })

    return new Promise<Refusal>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`it never exited, and said ${JSON.stringify(stderr)}`)), Entrypoint.#TIMEOUT_MS)
      child.once('close', (status) => {
        clearTimeout(timer)
        resolve({ status, said: stderr.split('\n') })
      })
      child.once('error', reject)
    })
  }

  static async listening(environment: NodeJS.ProcessEnv): Promise<number> {
    return (await Entrypoint.#started(environment)).port
  }

  static async makeStart(environment: NodeJS.ProcessEnv): Promise<number> {
    const child = spawn('make', ['--silent', 'start'], {
      cwd: Entrypoint.#ROOT,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    Entrypoint.#spawned.push(child)
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    return new Promise<number>((resolve, reject) => {
      let stdout = ''
      const timer = setTimeout(() => reject(new Error(`make start did not print a port: ${stderr}`)), Entrypoint.#TIMEOUT_MS)
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
        const line = stdout.split('\n').find((candidate) => candidate.startsWith('{"port":'))
        if (line === undefined) return
        clearTimeout(timer)
        resolve((JSON.parse(line) as { port: number }).port)
      })
      child.once('error', reject)
      child.once('close', (code) => reject(new Error(`make start exited ${String(code)}: ${stderr}`)))
    })
  }

  static async makeRunBackendCommand(claudeConfigDirectory?: string): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), 'ct-api-make-run-backend-'))
    const environment = { ...process.env }
    delete environment.CLAUDE_CONFIG_DIR
    delete environment.MAKEFLAGS
    delete environment.MAKEOVERRIDES
    const argv = [
      '--dry-run', '-f', join(Entrypoint.#ROOT, 'Makefile'),
      'CT_API_PORT=8787', 'CT_HARVEST_BQ_TABLE=',
    ]
    if (claudeConfigDirectory !== undefined) argv.push(`CLAUDE_CONFIG_DIR=${claudeConfigDirectory}`)
    argv.push('run-backend')
    try {
      const output = execFileSync('make', argv, {
        cwd, env: environment, encoding: 'utf8', timeout: Entrypoint.#TIMEOUT_MS,
      })
      const command = output.split('\n').find((line) => line.includes('node backend/src/infrastructure/ct-api.ts'))
      if (command === undefined) throw new Error(`make run-backend did not print the backend invocation: ${output}`)
      return command
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }

  static async #started(environment: NodeJS.ProcessEnv): Promise<Started> {
    const child = spawn(process.execPath, [Entrypoint.#PATH], {
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    Entrypoint.#spawned.push(child)
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })

    return new Promise<Started>((resolve, reject) => {
      let stdout = ''
      const timer = setTimeout(() => reject(new Error(`no port line in ${stdout}`)), Entrypoint.#TIMEOUT_MS)
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
        const end = stdout.indexOf('\n')
        if (end === -1) return
        clearTimeout(timer)
        resolve({ port: (JSON.parse(stdout.slice(0, end)) as { port: number }).port, saidLater: () => stderr })
      })
      child.once('error', reject)
    })
  }

  static async recovering(environment: NodeJS.ProcessEnv): Promise<Started> {
    const started = await Entrypoint.#started(environment)
    for (let waited = 0; waited < 60; waited += 1) {
      if (started.saidLater().includes('plans in flight:')) break
      await new Promise((wake) => setTimeout(wake, 100))
    }

    return started
  }
}

class ACheckoutReachableByTwoPaths {
  static readonly ISSUE = 33
  static readonly REPOSITORY = 'acme/widget'
  static readonly TITLE = `ct-plan-acme__widget-issue-${ACheckoutReachableByTwoPaths.ISSUE}`

  static #git(cwd: string, ...argv: string[]): void {
    execFileSync('git', argv, { cwd, stdio: 'ignore' })
  }

  static async cut(): Promise<{ base: string, logical: string, physical: string }> {
    const base = await mkdtemp(join(tmpdir(), 'ct-api-two-paths-'))
    const physical = join(base, 'physical')
    await mkdir(physical, { recursive: true })
    const clone = join(physical, 'repo')
    await mkdir(clone, { recursive: true })
    ACheckoutReachableByTwoPaths.#git(clone, 'init', '-q')
    ACheckoutReachableByTwoPaths.#git(clone, 'config', 'user.email', 'smoke@test')
    ACheckoutReachableByTwoPaths.#git(clone, 'config', 'user.name', 'smoke')
    ACheckoutReachableByTwoPaths.#git(clone, 'remote', 'add', 'origin', 'git@github.com:acme/widget.git')
    ACheckoutReachableByTwoPaths.#git(clone, 'commit', '-q', '--allow-empty', '-m', 'base')
    ACheckoutReachableByTwoPaths.#git(clone, 'branch', '-M', 'main')
    ACheckoutReachableByTwoPaths.#git(
      clone, 'worktree', 'add', '-q', '-b', `feat/${ACheckoutReachableByTwoPaths.ISSUE}`,
      join('.worktrees', String(ACheckoutReachableByTwoPaths.ISSUE)), 'main'
    )
    execFileSync('ln', ['-s', 'physical', join(base, 'logical')], { stdio: 'ignore' })

    return {
      base,
      logical: join(base, 'logical', 'repo'),
      physical: realpathSync(clone),
    }
  }
}

class ExternalTools {
  static readonly DESTINATION = 'fixture-project:fixture_dataset.fixture_table'
}

class RunFileFixture {
  static readonly ISSUE = 7

  static async inATemporaryRoot(step: string = 'implement'): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'ct-api-progress-'))
    const worktree = join(root, '.worktrees', String(RunFileFixture.ISSUE))
    await mkdir(join(worktree, '.agent'), { recursive: true })
    await writeFile(join(worktree, '.agent', `run-${RunFileFixture.ISSUE}.json`), JSON.stringify({
      plan: 'plan.md',
      issue: RunFileFixture.ISSUE,
      task: 1,
      tasksTotal: 1,
      step,
      controlRetries: 0,
      judgeRetries: 0,
      correctionRetries: 0,
      discards: 0,
    }, null, 2) + '\n')

    return root
  }

  static async remove(root: string): Promise<void> {
    await rm(root, { recursive: true, force: true })
  }
}

class AClaudeThatStaysOpen {
  static readonly SCRIPT = ['#!/bin/sh', 'exec sleep 120'].join('\n')

  static async onThePath(): Promise<{ directory: string, path: string }> {
    const directory = await mkdtemp(join(tmpdir(), 'ct-api-claude-'))
    await writeFile(join(directory, 'claude'), `${AClaudeThatStaysOpen.SCRIPT}\n`, { mode: 0o755 })

    return { directory, path: `${directory}:${process.env.PATH}` }
  }
}

class LifecycleFixture {
  static readonly REPOSITORY = 'acme/widget'
  static readonly READY = 'FAKE_CLAUDE_READY'
  static readonly INPUT = 'typed-through-the-api'
  static readonly #roots: string[] = []
  static readonly #processes: ChildProcess[] = []

  readonly base: string
  readonly checkout: string
  readonly config: string
  readonly bin: string
  readonly launches: string
  readonly inputs: string
  readonly pids: string

  private constructor({ base, checkout, config, bin, launches, inputs, pids }: {
    base: string, checkout: string, config: string, bin: string, launches: string, inputs: string, pids: string,
  }) {
    this.base = base
    this.checkout = checkout
    this.config = config
    this.bin = bin
    this.launches = launches
    this.inputs = inputs
    this.pids = pids
  }

  static async prepared(): Promise<LifecycleFixture> {
    const base = await mkdtemp(join(tmpdir(), 'ct-api-lifecycle-'))
    LifecycleFixture.#roots.push(base)
    const checkout = join(base, 'checkout')
    const config = join(base, 'config')
    const bin = join(base, 'bin')
    const launches = join(base, 'launches.ndjson')
    const inputs = join(base, 'inputs.txt')
    const pids = join(base, 'pids.txt')
    await Promise.all([mkdir(checkout), mkdir(config), mkdir(bin)])
    LifecycleFixture.#git(checkout, 'init', '-q')
    LifecycleFixture.#git(checkout, 'config', 'user.email', 'lifecycle@test')
    LifecycleFixture.#git(checkout, 'config', 'user.name', 'Lifecycle Fixture')
    LifecycleFixture.#git(checkout, 'remote', 'add', 'origin', 'git@github.com:acme/widget.git')
    await writeFile(join(checkout, 'sentinel.txt'), 'committed sentinel\n')
    LifecycleFixture.#git(checkout, 'add', 'sentinel.txt')
    LifecycleFixture.#git(checkout, 'commit', '-q', '-m', 'fixture baseline')
    await writeFile(join(checkout, 'sentinel.txt'), 'dirty sentinel must survive\n')
    await writeFile(join(checkout, 'untracked.txt'), 'untracked work must survive\n')
    await writeFile(join(bin, 'claude'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      "fs.appendFileSync(process.env.CT_LIFECYCLE_LAUNCHES, JSON.stringify(process.argv.slice(2)) + '\\n')",
      "fs.appendFileSync(process.env.CT_LIFECYCLE_PIDS, String(process.pid) + '\\n')",
      `process.stdout.write('${LifecycleFixture.READY}\\n')`,
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', (text) => fs.appendFileSync(process.env.CT_LIFECYCLE_INPUTS, text))",
      'setInterval(() => {}, 1000)',
    ].join('\n') + '\n', { mode: 0o755 })
    await writeFile(join(bin, 'fixture-shell'), [
      '#!/bin/sh',
      'while [ "$#" -gt 1 ]; do shift; done',
      'exec /bin/sh -c "$1"',
    ].join('\n') + '\n', { mode: 0o755 })

    return new LifecycleFixture({ base, checkout, config, bin, launches, inputs, pids })
  }

  environment(): NodeJS.ProcessEnv {
    return {
      CT_API_PORT: '0',
      CLAUDE_CONFIG_DIR: this.config,
      SHELL: join(this.bin, 'fixture-shell'),
      PATH: `${this.bin}:${process.env.PATH}`,
      CT_LIFECYCLE_LAUNCHES: this.launches,
      CT_LIFECYCLE_INPUTS: this.inputs,
      CT_LIFECYCLE_PIDS: this.pids,
    }
  }

  unrelatedProcess(): ChildProcess {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    LifecycleFixture.#processes.push(child)
    return child
  }

  async recordTranscript(conversation: string): Promise<void> {
    const folder = ClaudeCodeTranscript.folderFor(this.checkout)
    const directory = join(this.config, ClaudeCodeTranscript.FOLDER, folder)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, `${conversation}${ClaudeCodeTranscript.EXTENSION}`), '{"type":"user"}\n')
  }

  async launchCount(): Promise<number> {
    try {
      return (await readFile(this.launches, 'utf8')).trim().split('\n').filter((line) => line !== '').length
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw failure
    }
  }

  checkoutSnapshot(): { sentinel: string, status: string, diff: string } {
    return {
      sentinel: readFileSync(join(this.checkout, 'sentinel.txt'), 'utf8'),
      status: execFileSync('git', ['-C', this.checkout, 'status', '--porcelain=v1'], { encoding: 'utf8' }),
      diff: execFileSync('git', ['-C', this.checkout, 'diff', '--binary'], { encoding: 'utf8' }),
    }
  }

  static async cleanAll(): Promise<void> {
    const pids = LifecycleFixture.#processes.splice(0)
      .map((child) => child.pid)
      .filter((pid): pid is number => pid !== undefined)
    for (const root of LifecycleFixture.#roots) {
      try {
        pids.push(...(await readFile(join(root, 'pids.txt'), 'utf8'))
          .split('\n').filter((line) => line !== '').map(Number))
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure
      }
    }
    await Promise.all([...new Set(pids)].map((pid) => Entrypoint.killPid(pid)))
    await Promise.all(LifecycleFixture.#roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  }

  static #git(cwd: string, ...argv: string[]): void {
    execFileSync('git', argv, { cwd, stdio: 'ignore' })
  }
}

class ARecordedConversation {
  static readonly ID = '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'
  static readonly REPOSITORY = 'acme/widget'

  static async withATranscriptUnder(config: string): Promise<{ config: string, checkout: string }> {
    const checkout = await ARecordedConversation.#recordedUnder(config)
    const folder = ClaudeCodeTranscript.folderFor(checkout)
    const transcript = join(config, ClaudeCodeTranscript.FOLDER, folder)
    await mkdir(transcript, { recursive: true })
    await writeFile(join(transcript, `${ARecordedConversation.ID}${ClaudeCodeTranscript.EXTENSION}`), '{"type":"user"}\n')

    return { config, checkout }
  }

  static async withNoTranscriptAnywhere(config: string): Promise<{ config: string, checkout: string }> {
    return { config, checkout: await ARecordedConversation.#recordedUnder(config) }
  }

  static async #recordedUnder(config: string): Promise<string> {
    const checkout = await mkdtemp(join(tmpdir(), 'ct-api-coordinating-checkout-'))
    const recorded = join(config, 'control-tower', 'coordinating-session')
    await mkdir(recorded, { recursive: true })
    await writeFile(join(recorded, 'conversation.json'), `${JSON.stringify({
      conversation: ARecordedConversation.ID,
      repo: ARecordedConversation.REPOSITORY,
      root: checkout,
    }, null, 2)}\n`)

    return checkout
  }
}

class TheCoordinatingSession {
  static readonly #TRIES = 100
  static readonly #WAIT_MS = 100

  static async recoveredBy(port: number): Promise<{ status: string }> {
    for (let tried = 0; tried < TheCoordinatingSession.#TRIES; tried += 1) {
      const answered = await (await fetch(`http://127.0.0.1:${port}/coordinating-session`)).json() as { status: string }
      if (answered.status !== 'none') return answered
      await new Promise((wake) => setTimeout(wake, TheCoordinatingSession.#WAIT_MS))
    }
    throw new Error('the recorded conversation was never recovered')
  }
}

class TheCoordinatingSessionEndpoint {
  static readonly COMMENT = 'explore the checkout screen'

  static open(port: number, repository: string, checkout: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/coordinating-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_comment: TheCoordinatingSessionEndpoint.COMMENT,
        repo: repository,
        path: checkout,
      }),
    })
  }

  static async brainstormingsOf(port: number): Promise<number> {
    const listed = await (await fetch(`http://127.0.0.1:${port}/sessions`)).json() as
      { sessions: { name: string }[] }

    return listed.sessions.filter((session) => session.name === 'brainstorming').length
  }

  static close(port: number, conversation: string, target: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/coordinating-session/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation, target }),
    })
  }

  static type(port: number, session: string, text: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/sessions/${session}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  }

  static async waitsForOutput(port: number, session: string, token: string): Promise<void> {
    const response = await fetch(`http://127.0.0.1:${port}/sessions/${session}/stream`)
    const reader = response.body!.getReader()
    let received = ''
    try {
      for (let read = 0; read < 20 && !received.includes(token); read += 1) {
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('session output timed out')), 5_000)),
        ])
        if (next.done) break
        received += Buffer.from(next.value).toString('utf8')
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    if (!received.includes(token)) throw new Error(`session output did not contain ${JSON.stringify(token)}`)
  }
}

class ActualHeadlessRuntime {
  static readonly REPOSITORY = 'acme/widget'
  static readonly MILESTONE = 'Fixture milestone'
  static readonly COORDINATOR = '22222222-2222-4222-8222-222222222222'
  static readonly WRONG_AGENT = '33333333-3333-4333-8333-333333333333'
  static readonly ISSUE_BODY_UNITS = ToolRunner.PIPE_BUFFER_BYTES * 32
  static readonly #WAIT_TRIES = 100
  static readonly #WAIT_MS = 100

  readonly root: string
  readonly state: string
  readonly bin: string
  readonly captures: string
  readonly specSha: string

  constructor(asked: { root: string, state: string, bin: string, captures: string, specSha: string }) {
    this.root = asked.root
    this.state = asked.state
    this.bin = asked.bin
    this.captures = asked.captures
    this.specSha = asked.specSha
  }

  static async prepared(): Promise<ActualHeadlessRuntime> {
    const base = await mkdtemp(join(tmpdir(), 'ct-api-headless-runtime-'))
    const root = join(base, 'checkout')
    const state = join(base, 'config')
    const bin = join(base, 'bin')
    const captures = join(base, 'captures')
    await Promise.all([mkdir(root), mkdir(state), mkdir(bin), mkdir(captures)])
    ActualHeadlessRuntime.#git(root, 'init', '-q')
    ActualHeadlessRuntime.#git(root, 'config', 'user.email', 'fixture@example.test')
    ActualHeadlessRuntime.#git(root, 'config', 'user.name', 'Fixture')
    await mkdir(join(root, 'docs', 'superpowers', 'specs'), { recursive: true })
    await writeFile(join(root, 'AGENTS.md'), '# Fixture\n')
    await writeFile(join(root, 'docs', 'superpowers', 'specs', '2026-01-01-fixture-execution.md'), ActualHeadlessRuntime.#spec())
    ActualHeadlessRuntime.#git(root, 'add', '.')
    ActualHeadlessRuntime.#git(root, 'commit', '-q', '-m', 'fixture baseline')
    ActualHeadlessRuntime.#git(root, 'branch', '-M', 'main')
    ActualHeadlessRuntime.#git(root, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git')
    ActualHeadlessRuntime.#git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    ActualHeadlessRuntime.#git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    const specSha = execFileSync('git', [
      '-C', root, 'hash-object', 'docs/superpowers/specs/2026-01-01-fixture-execution.md',
    ], { encoding: 'utf8' }).trim()
    await ActualHeadlessRuntime.#executables(bin)
    await ActualHeadlessRuntime.#coordinator(state, root)
    return new ActualHeadlessRuntime({ root, state, bin, captures, specSha })
  }

  environment(): NodeJS.ProcessEnv {
    return {
      CT_API_PORT: '0',
      CLAUDE_CONFIG_DIR: this.state,
      SHELL: '/bin/sh',
      PATH: `${this.bin}:${process.env.PATH}`,
      CT_REAL_GIT: execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(),
      CT_FIXTURE_CAPTURES: this.captures,
      CT_FIXTURE_SPEC_SHA: this.specSha,
    }
  }

  async launches(): Promise<RecordedLaunch[]> {
    for (let tried = 0; tried < ActualHeadlessRuntime.#WAIT_TRIES; tried += 1) {
      const names = await readdir(this.captures)
      if (names.length === 2) return await this.#recorded(names)
      await new Promise((resolve) => setTimeout(resolve, ActualHeadlessRuntime.#WAIT_MS))
    }
    throw new Error('the two plan launches were not captured before the deadline')
  }

  launchFor(started: StartedPlan, launches: RecordedLaunch[]): RecordedLaunch {
    const matching = launches.filter((launch) => launch.issue === started.issue.number)
    if (matching.length !== 1) {
      throw new Error(`expected one plan launch for issue ${started.issue.number}, got ${matching.length}`)
    }
    const launch = matching[0]
    const sessionAt = launch.captured.argv.indexOf('--session-id')
    const launchedAgent = launch.captured.argv[sessionAt + 1]
    if (sessionAt < 0 || launchedAgent !== started.agent || launch.agent !== started.agent
      || launch.call.conversation !== started.agent) {
      throw new Error(`launch identity differs from response agent ${started.agent}`)
    }
    if (launch.call.purpose !== 'plan' || launch.call.argv.join('\0') !== launch.captured.argv.join('\0')
      || launch.captured.prompt !== launch.promptPath || launch.prompt.length === 0) {
      throw new Error(`launch evidence differs from the recorded plan call for ${started.agent}`)
    }
    return launch
  }

  async remove(): Promise<void> {
    await rm(dirname(this.root), { recursive: true, force: true })
  }

  async #recorded(names: string[]): Promise<RecordedLaunch[]> {
    const harness = join(this.state, 'control-tower', 'harness')
    const launches: RecordedLaunch[] = []
    for (const name of names) {
      const captured = JSON.parse(await readFile(join(this.captures, name), 'utf8')) as CapturedLaunch
      const agent = name.replace(/\.json$/, '')
      const dispatch = JSON.parse(await readFile(join(harness, agent, 'dispatch.json'), 'utf8')) as { issue: { number: number } }
      const callsRoot = join(harness, agent, 'calls')
      const callNames = await readdir(callsRoot)
      if (callNames.length !== 1) throw new Error(`expected one recorded call for ${agent}, got ${callNames.length}`)
      const callRoot = join(callsRoot, callNames[0])
      launches.push({
        agent,
        issue: dispatch.issue.number,
        call: JSON.parse(await readFile(join(callRoot, 'call.json'), 'utf8')) as RecordedLaunch['call'],
        promptPath: join(callRoot, 'prompt.md'),
        prompt: await readFile(join(callRoot, 'prompt.md'), 'utf8'),
        captured,
      })
    }
    return launches
  }

  static #git(cwd: string, ...argv: string[]): void {
    execFileSync('git', argv, { cwd, stdio: 'ignore' })
  }

  static #spec(): string {
    return [
      '# Fixture milestone — Execution spec',
      '',
      '**Fecha de congelación:** 2026-09-16',
      '**Estado:** CONGELADA',
      '',
      '## Hipótesis del experimento',
      '',
      '**The bet:** the fixture proves both entrances.',
      '',
      '**How we will know it failed:** either entrance does not launch.',
      '',
      '**Anti-scope — what this epic does NOT do:** no network calls.',
      '',
      '## Decisiones congeladas',
      '',
      '- **D-1 · Fixture decision** — both entrances use recorded calls.',
      '  *(Procedencia: hablada — fixture contract.)*',
      '',
      '## Tabla de slices',
      '',
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Señal |',
      '|---|-------|------|---------|-----|--------|-----------|------|------|------|-------|',
      '| 1 | Fixture slice | backend | fixture delivery | – | fixture accepted | – | fixture | backend | !plan | fixture signal |',
      '',
    ].join('\n')
  }

  static async #coordinator(state: string, root: string): Promise<void> {
    const recorded = join(state, 'control-tower', 'coordinating-session')
    await mkdir(recorded, { recursive: true })
    await writeFile(join(recorded, 'conversation.json'), `${JSON.stringify({
      conversation: ActualHeadlessRuntime.COORDINATOR,
      repo: ActualHeadlessRuntime.REPOSITORY,
      root,
    }, null, 2)}\n`)
    const transcript = join(state, ClaudeCodeTranscript.FOLDER, ClaudeCodeTranscript.folderFor(root))
    await mkdir(transcript, { recursive: true })
    await writeFile(join(transcript, `${ActualHeadlessRuntime.COORDINATOR}${ClaudeCodeTranscript.EXTENSION}`), '{"type":"user"}\n')
  }

  static async #executables(bin: string): Promise<void> {
    await writeFile(join(bin, 'git'), [
      '#!/bin/sh',
      'if [ "$3" = "fetch" ]; then exit 0; fi',
      'exec "$CT_REAL_GIT" "$@"',
    ].join('\n') + '\n', { mode: 0o755 })
    await writeFile(join(bin, 'claude'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      "const path = require('node:path')",
      'const argv = process.argv.slice(2)',
      "if (argv[0] === '-p') {",
      "  const at = argv.indexOf('--session-id')",
      '  const id = argv[at + 1]',
      "  fs.writeFileSync(path.join(process.env.CT_FIXTURE_CAPTURES, `${id}.json`), JSON.stringify({ argv, prompt: process.env.CT_CALL_PROMPT }))",
      '}',
      'setInterval(() => {}, 1000)',
    ].join('\n') + '\n', { mode: 0o755 })
    await writeFile(join(bin, 'gh'), [
      '#!/usr/bin/env node',
      'const argv = process.argv.slice(2)',
      `const issue = { number: 42, html_url: 'https://github.com/acme/widget/issues/42', title: '#1 Fixture slice', body: 'x'.repeat(${ActualHeadlessRuntime.ISSUE_BODY_UNITS}) + '\\n<!-- ct-order:1 -->', milestone: { number: 1, title: 'Fixture milestone' }, labels: [{ name: 'status:ready' }] }`,
      "if (argv[0] === 'issue' && argv[1] === 'create') console.log('https://github.com/acme/widget/issues/41')",
      "else if (argv[0] === 'issue' && argv[1] === 'view') { const number = Number(argv[2]); console.log(JSON.stringify({ number, title: number === 42 ? '#1 Fixture slice' : 'Loose fixture', body: '<!-- ct-order:1 -->', labels: [{ name: 'status:ready' }], milestone: number === 42 ? { title: 'Fixture milestone' } : null })) }",
      "else if (argv[0] === 'issue' && argv[1] === 'list') console.log(JSON.stringify([{ number: 42, url: issue.html_url, title: issue.title, labels: issue.labels, state: 'OPEN', body: '<!-- ct-order:1 -->' }]))",
      "else if (argv[0] === 'api' && argv[1].includes('/contents/')) console.log(JSON.stringify({ sha: process.env.CT_FIXTURE_SPEC_SHA }))",
      "else if (argv[0] === 'api' && argv[1] === 'repos/acme/widget/issues') console.log(JSON.stringify(argv.includes('state=closed') ? [[]] : [[issue]]))",
      "else console.log('{}')",
    ].join('\n') + '\n', { mode: 0o755 })
  }
}

describe('ct-api entrypoint', () => {
  afterEach(async () => {
    await Entrypoint.killAll()
    await LifecycleFixture.cleanAll()
  })

  it('a session can be closed and replaced and stays closed after backend restart', async () => {
    const fixture = await LifecycleFixture.prepared()
    const unrelated = fixture.unrelatedProcess()
    const environment = fixture.environment()
    const firstPort = await Entrypoint.listening(environment)

    const opened = await TheCoordinatingSessionEndpoint.open(
      firstPort, LifecycleFixture.REPOSITORY, fixture.checkout
    )
    expect(opened.status).toBe(202)
    const first = await opened.json() as {
      conversation: string, target: string, session: { id: string },
    }
    await expect.poll(() => fixture.launchCount()).toBe(1)
    await TheCoordinatingSessionEndpoint.waitsForOutput(firstPort, first.session.id, LifecycleFixture.READY)
    expect(await TheCoordinatingSessionEndpoint.type(
      firstPort, first.session.id, `${LifecycleFixture.INPUT}\r`
    )).toHaveProperty('status', 202)
    await expect.poll(async () => {
      try {
        return (await readFile(fixture.inputs, 'utf8')).includes(LifecycleFixture.INPUT)
      } catch {
        return false
      }
    }).toBe(true)
    await fixture.recordTranscript(first.conversation)
    const beforeClose = fixture.checkoutSnapshot()

    const closed = await TheCoordinatingSessionEndpoint.close(firstPort, first.conversation, first.target)

    expect(closed.status).toBe(200)
    expect(await closed.json()).toEqual({
      status: 'closed', conversation: first.conversation, target: first.target,
    })
    expect(await (await fetch(`http://127.0.0.1:${firstPort}/coordinating-session`)).json()).toEqual({
      status: 'none', operation: 'idle',
    })
    expect(await TheCoordinatingSessionEndpoint.brainstormingsOf(firstPort)).toBe(0)
    expect(await (await fetch(`http://127.0.0.1:${firstPort}/spec-freeze`)).json()).toEqual({ status: 'none' })
    expect(await (await fetch(`http://127.0.0.1:${firstPort}/epic-groom`)).json()).toEqual({ status: 'none' })
    expect(fixture.checkoutSnapshot()).toEqual(beforeClose)
    expect(unrelated.exitCode).toBeNull()
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow()

    const sameBackendReplacement = await TheCoordinatingSessionEndpoint.open(
      firstPort, LifecycleFixture.REPOSITORY, fixture.checkout
    )
    expect(sameBackendReplacement.status).toBe(202)
    const second = await sameBackendReplacement.json() as {
      conversation: string, target: string, session: { id: string },
    }
    expect(second.conversation).not.toBe(first.conversation)
    expect(second.target).not.toBe(first.target)
    await expect.poll(() => fixture.launchCount()).toBe(2)
    await TheCoordinatingSessionEndpoint.waitsForOutput(firstPort, second.session.id, LifecycleFixture.READY)
    expect((await TheCoordinatingSessionEndpoint.close(firstPort, second.conversation, second.target)).status).toBe(200)

    await Entrypoint.killAll()
    const restartedPort = await Entrypoint.listening(environment)
    await expect.poll(async () => {
      return await (await fetch(`http://127.0.0.1:${restartedPort}/coordinating-session`)).json()
    }).toEqual({ status: 'none', operation: 'idle' })
    expect(await fixture.launchCount()).toBe(2)

    const replacementAfterRestart = await TheCoordinatingSessionEndpoint.open(
      restartedPort, LifecycleFixture.REPOSITORY, fixture.checkout
    )
    expect(replacementAfterRestart.status).toBe(202)
    const third = await replacementAfterRestart.json() as { conversation: string, target: string }
    expect(third.conversation).not.toBe(second.conversation)
    expect(third.target).not.toBe(second.target)
    await expect.poll(() => fixture.launchCount()).toBe(3)
    expect(fixture.checkoutSnapshot()).toEqual(beforeClose)
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow()
  }, 60_000)

  it('the_recovery_reads_the_transcript_under_the_configured_claude_directory', async () => {
    const config = await mkdtemp(join(tmpdir(), 'ct-api-coordinating-config-'))
    const recorded = await ARecordedConversation.withATranscriptUnder(config)
    const claude = await AClaudeThatStaysOpen.onThePath()

    const port = await Entrypoint.listening({
      CT_API_PORT: '0', CLAUDE_CONFIG_DIR: config, SHELL: '/bin/sh', PATH: claude.path,
    })

    expect((await TheCoordinatingSession.recoveredBy(port)).status).not.toBe('unresumable')
    await RunFileFixture.remove(config)
    await RunFileFixture.remove(recorded.checkout)
    await RunFileFixture.remove(claude.directory)
  }, 60_000)

  it('a_recorded_conversation_with_no_transcript_at_all_is_not_resumed', async () => {
    const config = await mkdtemp(join(tmpdir(), 'ct-api-coordinating-config-'))
    const recorded = await ARecordedConversation.withNoTranscriptAnywhere(config)
    const claude = await AClaudeThatStaysOpen.onThePath()

    const port = await Entrypoint.listening({
      CT_API_PORT: '0', CLAUDE_CONFIG_DIR: config, SHELL: '/bin/sh', PATH: claude.path,
    })

    expect((await TheCoordinatingSession.recoveredBy(port)).status).toBe('unresumable')
    await RunFileFixture.remove(config)
    await RunFileFixture.remove(recorded.checkout)
    await RunFileFixture.remove(claude.directory)
  }, 60_000)

  it('two_openings_fired_at_once_open_a_single_conversation', async () => {
    const checkout = await ACheckoutReachableByTwoPaths.cut()
    const config = await mkdtemp(join(tmpdir(), 'ct-api-coordinating-race-'))
    const claude = await AClaudeThatStaysOpen.onThePath()
    const port = await Entrypoint.listening({
      CT_API_PORT: '0', CLAUDE_CONFIG_DIR: config, SHELL: '/bin/sh', PATH: claude.path,
    })

    const answered = await Promise.all([
      TheCoordinatingSessionEndpoint.open(port, ACheckoutReachableByTwoPaths.REPOSITORY, checkout.physical),
      TheCoordinatingSessionEndpoint.open(port, ACheckoutReachableByTwoPaths.REPOSITORY, checkout.physical),
    ])

    expect(answered.map((response) => response.status).sort()).toEqual([202, 409])
    expect(await TheCoordinatingSessionEndpoint.brainstormingsOf(port)).toBe(1)
    await Entrypoint.killAll()
    await RunFileFixture.remove(checkout.base)
    await RunFileFixture.remove(config)
    await RunFileFixture.remove(claude.directory)
  }, 60_000)

  it('prints_the_port_it_bound_so_whoever_started_it_knows_where_to_knock', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    expect(port).toBeGreaterThan(0)
  })

  it('existing entrypoints start without an activation setting', async () => {
    const state = await mkdtemp(join(tmpdir(), 'ct-api-entrypoint-settings-'))
    try {
      const port = await Entrypoint.makeStart({
        CT_API_PORT: '0', CLAUDE_CONFIG_DIR: state, CT_HARVEST_BQ_TABLE: '', SHELL: '/bin/sh',
      })

      expect(port).toBeGreaterThan(0)
    } finally {
      Entrypoint.killAll()
      await RunFileFixture.remove(state)
    }
  }, 60_000)

  it('run-backend omits an absent Claude configuration directory', async () => {
    const command = await Entrypoint.makeRunBackendCommand()

    expect(command).toBe('CT_API_PORT=8787  CT_HARVEST_BQ_TABLE= node backend/src/infrastructure/ct-api.ts')
  })

  it('run-backend preserves an explicitly configured Claude directory', async () => {
    const command = await Entrypoint.makeRunBackendCommand('/tmp/ct-explicit-config')

    expect(command).toBe(
      'CT_API_PORT=8787 CLAUDE_CONFIG_DIR=/tmp/ct-explicit-config CT_HARVEST_BQ_TABLE= node backend/src/infrastructure/ct-api.ts',
    )
  })

  it('a_freshly_started_backend_lists_no_session_because_nothing_has_been_asked_of_it_yet', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0', SHELL: '/bin/sh' })

    const listed = await (await fetch(`http://127.0.0.1:${port}/sessions`)).json() as
      { sessions: { name: string }[] }

    expect(listed.sessions).toEqual([])
  })

  it('a_bad_invocation_is_refused_with_the_reason_and_a_usage_line_that_names_the_command_the_documentation_starts_the_backend_with', async () => {
    const refusal = await Entrypoint.refused({ CT_API_PORT: 'a fistful of ports' })

    expect(refusal.status).toBe(2)
    expect(refusal.said[0]).toContain('CT_API_PORT')
    expect(refusal.said[1]).toMatch(/^usage: make run-backend \(no arguments;/)
  })

  it('a_whole_request_to_external_tools_reaches_every_probe_client_the_entrypoint_wired_up', async () => {
    const port = await Entrypoint.listening({
      CT_API_PORT: '0', CT_HARVEST_BQ_TABLE: ExternalTools.DESTINATION,
    })

    const response = await fetch(`http://127.0.0.1:${port}/external-tools`)

    expect(response.status).toBe(200)
    const body = await response.json() as SurveyedTools
    expect(body.tools.map((row) => row.tool)).toEqual(['gh', 'acli', 'claude', 'git', 'bq'])
    expect(body.tools.every((row) => ['ready', 'missing', 'unknown'].includes(row.session))).toBe(true)
    const claude = body.tools.find((row) => row.tool === 'claude') as ToolRow
    expect(claude.session).toBe('unknown')
    expect(claude.fix).toBe('claude, then /login — not observable from this process')
    expect(body.metricsDelivery).toEqual({
      enabled: true,
      variable: 'CT_HARVEST_BQ_TABLE',
      destination: ExternalTools.DESTINATION,
    })
  }, 600_000)

  it('without_the_harvest_table_the_entrypoint_answers_a_disabled_delivery_read_from_the_startup_configuration', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0', CT_HARVEST_BQ_TABLE: '' })

    const response = await fetch(`http://127.0.0.1:${port}/external-tools`)

    const body = await response.json() as SurveyedTools
    expect(body.metricsDelivery).toEqual({
      enabled: false, variable: 'CT_HARVEST_BQ_TABLE', destination: null,
    })
  }, 600_000)

  it('a_whole_request_reaches_acli_so_a_typo_in_the_key_that_wires_the_user_stories_would_show_up_here_and_not_only_in_the_first_real_use', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    const response = await Entrypoint.startPlan(
      port,
      `{"id":"ZZZ-999999","repo":${JSON.stringify(HostCheckout.repository())},"path":${JSON.stringify(HostCheckout.path())}}`
    )

    expect(response.status).toBe(400)
    const body = await response.json() as Failure
    expect(body.code).toBe('user-story-not-read')
    expect(body.detail).toMatch(/^acli jira failed: /)
  })

  it('a_whole_request_reaches_gh_so_a_typo_in_the_url_that_wires_the_user_stories_would_show_up_here_and_not_only_in_the_first_real_use', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    const response = await Entrypoint.startPlan(
      port,
      `{"id":"https://github.com/mercadona/control-tower/issues/999999999",` +
        `"repo":${JSON.stringify(HostCheckout.repository())},"path":${JSON.stringify(HostCheckout.path())}}`
    )

    expect(response.status).toBe(400)
    const body = await response.json() as Failure
    expect(body.code).toBe('user-story-not-read')
    expect(body.detail).toMatch(/^gh issue view failed: /)
  })

  it('the_progress_of_a_slice_is_served_by_the_running_api', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })
    const root = await RunFileFixture.inATemporaryRoot()

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/implement-progress/${RunFileFixture.ISSUE}?root=${encodeURIComponent(root)}&repo=owner%2Fname`
      )

      expect(response.status).toBe(200)
      const body = await response.json() as
        { step: string, task: number, total_tasks: number, attempt: number }
      expect(body.step).toBe('implement')
      expect(body.task).toBe(1)
      expect(body.total_tasks).toBe(1)
      expect(body.attempt).toBe(1)
    } finally {
      await RunFileFixture.remove(root)
    }
  })

  it('a_slice_whose_second_veto_sent_it_to_the_adviser_is_served_as_that_step', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })
    const root = await RunFileFixture.inATemporaryRoot('advise')

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/implement-progress/${RunFileFixture.ISSUE}?root=${encodeURIComponent(root)}&repo=owner%2Fname`
      )

      expect(response.status).toBe(200)
      const body = await response.json() as { step: string, task: number }
      expect(body.step).toBe('advise')
      expect(body.task).toBe(1)
    } finally {
      await RunFileFixture.remove(root)
    }
  })

  it('plan_events_is_mounted_in_the_real_process_and_not_only_in_the_test_server', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    const response = await fetch(`http://127.0.0.1:${port}/plan-events/54?repo=jjponz%2Frepo-pulse`)

    expect(response.status).toBe(400)
    expect((await response.json() as Failure).code).toBe('not-watched')
  })

  it('a_whole_request_to_spec_freeze_reaches_the_wiring_the_entrypoint_built', async () => {
    const state = await mkdtemp(join(tmpdir(), 'ct-api-spec-freeze-'))
    const port = await Entrypoint.listening({ CT_API_PORT: '0', CLAUDE_CONFIG_DIR: state })

    const response = await fetch(`http://127.0.0.1:${port}/spec-freeze`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'none' })
    await RunFileFixture.remove(state)
  })

  it('a started backend answers gate 2 with no session held', async () => {
    const state = await mkdtemp(join(tmpdir(), 'ct-api-epic-groom-'))
    const port = await Entrypoint.listening({ CT_API_PORT: '0', CLAUDE_CONFIG_DIR: state })

    const response = await fetch(`http://127.0.0.1:${port}/epic-groom`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'none' })
    await RunFileFixture.remove(state)
  })

  it('review_plan_is_no_longer_mounted_in_the_real_process', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    const response = await fetch(`http://127.0.0.1:${port}/review-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue: 33, repo: 'jjponz/repo-pulse', changes: 'parte la tarea 2' }),
    })

    expect(response.status).toBe(404)
    expect((await response.json() as Failure).code).toBe('not-found')
  })

  it('both entrances use recorded calls and the runtime constructs no go or window client', async () => {
    const runtime = await ActualHeadlessRuntime.prepared()
    try {
      const port = await Entrypoint.listening(runtime.environment())
      await TheCoordinatingSession.recoveredBy(port)
      const looseResponse = await Entrypoint.startPlan(port, JSON.stringify({
        user_comment: 'Plan the loose fixture', repo: ActualHeadlessRuntime.REPOSITORY, path: runtime.root,
      }))
      const milestoneResponse = await Entrypoint.startPlan(port, JSON.stringify({
        milestone: ActualHeadlessRuntime.MILESTONE,
      }))
      expect(looseResponse.status).toBe(202)
      const milestoneText = await milestoneResponse.text()
      expect(milestoneResponse.status, milestoneText).toBe(202)
      const loose = await looseResponse.json() as StartedPlan
      const milestone = JSON.parse(milestoneText) as StartedPlan
      const launches = await runtime.launches()
      expect(launches).toHaveLength(2)
      expect(ActualHeadlessRuntime.ISSUE_BODY_UNITS).toBeGreaterThan(ToolRunner.PIPE_BUFFER_BYTES)
      const looseLaunch = runtime.launchFor(loose, launches)
      runtime.launchFor(milestone, launches)
      const sessionAt = looseLaunch.captured.argv.indexOf('--session-id')
      const mutatedArgv = [...looseLaunch.captured.argv]
      mutatedArgv[sessionAt + 1] = ActualHeadlessRuntime.WRONG_AGENT
      const mutated = { ...looseLaunch, captured: { ...looseLaunch.captured, argv: mutatedArgv } }
      expect(() => runtime.launchFor(loose, launches.map((launch) => launch === looseLaunch ? mutated : launch)))
        .toThrow(/launch identity differs/)
    } finally {
      await Entrypoint.killAll()
      await runtime.remove()
    }
  }, 60_000)

  it('the runtime switch retains the retired implementation endpoint as not found', async () => {
    const state = await mkdtemp(join(tmpdir(), 'ct-api-retired-implementation-'))
    const go = join(state, 'control-tower', 'go')
    const requireGoAbsent = async (): Promise<void> => {
      try {
        await stat(go)
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code === 'ENOENT') return
        throw failure
      }
      throw new Error(`go exists at ${go}`)
    }
    try {
      const port = await Entrypoint.listening({ CT_API_PORT: '0', CLAUDE_CONFIG_DIR: state })
      const posted = await fetch(`http://127.0.0.1:${port}/implement-plan`, { method: 'POST' })
      const read = await fetch(`http://127.0.0.1:${port}/implement-plan`)

      expect(posted.status).toBe(404)
      expect(await posted.json()).toEqual({ code: 'not-found', detail: 'not found' })
      expect(read.status).toBe(404)
      expect(await read.json()).toEqual({ code: 'not-found', detail: 'not found' })
      await requireGoAbsent()
      await mkdir(go, { recursive: true })
      await expect(requireGoAbsent()).rejects.toThrow(`go exists at ${go}`)
      await rm(go, { recursive: true })
      await requireGoAbsent()
    } finally {
      await Entrypoint.killAll()
      await RunFileFixture.remove(state)
    }
  })
})
