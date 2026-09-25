import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCodeTranscript } from '../../../plugin/scripts/claude-code-usage.js'
import { issuesQueryFor } from '../../../plugin/scripts/gh-issues.js'
import { Entrypoint, TheCoordinatingSession } from './fixtures/ct-api-process.ts'

type Failure = { code: string, detail: string }
type ToolRow = { tool: string, installed: boolean, session: string, fix: string | null }

type DeliveredMetrics = { enabled: boolean, variable: string, destination: string | null }

type SurveyedTools = { ready: boolean, tools: ToolRow[], metricsDelivery: DeliveredMetrics }

class ACheckoutReachableByTwoPaths {
  static readonly ISSUE = 33
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
    await TheCoordinatingSessionEndpoint.prepareStoryReader(directory)

    return { directory, path: `${directory}:${process.env.PATH}` }
  }
}

class LifecycleFixture {
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
    await TheCoordinatingSessionEndpoint.prepareStoryReader(bin)
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
  static readonly STORY = 'STAFF-128'

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
      story: ARecordedConversation.STORY,
    }, null, 2)}\n`)

    return checkout
  }
}

class TheCoordinatingSessionEndpoint {
  static readonly TICKET = 'https://github.com/acme/widget/issues/1'

  static async prepareStoryReader(directory: string): Promise<void> {
    await writeFile(join(directory, 'gh'), [
      '#!/usr/bin/env node',
      "const argv = process.argv.slice(2)",
      `if (JSON.stringify(argv) !== JSON.stringify(['issue', 'view', '${TheCoordinatingSessionEndpoint.TICKET}', '--json', 'title,body,comments'])) throw new Error('unexpected gh request')`,
      "console.log(JSON.stringify({ title: 'Explore the checkout screen', body: '', comments: [] }))",
    ].join('\n') + '\n', { mode: 0o755 })
  }

  static open(port: number, checkout: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/coordinating-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: TheCoordinatingSessionEndpoint.TICKET,
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

class ACheckoutWithNothingReady {
  static readonly REPOSITORY = 'acme/idle-widget'
  static readonly STORY = 'IDLE-1'

  static async prepared(): Promise<{ base: string, root: string, state: string, bin: string, ghCalls: string }> {
    const base = await mkdtemp(join(tmpdir(), 'ct-api-idle-sweep-'))
    const root = join(base, 'checkout')
    const state = join(base, 'config')
    const bin = join(base, 'bin')
    await Promise.all([mkdir(root), mkdir(state), mkdir(bin)])
    ACheckoutWithNothingReady.#git(root, 'init', '-q')
    ACheckoutWithNothingReady.#git(root, 'config', 'user.email', 'idle@example.test')
    ACheckoutWithNothingReady.#git(root, 'config', 'user.name', 'Idle Fixture')
    ACheckoutWithNothingReady.#git(root, 'remote', 'add', 'origin', `https://github.com/${ACheckoutWithNothingReady.REPOSITORY}.git`)
    await writeFile(join(root, 'README.md'), '# Idle fixture\n')
    await mkdir(join(root, 'docs', 'superpowers', 'specs'), { recursive: true })
    await writeFile(
      join(root, 'docs', 'superpowers', 'specs', `${ACheckoutWithNothingReady.STORY}-execution.md`),
      '# The idle milestone — Execution spec\n',
    )
    ACheckoutWithNothingReady.#git(root, 'add', '.')
    ACheckoutWithNothingReady.#git(root, 'commit', '-q', '-m', 'idle fixture baseline')
    const ghCalls = join(base, 'gh-calls.ndjson')
    await writeFile(join(bin, 'gh'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      'const argv = process.argv.slice(2)',
      `fs.appendFileSync(${JSON.stringify(ghCalls)}, JSON.stringify(argv) + '\\n')`,
      "console.log('[]')",
    ].join('\n') + '\n', { mode: 0o755 })
    const controlTower = join(state, 'control-tower')
    await mkdir(controlTower, { recursive: true })
    await writeFile(join(controlTower, 'checkouts.json'), `${JSON.stringify({
      checkouts: [{ repo: ACheckoutWithNothingReady.REPOSITORY, path: root }],
    }, null, 2)}\n`)
    await mkdir(join(controlTower, 'coordinating-session'), { recursive: true })
    await writeFile(join(controlTower, 'coordinating-session', 'conversation.json'), `${JSON.stringify({
      conversation: '0f3c2a8e-5b1d-4c6e-9a7f-2d8b4e1c9a30',
      repo: ACheckoutWithNothingReady.REPOSITORY,
      root,
      story: ACheckoutWithNothingReady.STORY,
    }, null, 2)}\n`)

    return { base, root, state, bin, ghCalls }
  }

  static openIssueReadsIn(ghCalls: string): boolean {
    const calls = readFileSync(ghCalls, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[])

    return calls.length > 0 && calls.every((argv) => argv.includes(`query=${issuesQueryFor(['OPEN'])}`))
  }

  static environment({ state, bin }: { state: string, bin: string }): NodeJS.ProcessEnv {
    return {
      CT_API_PORT: '0',
      CLAUDE_CONFIG_DIR: state,
      SHELL: '/bin/sh',
      PATH: `${bin}:${process.env.PATH}`,
    }
  }

  static async remove(fixture: { base: string }): Promise<void> {
    await rm(fixture.base, { recursive: true, force: true })
  }

  static #git(cwd: string, ...argv: string[]): void {
    execFileSync('git', argv, { cwd, stdio: 'ignore' })
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

    const opened = await TheCoordinatingSessionEndpoint.open(firstPort, fixture.checkout)
    expect(opened.status).toBe(202)
    const first = await opened.json() as {
      conversation: string, target: string, session: { id: string },
    }
    await TheCoordinatingSessionEndpoint.waitsForOutput(firstPort, first.session.id, LifecycleFixture.READY)
    expect(await fixture.launchCount()).toBe(1)
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
    expect(await (await fetch(`http://127.0.0.1:${firstPort}/spec-freeze`)).json())
      .toEqual({ status: 'no-spec', target: null })
    expect(await (await fetch(`http://127.0.0.1:${firstPort}/epic-groom`)).json())
      .toEqual({ status: 'no-spec', target: null })
    expect(fixture.checkoutSnapshot()).toEqual(beforeClose)
    expect(unrelated.exitCode).toBeNull()
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow()

    const sameBackendReplacement = await TheCoordinatingSessionEndpoint.open(firstPort, fixture.checkout)
    expect(sameBackendReplacement.status).toBe(202)
    const second = await sameBackendReplacement.json() as {
      conversation: string, target: string, session: { id: string },
    }
    expect(second.conversation).not.toBe(first.conversation)
    expect(second.target).not.toBe(first.target)
    await TheCoordinatingSessionEndpoint.waitsForOutput(firstPort, second.session.id, LifecycleFixture.READY)
    expect(await fixture.launchCount()).toBe(2)
    expect((await TheCoordinatingSessionEndpoint.close(firstPort, second.conversation, second.target)).status).toBe(200)

    await Entrypoint.killAll()
    const restartedPort = await Entrypoint.listening(environment)
    await expect.poll(async () => {
      return await (await fetch(`http://127.0.0.1:${restartedPort}/coordinating-session`)).json()
    }).toEqual({ status: 'none', operation: 'idle' })
    expect(await fixture.launchCount()).toBe(2)

    const replacementAfterRestart = await TheCoordinatingSessionEndpoint.open(restartedPort, fixture.checkout)
    expect(replacementAfterRestart.status).toBe(202)
    const third = await replacementAfterRestart.json() as { conversation: string, target: string, session: { id: string } }
    expect(third.conversation).not.toBe(second.conversation)
    expect(third.target).not.toBe(second.target)
    await TheCoordinatingSessionEndpoint.waitsForOutput(restartedPort, third.session.id, LifecycleFixture.READY)
    expect(await fixture.launchCount()).toBe(3)
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
      TheCoordinatingSessionEndpoint.open(port, checkout.physical),
      TheCoordinatingSessionEndpoint.open(port, checkout.physical),
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
      const port = await Entrypoint.makeRunBackendWithoutReinstalling({
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

  it('the_running_api_does_not_read_an_arbitrary_checkout_as_recorded_work', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })
    const root = await RunFileFixture.inATemporaryRoot()

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/work-progress/${RunFileFixture.ISSUE}?root=${encodeURIComponent(root)}&repo=owner%2Fname`
      )

      expect(response.status).toBe(400)
      expect((await response.json() as Failure).code).toBe('unknown-work-field')
    } finally {
      await RunFileFixture.remove(root)
    }
  })

  it('the_retired_progress_route_is_absent_even_when_a_run_file_exists', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })
    const root = await RunFileFixture.inATemporaryRoot('advise')

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/implement-progress/${RunFileFixture.ISSUE}?root=${encodeURIComponent(root)}&repo=owner%2Fname`
      )

      expect(response.status).toBe(404)
      expect((await response.json() as Failure).code).toBe('not-found')
    } finally {
      await RunFileFixture.remove(root)
    }
  })

  it('unified_progress_is_mounted_in_the_real_process_and_refuses_unknown_work', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    const response = await fetch(`http://127.0.0.1:${port}/work-progress/54?repo=jjponz%2Frepo-pulse`)

    expect(response.status).toBe(400)
    expect((await response.json() as Failure).code).toBe('work-not-found')
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

  it('the runtime sweeps the checkout of its held story and mounts the slice message path', async () => {
    const fixture = await ACheckoutWithNothingReady.prepared()
    try {
      const started = await Entrypoint.started(ACheckoutWithNothingReady.environment(fixture))

      const response = await fetch(`http://127.0.0.1:${started.port}/slices/42/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })

      expect(response.status).not.toBe(404)
      expect(await response.json()).toMatchObject({ code: 'malformed-repo' })
      await new Promise((resolve) => setTimeout(resolve, 1000))
      expect(ACheckoutWithNothingReady.openIssueReadsIn(fixture.ghCalls)).toBe(true)
      expect(started.saidLater()).not.toContain('could not survey')
      expect(started.saidLater()).not.toContain('relay:')
    } finally {
      await ACheckoutWithNothingReady.remove(fixture)
    }
  }, 30_000)

  it('the mounted path refuses another method with an allow header', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    const response = await fetch(`http://127.0.0.1:${port}/slices/42/message`)

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
  })
})
