import { execFileSync, spawn } from 'node:child_process'
import { issuesQueryFor } from '../../../../plugin/scripts/gh-issues.js'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClaudeCodeTranscript } from '../../../../plugin/scripts/claude-code-usage.js'
import { EpicSpec } from '../../../src/domain/value-objects/epic-spec.ts'
import { ToolRunner } from '../../../src/infrastructure/tool-runner.ts'

export type StartedEntrypoint = {
  port: number,
  pid: number,
  saidLater: () => string,
  descendants: () => number[],
  crash: () => Promise<void>,
}

export type Refusal = { status: number | null, said: string[] }
export type StartedPlan = { agent: string, issue: { number: number } }
export type ListedActivePlan = { plan: StartedPlan }
export type CapturedLaunch = { argv: string[], prompt: string, pid: number }
export type RecordedLaunch = {
  agent: string,
  issue: number,
  call: { conversation: string, purpose: string, argv: string[] },
  promptPath: string,
  prompt: string,
  captured: CapturedLaunch,
}

export class Entrypoint {
  static readonly #PATH = join(
    dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'infrastructure', 'ct-api.ts'
  )
  static readonly #ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
  static readonly #TIMEOUT_MS = 30_000
  static readonly #spawned: ChildProcess[] = []
  static readonly #configs: string[] = []

  static async isolated(environment: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
    let config = environment.CLAUDE_CONFIG_DIR
    if (config === undefined) {
      config = await mkdtemp(join(tmpdir(), 'ct-api-isolated-config-'))
      Entrypoint.#configs.push(config)
    }
    return { ...process.env, ...environment, CT_STATE_DIR: environment.CT_STATE_DIR, CLAUDE_CONFIG_DIR: config }
  }

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
      for (const descendant of Entrypoint.descendantsOf(child.pid)) pids.add(descendant)
      if (child.pid !== undefined) pids.add(child.pid)
    }
    await Promise.all([...pids].map((pid) => Entrypoint.killPid(pid)))
    await Promise.all(Entrypoint.#configs.splice(0).map((config) => rm(config, { recursive: true, force: true })))
  }

  static descendantsOf(pid: number | undefined): number[] {
    if (pid === undefined) return []
    const direct = Entrypoint.#directChildrenOf(pid)

    return direct.flatMap((child) => [child, ...Entrypoint.descendantsOf(child)])
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

  static alive(pid: number): boolean {
    try {
      process.kill(pid, 0)
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code === 'ESRCH') return false
      throw failure
    }

    return true
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
      if (!Entrypoint.alive(pid)) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`fixture process ${pid} did not exit within 5000ms`)
  }

  static async refused(environment: NodeJS.ProcessEnv): Promise<Refusal> {
    const isolated = await Entrypoint.isolated(environment)
    const child = spawn(process.execPath, [Entrypoint.#PATH], {
      env: isolated,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    Entrypoint.#spawned.push(child)
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })

    return new Promise<Refusal>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`it never exited, and said ${JSON.stringify(stderr)}`)), Entrypoint.#TIMEOUT_MS
      )
      child.once('close', (status) => {
        clearTimeout(timer)
        resolve({ status, said: stderr.split('\n') })
      })
      child.once('error', reject)
    })
  }

  static async listening(environment: NodeJS.ProcessEnv): Promise<number> {
    return (await Entrypoint.started(environment)).port
  }

  static #asOverridesThatBeatALocalEnvFile(environment: NodeJS.ProcessEnv): string[] {
    return Object.entries(environment).map(([name, value]) => `${name}=${value ?? ''}`)
  }

  static async makeRunBackendWithoutReinstalling(environment: NodeJS.ProcessEnv): Promise<number> {
    const isolated = await Entrypoint.isolated(environment)
    const child = spawn('make', [
      '--silent', '-o', 'install-backend', 'run-backend',
      ...Entrypoint.#asOverridesThatBeatALocalEnvFile(environment),
      `CT_STATE_DIR=${isolated.CT_STATE_DIR ?? ''}`,
      `CLAUDE_CONFIG_DIR=${isolated.CLAUDE_CONFIG_DIR}`,
    ], {
      cwd: Entrypoint.#ROOT,
      env: isolated,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    Entrypoint.#spawned.push(child)
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    return new Promise<number>((resolve, reject) => {
      let stdout = ''
      const timer = setTimeout(
        () => reject(new Error(`make run-backend did not print a port: ${stderr}`)), Entrypoint.#TIMEOUT_MS
      )
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
        const line = stdout.split('\n').find((candidate) => candidate.startsWith('{"port":'))
        if (line === undefined) return
        clearTimeout(timer)
        resolve((JSON.parse(line) as { port: number }).port)
      })
      child.once('error', reject)
      child.once('close', (code) => reject(new Error(`make run-backend exited ${String(code)}: ${stderr}`)))
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

  static async started(environment: NodeJS.ProcessEnv): Promise<StartedEntrypoint> {
    const isolated = await Entrypoint.isolated(environment)
    const child = spawn(process.execPath, [Entrypoint.#PATH], {
      env: isolated,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    Entrypoint.#spawned.push(child)
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })

    return new Promise<StartedEntrypoint>((resolve, reject) => {
      let stdout = ''
      const timer = setTimeout(() => reject(new Error(`no port line in ${stdout}`)), Entrypoint.#TIMEOUT_MS)
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
        const end = stdout.indexOf('\n')
        if (end === -1) return
        clearTimeout(timer)
        const pid = child.pid
        if (pid === undefined) {
          reject(new Error('the entrypoint bound a port without ever having a pid'))
          return
        }
        resolve({
          port: (JSON.parse(stdout.slice(0, end)) as { port: number }).port,
          pid,
          saidLater: () => stderr,
          descendants: () => Entrypoint.descendantsOf(pid),
          crash: () => Entrypoint.killPid(pid),
        })
      })
      child.once('error', reject)
    })
  }

  static async recovering(environment: NodeJS.ProcessEnv): Promise<StartedEntrypoint> {
    const started = await Entrypoint.started(environment)
    for (let waited = 0; waited < 60; waited += 1) {
      if (started.saidLater().includes('plans in flight:')) break
      await new Promise((wake) => setTimeout(wake, 100))
    }

    return started
  }
}

export class TheCoordinatingSession {
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

export class TheActivePlans {
  static readonly PATH = '/active-plans'

  readonly status: number
  readonly text: string

  constructor(asked: { status: number, text: string }) {
    this.status = asked.status
    this.text = asked.text
  }

  static async listedBy(port: number): Promise<TheActivePlans> {
    const answered = await fetch(`http://127.0.0.1:${port}${TheActivePlans.PATH}`)

    return new TheActivePlans({ status: answered.status, text: await answered.text() })
  }

  planFor(issue: number): StartedPlan {
    const listed = (JSON.parse(this.text) as { plans: ListedActivePlan[] }).plans
    const matching = listed.filter((active) => active.plan.issue.number === issue)
    if (matching.length !== 1) {
      throw new Error(`expected one active plan for issue ${issue}, got ${matching.length} in ${this.text}`)
    }

    return matching[0].plan
  }
}

export class ActualHeadlessRuntime {
  static readonly REPOSITORY = 'acme/widget'
  static readonly MILESTONE = 'Fixture milestone'
  static readonly SLICE_ISSUE = 42
  static readonly LAUNCHED_BY_THE_CHAIN = 1
  static readonly LAUNCHED_BY_BOTH_ENTRANCES = 2
  static readonly COORDINATOR = '22222222-2222-4222-8222-222222222222'
  static readonly WRONG_AGENT = '33333333-3333-4333-8333-333333333333'
  static readonly ISSUE_BODY_UNITS = ToolRunner.PIPE_BUFFER_BYTES * 32
  static readonly #FROZEN_ON = '2026-09-16'
  static readonly #NEVER_FROZEN = '—'
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

  static async prepared({ spec }: { spec: string }): Promise<ActualHeadlessRuntime> {
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
    await writeFile(
      join(root, 'docs', 'superpowers', 'specs', '2026-01-01-fixture-execution.md'),
      ActualHeadlessRuntime.#spec(spec)
    )
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

  async launches(expected: number): Promise<RecordedLaunch[]> {
    for (let tried = 0; tried < ActualHeadlessRuntime.#WAIT_TRIES; tried += 1) {
      const names = await readdir(this.captures)
      if (names.length === expected) return await this.#recorded(names)
      await new Promise((resolve) => setTimeout(resolve, ActualHeadlessRuntime.#WAIT_MS))
    }
    throw new Error(`the ${expected} plan launches were not captured before the deadline`)
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
      const dispatch = JSON.parse(
        await readFile(join(harness, agent, 'dispatch.json'), 'utf8')
      ) as { issue: { number: number } }
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

  static #freezeDateFor(state: string): string {
    return state === EpicSpec.FROZEN ? ActualHeadlessRuntime.#FROZEN_ON : ActualHeadlessRuntime.#NEVER_FROZEN
  }

  static #spec(state: string): string {
    return [
      `# ${ActualHeadlessRuntime.MILESTONE}${EpicSpec.TITLE_SUFFIX}`,
      '',
      `${EpicSpec.DATE_LINE} ${ActualHeadlessRuntime.#freezeDateFor(state)}`,
      `${EpicSpec.STATE_LINE} ${state}`,
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
      '## Contexto del milestone',
      '',
      '- **Alcance:** `src/**`',
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
    await writeFile(
      join(transcript, `${ActualHeadlessRuntime.COORDINATOR}${ClaudeCodeTranscript.EXTENSION}`), '{"type":"user"}\n'
    )
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
      '  const errand = argv[argv.length - 1]',
      "  const errandMatch = /^Read the file at (.+) and do exactly what it says\\.$/.exec(errand)",
      "  if (errandMatch === null) throw new Error('unexpected CLI errand: ' + JSON.stringify(errand))",
      '  fs.writeFileSync(path.join(process.env.CT_FIXTURE_CAPTURES, `${id}.json`), '
      + 'JSON.stringify({ argv, prompt: errandMatch[1], pid: process.pid }))',
      '}',
      'setInterval(() => {}, 1000)',
    ].join('\n') + '\n', { mode: 0o755 })
    await writeFile(join(bin, 'gh'), [
      '#!/usr/bin/env node',
      'const argv = process.argv.slice(2)',
      `const issue = { number: ${ActualHeadlessRuntime.SLICE_ISSUE}, html_url: 'https://github.com/acme/widget/issues/${ActualHeadlessRuntime.SLICE_ISSUE}', title: '#1 Fixture slice', body: 'x'.repeat(${ActualHeadlessRuntime.ISSUE_BODY_UNITS}) + '\\n<!-- ct-order:1 -->', milestone: { number: 1, title: ${JSON.stringify(ActualHeadlessRuntime.MILESTONE)} }, labels: [{ name: 'status:ready' }] }`,
      "const node = { number: issue.number, url: issue.html_url, title: issue.title, body: issue.body, state: 'OPEN', stateReason: null, milestone: { ...issue.milestone, description: null }, labels: { nodes: issue.labels } }",
      "const page = (nodes) => JSON.stringify([{ data: { repository: { issues: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } }])",
      "if (argv[0] === 'issue' && argv[1] === 'create') console.log('https://github.com/acme/widget/issues/41')",
      `else if (argv[0] === 'issue' && argv[1] === 'view') { const number = Number(argv[2]); console.log(JSON.stringify({ number, title: number === issue.number ? '#1 Fixture slice' : 'Loose fixture', body: '<!-- ct-order:1 -->', labels: [{ name: 'status:ready' }], milestone: number === issue.number ? { title: ${JSON.stringify(ActualHeadlessRuntime.MILESTONE)} } : null })) }`,
      "else if (argv[0] === 'issue' && argv[1] === 'list') console.log(JSON.stringify([{ number: issue.number, url: issue.html_url, title: issue.title, labels: issue.labels, state: 'OPEN', body: '<!-- ct-order:1 -->' }]))",
      "else if (argv[0] === 'api' && argv[1].includes('/contents/')) console.log(JSON.stringify({ sha: process.env.CT_FIXTURE_SPEC_SHA }))",
      `else if (argv[0] === 'api' && argv[1] === 'graphql' && argv.includes(${JSON.stringify(`query=${issuesQueryFor(['CLOSED'])}`)})) console.log(page([]))`,
      `else if (argv[0] === 'api' && argv[1] === 'graphql' && argv.includes(${JSON.stringify(`query=${issuesQueryFor(['OPEN'])}`)})) console.log(page([node]))`,
      "else console.log('{}')",
    ].join('\n') + '\n', { mode: 0o755 })
  }
}
