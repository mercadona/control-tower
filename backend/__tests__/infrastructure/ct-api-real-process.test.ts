import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type Started = { port: number, saidLater: () => string }
type Failure = { code: string, detail: string }
type ToolRow = { tool: string, installed: boolean, session: string, fix: string | null }

type DeliveredMetrics = { enabled: boolean, variable: string, destination: string | null }

type SurveyedTools = { ready: boolean, tools: ToolRow[], metricsDelivery: DeliveredMetrics }

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
  static readonly #TIMEOUT_MS = 30_000
  static readonly #spawned: ChildProcess[] = []

  static startPlan(port: number, body: string = '{"id":"ABC-123"}'): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/start-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  }

  static killAll(): void {
    for (const child of Entrypoint.#spawned.splice(0)) child.kill('SIGKILL')
  }

  static async listening(environment: NodeJS.ProcessEnv): Promise<number> {
    return (await Entrypoint.#started(environment)).port
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
      if (started.saidLater().length > 0) break
      await new Promise((wake) => setTimeout(wake, 100))
    }

    return started
  }
}

class ACmuxWithNoWindows {
  static readonly SCRIPT = [
    '#!/bin/sh',
    'if [ "$1" = "list-windows" ]; then echo \'[]\'; exit 0; fi',
    'exit 1',
  ].join('\n')

