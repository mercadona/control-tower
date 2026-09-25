import { describe, it, expect, afterEach } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCodeTranscript } from '../../../plugin/scripts/claude-code-usage.js'
import { issuesQueryFor } from '../../../plugin/scripts/gh-issues.js'
import { AcliUserStories } from '../../src/infrastructure/acli-user-stories.ts'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.ts'
import { HostProcesses, InProcessApi } from './fixtures/in-process-api.ts'
import { LivingProcessGroups } from './fixtures/living-process-groups.ts'
import { Capture, ScriptedConversation } from './fixtures/scripted-conversation.ts'
import { ScriptedTerminals } from './fixtures/scripted-terminals.ts'

type Failure = { code: string, detail: string }
type ToolRow = { tool: string, installed: boolean, session: string, fix: string | null }
type DeliveredMetrics = { enabled: boolean, variable: string, destination: string | null }
type SurveyedTools = { ready: boolean, tools: ToolRow[], metricsDelivery: DeliveredMetrics }

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

class ExternalToolsProbe {
  static readonly DESTINATION = 'fixture-project:fixture_dataset.fixture_table'
  static readonly #BINARIES = ['gh', 'acli', 'claude', 'git', 'ssh', 'bq', 'gcloud']
  static readonly #paths: string[] = []

  static async started(harvestTable: string): Promise<{ api: InProcessApi, conversation: ScriptedConversation }> {
    const path = await mkdtemp(join(tmpdir(), 'ct-api-external-tools-path-'))
    ExternalToolsProbe.#paths.push(path)
    await Promise.all(
      ExternalToolsProbe.#BINARIES.map((name) => writeFile(join(path, name), '', { mode: 0o755 }))
    )
    const conversation = new ScriptedConversation()
      .answering({ binary: 'gh', argv: ['auth', 'status'] }, Capture.read('gh', 'auth-status'))
      .answering({ binary: 'acli', argv: ['jira', 'auth', 'status'] }, Capture.read('acli', 'jira-auth-status'))
      .answering({ binary: 'claude', argv: ['auth', 'status'] }, Capture.read('claude', 'auth-status'))
      .answering(
        { binary: 'ssh', argv: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-T', 'git@github.com'] },
        Capture.read('ssh', 'github-batch-mode'),
      )
      .answering(
        { binary: 'gcloud', argv: ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'] },
        Capture.read('gcloud', 'auth-list-active'),
      )
    const api = await InProcessApi.started(
      { CT_API_PORT: '0', CT_HARVEST_BQ_TABLE: harvestTable, PATH: path },
      new HostProcesses({ conversation, table: new LivingProcessGroups([]) }),
    )

    return { api, conversation }
  }

  static async cleanUp(): Promise<void> {
    const paths = ExternalToolsProbe.#paths.splice(0)
    await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })))
  }
}

class ScriptedCheckout {
  static readonly REPOSITORY = 'acme/widget'
  static readonly REPOSITORY_URL = `git@github.com:${ScriptedCheckout.REPOSITORY}.git`
  static readonly BASE = 'main'
  static readonly #SENTINEL = 'committed sentinel\n'
  static readonly #UNTRACKED = 'untracked work must survive\n'
  static readonly #GIT_VERSION = 'git version 2.50.1 (Apple Git-155)'
  static readonly #DATE = '2026-09-25'
  static readonly #DESTRUCTIVE = ['checkout', 'reset', 'clean', 'stash', 'restore']

