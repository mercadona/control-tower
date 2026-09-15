import { basename, dirname, join } from 'node:path'
import type { StartedPlanCall } from '../domain/value-objects/plan-call.ts'

export class HeadlessFiles {
  readonly root: string
  readonly fs: typeof import('node:fs/promises')
  readonly newId: () => string

  constructor(asked: { root: string, fs: typeof import('node:fs/promises'), newId: () => string }) {
    this.root = asked.root
    this.fs = asked.fs
    this.newId = asked.newId
  }

  dispatchPath(conversation: string): string {
    return join(this.root, 'harness', conversation, 'dispatch.json')
  }

  callDirectory(call: StartedPlanCall): string {
    return join(this.root, 'harness', call.conversation, 'calls', call.id)
  }

  async writeOnce(path: string, text: string): Promise<void> {
    await this.fs.mkdir(dirname(path), { recursive: true })
    const temporary = join(dirname(path), `.${basename(path)}.${this.newId()}.tmp`)
    let opened: import('node:fs/promises').FileHandle | null = await this.fs.open(temporary, 'wx')
    try {
      await opened.writeFile(text, 'utf8')
      await opened.sync()
      await opened.close()
      opened = null
      await this.fs.link(temporary, path)
    } finally {
      if (opened !== null) await opened.close()
      await this.fs.rm(temporary, { force: true })
    }
  }

  async read(path: string): Promise<string | null> {
    try {
      return await this.fs.readFile(path, 'utf8')
    } catch (cause) {
      if (HeadlessFiles.#hasCode(cause, 'ENOENT')) return null
      throw cause
    }
  }

  async list(path: string): Promise<string[]> {
    try {
      return await this.fs.readdir(path)
    } catch (cause) {
      if (HeadlessFiles.#hasCode(cause, 'ENOENT')) return []
      throw cause
    }
  }

  static #hasCode(cause: unknown, code: string): boolean {
    return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === code
  }
}
