import { join } from 'node:path'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

type ReadText = (path: string) => string
type StatEntry = (path: string) => { isFile(): boolean }
type WriteText = (path: string, text: string) => Promise<void>

export class DiskImplementationStartRegistry {
  static readonly DIRECTORY = 'implementation-starts'
  static readonly NOT_IDENTITY = ['story']

  readonly read: ReadText
  readonly stat: StatEntry
  readonly write: WriteText
  readonly root: string

  constructor({ read, stat, write, root }: {
    read: ReadText,
    stat: StatEntry,
    write: WriteText,
    root: string,
  }) {
    this.read = read
    this.stat = stat
    this.write = write
    this.root = root
  }

  static pathFor({ issueNumber, repository, root }: {
    issueNumber: number,
    repository: RepositoryName,
    root: string,
  }): string {
    const file = `${repository.text.replace(/\//g, '__')}-${issueNumber}.json`
    return join(root, DiskImplementationStartRegistry.DIRECTORY, file)
  }

  static recordFor(watch: PlanWatch): Record<string, unknown> {
    return {
      repo: watch.repository.text,
      issue: watch.issue.number,
      agent: watch.agent,
      story: watch.storyText(),
      root: watch.located.root,
      branch: watch.located.branch,
      worktree: watch.located.path,
    }
  }

  static #isRecord(parsed: unknown): parsed is Record<string, unknown> {
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
  }

  async remember(watch: PlanWatch): Promise<void> {
    const path = DiskImplementationStartRegistry.pathFor({
      issueNumber: watch.issue.number,
      repository: watch.repository,
      root: this.root,
    })
    await this.write(path, `${JSON.stringify(DiskImplementationStartRegistry.recordFor(watch), null, 2)}\n`)
  }

  matches(watch: PlanWatch): boolean {
    const path = DiskImplementationStartRegistry.pathFor({
      issueNumber: watch.issue.number,
      repository: watch.repository,
      root: this.root,
    })
    try {
      if (!this.stat(path).isFile()) return false
      const record: unknown = JSON.parse(this.read(path))
      const expected = DiskImplementationStartRegistry.recordFor(watch)

      return DiskImplementationStartRegistry.#isRecord(record) &&
        Object.keys(expected)
          .filter((field) => !DiskImplementationStartRegistry.NOT_IDENTITY.includes(field))
          .every((field) => record[field] === expected[field])
    } catch {
      return false
    }
  }
}
