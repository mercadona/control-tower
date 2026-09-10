import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { GoRegistry } from '../domain/ports/go-registry.ts'
import { GoNotRecorded } from '../domain/exceptions.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

type RandomBytes = (bytes: number) => Uint8Array
type ReadText = (path: string) => string
type StatEntry = (path: string) => { isFile(): boolean }
type WriteText = (path: string, text: string) => Promise<void>

export class DiskGoRegistry extends GoRegistry {
  static readonly NONCE_BYTES = 4
  static readonly DIRECTORY = 'go'

  readonly random: RandomBytes
  readonly read: ReadText | null
  readonly stat: StatEntry | null
  readonly write: WriteText
  readonly root: string

  constructor({ random, read = null, stat = null, write, root }: {
    random: RandomBytes,
    read?: ReadText | null,
    stat?: StatEntry | null,
    write: WriteText,
    root: string,
  }) {
    super()
    this.random = random
    this.read = read
    this.stat = stat
    this.write = write
    this.root = root
  }

  static nonceFrom(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('hex')
  }

  static commitmentOf(nonce: string): string {
    return createHash('sha256').update(nonce, 'utf8').digest('hex')
  }

  static fileNameFor({ issueNumber, repository }: { issueNumber: number, repository: RepositoryName }): string {
    return `${repository.text.replace(/\//g, '__')}-${issueNumber}.json`
  }

  static pathFor({ issueNumber, repository, root }: {
    issueNumber: number,
    repository: RepositoryName,
    root: string,
  }): string {
    return join(root, DiskGoRegistry.DIRECTORY, DiskGoRegistry.fileNameFor({ issueNumber, repository }))
  }

  static contentFor({ issueNumber, repository, commitment }: {
    issueNumber: number,
    repository: RepositoryName,
    commitment: string,
  }): string {
    return `${JSON.stringify({ repo: repository.text, issue: issueNumber, commitment }, null, 2)}\n`
  }

  static #isRecord(parsed: unknown): parsed is Record<string, unknown> {
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
  }

  static #messageOf(failure: unknown): string {
    return failure instanceof Error ? failure.message : String(failure)
  }

  async mint({ issueNumber, repository }: { issueNumber: number, repository: RepositoryName }): Promise<string> {
    const nonce = DiskGoRegistry.nonceFrom(this.random(DiskGoRegistry.NONCE_BYTES))
    const path = DiskGoRegistry.pathFor({ issueNumber, repository, root: this.root })
    try {
      await this.write(path, DiskGoRegistry.contentFor({
        issueNumber, repository, commitment: DiskGoRegistry.commitmentOf(nonce),
      }))
    } catch (failure) {
      throw new GoNotRecorded(
        `the go of ${repository.text}#${issueNumber} could not be written to ${path}: ${DiskGoRegistry.#messageOf(failure)}`
      )
    }

    return nonce
  }

  matches(watch: PlanWatch): boolean {
    if (this.read === null || this.stat === null) return false
    const path = DiskGoRegistry.pathFor({
      issueNumber: watch.issue.number,
      repository: watch.repository,
      root: this.root,
    })
    try {
      if (!this.stat(path).isFile()) return false
      const record: unknown = JSON.parse(this.read(path))

      return DiskGoRegistry.#isRecord(record) &&
        record.repo === watch.repository.text && record.issue === watch.issue.number &&
        typeof record.commitment === 'string' && /^[0-9a-f]{64}$/.test(record.commitment)
    } catch {
      return false
    }
  }
}