  static async prepared(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'ct-api-coordinating-checkout-'))
    await writeFile(join(root, 'sentinel.txt'), ScriptedCheckout.#SENTINEL)
    await writeFile(join(root, 'untracked.txt'), ScriptedCheckout.#UNTRACKED)

    return root
  }

  static async remains(root: string): Promise<boolean> {
    const sentinel = await readFile(join(root, 'sentinel.txt'), 'utf8')
    const untracked = await readFile(join(root, 'untracked.txt'), 'utf8')

    return sentinel === ScriptedCheckout.#SENTINEL && untracked === ScriptedCheckout.#UNTRACKED
  }

  static answering(conversation: ScriptedConversation, root: string): ScriptedConversation {
    return conversation
      .answering(
        { binary: 'git', argv: ['-C', root, 'remote', 'get-url', 'origin'] },
        ScriptedCheckout.#printing(`${ScriptedCheckout.REPOSITORY_URL}\n`),
      )
      .answering(
        { binary: 'git', argv: ['-C', root, 'rev-parse', '--show-toplevel'] },
        ScriptedCheckout.#printing(`${root}\n`),
      )
      .answering(
        { binary: 'git', argv: ['-C', root, 'symbolic-ref', 'refs/remotes/origin/HEAD'] },
        ScriptedCheckout.#printing(`refs/remotes/origin/${ScriptedCheckout.BASE}\n`),
      )
      .answering(
        { binary: 'git', argv: ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'] },
        ScriptedCheckout.#printing(`${ScriptedCheckout.BASE}\n`),
      )
      .answering(
        { binary: 'git', argv: ['-C', root, 'fetch', 'origin', ScriptedCheckout.BASE] },
        ScriptedCheckout.#printing(''),
      )
      .answering(
        { binary: 'git', argv: ['-C', root, 'rev-parse', '--verify', '--quiet', `origin/${ScriptedCheckout.BASE}^{commit}`] },
        ScriptedCheckout.#printing('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n'),
      )
      .answering(
        { binary: 'git', argv: ['-C', root, 'merge', '--ff-only', `origin/${ScriptedCheckout.BASE}`] },
        ScriptedCheckout.#printing('Already up to date.\n'),
      )
      .answering(
        { binary: 'git', argv: ['-C', root, 'worktree', 'list', '--porcelain'] },
        ScriptedCheckout.#printing(`worktree ${root}\nHEAD a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\nbranch refs/heads/${ScriptedCheckout.BASE}\n\n`),
      )
  }

  static requestedNoDestructiveGitCommand(conversation: ScriptedConversation): boolean {
    return conversation.asked.every((request) => request.binary !== 'git' ||
      request.argv.every((token) => !ScriptedCheckout.#DESTRUCTIVE.includes(token)))
  }

  static #printing(stdout: string): Capture {
    return new Capture({
      command: 'git', version: ScriptedCheckout.#GIT_VERSION, date: ScriptedCheckout.#DATE, code: 0, stdout, stderr: '',
    })
  }
}

class CoordinatingSessionEndpoint {
  static readonly TICKET = 'https://github.com/mercadona/control-tower/issues/154'
  static readonly INPUT = 'typed-through-the-api'

  static conversationFor(root: string): ScriptedConversation {
    return ScriptedCheckout.answering(
      new ScriptedConversation().answering(
        { binary: 'gh', argv: ['issue', 'view', CoordinatingSessionEndpoint.TICKET, '--json', 'title,body,comments'] },
        Capture.read('gh', 'issue-view-154'),
      ),
      root,
    )
  }

  static open(port: number, checkout: string): Promise<Response> {
    return CoordinatingSessionEndpoint.openFor(port, CoordinatingSessionEndpoint.TICKET, checkout)
  }

  static openFor(port: number, id: string, checkout: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/coordinating-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, path: checkout }),
    })
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

  static async brainstormingsOf(port: number): Promise<number> {
    const listed = await (await fetch(`http://127.0.0.1:${port}/sessions`)).json() as { sessions: { name: string }[] }

    return listed.sessions.filter((session) => session.name === 'brainstorming').length
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

class ARecordedConversation {
  static readonly ID = '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'
  static readonly STORY = 'STAFF-128'

  static async withATranscriptUnder(config: string, root: string): Promise<void> {
    await ARecordedConversation.#recordedUnder(config, root)
    const folder = ClaudeCodeTranscript.folderFor(root)
    const transcript = join(config, ClaudeCodeTranscript.FOLDER, folder)
    await mkdir(transcript, { recursive: true })
    await writeFile(join(transcript, `${ARecordedConversation.ID}${ClaudeCodeTranscript.EXTENSION}`), '{"type":"user"}\n')
  }

  static withNoTranscriptAnywhere(config: string, root: string): Promise<void> {
    return ARecordedConversation.#recordedUnder(config, root)
  }

  static async #recordedUnder(config: string, root: string): Promise<void> {
    const recorded = join(config, 'control-tower', 'coordinating-session')
    await mkdir(recorded, { recursive: true })
    await writeFile(join(recorded, 'conversation.json'), `${JSON.stringify({
      conversation: ARecordedConversation.ID,
      repo: ScriptedCheckout.REPOSITORY,
      root,
      story: ARecordedConversation.STORY,
    }, null, 2)}\n`)
  }
}

