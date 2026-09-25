import { ProcessTable, type TableRead, type Terminal, type TerminalOptions } from '../../../src/infrastructure/process-table.ts'
import { UnscriptedRequest } from './scripted-conversation.ts'

export class LivingProcessGroups extends ProcessTable {
  readonly alive: Set<number>
  readonly asked: number[] = []

  constructor(alive: Iterable<number>) {
    super()
    this.alive = new Set(alive)
  }

  override signal(pid: number, signal: NodeJS.Signals | 0): void {
    this.asked.push(pid)
    if (signal === 0 && this.alive.has(pid)) return
    throw Object.assign(new Error(`no such process ${pid}`), { code: 'ESRCH' })
  }

  override readTable(_read: TableRead): Promise<string> {
    throw new UnscriptedRequest({ binary: 'readTable', argv: [] })
  }

  override openTerminal(file: string, argv: string[], _options: TerminalOptions): Terminal {
    throw new UnscriptedRequest({ binary: file, argv })
  }
}
