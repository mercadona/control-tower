import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DetachedRun } from '../../src/infrastructure/detached-run.js'
import { HarnessCall, HarnessStep, HeadlessPlanAgents } from '../../src/infrastructure/headless-plan-agents.js'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'

class FakeClaude {
  static BIN = 'claude'
  static #SCRIPT = [
    '#!/bin/sh',
    'dir="$CT_FAKE_CLAUDE_CAPTURE_DIR"',
    ': > "$dir/argv.txt"',
    'for a in "$@"; do',
    '  printf \'%s\\n\' "$a" >> "$dir/argv.txt"',
    'done',
    'printf \'%s\' "$$" > "$dir/pid.txt"',
    'if [ -n "$CT_FAKE_CLAUDE_DELAY_S" ]; then sleep "$CT_FAKE_CLAUDE_DELAY_S"; fi',
    "printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"init\"}'",
    "printf '%s\\n' '{\"type\":\"result\",\"subtype\":\"success\"}'",
    '',
  ].join('\n')

  constructor() {
    this.directory = mkdtempSync(join(tmpdir(), 'ct-headless-contract-bin-'))
    const binary = join(this.directory, FakeClaude.BIN)
    writeFileSync(binary, FakeClaude.#SCRIPT)
    chmodSync(binary, 0o755)
  }

  pathPrefixedWith(existingPath) {
    return `${this.directory}${delimiter}${existingPath}`
  }

  stop() {
    rmSync(this.directory, { recursive: true, force: true })
  }
}

class Capture {
  static async eventually(check, { timeoutMs = 5_000, everyMs = 20 } = {}) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = check()
      if (value !== null) return value
      if (Date.now() > deadline) throw new Error('timed out waiting for the fake claude to write')
      await new Promise((wake) => setTimeout(wake, everyMs))
    }
  }

  static #read(path) {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  }

  static eventuallyEquals(path, expected) {
    return Capture.eventually(() => (Capture.#read(path) === expected ? expected : null))
  }

  static eventuallyArgvIn(captureDirectory) {
    const path = join(captureDirectory, 'argv.txt')

    return Capture.eventually(() => {
      const text = Capture.#read(path)

      return text === null || text.length === 0 ? null : text.split('\n').slice(0, -1)
    })
  }

  static eventuallyPidIn(captureDirectory) {
    const path = join(captureDirectory, 'pid.txt')

    return Capture.eventually(() => {
      const text = Capture.#read(path)

      return text === null || text.length === 0 ? null : Number(text)
    })
  }
}

class GroupTracking {
  static #started = []

  static track(pid) {
    GroupTracking.#started.push(pid)
  }

  static killEveryGroupStarted() {
    for (const pid of GroupTracking.#started.splice(0)) {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        continue
      }
    }
  }
}

class RealComposition {
  static MODEL = 'opus'
  static PLUGIN_ROOT = '/plugin'
  static AGENT = '11111111-2222-3333-4444-555555555555'
  static STARTED_AT = 1_700_000_000_000
  static ERRAND = 'contract-errand-with-no-shell-metacharacters'
  static BRANCH = 'feat/42'
  static ISSUE = new PlanIssue({ number: 42, url: 'https://github.com/owner/name/issues/42' })
  static REPOSITORY = new RepositoryName('owner/name')
  static BUDGET_MS = 30_000
  static EXPECTED_STREAM =
    '{"type":"system","subtype":"init"}\n{"type":"result","subtype":"success"}\n'

  static headless({ runsIn, env }) {
    return new HeadlessPlanAgents({
      start: new DetachedRun({ bin: HeadlessPlanAgents.BIN, budgetMs: RealComposition.BUDGET_MS, env }),
      makeDirectory: (path) => mkdir(path, { recursive: true }),
      write: (path, text) => writeFile(path, text),
      read: (path) => readFile(path, 'utf8').catch(() => null),
      mint: () => RealComposition.AGENT,
      clock: () => RealComposition.STARTED_AT,
      brief: { errandFor: () => RealComposition.ERRAND },
      runsIn,
      model: RealComposition.MODEL,
      pluginRoot: RealComposition.PLUGIN_ROOT,
    })
  }

