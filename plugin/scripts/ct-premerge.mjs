#!/usr/bin/env node
// /ct-premerge — WHAT QUESTION IT ANSWERS: «would each open pull request still
// be green on top of the `main` it will actually land on, and would any two of
// them still be green on top of each other?»
//
// The second half is the one no CI asks. A pull request is measured against the
// base it forked from; whichever of two lands second sits on a tree its own run
// never saw. On 2026-09-20 that was answered by hand three times for #472, #473
// and #474 — and it worked because somebody remembered. This is that, without
// the remembering.
//
// IT MUTATES NOTHING that anybody else can see: it never rebases a pushed
// branch, never pushes, never merges and never touches the ruleset. Everything
// happens in throwaway worktrees under the system temp directory, and they are
// removed even when a suite fails.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Premerge, PremergeVerdict } from './premerge.js'

class Rehearsal {
  static USAGE = 'usage: ct-premerge.mjs --repo <owner/repo> [--base <branch>] [--no-pairs]'
  static REF = 'refs/ct-premerge'
  static PACKAGES_WITH_A_LOCKFILE = ['plugin', 'backend', 'frontend']

  static git(argv, { cwd = process.cwd(), quiet = true } = {}) {
    return String(execFileSync('git', argv, {
      cwd, encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    }) ?? '')
  }

  static open(repo) {
    const raw = execFileSync('gh', [
      'pr', 'list', '--repo', repo, '--state', 'open', '--limit', '50',
      '--json', 'number,isDraft,headRefName',
    ], { encoding: 'utf8' })

    return JSON.parse(raw).filter((pull) => pull.isDraft !== true).map((pull) => pull.number)
  }

  static fetch(repo, numbers) {
    Rehearsal.git(['fetch', 'origin', '--quiet'])
    for (const number of numbers) {
      execFileSync('gh', ['pr', 'view', String(number), '--repo', repo, '--json', 'number'], { stdio: 'ignore' })
      Rehearsal.git(['fetch', 'origin', '--force', `pull/${number}/head:${Rehearsal.REF}/${number}`])
    }
  }

  static installed(root, suites) {
    for (const suite of suites) {
      if (!Rehearsal.PACKAGES_WITH_A_LOCKFILE.includes(suite)) continue
      if (existsSync(join(root, suite, 'node_modules'))) continue
      // A worktree with no node_modules of its own gives a false red on the
      // check that the built plugin matches its sources. Installing is part of
      // measuring, not part of the change.
      execFileSync('npm', ['ci', '--prefix', suite], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] })
    }
  }

  // One suite at a time, on purpose: the `*-real-process` family times out
  // under load and sends whoever reads it chasing a change that is not there.
  static ran(root, suite) {
    try {
      execFileSync(Premerge.COMMANDS[suite][0], Premerge.COMMANDS[suite].slice(1), {
        cwd: root, stdio: ['ignore', 'ignore', 'pipe'], timeout: 20 * 60 * 1000,
      })

      return true
    } catch {
      return false
    }
  }

  static measured(root, suites) {
    for (const suite of suites) {
      const verdict = Premerge.verdictOf({
        first: Rehearsal.ran(root, suite),
        alone: null,
      })
      if (verdict === PremergeVerdict.GREEN) continue
      const second = Premerge.verdictOf({ first: false, alone: Rehearsal.ran(root, suite) })

      return { verdict: second, detail: suite }
    }

    return { verdict: PremergeVerdict.GREEN, detail: null }
  }

  static inAWorktree(base, build) {
    const root = mkdtempSync(join(tmpdir(), 'ct-premerge-'))
    try {
      Rehearsal.git(['worktree', 'add', '--quiet', '--detach', root, base])

      return build(root)
    } finally {
      try { Rehearsal.git(['worktree', 'remove', '--force', root]) } catch { /* it may never have been added */ }
      rmSync(root, { recursive: true, force: true })
    }
  }

  static rehearse(about, base, refs) {
    return Rehearsal.inAWorktree(base, (root) => {
      for (const ref of refs) {
        try {
          Rehearsal.git(['merge', '--no-edit', ref], { cwd: root })
        } catch (refusal) {
          return { about, suites: [], verdict: PremergeVerdict.CONFLICT, detail: Rehearsal.#firstLine(refusal) }
        }
      }
      const files = Rehearsal.git(['diff', '--name-only', `${base}...HEAD`], { cwd: root })
        .split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
      const suites = Premerge.suitesFor(files)
      try {
        Rehearsal.installed(root, suites)
      } catch (failure) {
        return { about, suites, verdict: PremergeVerdict.UNMEASURED, detail: `install: ${Rehearsal.#firstLine(failure)}` }
      }
      const measured = Rehearsal.measured(root, suites)

      return { about, suites, verdict: measured.verdict, detail: measured.detail }
    })
  }

  static #firstLine(failure) {
    const text = String(failure?.stderr ?? failure?.message ?? failure).trim()

    return text.split('\n').find((line) => line.trim().length > 0) ?? 'no detail'
  }

  static #argument(argv, name) {
    const at = argv.indexOf(name)

    return at === -1 || at === argv.length - 1 ? null : argv[at + 1]
  }

  static main(argv) {
    const repo = Rehearsal.#argument(argv, '--repo')
    if (repo === null || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
      process.stderr.write(`${Rehearsal.USAGE}\n`)
      process.exit(2)
    }
    const base = `origin/${Rehearsal.#argument(argv, '--base') ?? 'main'}`
    const numbers = Rehearsal.open(repo)
    Rehearsal.fetch(repo, numbers)
    const results = numbers.map((number) => {
      process.stderr.write(`rehearsing #${number}…\n`)

      return Rehearsal.rehearse(number, base, [`${Rehearsal.REF}/${number}`])
    })
    const holding = results
      .filter((result) => result.verdict === PremergeVerdict.GREEN || result.verdict === PremergeVerdict.FLAKE)
      .map((result) => result.about)
    const pairs = argv.includes('--no-pairs') ? [] : Premerge.pairsOf(holding)
    for (const [first, second] of pairs) {
      process.stderr.write(`rehearsing #${first} with #${second}…\n`)
      results.push(Rehearsal.rehearse(
        [first, second], base, [`${Rehearsal.REF}/${first}`, `${Rehearsal.REF}/${second}`],
      ))
    }
    for (const line of Premerge.report(results)) process.stdout.write(`${line}\n`)
    for (const number of numbers) {
      try { Rehearsal.git(['update-ref', '-d', `${Rehearsal.REF}/${number}`]) } catch { /* already gone */ }
    }
    process.exitCode = Premerge.exitCodeFor(results)
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Rehearsal.main(process.argv.slice(2))
}
