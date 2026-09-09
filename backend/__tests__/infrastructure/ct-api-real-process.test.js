import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

class HostCheckout {
  static #HERE = dirname(fileURLToPath(import.meta.url))
  static #NAMED = /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/

  static path() {
    return HostCheckout.#HERE
  }

  static repository() {
    const url = execFileSync('git', ['-C', HostCheckout.#HERE, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
    const named = url.match(HostCheckout.#NAMED)
    if (named === null) {
      throw new Error(`the origin of this checkout is ${JSON.stringify(url)}, and no owner/name can be read out of it`)
    }

    return named[1]
  }
}

class Entrypoint {
  static #PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'infrastructure', 'ct-api.mjs')
  static #TIMEOUT_MS = 30_000
  static #spawned = []

  static startPlan(port, body = '{"id":"ABC-123"}') {
    return fetch(`http://127.0.0.1:${port}/start-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  }

  static killAll() {
    for (const child of Entrypoint.#spawned.splice(0)) child.kill('SIGKILL')
  }

  static async listening(environment) {
    return (await Entrypoint.#started(environment)).port
  }

  static async #started(environment) {
    const child = spawn(process.execPath, [Entrypoint.#PATH], {
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    Entrypoint.#spawned.push(child)
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })

    return new Promise((resolve, reject) => {
      let stdout = ''
      const timer = setTimeout(() => reject(new Error(`no port line in ${stdout}`)), Entrypoint.#TIMEOUT_MS)
      child.stdout.on('data', (chunk) => {
        stdout += chunk
        const end = stdout.indexOf('\n')
        if (end === -1) return
        clearTimeout(timer)
        resolve({ port: JSON.parse(stdout.slice(0, end)).port, saidLater: () => stderr })
      })
      child.once('error', reject)
    })
  }

  static async recovering(environment) {
    const started = await Entrypoint.#started(environment)
    for (let waited = 0; waited < 60; waited += 1) {
      if (started.saidLater().length > 0) break
      await new Promise((wake) => setTimeout(wake, 100))
    }

    return started
  }
}

class ACmuxWithNoWindows {
  static SCRIPT = [
    '#!/bin/sh',
    'if [ "$1" = "list-windows" ]; then echo \'[]\'; exit 0; fi',
    'exit 1',
  ].join('\n')

  static async onThePath() {
    const directory = await mkdtemp(join(tmpdir(), 'ct-api-cmux-'))
    const binary = join(directory, 'cmux')
    await writeFile(binary, `${ACmuxWithNoWindows.SCRIPT}\n`, { mode: 0o755 })

    return { directory, path: `${directory}:${process.env.PATH}` }
  }
}

class ACheckoutReachableByTwoPaths {
  static ISSUE = 33
  static REPOSITORY = 'acme/widget'
  static TITLE = `ct-plan-acme__widget-issue-${ACheckoutReachableByTwoPaths.ISSUE}`

  static #git(cwd, ...argv) {
    execFileSync('git', argv, { cwd, stdio: 'ignore' })
  }

  static async cut() {
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
  static SCRIPT = [
    '#!/bin/sh',
    'if [ "$1" = "list-windows" ]; then echo \'[{"id":"w1"}]\'; exit 0; fi',
    'if [ "$1" = "workspace" ]; then printf %s "$CMUX_FAKE"; exit 0; fi',
    'exit 1',
  ].join('\n')

  static async attending(worktree, ref = 'workspace:97') {
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
  static SCRIPT = [
    '#!/bin/sh',
    'echo "Error: ERROR: Access denied - only processes started inside cmux can connect" >&2',
    'exit 1',
  ].join('\n')

  static async onThePath() {
    const directory = await mkdtemp(join(tmpdir(), 'ct-api-cmux-refusing-'))
    const binary = join(directory, 'cmux')
    await writeFile(binary, `${ACmuxThatRefusesTheConnection.SCRIPT}\n`, { mode: 0o755 })

    return { directory, path: `${directory}:${process.env.PATH}` }
  }
}

class ExternalTools {
  static async cmuxRowOf(port) {
    const response = await fetch(`http://127.0.0.1:${port}/external-tools`)
    const body = await response.json()
    const row = body.tools.find((candidate) => candidate.tool === 'cmux')

    return { installed: row.installed, session: row.session, fix: row.fix }
  }
}

class RunFileFixture {
  static ISSUE = 7

  static async inATemporaryRoot(step = 'implement') {
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

  static async remove(root) {
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
    const served = await (await fetch(`http://127.0.0.1:${port}/active-plans`)).json()

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
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    const response = await fetch(`http://127.0.0.1:${port}/external-tools`)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.tools.map((row) => row.tool)).toEqual(['gh', 'acli', 'claude', 'git', 'bq', 'cmux'])
    expect(body.tools.every((row) => ['ready', 'missing', 'unknown'].includes(row.session))).toBe(true)
    const claude = body.tools.find((row) => row.tool === 'claude')
    expect(claude.session).toBe('unknown')
    expect(claude.fix).toBe('claude, then /login — not observable from this process')
  }, 600_000)

  it('a_whole_request_reaches_acli_so_a_typo_in_the_key_that_wires_the_user_stories_would_show_up_here_and_not_only_in_the_first_real_use', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    const response = await Entrypoint.startPlan(
      port,
      `{"id":"ZZZ-999999","repo":${JSON.stringify(HostCheckout.repository())},"path":${JSON.stringify(HostCheckout.path())}}`
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe('user-story-not-read')
    expect(body.detail).toMatch(/^acli jira failed: /)
  })

  it('the_progress_of_a_slice_is_served_by_the_running_api', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })
    const root = await RunFileFixture.inATemporaryRoot()

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/implement-progress/${RunFileFixture.ISSUE}?root=${encodeURIComponent(root)}&repo=owner%2Fname`
      )

      expect(response.status).toBe(200)
      const body = await response.json()
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
      const body = await response.json()
      expect(body.step).toBe('advise')
      expect(body.task).toBe(1)
    } finally {
      await RunFileFixture.remove(root)
    }
  })

  it('review_plan_is_mounted_in_the_real_process_and_not_only_in_the_test_server', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    const response = await fetch(`http://127.0.0.1:${port}/review-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue: 33, repo: 'jjponz/repo-pulse', changes: 'parte la tarea 2' }),
    })

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('no-live-planning-session')
  })
})
