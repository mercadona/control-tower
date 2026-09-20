#!/usr/bin/env node
// The `changes` job of continuous-integration.yml asks this, and so does
// /ct-premerge. One rule, two callers — the rule itself is in
// changed-packages.js, where it has tests.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ChangedPackages } from './changed-packages.js'

export class ChangedPackagesCommand {
  static USAGE = 'usage: ct-changed-packages.mjs <base> <head>'

  // Three dots, not two: what this branch changed since it forked off the
  // base, not everything that separates the two commits.
  static filesBetween(base, head, { run = execFileSync } = {}) {
    try {
      return String(run('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' }))
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    } catch {
      return null
    }
  }

  static main(argv) {
    if (argv.length !== 2) {
      process.stderr.write(`${ChangedPackagesCommand.USAGE}\n`)
      process.exit(2)
    }
    const files = ChangedPackagesCommand.filesBetween(argv[0], argv[1])
    if (files === null) {
      process.stderr.write('warning: the diff could not be read, so every suite is turned on\n')
    }
    const touched = files === null ? ChangedPackages.everything() : ChangedPackages.of(files)
    process.stdout.write(`${ChangedPackages.outputFor(touched)}\n`)
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ChangedPackagesCommand.main(process.argv.slice(2))
}