  static async onThePath(): Promise<{ directory: string, path: string }> {
    const directory = await mkdtemp(join(tmpdir(), 'ct-api-cmux-'))
    const binary = join(directory, 'cmux')
    await writeFile(binary, `${ACmuxWithNoWindows.SCRIPT}\n`, { mode: 0o755 })

    return { directory, path: `${directory}:${process.env.PATH}` }
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

class ACmuxAttendingOnePlan {
  static readonly SCRIPT = [
    '#!/bin/sh',
    'if [ "$1" = "list-windows" ]; then echo \'[{"id":"w1"}]\'; exit 0; fi',
    'if [ "$1" = "workspace" ]; then printf %s "$CMUX_FAKE"; exit 0; fi',
    'exit 1',
  ].join('\n')

  static async attending(
    worktree: string,
    ref: string = 'workspace:97'
  ): Promise<{ directory: string, path: string, said: string }> {
    const directory = await mkdtemp(join(tmpdir(), 'ct-api-cmux-plan-'))
    await writeFile(join(directory, 'cmux'), `${ACmuxAttendingOnePlan.SCRIPT}\n`, { mode: 0o755 })

    return {
      directory,
      path: `${directory}:${process.env.PATH}`,
      said: JSON.stringify({
        workspaces: [{
          custom_title: ACheckoutReachableByTwoPaths.TITLE,
          current_directory: worktree,
          has_custom_title: true,
          ref,
        }],
      }),
    }
  }
}

class ACmuxThatRefusesTheConnection {
  static readonly SCRIPT = [
    '#!/bin/sh',
    'echo "Error: ERROR: Access denied - only processes started inside cmux can connect" >&2',
    'exit 1',
  ].join('\n')

  static async onThePath(): Promise<{ directory: string, path: string }> {
    const directory = await mkdtemp(join(tmpdir(), 'ct-api-cmux-refusing-'))
    const binary = join(directory, 'cmux')
    await writeFile(binary, `${ACmuxThatRefusesTheConnection.SCRIPT}\n`, { mode: 0o755 })

    return { directory, path: `${directory}:${process.env.PATH}` }
  }
}

class ExternalTools {
  static readonly DESTINATION = 'fixture-project:fixture_dataset.fixture_table'

  static async cmuxRowOf(port: number): Promise<{ installed: boolean, session: string, fix: string | null }> {
    const response = await fetch(`http://127.0.0.1:${port}/external-tools`)
    const body = await response.json() as { tools: ToolRow[] }
    const row = body.tools.find((candidate) => candidate.tool === 'cmux') as ToolRow

    return { installed: row.installed, session: row.session, fix: row.fix }
  }
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

describe('ct-api entrypoint', () => {
  afterEach(() => {
    Entrypoint.killAll()
  })

  it('the_plans_in_flight_are_recovered_without_waiting_for_anyone_to_ask_for_them', async () => {
    const state = await mkdtemp(join(tmpdir(), 'ct-api-recovery-'))
    const orphan = await mkdtemp(join(tmpdir(), 'ct-api-not-a-repo-'))
    await mkdir(join(state, 'control-tower'), { recursive: true })
    await writeFile(
      join(state, 'control-tower', 'checkouts.json'),
      `${JSON.stringify({ roots: [orphan] }, null, 2)}\n`
    )
    const answering = await ACmuxWithNoWindows.onThePath()

    const started = await Entrypoint.recovering({
      CT_API_PORT: '0', CLAUDE_CONFIG_DIR: state, PATH: answering.path,
    })

    expect(started.saidLater()).toContain(`plans in flight: ${orphan}`)
    await RunFileFixture.remove(state)
    await RunFileFixture.remove(orphan)
    await RunFileFixture.remove(answering.directory)
  })

  it('a_plan_whose_session_names_one_path_and_git_the_other_is_served_with_its_agent_and_its_clone_remembered', async () => {
    const checkout = await ACheckoutReachableByTwoPaths.cut()
    const state = await mkdtemp(join(tmpdir(), 'ct-api-two-paths-state-'))
    const cmux = await ACmuxAttendingOnePlan.attending(
      join(checkout.logical, '.worktrees', String(ACheckoutReachableByTwoPaths.ISSUE))
    )

    const port = await Entrypoint.listening({
      CT_API_PORT: '0', CLAUDE_CONFIG_DIR: state, PATH: cmux.path, CMUX_FAKE: cmux.said,
    })
    const served = await (await fetch(`http://127.0.0.1:${port}/active-plans`)).json() as
      { plans: { plan: unknown }[] }

    expect(served.plans).toHaveLength(1)
    expect(served.plans[0].plan).toMatchObject({
      issue: { number: ACheckoutReachableByTwoPaths.ISSUE },
      agent: 'workspace:97',
      repo: ACheckoutReachableByTwoPaths.REPOSITORY,
      worktree: join(checkout.physical, '.worktrees', String(ACheckoutReachableByTwoPaths.ISSUE)),
    })
    await RunFileFixture.remove(checkout.base)
    await RunFileFixture.remove(state)
    await RunFileFixture.remove(cmux.directory)
  })

  it('prints_the_port_it_bound_so_whoever_started_it_knows_where_to_knock', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    expect(port).toBeGreaterThan(0)
  })

  it('the_cmux_row_is_ready_only_when_the_cmux_on_the_path_answers_the_query', async () => {
    const answering = await ACmuxWithNoWindows.onThePath()
    const refusing = await ACmuxThatRefusesTheConnection.onThePath()

    const answered = await Entrypoint.listening({ CT_API_PORT: '0', PATH: answering.path })
    const refused = await Entrypoint.listening({ CT_API_PORT: '0', PATH: refusing.path })

    expect(await ExternalTools.cmuxRowOf(answered)).toEqual({ installed: true, session: 'ready', fix: null })
    expect(await ExternalTools.cmuxRowOf(refused)).toEqual({
      installed: true,
      session: 'missing',
      fix: 'update cmux and restart the app, then start this backend from a terminal inside cmux',
    })
  })

  it('a_whole_request_to_external_tools_reaches_every_probe_client_the_entrypoint_wired_up', async () => {
    const port = await Entrypoint.listening({
      CT_API_PORT: '0', CT_HARVEST_BQ_TABLE: ExternalTools.DESTINATION,
    })

    const response = await fetch(`http://127.0.0.1:${port}/external-tools`)

    expect(response.status).toBe(200)
    const body = await response.json() as SurveyedTools
    expect(body.tools.map((row) => row.tool)).toEqual(['gh', 'acli', 'claude', 'git', 'bq', 'cmux'])
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

  it('review_plan_is_mounted_in_the_real_process_and_not_only_in_the_test_server', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    const response = await fetch(`http://127.0.0.1:${port}/review-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue: 33, repo: 'jjponz/repo-pulse', changes: 'parte la tarea 2' }),
    })

    expect(response.status).toBe(400)
    expect((await response.json() as Failure).code).toBe('no-live-planning-session')
  })
})
