import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo, PLUGIN_ROOT_TEST } from './fixtures/ct-step-harness.js'
import { worktreeInConflict } from './fixtures/worktree-in-conflict.js'

const BRANCH_BASE_SHA = '35303a16'
const BYTE_IDENTICAL_STEPS = ['implement', 'controls', 'judge', 'commit', 'reconcile', 'global', 'slice-judge', 'e2e']
const BASE_ADVISOR_HEADING = 'DISPATCH THE ADVISOR (subagent ct-advisor — declared with Read only) with:'
const TREE_ADVISOR_HEADING = 'DISPATCH THE ADVISOR (subagent ct-advisor — declared with Read, StructuredOutput only) with:'
const WORDING_THIS_TREE_CANNOT_PRINT = 'declared with Read only) with:'
const DECLARED_JOURNEY = ['the journey']
const VETOES_BEFORE_ADVICE = 2
const REJECTED_FINDING = { severity: 'high', what: 'the logic stayed in the module it had to leave', path: 'uno.txt', line: 1 }
const DRIVING_BOTH_FIXTURES_TAKES_MS = 600_000
const RECONCILER_DISPATCHED_WITH_ITS_FIRST_PACKAGE = [
  'DISPATCH ct-reconciler (subagent — declared WITHOUT Bash and WITHOUT Write: Read, Grep, Glob, Edit) to resolve the conflict: have it leave the files resolved, with no conflict markers, and without touching anything outside that list — it cannot stage, commit or abort the merge: this program does that on concluding. Give it:',
  '  - the reconciliation package: <REPO>/.agent/run-4/reconcile-package-1.md',
].join('\n')
const RECONCILER_REDISPATCHED_WITH_ITS_SECOND_PACKAGE = [
  'REDISPATCH ct-reconciler (subagent — declared WITHOUT Bash and WITHOUT Write: Read, Grep, Glob, Edit) with the new package:',
  '  - the reconciliation package: <REPO>/.agent/run-4/reconcile-package-2.md',
].join('\n')

class PrintedProse {
  static PLUGIN_ROOT = '<PLUGIN_ROOT>'
  static REPO = '<REPO>'
  static RUNTIME_VARIABLES = ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'AI_AGENT']
  static EXIT_OK = 0

  static of(pluginRoot, repo, step) {
    const printed = PrintedProse.#spawned(pluginRoot, repo, ['next', '--plan', 'plan.md', '--issue', '7'])
    const text = PrintedProse.#withoutPaths(String(printed.stdout), pluginRoot, repo)
    if (printed.status !== PrintedProse.EXIT_OK || !text.includes(`step: ${step} (attempt `)) {
      throw new Error(`ct-step next under ${pluginRoot} did not print the step ${step}: exit ${printed.status}, stderr: ${printed.stderr}`)
    }
    return text
  }

  static ofVerb(pluginRoot, repo, argv, exit = PrintedProse.EXIT_OK) {
    const printed = PrintedProse.#spawned(pluginRoot, repo, argv)
    if (printed.status !== exit) {
      throw new Error(`ct-step ${argv[0]} under ${pluginRoot} exited ${printed.status} instead of ${exit}: stderr: ${printed.stderr}`)
    }
    return PrintedProse.#withoutPaths(String(printed.stdout), pluginRoot, repo)
  }

  static #spawned(pluginRoot, repo, argv) {
    return spawnSync('node', [join(pluginRoot, 'scripts', 'ct-step.mjs'), ...argv], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: PrintedProse.#environment(repo),
    })
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

class VerbProse {
  static RECONCILE_ARGV = ['reconcile', '--plan', 'docs/superpowers/plans/plan.md', '--issue', '4']
  static RECONCILE_ROUNDS = 2
  static CONTROLS_ARGV = ['controls', '--plan', 'plan.md', '--issue', '7']
  static FAILING_CONTROLS_ROUNDS = 3
  static NOTHING_TOUCHED = { paths: [], summary: 'nothing was touched' }
  static REPORT_NAME = 'report.json'
  static CONTROLS_RED = 4

  static reconcileRounds(pluginRoot, repo) {
    const rounds = []
    for (let round = 0; round < VerbProse.RECONCILE_ROUNDS; round += 1) {
      rounds.push(PrintedProse.ofVerb(pluginRoot, repo, VerbProse.RECONCILE_ARGV))
    }
    return rounds.join('')
  }

  static closingControls(pluginRoot, repo) {
    let printed = ''
    for (let round = 1; round <= VerbProse.FAILING_CONTROLS_ROUNDS; round += 1) {
      const closes = round === VerbProse.FAILING_CONTROLS_ROUNDS
      PrintedProse.ofVerb(pluginRoot, repo, ['report', VerbProse.#reportIn(repo), '--plan', 'plan.md', '--issue', '7'])
      printed = PrintedProse.ofVerb(
        pluginRoot,
        repo,
        VerbProse.CONTROLS_ARGV,
        closes ? VerbProse.CONTROLS_RED : PrintedProse.EXIT_OK,
      )
    }
    return printed
  }

  static #reportIn(repo) {
    const path = join(repo, VerbProse.REPORT_NAME)
    writeFileSync(path, JSON.stringify(VerbProse.NOTHING_TOUCHED))
    return path
  }
}

let baseHome
let comparison
let happyPathRepo
let repo
let reconcileBaseRepo
let reconcileTreeRepo
let footerBaseRepo
let footerTreeRepo
let reconcilePrinted
let footerPrinted
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

  reconcileBaseRepo = worktreeInConflict()
  reconcileTreeRepo = worktreeInConflict()
  reconcilePrinted = {
    base: VerbProse.reconcileRounds(comparison.basePluginRoot, reconcileBaseRepo),
    tree: VerbProse.reconcileRounds(PLUGIN_ROOT_TEST, reconcileTreeRepo),
  }

  footerBaseRepo = makeRepo()
  footerTreeRepo = makeRepo()
  footerPrinted = {
    base: VerbProse.closingControls(comparison.basePluginRoot, footerBaseRepo),
    tree: VerbProse.closingControls(PLUGIN_ROOT_TEST, footerTreeRepo),
  }
}, DRIVING_BOTH_FIXTURES_TAKES_MS)

afterAll(() => {
  const temporary = [
    happyPathRepo, repo, reconcileBaseRepo, reconcileTreeRepo, footerBaseRepo, footerTreeRepo, baseHome,
  ]
  for (const directory of temporary.filter(Boolean)) rmSyncBestEffort(directory)
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

  it('the_reconcile_verb_prints_the_bytes_the_branch_base_printed', () => {
    expect(reconcilePrinted.tree, 'the first round never dispatched ct-reconciler with its first package')
      .toContain(RECONCILER_DISPATCHED_WITH_ITS_FIRST_PACKAGE)
    expect(reconcilePrinted.tree, 'the second round never redispatched ct-reconciler with its second package')
      .toContain(RECONCILER_REDISPATCHED_WITH_ITS_SECOND_PACKAGE)
    expect(reconcilePrinted.tree, 'the reconcile verb no longer prints what the branch base printed')
      .toBe(reconcilePrinted.base)
  })

  it('the_consuming_footer_prints_the_bytes_the_branch_base_printed', () => {
    expect(footerPrinted.tree, 'the footer of a closing consuming verb no longer prints what the branch base printed')
      .toBe(footerPrinted.base)
  })
})
