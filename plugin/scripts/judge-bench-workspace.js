import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RunPaths } from './judge-dispatch.js'

export class BenchWorkspace {
  constructor({ root }) {
    this.root = root
    Object.freeze(this)
  }

  prepare({ benchCase, attempt, yardstick }) {
    const directory = join(this.root, benchCase.name, String(attempt))
    mkdirSync(directory, { recursive: true })
    cpSync(benchCase.repoDirectory, directory, { recursive: true })
    const paths = new RunPaths({ issue: benchCase.issue, task: benchCase.task })
    mkdirSync(join(directory, paths.runDirectory), { recursive: true })
    writeFileSync(join(directory, paths.judgeBrief), benchCase.brief)
    writeFileSync(join(directory, paths.reviewPackage), BenchWorkspace.#packageWith(benchCase.reviewPackage, yardstick))
    return directory
  }

  static #packageWith(reviewPackage, yardstick) {
    const [header, token, ...rest] = reviewPackage.split('\n')
    return [header, token, yardstick, ...rest].join('\n')
  }

  verdictWrittenAt(path) {
    if (!existsSync(path)) return null
    return readFileSync(path, 'utf8')
  }
}
