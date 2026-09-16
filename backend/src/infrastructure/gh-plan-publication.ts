import { dirname, join } from 'node:path'
import { planFilesForIssue } from '../../../plugin/scripts/plan-contract.js'
import { PlanPublication } from '../domain/ports/plan-publication.ts'
import { PlanProgressNotRead } from '../domain/exceptions.ts'
import { PlanState } from '../domain/value-objects/plan-state.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { Gh } from './gh.ts'
import type { ProcessOutput, ToolRunner } from './tool-runner.ts'
import { PlanContractProgress } from './plan-contract-progress.ts'
import type { HeadlessFiles } from './headless-files.ts'

export class GhPlanPublication extends PlanPublication {
  static readonly #MAX_BODY_UNITS = 60_000

  readonly gh: Gh
  readonly git: ToolRunner['run']
  readonly progress: PlanContractProgress
  readonly files: HeadlessFiles
  readonly digest: (text: string) => string

  constructor(ports: {
    gh: Gh,
    git: ToolRunner['run'],
    progress: PlanContractProgress,
    files: HeadlessFiles,
    digest: (text: string) => string,
  }) {
    super()
    this.gh = ports.gh
    this.git = ports.git
    this.progress = ports.progress
    this.files = ports.files
    this.digest = ports.digest
  }

  async publish(watch: PlanWatch): Promise<void> {
    const state = await this.progress.of(watch)
    if (state !== PlanState.READY) {
      throw new PlanProgressNotRead(`the plan for ${watch.issue} is ${state}, not ready for publication`)
    }

    const listed = await this.git([
      '-C', watch.located.path, 'ls-tree', '-r', '--name-only', 'HEAD', '--', PlanContractProgress.PLANS,
    ])
    GhPlanPublication.#requireSuccess(listed, 'git ls-tree could not list the committed plans')
    const paths = planFilesForIssue(watch.issue.number, listed.stdout.split('\n').filter(Boolean))
    if (paths.length !== 1) {
      throw new PlanProgressNotRead(
        `expected exactly one committed plan for ${watch.issue}, found ${paths.length}: ${paths.join(', ')}`
      )
    }

    const path = paths[0]
    const shown = await this.git(['-C', watch.located.path, 'show', `HEAD:${path}`])
    GhPlanPublication.#requireSuccess(shown, `git show could not read the committed plan ${path}`)
    const hash = this.digest(shown.stdout)
    const bodies = GhPlanPublication.#bodies(shown.stdout, hash, path)
    const bodyPaths: string[] = []
    for (let index = 0; index < bodies.length; index += 1) {
      const bodyPath = join(
        dirname(this.files.dispatchPath(watch.agent)), 'publication', hash, `part-${index + 1}.md`
      )
      await this.#writeBody(bodyPath, bodies[index])
      bodyPaths.push(bodyPath)
    }

    const comments = await this.#comments(watch)
    for (let index = 0; index < bodies.length; index += 1) {
      if (comments.includes(bodies[index])) continue
      const posted = await this.gh.run([
        'issue', 'comment', String(watch.issue.number),
        '--repo', watch.repository.text,
        '--body-file', bodyPaths[index],
      ], { safeToRepeat: false })
      if (!posted.failed) continue

      const afterFailure = await this.#comments(watch)
      if (!afterFailure.includes(bodies[index])) {
        GhPlanPublication.#requireSuccess(posted, 'gh issue comment could not publish the committed plan')
      }
    }
  }

  async #writeBody(path: string, body: string): Promise<void> {
    try {
      await this.files.writeOnce(path, body)
    } catch (cause) {
      if (!GhPlanPublication.#hasCode(cause, 'EEXIST')) {
        throw new PlanProgressNotRead(`the publication part ${path} could not be written: ${String(cause)}`)
      }
      let existing: string | null
      try {
        existing = await this.files.read(path)
      } catch (readFailure) {
        throw new PlanProgressNotRead(
          `the existing publication part ${path} could not be read: ${String(readFailure)}`
        )
      }
      if (existing !== body) {
        throw new PlanProgressNotRead(`the publication part ${path} already exists with different content`)
      }
    }
  }

  async #comments(watch: PlanWatch): Promise<string[]> {
    const listed = await this.gh.run([
      'api', `repos/${watch.repository.text}/issues/${watch.issue.number}/comments`, '--paginate', '--slurp',
    ], { safeToRepeat: true })
    GhPlanPublication.#requireSuccess(listed, 'gh api could not list issue comments')
    try {
      const pages: unknown = JSON.parse(listed.stdout)
      if (!Array.isArray(pages)) throw new Error(`expected pages, got ${JSON.stringify(pages)}`)
      const bodies: string[] = []
      for (const page of pages) {
        if (!Array.isArray(page)) throw new Error(`expected a page, got ${JSON.stringify(page)}`)
        for (const comment of page) {
          if (comment === null || typeof comment !== 'object' || !('body' in comment) || typeof comment.body !== 'string') {
            throw new Error(`expected a comment body, got ${JSON.stringify(comment)}`)
          }
          bodies.push(comment.body)
        }
      }
      return bodies
    } catch (cause) {
      if (cause instanceof PlanProgressNotRead) throw cause
      throw new PlanProgressNotRead(`gh api comments could not be read: ${String(cause)}`)
    }
  }

  static #requireSuccess(output: ProcessOutput, action: string): void {
    if (output.failed) {
      throw new PlanProgressNotRead(`${action}, it exited ${output.code}: ${output.stderr.trim()}`)
    }
  }

  static #bodies(plan: string, hash: string, path: string): string[] {
    let total = 1
    for (;;) {
      const chunks = GhPlanPublication.#chunks(plan, hash, path, total)
      if (chunks.length === total) {
        return chunks.map((chunk, index) => `${GhPlanPublication.#header(hash, path, index + 1, total)}${chunk}`)
      }
      total = chunks.length
    }
  }

  static #chunks(plan: string, hash: string, path: string, total: number): string[] {
    if (plan.length === 0) return ['']
    const chunks: string[] = []
    let from = 0
    while (from < plan.length) {
      const header = GhPlanPublication.#header(hash, path, chunks.length + 1, total)
      const capacity = GhPlanPublication.#MAX_BODY_UNITS - header.length
      if (capacity < 1) {
        throw new PlanProgressNotRead(`the publication header for ${path} exceeds 60000 UTF-16 units`)
      }
      const to = GhPlanPublication.#chunkEnd(plan, from, capacity)
      chunks.push(plan.slice(from, to))
      from = to
    }
    return chunks
  }

  static #chunkEnd(text: string, from: number, capacity: number): number {
    let cursor = from
    let units = 0
    let lineBoundary = from
    while (cursor < text.length) {
      const point = text.codePointAt(cursor)
      if (point === undefined) break
      const size = point > 0xFFFF ? 2 : 1
      if (units + size > capacity) break
      cursor += size
      units += size
      if (point === 0x0A) lineBoundary = cursor
    }
    return lineBoundary > from ? lineBoundary : cursor
  }

  static #header(hash: string, path: string, part: number, total: number): string {
    return `Plan ${hash} — part ${part}/${total}\nSource: ${path}\n\n`
  }

  static #hasCode(cause: unknown, code: string): boolean {
    return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === code
  }
}