class ACheckoutWithNothingReady {
  static readonly REPOSITORY = 'jjponz/repo-pulse'
  static readonly REPOSITORY_URL = `https://github.com/${ACheckoutWithNothingReady.REPOSITORY}.git`
  static readonly STORY = 'IDLE-1'
  static readonly CONVERSATION = '0f3c2a8e-5b1d-4c6e-9a7f-2d8b4e1c9a30'
  static readonly #GIT_VERSION = 'git version 2.50.1 (Apple Git-155)'
  static readonly #DATE = '2026-09-25'
  static readonly #SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

  static async prepared(): Promise<{ base: string, root: string, config: string, conversation: ScriptedConversation }> {
    const base = await mkdtemp(join(tmpdir(), 'ct-api-idle-sweep-'))
    const root = join(base, 'checkout')
    const config = join(base, 'config')
    await mkdir(join(root, 'docs', 'superpowers', 'specs'), { recursive: true })
    await writeFile(
      join(root, 'docs', 'superpowers', 'specs', `${ACheckoutWithNothingReady.STORY}-execution.md`),
      '# The idle milestone — Execution spec\n',
    )
    const controlTower = join(config, 'control-tower')
    await mkdir(join(controlTower, 'coordinating-session'), { recursive: true })
    await writeFile(join(controlTower, 'checkouts.json'), `${JSON.stringify({
      checkouts: [{ repo: ACheckoutWithNothingReady.REPOSITORY, path: root }],
    }, null, 2)}\n`)
    await writeFile(join(controlTower, 'coordinating-session', 'conversation.json'), `${JSON.stringify({
      conversation: ACheckoutWithNothingReady.CONVERSATION,
      repo: ACheckoutWithNothingReady.REPOSITORY,
      root,
      story: ACheckoutWithNothingReady.STORY,
    }, null, 2)}\n`)

    const conversation = new ScriptedConversation()
      .answering(
        { binary: 'git', argv: ['-C', root, 'remote', 'get-url', 'origin'] },
        ACheckoutWithNothingReady.#git(`${ACheckoutWithNothingReady.REPOSITORY_URL}\n`),
      )
      .answering(
        { binary: 'git', argv: ['-C', root, 'worktree', 'list', '--porcelain'] },
        ACheckoutWithNothingReady.#git(`worktree ${root}\nHEAD ${ACheckoutWithNothingReady.#SHA}\nbranch refs/heads/main\n\n`),
      )
      .answering(
        { binary: 'git', argv: ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'] },
        ACheckoutWithNothingReady.#git('main\n'),
      )
      .answering(
        { binary: 'gh', argv: ACheckoutWithNothingReady.#openIssuesArgv() },
        Capture.read('gh', 'graphql-open-issues-repo-pulse'),
      )

    return { base, root, config, conversation }
  }

  static environment(config: string): NodeJS.ProcessEnv {
    return { CT_API_PORT: '0', CLAUDE_CONFIG_DIR: config, SHELL: '/bin/sh' }
  }

  static openIssueCallsCarryTheOpenQuery(conversation: ScriptedConversation): boolean {
    const calls = conversation.asked.filter((request) => request.binary === 'gh')

    return calls.length > 0 && calls.every((request) => request.argv.includes(`query=${issuesQueryFor(['OPEN'])}`))
  }

  static async remove(base: string): Promise<void> {
    await rm(base, { recursive: true, force: true })
  }

  static #openIssuesArgv(): string[] {
    const [owner, name] = ACheckoutWithNothingReady.REPOSITORY.split('/')

    return [
      'api', 'graphql', '--paginate', '--slurp',
      '-f', `query=${issuesQueryFor(['OPEN'])}`,
      '-f', `owner=${owner}`, '-f', `name=${name}`,
    ]
  }

  static #git(stdout: string): Capture {
    return new Capture({
      command: 'git', version: ACheckoutWithNothingReady.#GIT_VERSION, date: ACheckoutWithNothingReady.#DATE, code: 0, stdout, stderr: '',
    })
  }
}

