import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TableRead } from './process-table.ts'

export class ProcProcessTable {
  static readonly #PROCESS_GROUP_FIELD = 2
  static readonly #START_TICKS_FIELD = 19

  readonly #root: string

  constructor({ root }: { root: string }) {
    this.#root = root
  }

  async read(read: TableRead): Promise<string> {
    const deadline = Date.now() + read.timeoutMs
    const rows: string[] = []
    let bytes = 0
    for (const entry of await readdir(this.#root)) {
      if (!/^\d+$/.test(entry)) continue
      if (read.abort.aborted) throw new Error('process-table read was aborted')
      if (Date.now() > deadline) throw new Error(`process-table read exceeded ${read.timeoutMs}ms`)
      const stat = await this.#statOf(entry)
      if (stat === null) continue
      const row = ProcProcessTable.#rowOf(entry, stat)
      bytes += row.length + 1
      if (bytes > read.maxBufferBytes) throw new Error(`process table exceeded ${read.maxBufferBytes} bytes`)
      rows.push(row)
    }
    if (read.abort.aborted) throw new Error('process-table read was aborted')

    return rows.map((row) => `${row}\n`).join('')
  }

  async #statOf(pid: string): Promise<string | null> {
    try {
      return await readFile(join(this.#root, pid, 'stat'), 'utf8')
    } catch (failure) {
      if (failure instanceof Error && 'code' in failure && (failure.code === 'ENOENT' || failure.code === 'ESRCH')) return null
      throw failure
    }
  }

  static #rowOf(pid: string, stat: string): string {
    const fields = ProcProcessTable.#fieldsAfterCommandName(stat)
    const processGroup = fields[ProcProcessTable.#PROCESS_GROUP_FIELD]
    const startTicks = fields[ProcProcessTable.#START_TICKS_FIELD]
    if (processGroup === undefined || startTicks === undefined) throw new Error(`malformed /proc stat for pid ${pid}`)

    return `${pid} ${processGroup} @${startTicks}`
  }

  static #fieldsAfterCommandName(stat: string): string[] {
    return stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)
  }
}