  static briefing(worktree) {
    return new PlanBriefing({
      story: null,
      issue: RealComposition.ISSUE,
      located: new WorkspaceLocation({ path: worktree, branch: RealComposition.BRANCH }),
      repository: RealComposition.REPOSITORY,
    })
  }

  static expectedPaths(runsIn) {
    const directory = `${runsIn}/${RealComposition.AGENT}/${HarnessStep.WRITE_PLAN}-${RealComposition.STARTED_AT}`

    return {
      directory,
      stream: `${directory}/${HarnessCall.STREAM_FILE}`,
      error: `${directory}/${HarnessCall.ERROR_FILE}`,
      call: `${directory}/${HarnessCall.CALL_FILE}`,
      conversation: `${runsIn}/${RealComposition.AGENT}/${HeadlessPlanAgents.CONVERSATION_FILE}`,
    }
  }
}

class Wrapper {
  static #HERE = dirname(fileURLToPath(import.meta.url))
  static #moduleUrl(...parts) {
    return pathToFileURL(join(Wrapper.#HERE, '..', '..', 'src', ...parts)).href
  }

  static write(path, params) {
    writeFileSync(path, [
      `import { DetachedRun } from ${JSON.stringify(Wrapper.#moduleUrl('infrastructure', 'detached-run.js'))}`,
      `import { HeadlessPlanAgents } from ${JSON.stringify(Wrapper.#moduleUrl('infrastructure', 'headless-plan-agents.js'))}`,
      `import { PlanBriefing } from ${JSON.stringify(Wrapper.#moduleUrl('domain', 'value-objects', 'plan-briefing.js'))}`,
      `import { WorkspaceLocation } from ${JSON.stringify(Wrapper.#moduleUrl('domain', 'value-objects', 'workspace-location.js'))}`,
      `import { PlanIssue } from ${JSON.stringify(Wrapper.#moduleUrl('domain', 'value-objects', 'plan-issue.js'))}`,
      `import { RepositoryName } from ${JSON.stringify(Wrapper.#moduleUrl('domain', 'value-objects', 'repository-name.js'))}`,
      "import { mkdir, readFile, writeFile } from 'node:fs/promises'",
      '',
      `const params = ${JSON.stringify(params)}`,
      '',
      'const headless = new HeadlessPlanAgents({',
      '  start: new DetachedRun({ bin: params.bin, budgetMs: params.budgetMs, env: process.env }),',
      '  makeDirectory: (path) => mkdir(path, { recursive: true }),',
      '  write: (path, text) => writeFile(path, text),',
      "  read: (path) => readFile(path, 'utf8').catch(() => null),",
      '  mint: () => params.agent,',
      '  clock: () => params.startedAt,',
      '  brief: { errandFor: () => params.errand },',
      '  runsIn: params.runsIn,',
      '  model: params.model,',
      '  pluginRoot: params.pluginRoot,',
      '})',
      '',
      'const briefing = new PlanBriefing({',
      '  story: null,',
      '  issue: new PlanIssue({ number: params.issueNumber, url: params.issueUrl }),',
      '  located: new WorkspaceLocation({ path: params.worktree, branch: params.branch }),',
      '  repository: new RepositoryName(params.repository),',
      '})',
      '',
      'const agent = await headless.launch(briefing)',
      'process.stdout.write(agent)',
      '',
    ].join('\n'))
  }
}

describe('the real DetachedRun composed with the real HeadlessPlanAgents', () => {
  let claude
  let captureDirectory
  let runsIn
  let worktree

  beforeEach(() => {
    claude = new FakeClaude()
    captureDirectory = mkdtempSync(join(tmpdir(), 'ct-headless-contract-capture-'))
    runsIn = mkdtempSync(join(tmpdir(), 'ct-headless-contract-runs-in-'))
    worktree = mkdtempSync(join(tmpdir(), 'ct-headless-contract-worktree-'))
  })

  afterEach(() => {
    GroupTracking.killEveryGroupStarted()
    claude.stop()
    rmSync(captureDirectory, { recursive: true, force: true })
    rmSync(runsIn, { recursive: true, force: true })
    rmSync(worktree, { recursive: true, force: true })
  })

  it('the_files_a_real_launch_leaves_agree_with_what_the_process_received_and_the_conversation_names_the_plan_it_belongs_to', async () => {
    const env = {
      ...process.env,
      PATH: claude.pathPrefixedWith(process.env.PATH),
      CT_FAKE_CLAUDE_CAPTURE_DIR: captureDirectory,
    }
    const headless = RealComposition.headless({ runsIn, env })

    const agent = await headless.launch(RealComposition.briefing(worktree))
    const paths = RealComposition.expectedPaths(runsIn)

    expect(agent).toBe(RealComposition.AGENT)
    expect(existsSync(paths.directory)).toBe(true)

    const stream = await Capture.eventuallyEquals(paths.stream, RealComposition.EXPECTED_STREAM)
    const capturedArgv = await Capture.eventuallyArgvIn(captureDirectory)
    const capturedPid = await Capture.eventuallyPidIn(captureDirectory)
    GroupTracking.track(capturedPid)

    expect(stream).toBe(RealComposition.EXPECTED_STREAM)
    expect(readFileSync(paths.error, 'utf8')).toBe('')

    const call = JSON.parse(readFileSync(paths.call, 'utf8'))

    expect(call.argv).toEqual(capturedArgv)
    expect(call.pid).toBe(capturedPid)

    const conversation = JSON.parse(readFileSync(paths.conversation, 'utf8'))

    expect(conversation).toEqual({
      worktree,
      issue: RealComposition.ISSUE.number,
      repository: RealComposition.REPOSITORY.text,
      startedAt: RealComposition.STARTED_AT,
    })
  })

  it('the_envelope_a_launch_composes_keeps_landing_after_the_process_that_launched_it_has_already_exited', async () => {
    const wrapperDirectory = mkdtempSync(join(tmpdir(), 'ct-headless-contract-wrapper-'))
    const wrapperPath = join(wrapperDirectory, 'wrapper.mjs')
    Wrapper.write(wrapperPath, {
      bin: HeadlessPlanAgents.BIN,
      budgetMs: RealComposition.BUDGET_MS,
      agent: RealComposition.AGENT,
      startedAt: RealComposition.STARTED_AT,
      errand: RealComposition.ERRAND,
      runsIn,
      model: RealComposition.MODEL,
      pluginRoot: RealComposition.PLUGIN_ROOT,
      issueNumber: RealComposition.ISSUE.number,
      issueUrl: RealComposition.ISSUE.url,
      worktree,
      branch: RealComposition.BRANCH,
      repository: RealComposition.REPOSITORY.text,
    })

    const env = {
      ...process.env,
      PATH: claude.pathPrefixedWith(process.env.PATH),
      CT_FAKE_CLAUDE_CAPTURE_DIR: captureDirectory,
      CT_FAKE_CLAUDE_DELAY_S: '1',
    }

    let stdout = ''
    let stderr = ''
    const wrapper = spawn(process.execPath, [wrapperPath], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    wrapper.stdout.on('data', (chunk) => { stdout += chunk })
    wrapper.stderr.on('data', (chunk) => { stderr += chunk })

    const exitCode = await new Promise((resolve) => wrapper.once('exit', (code) => resolve(code)))
    const paths = RealComposition.expectedPaths(runsIn)

    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(stdout).toBe(RealComposition.AGENT)
    expect(existsSync(paths.stream)).toBe(true)
    expect(readFileSync(paths.stream, 'utf8')).toBe('')

    const stream = await Capture.eventuallyEquals(paths.stream, RealComposition.EXPECTED_STREAM)
    const capturedPid = await Capture.eventuallyPidIn(captureDirectory)
    GroupTracking.track(capturedPid)

    expect(stream).toBe(RealComposition.EXPECTED_STREAM)

    const call = JSON.parse(readFileSync(paths.call, 'utf8'))

    expect(call.pid).toBe(capturedPid)

    rmSync(wrapperDirectory, { recursive: true, force: true })
  })
})
