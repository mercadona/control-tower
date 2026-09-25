import { describe, it, expect, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InProcessApi } from './fixtures/in-process-api.ts'

type Failure = { code: string, detail: string }

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

describe('ct-api entrypoint composed in process', () => {
  afterEach(async () => {
    await InProcessApi.stopAll()
  })

  it('prints_the_port_it_bound_so_whoever_started_it_knows_where_to_knock', async () => {
    const api = await InProcessApi.started({ CT_API_PORT: '0' })

    expect(api.port).toBeGreaterThan(0)
    expect(api.said()).toBe(`${JSON.stringify({ port: api.port })}\n`)
  })

  it('a_bad_invocation_is_refused_with_the_reason_and_a_usage_line_that_names_the_command_the_documentation_starts_the_backend_with', async () => {
    const refusal = await InProcessApi.refused({ CT_API_PORT: 'a fistful of ports' })

    expect(refusal.status).toBe(2)
    expect(refusal.said[0]).toContain('CT_API_PORT')
    expect(refusal.said[1]).toMatch(/^usage: make run-backend \(no arguments;/)
  })

  it('a_freshly_started_backend_lists_no_session_because_nothing_has_been_asked_of_it_yet', async () => {
    const api = await InProcessApi.started({ CT_API_PORT: '0', SHELL: '/bin/sh' })

    const listed = await (await fetch(`http://127.0.0.1:${api.port}/sessions`)).json() as
      { sessions: { name: string }[] }

    expect(listed.sessions).toEqual([])
  })

  it('existing entrypoints start without an activation setting', async () => {
    const state = await mkdtemp(join(tmpdir(), 'ct-api-entrypoint-settings-'))
    try {
      const api = await InProcessApi.started({
        CT_API_PORT: '0', CLAUDE_CONFIG_DIR: state, CT_HARVEST_BQ_TABLE: '', SHELL: '/bin/sh',
      })

      expect(api.port).toBeGreaterThan(0)
    } finally {
      await rm(state, { recursive: true, force: true })
    }
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
      const api = await InProcessApi.started({ CT_API_PORT: '0', CLAUDE_CONFIG_DIR: state })
      const posted = await fetch(`http://127.0.0.1:${api.port}/implement-plan`, { method: 'POST' })
      const read = await fetch(`http://127.0.0.1:${api.port}/implement-plan`)

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
      await rm(state, { recursive: true, force: true })
    }
  })

  it('the_running_api_does_not_read_an_arbitrary_checkout_as_recorded_work', async () => {
    const api = await InProcessApi.started({ CT_API_PORT: '0' })
    const root = await RunFileFixture.inATemporaryRoot()

    try {
      const response = await fetch(
        `http://127.0.0.1:${api.port}/work-progress/${RunFileFixture.ISSUE}?root=${encodeURIComponent(root)}&repo=owner%2Fname`
      )

      expect(response.status).toBe(400)
      expect((await response.json() as Failure).code).toBe('unknown-work-field')
    } finally {
      await RunFileFixture.remove(root)
    }
  })

  it('the_retired_progress_route_is_absent_even_when_a_run_file_exists', async () => {
    const api = await InProcessApi.started({ CT_API_PORT: '0' })
    const root = await RunFileFixture.inATemporaryRoot('advise')

    try {
      const response = await fetch(
        `http://127.0.0.1:${api.port}/implement-progress/${RunFileFixture.ISSUE}?root=${encodeURIComponent(root)}&repo=owner%2Fname`
      )

      expect(response.status).toBe(404)
      expect((await response.json() as Failure).code).toBe('not-found')
    } finally {
      await RunFileFixture.remove(root)
    }
  })

  it('unified_progress_is_mounted_in_the_composed_api_and_refuses_unknown_work', async () => {
    const api = await InProcessApi.started({ CT_API_PORT: '0' })

    const response = await fetch(`http://127.0.0.1:${api.port}/work-progress/54?repo=jjponz%2Frepo-pulse`)

    expect(response.status).toBe(400)
    expect((await response.json() as Failure).code).toBe('work-not-found')
  })

  it('a_whole_request_to_spec_freeze_reaches_the_wiring_the_entrypoint_built', async () => {
    const state = await mkdtemp(join(tmpdir(), 'ct-api-spec-freeze-'))
    try {
      const api = await InProcessApi.started({ CT_API_PORT: '0', CLAUDE_CONFIG_DIR: state })

      const response = await fetch(`http://127.0.0.1:${api.port}/spec-freeze`)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'none' })
    } finally {
      await rm(state, { recursive: true, force: true })
    }
  })

  it('a started backend answers gate 2 with no session held', async () => {
    const state = await mkdtemp(join(tmpdir(), 'ct-api-epic-groom-'))
    try {
      const api = await InProcessApi.started({ CT_API_PORT: '0', CLAUDE_CONFIG_DIR: state })

      const response = await fetch(`http://127.0.0.1:${api.port}/epic-groom`)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'none' })
    } finally {
      await rm(state, { recursive: true, force: true })
    }
  })

  it('review_plan_is_no_longer_mounted_in_the_composed_api', async () => {
    const api = await InProcessApi.started({ CT_API_PORT: '0' })

    const response = await fetch(`http://127.0.0.1:${api.port}/review-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue: 33, repo: 'jjponz/repo-pulse', changes: 'parte la tarea 2' }),
    })

    expect(response.status).toBe(404)
    expect((await response.json() as Failure).code).toBe('not-found')
  })

  it('the mounted path refuses another method with an allow header', async () => {
    const api = await InProcessApi.started({ CT_API_PORT: '0' })

    const response = await fetch(`http://127.0.0.1:${api.port}/slices/42/message`)

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
  })
})
