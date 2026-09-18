import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { ApiInvocationFailure, CtApi } from '../../src/infrastructure/ct-api.ts'
import type { ApiRuntime } from '../../src/infrastructure/ct-api.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import type { Terminal, TerminalSpawn } from '../../src/infrastructure/pty-live-sessions.ts'
import { ClaudeCodeTranscript } from '../../../plugin/scripts/claude-code-usage.js'

type ToolCall = { bin: string, argv: string[], cwd?: string, whole: boolean }
type ToolsAnswer = {
  tools: { tool: string, session: string, fix: string | null }[],
  metricsDelivery: { enabled: boolean, variable: string, destination: string | null },
}
type OpenedSession = { conversation: string, target: string, session: { id: string } }

class TerminalConversation implements Terminal {
  readonly pid: number
  readonly written: string[] = []
  readonly resized: number[][] = []
  data: (text: string) => void = () => {}
  exit: () => void = () => {}
  alive = true

  constructor(pid: number) { this.pid = pid }
  onData(listener: (text: string) => void): void { this.data = listener }
  onExit(listener: () => void): void { this.exit = listener }
  write(text: string): void { this.written.push(text) }
  resize(cols: number, rows: number): void { this.resized.push([cols, rows]) }
  close(): void {
    if (!this.alive) return
    this.alive = false
    this.exit()
  }
}

class ToolConversation {
  readonly calls: ToolCall[] = []
  readonly answers = new Map<string, ProcessOutput>()

  answer(bin: string, argv: string[], output: ProcessOutput, cwd?: string): void {
    this.answers.set(JSON.stringify([bin, argv, cwd ?? null]), output)
  }

  async run(bin: string, argv: string[], cwd: string | undefined, whole: boolean): Promise<ProcessOutput> {
    this.calls.push({ bin, argv, cwd, whole })
    const key = JSON.stringify([bin, argv, cwd ?? null])
    const answer = this.answers.get(key)
    if (answer === undefined) throw new Error(`No tool answer declared for ${key}`)
    return answer
  }
}

class Composition {
  static readonly opened: Composition[] = []
  readonly root: string
  readonly tools = new ToolConversation()
  readonly stdout: string[] = []
  readonly stderr: string[] = []
  readonly waiting = new Set<AbortSignal>()
  readonly terminals: TerminalConversation[] = []
  readonly launches: Parameters<TerminalSpawn>[] = []
  readonly workers: { bin: string, argv: string[], options: unknown, descriptor: Record<string, unknown> }[] = []
  readonly runtime: ApiRuntime
  api: CtApi | null = null

  constructor(root: string) {
    this.root = root
    this.runtime = {
      tool: ({ bin }) => ({
        run: (argv, options) => this.tools.run(bin, argv, options?.cwd, false),
        runWholeOutput: (argv, options) => this.tools.run(bin, argv, options?.cwd, true),
      }),
      spawn: () => { throw new Error('No worker launch declared') },
      terminal: () => { throw new Error('No terminal launch declared') },
      signal: () => { throw new Error('No process signal declared') },
      inspectProcessTable: () => { throw new Error('No process inspection declared') },
      sleep: (milliseconds, signal) => this.sleep(milliseconds, signal),
      home: () => root,
      out: (text) => { this.stdout.push(text) },
      err: (text) => { this.stderr.push(text) },
    }
  }

  static async isolated(): Promise<Composition> {
    const fixture = new Composition(await mkdtemp(join(tmpdir(), 'ct-api-composition-')))
    Composition.opened.push(fixture)
    return fixture
  }