describe('ct-api entrypoint composed in process', () => {
  afterEach(async () => {
    await InProcessApi.stopAll()
    await ExternalToolsProbe.cleanUp()
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

  it('a_whole_request_to_external_tools_reaches_every_probe_client_the_entrypoint_wired_up', async () => {
    const { api, conversation } = await ExternalToolsProbe.started(ExternalToolsProbe.DESTINATION)

    const response = await fetch(`http://127.0.0.1:${api.port}/external-tools`)

    expect(response.status).toBe(200)
    const body = await response.json() as SurveyedTools
    expect(body.tools.map((row) => row.tool)).toEqual(['gh', 'acli', 'claude', 'git', 'bq'])
    expect(body.tools.every((row) => ['ready', 'missing', 'unknown'].includes(row.session))).toBe(true)
    const claude = body.tools.find((row) => row.tool === 'claude') as ToolRow
    expect(claude.fix).toBe(claude.session === 'ready' ? null : 'claude auth login')
    expect(body.metricsDelivery).toEqual({
      enabled: true,
      variable: 'CT_HARVEST_BQ_TABLE',
      destination: ExternalToolsProbe.DESTINATION,
    })
    expect(conversation.asked.map((request) => request.binary)).toEqual(['gh', 'acli', 'claude', 'ssh', 'gcloud'])
  })

  it('without_the_harvest_table_the_entrypoint_answers_a_disabled_delivery_read_from_the_startup_configuration', async () => {
    const { api } = await ExternalToolsProbe.started('')

    const response = await fetch(`http://127.0.0.1:${api.port}/external-tools`)

    const body = await response.json() as SurveyedTools
    expect(body.metricsDelivery).toEqual({
      enabled: false, variable: 'CT_HARVEST_BQ_TABLE', destination: null,
    })
  })

  it('a session can be closed and replaced and stays closed after backend restart', async () => {
    const root = await ScriptedCheckout.prepared()
    const config = await mkdtemp(join(tmpdir(), 'ct-api-coordinating-restart-'))
    const conversation = CoordinatingSessionEndpoint.conversationFor(root)
    const table = new ScriptedTerminals()
    const processes = new HostProcesses({ conversation, table })
    const environment = { CT_API_PORT: '0', CLAUDE_CONFIG_DIR: config, SHELL: '/bin/sh' }

    try {
      const api1 = await InProcessApi.started(environment, processes)

      const opened = await CoordinatingSessionEndpoint.open(api1.port, root)
      expect(opened.status).toBe(202)
      const first = await opened.json() as { conversation: string, target: string, session: { id: string } }
      await CoordinatingSessionEndpoint.waitsForOutput(api1.port, first.session.id, ScriptedTerminals.READY)
      expect(table.opened.length).toBe(1)
      expect((await CoordinatingSessionEndpoint.type(
        api1.port, first.session.id, `${CoordinatingSessionEndpoint.INPUT}\r`
      )).status).toBe(202)
      await expect.poll(() => table.typed.includes(CoordinatingSessionEndpoint.INPUT)).toBe(true)

      const closed = await CoordinatingSessionEndpoint.close(api1.port, first.conversation, first.target)
      expect(closed.status).toBe(200)
      expect(await closed.json()).toEqual({ status: 'closed', conversation: first.conversation, target: first.target })
      expect(await (await fetch(`http://127.0.0.1:${api1.port}/coordinating-session`)).json())
        .toEqual({ status: 'none', operation: 'idle' })
      expect(await CoordinatingSessionEndpoint.brainstormingsOf(api1.port)).toBe(0)
      expect(await (await fetch(`http://127.0.0.1:${api1.port}/spec-freeze`)).json())
        .toEqual({ status: 'no-spec', target: null })
      expect(await (await fetch(`http://127.0.0.1:${api1.port}/epic-groom`)).json())
        .toEqual({ status: 'no-spec', target: null })

      const sameBackendReplacement = await CoordinatingSessionEndpoint.open(api1.port, root)
      expect(sameBackendReplacement.status).toBe(202)
      const second = await sameBackendReplacement.json() as { conversation: string, target: string, session: { id: string } }
      expect(second.conversation).not.toBe(first.conversation)
      expect(second.target).not.toBe(first.target)
      await CoordinatingSessionEndpoint.waitsForOutput(api1.port, second.session.id, ScriptedTerminals.READY)
      expect(table.opened.length).toBe(2)
      expect((await CoordinatingSessionEndpoint.close(api1.port, second.conversation, second.target)).status).toBe(200)

      await api1.stop()
      const api2 = await InProcessApi.started(environment, processes)
      await expect.poll(async () => await (await fetch(`http://127.0.0.1:${api2.port}/coordinating-session`)).json())
        .toEqual({ status: 'none', operation: 'idle' })
      expect(table.opened.length).toBe(2)

      const replacementAfterRestart = await CoordinatingSessionEndpoint.open(api2.port, root)
      expect(replacementAfterRestart.status).toBe(202)
      const third = await replacementAfterRestart.json() as { conversation: string, target: string, session: { id: string } }
      expect(third.conversation).not.toBe(second.conversation)
      expect(third.target).not.toBe(second.target)
      await CoordinatingSessionEndpoint.waitsForOutput(api2.port, third.session.id, ScriptedTerminals.READY)
      expect(table.opened.length).toBe(3)

      expect(table.typed).toContain(CoordinatingSessionEndpoint.INPUT)
      expect(await ScriptedCheckout.remains(root)).toBe(true)
      expect(ScriptedCheckout.requestedNoDestructiveGitCommand(conversation)).toBe(true)
      expect(table.signalled.length).toBeGreaterThan(0)
      expect(table.signalled.every((pid) => table.pids.includes(Math.abs(pid)))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(config, { recursive: true, force: true })
    }
  }, 60_000)

  it('two_openings_fired_at_once_open_a_single_conversation', async () => {
    const root = await ScriptedCheckout.prepared()
    const config = await mkdtemp(join(tmpdir(), 'ct-api-coordinating-race-'))
    const conversation = CoordinatingSessionEndpoint.conversationFor(root)
    const processes = new HostProcesses({ conversation, table: new ScriptedTerminals() })
    const environment = { CT_API_PORT: '0', CLAUDE_CONFIG_DIR: config, SHELL: '/bin/sh' }

    try {
      const api = await InProcessApi.started(environment, processes)

      const answered = await Promise.all([
        CoordinatingSessionEndpoint.open(api.port, root),
        CoordinatingSessionEndpoint.open(api.port, root),
      ])

      expect(answered.map((response) => response.status).sort()).toEqual([202, 409])
      expect(await CoordinatingSessionEndpoint.brainstormingsOf(api.port)).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(config, { recursive: true, force: true })
    }
  }, 60_000)

  it('the_recovery_reads_the_transcript_under_the_configured_claude_directory', async () => {
    const root = await ScriptedCheckout.prepared()
    const config = await mkdtemp(join(tmpdir(), 'ct-api-coordinating-recovery-'))
    await ARecordedConversation.withATranscriptUnder(config, root)
    const conversation = ScriptedCheckout.answering(new ScriptedConversation(), root)
    const table = new ScriptedTerminals()
    const processes = new HostProcesses({ conversation, table })

    try {
      const api = await InProcessApi.started(
        { CT_API_PORT: '0', CLAUDE_CONFIG_DIR: config, SHELL: '/bin/sh' }, processes
      )

      const recovered = await (await fetch(`http://127.0.0.1:${api.port}/coordinating-session`)).json() as
        { status: string }

      expect(recovered.status).not.toBe('unresumable')
      expect(table.opened.length).toBe(1)
      expect(table.opened[0].argv.some((token) => token.includes(ARecordedConversation.ID))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(config, { recursive: true, force: true })
    }
  }, 60_000)

  it('a_recorded_conversation_with_no_transcript_at_all_is_not_resumed', async () => {
    const root = await ScriptedCheckout.prepared()
    const config = await mkdtemp(join(tmpdir(), 'ct-api-coordinating-recovery-'))
    await ARecordedConversation.withNoTranscriptAnywhere(config, root)
    const conversation = ScriptedCheckout.answering(new ScriptedConversation(), root)
    const table = new ScriptedTerminals()
    const processes = new HostProcesses({ conversation, table })

    try {
      const api = await InProcessApi.started(
        { CT_API_PORT: '0', CLAUDE_CONFIG_DIR: config, SHELL: '/bin/sh' }, processes
      )

      const recovered = await (await fetch(`http://127.0.0.1:${api.port}/coordinating-session`)).json() as
        { status: string }

      expect(recovered.status).toBe('unresumable')
      expect(table.opened.length).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(config, { recursive: true, force: true })
    }
  }, 60_000)

  it('a_whole_request_reaches_acli_so_a_typo_in_the_key_that_wires_the_user_stories_would_show_up_here', async () => {
    const key = new UserStoryKey('ZZZ-999999')
    const root = await ScriptedCheckout.prepared()
    const config = await mkdtemp(join(tmpdir(), 'ct-api-coordinating-acli-'))
    const conversation = ScriptedCheckout.answering(new ScriptedConversation(), root)
      .answering({ binary: 'acli', argv: AcliUserStories.argvFor(key) }, Capture.read('acli', 'workitem-view-missing'))
    const table = new ScriptedTerminals()
    const processes = new HostProcesses({ conversation, table })

    try {
      const api = await InProcessApi.started(
        { CT_API_PORT: '0', CLAUDE_CONFIG_DIR: config, SHELL: '/bin/sh' }, processes
      )

      const response = await CoordinatingSessionEndpoint.openFor(api.port, key.text, root)

      expect(response.status).toBe(400)
      const body = await response.json() as Failure
      expect(body.code).toBe('user-story-not-read')
      expect(body.detail).toMatch(/^acli jira failed: /)
      expect(table.opened.length).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(config, { recursive: true, force: true })
    }
  }, 60_000)

  it('a_whole_request_reaches_gh_so_a_typo_in_the_url_that_wires_the_user_stories_would_show_up_here', async () => {
    const url = 'https://github.com/mercadona/control-tower/issues/999999999'
    const root = await ScriptedCheckout.prepared()
    const config = await mkdtemp(join(tmpdir(), 'ct-api-coordinating-gh-'))
    const conversation = ScriptedCheckout.answering(new ScriptedConversation(), root)
      .answering(
        { binary: 'gh', argv: ['issue', 'view', url, '--json', 'title,body,comments'] },
        Capture.read('gh', 'issue-view-missing'),
      )
    const table = new ScriptedTerminals()
    const processes = new HostProcesses({ conversation, table })

    try {
      const api = await InProcessApi.started(
        { CT_API_PORT: '0', CLAUDE_CONFIG_DIR: config, SHELL: '/bin/sh' }, processes
      )

      const response = await CoordinatingSessionEndpoint.openFor(api.port, url, root)

      expect(response.status).toBe(400)
      const body = await response.json() as Failure
      expect(body.code).toBe('user-story-not-read')
      expect(body.detail).toMatch(/^gh issue view failed: /)
      expect(table.opened.length).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(config, { recursive: true, force: true })
    }
  }, 60_000)

  it('the runtime sweeps the checkout of its held story and mounts the slice message path', async () => {
    const fixture = await ACheckoutWithNothingReady.prepared()
    const table = new ScriptedTerminals()

    try {
      const api = await InProcessApi.started(
        ACheckoutWithNothingReady.environment(fixture.config),
        new HostProcesses({ conversation: fixture.conversation, table }),
      )

      const response = await fetch(`http://127.0.0.1:${api.port}/slices/42/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })

      expect(response.status).not.toBe(404)
      expect(await response.json()).toMatchObject({ code: 'malformed-repo' })
      await expect.poll(
        () => ACheckoutWithNothingReady.openIssueCallsCarryTheOpenQuery(fixture.conversation), { timeout: 10_000 }
      ).toBe(true)
      expect(api.saidLater()).not.toContain('could not survey')
      expect(api.saidLater()).not.toContain('relay:')
      expect(table.opened).toEqual([])
      await expect(stat(join(fixture.config, 'control-tower', 'go'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await ACheckoutWithNothingReady.remove(fixture.base)
    }
  }, 30_000)
})
