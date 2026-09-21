import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo, PLUGIN_ROOT_TEST } from './fixtures/ct-step-harness.js'

const BRANCH_BASE_SHA = '35303a16'
const BYTE_IDENTICAL_STEPS = ['implement', 'controls', 'judge', 'commit', 'reconcile', 'global', 'slice-judge', 'e2e']
const BASE_ADVISOR_HEADING = 'DISPATCH THE ADVISOR (subagent ct-advisor — declared with Read only) with:'
const TREE_ADVISOR_HEADING = 'DISPATCH THE ADVISOR (subagent ct-advisor — declared with Read, StructuredOutput only) with:'
const WORDING_THIS_TREE_CANNOT_PRINT = 'declared with Read only) with:'
const DECLARED_JOURNEY = ['the journey']
const VETOES_BEFORE_ADVICE = 2
const REJECTED_FINDING = { severity: 'high', what: 'the logic stayed in the module it had to leave', path: 'uno.txt', line: 1 }
const DRIVING_BOTH_FIXTURES_TAKES_MS = 600_000

class PrintedProse {
  static PLUGIN_ROOT = '<PLUGIN_ROOT>'
  static REPO = '<REPO>'
  static RUNTIME_VARIABLES = ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'AI_AGENT']

  static of(pluginRoot, repo, step) {
    const printed = spawnSync('node', [join(pluginRoot, 'scripts', 'ct-step.mjs'), 'next', '--plan', 'plan.md', '--issue', '7'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: PrintedProse.#environment(repo),
    })
    const text = PrintedProse.#withoutPaths(String(printed.stdout), pluginRoot, repo)
    if (printed.status !== 0 || !text.includes(`step: ${step} (attempt `)) {
      throw new Error(`ct-step next under ${pluginRoot} did not print the step ${step}: exit ${printed.status}, stderr: ${printed.stderr}`)
    }
    return text
  }

  static #environment(repo) {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: join(repo, '.telemetria') }
    for (const variable of PrintedProse.RUNTIME_VARIABLES) delete env[variable]
    return env
  }

  static #withoutPaths(text, pluginRoot, repo) {
    return PrintedProse.#replaced(
      PrintedProse.#replaced(text, pluginRoot, PrintedProse.PLUGIN_ROOT),
      repo,
      PrintedProse.REPO,
    )
  }

  static #replaced(text, directory, token) {
    return [realpathSync(directory), directory]
      .sort((one, other) => other.length - one.length)
      .reduce((printed, spelling) => printed.split(spelling).join(token), text)
  }
}

class BranchBaseComparison {
  static extractedInto(home) {
    const tarball = join(home, 'base.tar')
    const repoRoot = join(PLUGIN_ROOT_TEST, '..')
    execFileSync('git', ['archive', '--format=tar', `--output=${tarball}`, BRANCH_BASE_SHA, 'plugin'], { cwd: repoRoot })
    execFileSync('tar', ['-xf', tarball, '-C', home])
    return new BranchBaseComparison(join(home, 'plugin'))
  }

  constructor(basePluginRoot) {
    this.basePluginRoot = basePluginRoot
    this.printed = new Map()
  }

  capture(step, repo) {
    this.printed.set(step, {
      base: PrintedProse.of(this.basePluginRoot, repo, step),
      tree: PrintedProse.of(PLUGIN_ROOT_TEST, repo, step),
    })
  }

  base(step) {
    return this.printed.get(step).base
  }

  tree(step) {
    return this.printed.get(step).tree
  }
}

let baseHome
let comparison
let happyPathRepo
let repo
const { ct, writeReport, writeVerdict, writeSliceVerdict, taskOk, judgeTask, judgeSlice } = makeHelpers(() => repo)

beforeAll(() => {
  baseHome = mkdtempSync(join(tmpdir(), 'ct-step-branch-base-'))
  comparison = BranchBaseComparison.extractedInto(baseHome)

  repo = makeRepo({ e2e: DECLARED_JOURNEY })
  happyPathRepo = repo
  comparison.capture('implement', repo)
  ct('report', writeReport(['uno.txt']))
  comparison.capture('controls', repo)
  ct('controls')
  comparison.capture('judge', repo)
  judgeTask(writeVerdict('PASS'))
  comparison.capture('commit', repo)
  ct('commit')
  taskOk('dos.txt')
  comparison.capture('reconcile', repo)
  ct('reconcile')
  comparison.capture('global', repo)
  ct('global')
  comparison.capture('slice-judge', repo)
  judgeSlice(writeSliceVerdict('PASS'))
  comparison.capture('e2e', repo)

  repo = makeRepo()
  for (let veto = 0; veto < VETOES_BEFORE_ADVICE; veto += 1) {
    ct('next')
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    judgeTask(writeVerdict('FAIL', [REJECTED_FINDING]))
  }
  comparison.capture('advise', repo)
}, DRIVING_BOTH_FIXTURES_TAKES_MS)

afterAll(() => {
  rmSyncBestEffort(happyPathRepo)
  rmSyncBestEffort(repo)
  rmSyncBestEffort(baseHome)
})

describe('the prose a human reads is the prose of the branch base', () => {
  it('eight_of_the_nine_steps_print_the_bytes_the_branch_base_printed', () => {
    for (const step of BYTE_IDENTICAL_STEPS) {
      expect(comparison.tree(step), `the ${step} step no longer prints what the branch base printed`)
        .toBe(comparison.base(step))
    }
  })

  it('the_advise_step_differs_in_the_one_line_the_advisor_tool_declaration_moved', () => {
    expect(comparison.tree('advise'))
      .toBe(comparison.base('advise').replace(BASE_ADVISOR_HEADING, TREE_ADVISOR_HEADING))
  })

  it('the_base_transcript_comes_from_git_and_not_from_the_tree_under_test', () => {
    expect(comparison.base('advise')).toContain(WORDING_THIS_TREE_CANNOT_PRINT)
  })
})
