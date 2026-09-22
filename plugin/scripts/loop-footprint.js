import { CtStepCommit } from './ct-step-commit.js'

export const FootprintOutcome = Object.freeze({
  COMMITTED: 'committed',
  CLEAN: 'clean',
  FOREIGN_INDEX: 'foreign-index',
  UNSTAGEABLE: 'unstageable',
  UNCOMMITTABLE: 'uncommittable',
})

export class LoopFootprint {
  #git
  #stagedPaths
  #exists
  #telemetryPath
  #issue

  constructor({ git, stagedPaths, exists, telemetryPath, issue }) {
    this.#git = git
    this.#stagedPaths = stagedPaths
    this.#exists = exists
    this.#telemetryPath = telemetryPath
    this.#issue = issue
  }

  static message(issue) {
    return [
      `Telemetry of the slice (#${issue})`,
      '',
      'The rows ct-step wrote after the last task commit, committed before the Global verification measures the tree.',
      '',
      CtStepCommit.TRAILER_LINE,
      'Co-Authored-By: Claude <noreply@anthropic.com>',
    ].join('\n')
  }

  commitPending() {
    if (!this.#exists(this.#telemetryPath)) return { outcome: FootprintOutcome.CLEAN, foreign: [] }
    if (!(this.#git(['status', '--porcelain', '--', this.#telemetryPath]) || '').trim()) {
      return { outcome: FootprintOutcome.CLEAN, foreign: [] }
    }
    if (this.#git(['add', '--', this.#telemetryPath], { allowFail: true }) === null) {
      return { outcome: FootprintOutcome.UNSTAGEABLE, foreign: [] }
    }
    const foreign = this.#stagedPaths().filter((path) => path !== this.#telemetryPath)
    if (foreign.length) return { outcome: FootprintOutcome.FOREIGN_INDEX, foreign }
    if (this.#git(['commit', '-m', LoopFootprint.message(this.#issue)], { allowFail: true }) === null) {
      return { outcome: FootprintOutcome.UNCOMMITTABLE, foreign: [] }
    }
    return { outcome: FootprintOutcome.COMMITTED, foreign: [] }
  }
}