  async sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (milliseconds < 1000 && milliseconds !== 250) return
    signal.throwIfAborted()
    this.waiting.add(signal)
    await new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => {
        this.waiting.delete(signal)
        reject(signal.reason)
      }, { once: true })
    })
  }

  environment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return { CT_API_PORT: '0', CLAUDE_CONFIG_DIR: this.root, PATH: join(this.root, 'bin'), SHELL: '/bin/sh', ...extra }
  }

  async start(extra: NodeJS.ProcessEnv = {}): Promise<void> {
    this.api = await CtApi.run([], this.environment(extra), this.runtime)
  }

  request(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`http://127.0.0.1:${this.api!.port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  async file(path: string, text: string): Promise<void> {
    const parts = path.split('/')
    await mkdir(join(this.root, ...parts.slice(0, -1)), { recursive: true })
    await writeFile(join(this.root, path), text)
  }

  static async closeAll(): Promise<void> {
    for (const fixture of Composition.opened.splice(0)) {
      for (const terminal of fixture.terminals) terminal.close()
      await fixture.api?.close()
      await rm(fixture.root, { recursive: true, force: true })
    }
  }

  static ok(stdout = '', stderr = ''): ProcessOutput {
    return new ProcessOutput({ code: 0, stdout, stderr })
  }

  async withProbes(): Promise<void> {
    await mkdir(join(this.root, 'bin'))
    for (const bin of ['gh', 'acli', 'claude', 'git', 'ssh', 'bq', 'gcloud']) {
      await writeFile(join(this.root, 'bin', bin), '', { mode: 0o755 })
    }
    this.tools.answer('gh', ['auth', 'status'], Composition.ok())
    this.tools.answer('acli', ['jira', 'auth', 'status'], Composition.ok())
    this.tools.answer('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-T', 'git@github.com'],
      new ProcessOutput({ code: 1, stdout: '', stderr: "Hi fixture! You've successfully authenticated, but GitHub does not provide shell access.\n" }))
    this.tools.answer('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'], Composition.ok('fixture@example.test\n'))
  }

  async withProgress(step: string): Promise<void> {
    await this.file('.worktrees/7/.agent/run-7.json', JSON.stringify({
      plan: 'plan.md', issue: 7, task: 1, tasksTotal: 1, step,
      controlRetries: 0, judgeRetries: 0, correctionRetries: 0, discards: 0,
    }))
  }

  allowTerminals(): void {
    this.runtime.terminal = (...args) => {
      this.launches.push(args)
      const terminal = new TerminalConversation(4101 + this.terminals.length)
      this.terminals.push(terminal)
      return terminal
    }
    this.runtime.inspectProcessTable = async () => this.terminals.filter((terminal) => terminal.alive)
      .map((terminal) => `${terminal.pid} ${terminal.pid} Thu Sep 17 22:29:08 2026`).join('\n')
    this.runtime.signal = (pid, signal) => {
      const terminal = this.terminals.find((candidate) => candidate.pid === Math.abs(pid) && candidate.alive)
      if (terminal === undefined) throw Object.assign(new Error('No such process'), { code: 'ESRCH' })
      if (signal !== 0) terminal.close()
    }
  }

  async recordedConversation(transcript: boolean): Promise<string> {
    const id = '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'
    const checkout = join(this.root, 'checkout')
    await mkdir(checkout, { recursive: true })
    await this.file('control-tower/coordinating-session/conversation.json', JSON.stringify({
      conversation: id, repo: 'acme/widget', root: checkout,
    }))
    if (transcript) {
      await this.file(`${ClaudeCodeTranscript.FOLDER}/${ClaudeCodeTranscript.folderFor(checkout)}/${id}${ClaudeCodeTranscript.EXTENSION}`, '{"type":"user"}\n')
    }
    this.allowTerminals()
    return id
  }

  async confirmedCheckout(): Promise<string> {
    const checkout = join(this.root, 'checkout')
    await mkdir(checkout, { recursive: true })
    for (const [argv, output] of [
      [['remote', 'get-url', 'origin'], 'git@github.com:acme/widget.git\n'],
      [['rev-parse', '--show-toplevel'], `${checkout}\n`],
      [['symbolic-ref', 'refs/remotes/origin/HEAD'], 'refs/remotes/origin/main\n'],
      [['rev-parse', '--abbrev-ref', 'HEAD'], 'main\n'],
      [['fetch', 'origin', 'main'], ''],
      [['rev-parse', '--verify', '--quiet', 'origin/main^{commit}'], 'a'.repeat(40) + '\n'],
      [['merge', '--ff-only', 'origin/main'], 'Already up to date.\n'],
    ] as [string[], string][]) this.tools.answer('git', ['-C', checkout, ...argv], Composition.ok(output))
    this.allowTerminals()
    return checkout
  }

  async preparedPlan(number: number, checkout: string): Promise<void> {
    const worktree = join(checkout, '.worktrees', String(number))
    await mkdir(worktree, { recursive: true })
    this.tools.answer('gh', ['issue', 'view', String(number), '--repo', 'acme/widget', '--json', 'number,title,body,labels,milestone'], Composition.ok(JSON.stringify({
      number, title: number === 41 ? 'Loose fixture' : '#1 Fixture slice', body: '<!-- ct-order:1 -->',
      labels: [{ name: 'status:ready' }], milestone: number === 41 ? null : { title: 'Fixture milestone' },
    })))
    this.tools.answer('git', ['-C', checkout, 'worktree', 'add', '-b', `feat/${number}`, worktree, 'origin/main'], Composition.ok())
    this.tools.answer('git', ['-C', worktree, 'rev-parse', '--git-common-dir'], Composition.ok(join(checkout, '.git')))
    this.tools.answer('git', ['-C', worktree, 'status', '--porcelain', '--untracked-files=all'], Composition.ok())
    const dispatchCheck = fileURLToPath(new URL('../../../plugin/scripts/dispatch-check.mjs', import.meta.url))
    this.tools.answer(process.execPath, [dispatchCheck, String(number), '--repo', 'acme/widget'], Composition.ok(), checkout)
    this.runtime.spawn = ((bin: string, args: string[], options: unknown) => {
      if (!Array.isArray(args) || typeof args[1] !== 'string') throw new Error('Worker descriptor was not named')
      const descriptor = JSON.parse(readFileSync(args[1], 'utf8')) as Record<string, unknown>
      this.workers.push({ bin, argv: args, options, descriptor })
      const worker = Object.assign(new EventEmitter(), { connected: true, disconnect: () => {}, unref: () => {} })
      queueMicrotask(() => { worker.emit('spawn'); worker.emit('message', { kind: 'accepted' }) })
      return worker as ReturnType<ApiRuntime['spawn']>
    }) as ApiRuntime['spawn']
  }

  async loosePlan(): Promise<string> {
    const checkout = await this.confirmedCheckout()
    await this.preparedPlan(41, checkout)
    this.tools.answer('gh', ['issue', 'create', '--repo', 'acme/widget', '--title', 'Plan the loose fixture', '--body',
      '> Plan asked for by hand: there is no ticket behind it.\n\n## Descripción\nPlan the loose fixture\n\n## Comentario de quien pide el plan\nPlan the loose fixture\n\n## Contexto del epic\n_This plan does not come from any ticket._\n\n## Contexto heredado\n_(empty — the coordinating session fills it in when something already merged conditions this slice. `/ct-groom` neither writes here nor rewrites what you write.)_\n\n## Acceptance criteria (EARS, 1:1 con tests)\n- (fill in from the spec)\n\n## Gates\n- (none) — this slice demands no human gate before merging.\n\n## Out of scope / Protected\n- (none declared)\n',
      '--label', 'gate:none', '--label', 'status:ready'], Composition.ok('https://github.com/acme/widget/issues/41\n'))
    return checkout
  }

  async bothPlanEntrances(): Promise<string> {
    const checkout = await this.loosePlan()
    await this.recordedConversation(true)
    await this.preparedPlan(42, checkout)
    const specPath = 'docs/superpowers/specs/2026-09-18-fixture-execution.md'
    const spec = '# Fixture milestone — Execution spec\n\n**Estado:** CONGELADA\n'
    await this.file(`checkout/${specPath}`, spec)
    const sha = createHash('sha1').update(`blob ${Buffer.byteLength(spec)}\0${spec}`).digest('hex')
    this.tools.answer('gh', ['api', `repos/acme/widget/contents/${specPath}`], Composition.ok(JSON.stringify({ sha })))
    this.tools.answer('gh', ['issue', 'list', '--repo', 'acme/widget', '--milestone', 'Fixture milestone', '--state', 'all', '--limit', '200', '--json', 'number,url,title,labels,state,body'], Composition.ok(JSON.stringify([
      { number: 42, url: 'https://github.com/acme/widget/issues/42', title: '#1 Fixture slice', labels: [{ name: 'status:ready' }], state: 'OPEN', body: '<!-- ct-order:1 -->' },
    ])))
    const groom = fileURLToPath(new URL('../../../plugin/scripts/ct-groom.mjs', import.meta.url))
    this.tools.answer(process.execPath, [groom, specPath, '--repo', 'acme/widget', '--milestone', 'Fixture milestone', '--dry-run'], Composition.ok(JSON.stringify({
      milestone: 'Fixture milestone', issues: [{ order: 1, title: '#1 Fixture slice', labels: ['status:ready'], repo: 'acme/widget' }],
    })), checkout)
    const issue = {
      number: 42, html_url: 'https://github.com/acme/widget/issues/42', title: '#1 Fixture slice',
      body: 'x'.repeat(65536 * 32) + '\n<!-- ct-order:1 -->',
      milestone: { number: 1, title: 'Fixture milestone' }, labels: [{ name: 'status:ready' }],
    }
    for (const state of ['open', 'closed']) {
      this.tools.answer('gh', ['api', 'repos/acme/widget/issues', '--method', 'GET', '-f', `state=${state}`, '-f', 'per_page=100', '--paginate', '--slurp'], Composition.ok(JSON.stringify(state === 'open' ? [[issue]] : [[]])))
    }
    const dispatchCheck = fileURLToPath(new URL('../../../plugin/scripts/dispatch-check.mjs', import.meta.url))
    this.tools.answer(process.execPath, [dispatchCheck, '41', '--repo', 'acme/widget', '--check-plan'], new ProcessOutput({ code: 6, stdout: '', stderr: 'plan not yet written' }), join(checkout, '.worktrees/41'))
    return checkout
  }
}

describe('the API composition is exercised over HTTP with external execution injected', () => {
  afterEach(() => Composition.closeAll())

  it('startup prints its actual port and closing cancels its harvest wait', async () => {
    const fixture = await Composition.isolated()
    await fixture.start()
    expect(fixture.stdout).toEqual([`${JSON.stringify({ port: fixture.api!.port })}\n`])
    expect(fixture.waiting.size).toBe(1)
    await fixture.api!.close()
    expect(fixture.waiting.size).toBe(0)
    expect(fixture.tools.calls).toEqual([])
    await expect(fixture.request('/sessions')).rejects.toThrow()
  })

  it('two instances have independent ports roots and lifetimes', async () => {
    const first = await Composition.isolated()
    const second = await Composition.isolated()
    await first.start()
    await second.start()
    expect(first.api!.port).not.toBe(second.api!.port)
    await first.api!.close()
    expect((await second.request('/sessions')).status).toBe(200)
    expect(second.waiting.size).toBe(1)
    expect(first.waiting.size).toBe(0)
  })

  it('a bad invocation reports the existing reason and usage without starting tools', async () => {
    const fixture = await Composition.isolated()
    await expect(fixture.start({ CT_API_PORT: 'a fistful of ports' })).rejects.toMatchObject({ code: 2 })
    expect(fixture.stderr.join('')).toMatch(/CT_API_PORT[^\n]*\nusage: make run-backend \(no arguments;/)
    expect(fixture.stdout).toEqual([])
    expect(fixture.tools.calls).toEqual([])
    expect(fixture.waiting.size).toBe(0)
  })

  it('an occupied port is a listen refusal and leaves no background work', async () => {
    const first = await Composition.isolated()
    const second = await Composition.isolated()
    await first.start()
    await expect(second.start({ CT_API_PORT: String(first.api!.port) })).rejects.toBeInstanceOf(ApiInvocationFailure)
    expect(second.stderr.join('')).toContain('could not listen on 127.0.0.1:')
    expect(second.waiting.size).toBe(0)
    expect((await first.request('/sessions')).status).toBe(200)
  })

  it('a freshly started API lists no sessions through its real query and adapter', async () => {
    const fixture = await Composition.isolated()
    await fixture.start()
    expect(await (await fixture.request('/sessions')).json()).toEqual({ sessions: [] })
  })

  it('external tools reaches all probe clients and carries enabled delivery from startup', async () => {
    const fixture = await Composition.isolated()
    await fixture.withProbes()
    await fixture.start({ CT_HARVEST_BQ_TABLE: 'fixture-project:fixture_dataset.fixture_table' })
    const response = await fixture.request('/external-tools')
    expect(response.status).toBe(200)
    const body = await response.json() as ToolsAnswer
    expect(body.tools.map((row: { tool: string }) => row.tool)).toEqual(['gh', 'acli', 'claude', 'git', 'bq'])
    expect(body.tools.map((row: { session: string }) => row.session)).toEqual(['ready', 'ready', 'unknown', 'ready', 'ready'])
    expect(body.tools[2].fix).toBe('claude, then /login — not observable from this process')
    expect(body.metricsDelivery).toEqual({ enabled: true, variable: 'CT_HARVEST_BQ_TABLE', destination: 'fixture-project:fixture_dataset.fixture_table' })
    expect(fixture.tools.calls.map(({ bin, argv }) => [bin, argv])).toEqual([
      ['gh', ['auth', 'status']],
      ['acli', ['jira', 'auth', 'status']],
      ['ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-T', 'git@github.com']],
      ['gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)']],
    ])
  })

  it('an absent harvest destination is served as disabled delivery', async () => {
    const fixture = await Composition.isolated()
    await fixture.start()
    const body = await (await fixture.request('/external-tools')).json() as ToolsAnswer
    expect(body.metricsDelivery).toEqual({ enabled: false, variable: 'CT_HARVEST_BQ_TABLE', destination: null })
    expect(fixture.tools.calls).toEqual([])
  })

  it.each(['implement', 'advise'])('the real progress reader serves the %s step from disk', async (step) => {
    const fixture = await Composition.isolated()
    await fixture.withProgress(step)
    await fixture.start()
    const response = await fixture.request(`/implement-progress/7?root=${encodeURIComponent(fixture.root)}&repo=owner%2Fname`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ step, task: 1, total_tasks: 1, attempt: 1 })
  })

  it('the events route retains its unregistered-plan refusal', async () => {
    const fixture = await Composition.isolated()
    await fixture.start()
    const response = await fixture.request('/plan-events/54?repo=jjponz%2Frepo-pulse')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'not-watched' })
  })

  it.each(['/spec-freeze', '/epic-groom'])('%s is wired to the empty coordinating state', async (path) => {
    const fixture = await Composition.isolated()
    await fixture.start()
    const response = await fixture.request(path)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'none' })
  })

  it('both retired implementation methods and the retired review route remain absent', async () => {
    const fixture = await Composition.isolated()
    await fixture.start()
    for (const response of [
      await fixture.request('/implement-plan'), await fixture.request('/implement-plan', {}),
      await fixture.request('/review-plan', { issue: 33, repo: 'jjponz/repo-pulse', changes: 'split task 2' }),
    ]) {
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ code: 'not-found', detail: 'not found' })
    }
    await expect(import('node:fs/promises').then(({ stat }) => stat(join(fixture.root, 'control-tower', 'go'))))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([true, false])('recovery consults the configured transcript directory: transcript present %s', async (present) => {
    const fixture = await Composition.isolated()
    const id = await fixture.recordedConversation(present)
    await fixture.start()
    const body = await (await fixture.request('/coordinating-session')).json() as { status: string }
    expect(body.status).toBe(present ? 'live' : 'unresumable')
    expect(fixture.launches).toHaveLength(present ? 1 : 0)
    if (present) {
      expect(fixture.launches[0][1]).toEqual(['-il', '-c', `exec claude --resume ${id} --permission-mode auto --model opus --plugin-dir "$CT_PLUGIN_ROOT"`])
      expect(fixture.launches[0][2].env.CLAUDE_CONFIG_DIR).toBe(fixture.root)
      expect(fixture.launches[0][2].env.CT_SESSION_HOOKS_URL).toBe(`http://127.0.0.1:${fixture.api!.port}/session-hooks`)
    }
  })

  it('concurrent openings create one recorded conversation and one native launch', async () => {
    const fixture = await Composition.isolated()
    const checkout = await fixture.confirmedCheckout()
    await fixture.start()
    const body = { repo: 'acme/widget', path: checkout, user_comment: 'explore the checkout screen' }
    const answers = await Promise.all([fixture.request('/coordinating-session', body), fixture.request('/coordinating-session', body)])
    expect(answers.map((answer) => answer.status).sort()).toEqual([202, 409])
    expect(fixture.launches).toHaveLength(1)
    const accepted = answers.find((answer) => answer.status === 202)!
    const opened = await accepted.json() as OpenedSession
    const record = JSON.parse(await readFile(join(fixture.root, 'control-tower/coordinating-session/conversation.json'), 'utf8'))
    expect(record.conversation).toBe(opened.conversation)
    expect(fixture.launches[0][2].cwd).toBe(checkout)
    expect(fixture.launches[0][2].env.CT_PHASE_PROMPT).toBeTruthy()
    expect(await readFile(fixture.launches[0][2].env.CT_PHASE_PROMPT, 'utf8')).toContain('explore the checkout screen')
  })

  it.each([
    ['ZZZ-999999', 'acli', ['jira', 'workitem', 'view', 'ZZZ-999999', '--json', '--fields', 'summary,description'], 'acli jira failed: '],
    ['https://github.com/mercadona/control-tower/issues/999999999', 'gh', ['issue', 'view', 'https://github.com/mercadona/control-tower/issues/999999999', '--json', 'title,body,comments'], 'gh issue view failed: '],
  ] as const)('a story request for %s reaches its actual adapter', async (id, bin, argv, prefix) => {
    const fixture = await Composition.isolated()
    const checkout = await fixture.confirmedCheckout()
    fixture.tools.answer(bin, [...argv], new ProcessOutput({ code: 1, stdout: '', stderr: 'fixture issue was not found' }))
    await fixture.start()
    const response = await fixture.request('/start-plan', { id, repo: 'acme/widget', path: checkout })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'user-story-not-read', detail: `${prefix}fixture issue was not found` })
    expect(fixture.tools.calls.filter((call) => call.bin === bin).map((call) => call.argv)).toEqual([[...argv]])
  })

  it('session listing streaming input resize and hook attention reach the same live adapter', async () => {
    const fixture = await Composition.isolated()
    const conversation = await fixture.recordedConversation(true)
    await fixture.start()
    const listed = await (await fixture.request('/sessions')).json() as { sessions: { id: string, name: string }[] }
    expect(listed.sessions).toHaveLength(1)
    expect(listed.sessions[0].name).toBe('brainstorming')
    const id = listed.sessions[0].id
    const typed = await fixture.request(`/sessions/${id}/input`, { text: 'hello\r' })
    expect(typed.status).toBe(202)
    expect(await typed.json()).toEqual({ status: 'typed', id })
    expect(fixture.terminals[0].written).toEqual(['hello\r'])
    const resized = await fixture.request(`/sessions/${id}/resize`, { cols: 111, rows: 37 })
    expect(resized.status).toBe(202)
    expect(await resized.json()).toEqual({ status: 'resized', id, cols: 111, rows: 37 })
    expect(fixture.terminals[0].resized).toEqual([[111, 37]])
    fixture.terminals[0].data('fixture terminal output\n')
    const streamed = await fixture.request(`/sessions/${id}/stream`)
    expect(streamed.status).toBe(200)
    const reader = streamed.body!.getReader()
    try {
      const next = await reader.read()
      expect(new TextDecoder().decode(next.value)).toContain('fixture terminal output')
    } finally { await reader.cancel() }
    const hook = await fixture.request('/session-hooks', { session_id: conversation, hook_event_name: 'Stop' })
    expect(hook.status).toBe(202)
    const held = await (await fixture.request('/coordinating-session')).json() as { attention: { status: string } }
    expect(held.attention.status).toBe('waiting')
  })

  it('closing the coordinating session reaches ownership inspection and durable records', async () => {
    const fixture = await Composition.isolated()
    const checkout = await fixture.confirmedCheckout()
    await fixture.file('checkout/sentinel.txt', 'uncommitted work\n')
    const conversation = await fixture.recordedConversation(true)
    await fixture.start()
    const unrelated = new TerminalConversation(9900)
    fixture.terminals.push(unrelated)
    const held = await (await fixture.request('/coordinating-session')).json() as { target: string }
    const response = await fixture.request('/coordinating-session/close', { conversation, target: held.target })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'closed', conversation, target: held.target })
    expect(fixture.terminals[0].alive).toBe(false)
    expect(unrelated.alive).toBe(true)
    expect(await (await fixture.request('/coordinating-session')).json()).toEqual({ status: 'none', operation: 'idle' })
    expect(await (await fixture.request('/sessions')).json()).toEqual({ sessions: [] })
    expect(await (await fixture.request('/spec-freeze')).json()).toEqual({ status: 'none' })
    expect(await (await fixture.request('/epic-groom')).json()).toEqual({ status: 'none' })
    const replacement = await fixture.request('/coordinating-session', { repo: 'acme/widget', path: checkout, user_comment: 'replace the closed session' })
    expect(replacement.status).toBe(202)
    const second = await replacement.json() as OpenedSession
    expect(second.conversation).not.toBe(conversation)
    expect(second.target).not.toBe(held.target)
    expect((await fixture.request('/coordinating-session/close', { conversation: second.conversation, target: second.target })).status).toBe(200)
    await fixture.api!.close()
    await fixture.start()
    expect(await (await fixture.request('/coordinating-session')).json()).toEqual({ status: 'none', operation: 'idle' })
    expect(fixture.launches).toHaveLength(2)
    const afterRestart = await fixture.request('/coordinating-session', { repo: 'acme/widget', path: checkout, user_comment: 'start after restart' })
    expect(afterRestart.status).toBe(202)
    const third = await afterRestart.json() as OpenedSession
    expect(third.conversation).not.toBe(second.conversation)
    expect(third.target).not.toBe(second.target)
    expect(fixture.launches).toHaveLength(3)
    expect(unrelated.alive).toBe(true)
    expect(await readFile(join(checkout, 'sentinel.txt'), 'utf8')).toBe('uncommitted work\n')
  })

  it('freeze reslicing groom and promotion requests read the real draft spec', async () => {
    const fixture = await Composition.isolated()
    await fixture.recordedConversation(false)
    const spec = 'checkout/docs/superpowers/specs/2026-09-18-fixture-execution.md'
    await fixture.file(spec, '# Fixture milestone — Execution spec\n\n**Estado:** BORRADOR\n')
    await fixture.start()
    const draft = await (await fixture.request('/spec-freeze', undefined, { 'sec-fetch-site': 'same-origin' })).json() as {
      status: string, spec: string, key: string, target: string, findings: unknown[],
    }
    expect(draft.status).toBe('draft')
    expect(draft.spec).toBe('docs/superpowers/specs/2026-09-18-fixture-execution.md')
    expect(draft.findings.length).toBeGreaterThan(0)
    expect(draft.key).toMatch(/^[a-f0-9]{64}$/)
    const headers = { 'x-gate-key': draft.key, 'x-coordinating-target': draft.target }
    for (const [path, code] of [
      ['/spec-freeze', 'spec-not-freezable'], ['/spec-reslicing', 'spec-not-frozen'],
      ['/epic-groom', 'spec-not-frozen'], ['/epic-promotion', 'no-epic-issues'],
    ]) {
      const response = await fixture.request(path, {}, headers)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code })
    }
    expect(await (await fixture.request('/epic-groom')).json()).toEqual({ status: 'draft', target: draft.target })
    await rm(join(fixture.root, spec))
    const groom = await fixture.request('/groom-session', {}, headers)
    expect(groom.status).toBe(400)
    expect(await groom.json()).toMatchObject({ code: 'no-epic-spec' })
    expect(fixture.tools.calls).toEqual([])
  })

  it('history and active plans use the real disk readers', async () => {
    const fixture = await Composition.isolated()
    await fixture.withProgress('implement')
    await fixture.start()
    const history = await fixture.request(`/implement-history/7?root=${encodeURIComponent(fixture.root)}&repo=owner%2Fname`)
    expect(history.status).toBe(200)
    expect(await history.json()).toEqual({ steps: [] })
    expect(await (await fixture.request('/active-plans')).json()).toEqual({ plans: [] })
  })

  it.each([
    ['/recover-plan', 'recover-plan-not-found'], ['/cleanup-plan', 'cleanup-plan-not-found'],
  ])('%s reaches the real record lookup for a valid request', async (path, code) => {
    const fixture = await Composition.isolated()
    await fixture.start()
    const response = await fixture.request(path, {
      repo: 'acme/widget', issue: 7, agent: '11111111-1111-4111-8111-111111111111',
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code })
  })

  it('both plan entrances record worker identity and route paginated output through the whole-output runner', async () => {
    const fixture = await Composition.isolated()
    const checkout = await fixture.bothPlanEntrances()
    await fixture.start({ CT_PHASE_PROMPT: 'parent prompt', CT_SESSION_HOOKS_URL: 'parent hooks', CLAUDE_CODE_SESSION_ID: 'parent session' })
    const response = await fixture.request('/start-plan', { user_comment: 'Plan the loose fixture', repo: 'acme/widget', path: checkout })
    const body = await response.json() as { agent: string, issue: { number: number } }
    expect(response.status, JSON.stringify(body)).toBe(202)
    expect(body.issue.number).toBe(41)
    expect(fixture.workers).toHaveLength(1)
    const worker = fixture.workers[0]
    expect(worker.bin).toBe(process.execPath)
    expect(worker.argv[0]).toBe(fileURLToPath(new URL('../../src/infrastructure/headless-call-worker.ts', import.meta.url)))
    expect(worker.descriptor.conversation).toBe(body.agent)
    expect(worker.descriptor.purpose).toBe('plan')
    expect(worker.descriptor.cwd).toBe(join(checkout, '.worktrees/41'))
    const args = worker.descriptor.argv as string[]
    expect(args[args.indexOf('--session-id') + 1]).toBe(body.agent)
    const options = worker.options as { env: NodeJS.ProcessEnv }
    expect(options.env.CT_PHASE_PROMPT).toBeUndefined()
    expect(options.env.CT_SESSION_HOOKS_URL).toBeUndefined()
    expect(options.env.CLAUDE_CODE_SESSION_ID).toBeUndefined()
    expect(await readFile(join(worker.argv[1], '..', 'prompt.md'), 'utf8')).toContain('41')
    const claim = fixture.tools.calls.findIndex((call) => call.argv[0]?.endsWith('dispatch-check.mjs'))
    const cut = fixture.tools.calls.findIndex((call) => call.argv.includes('worktree') && call.argv.includes('add'))
    expect(claim).toBeGreaterThan(-1)
    expect(cut).toBeGreaterThan(claim)
    const milestone = await fixture.request('/start-plan', { milestone: 'Fixture milestone' })
    const started = await milestone.json() as { agent: string, issue: { number: number } }
    expect(milestone.status, JSON.stringify(started)).toBe(202)
    expect(started.issue.number).toBe(42)
    expect(fixture.workers).toHaveLength(2)
    expect(fixture.workers[1].descriptor.conversation).toBe(started.agent)
    expect(fixture.workers[1].descriptor.purpose).toBe('plan')
    const milestoneArgs = fixture.workers[1].descriptor.argv as string[]
    expect(milestoneArgs[milestoneArgs.indexOf('--session-id') + 1]).toBe(started.agent)
    expect(fixture.tools.calls.filter((call) => call.argv.includes('--paginate')).map((call) => call.whole)).toEqual([true, true])
    expect(fixture.tools.calls.filter((call) => call.argv[0]?.endsWith('ct-groom.mjs')).map((call) => call.whole)).toEqual([true])
    const events = await fixture.request('/plan-events/41?repo=acme%2Fwidget')
    expect(events.status).toBe(200)
    const reader = events.body!.getReader()
    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: {"state":"writing"}\n\n')
    } finally { await reader.cancel() }
  })
})
