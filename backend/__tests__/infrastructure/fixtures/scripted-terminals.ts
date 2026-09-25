import { ProcessTable } from '../../../src/infrastructure/process-table.ts'
import type { TableRead, Terminal, TerminalOptions } from '../../../src/infrastructure/process-table.ts'

class LiveTerminal implements Terminal {
  readonly pid: number
  readonly #owner: ScriptedTerminals
  #onData: ((bytes: string) => void) | null = null
  #onExit: (() => void) | null = null

  constructor(pid: number, owner: ScriptedTerminals) {
    this.pid = pid
    this.#owner = owner
  }

  onData(listener: (bytes: string) => void): void {
    this.#onData = listener
  }

  onExit(listener: () => void): void {
    this.#onExit = listener
  }

  write(text: string): void {
    this.#owner.typed += text
  }

  resize(_cols: number, _rows: number): void {}

  becomeReady(): void {
    this.#onData?.(ScriptedTerminals.READY)
  }

  end(): void {
    this.#onExit?.()
  }
}

export class ScriptedTerminals extends ProcessTable {
  static readonly READY = 'scripted-terminal-ready'
  static readonly #START = 'Thu Sep 17 22:29:08 2026'
  static readonly #UNRELATED_PID = 1

  readonly opened: { file: string, argv: string[], cwd: string }[] = []
  readonly signalled: number[] = []
  typed = ''

  #nextPid = 61_000
  readonly #live = new Map<number, LiveTerminal>()
  readonly #pids: number[] = []

  get pids(): readonly number[] {
    return this.#pids
  }

  override openTerminal(file: string, argv: string[], options: TerminalOptions): Terminal {
    const pid = this.#nextPid++
    this.opened.push({ file, argv: [...argv], cwd: options.cwd })
    this.#pids.push(pid)
    const terminal = new LiveTerminal(pid, this)
    this.#live.set(pid, terminal)
    queueMicrotask(() => terminal.becomeReady())

    return terminal
  }

  override signal(pid: number, signal: NodeJS.Signals | 0): void {
    this.signalled.push(pid)
    const group = Math.abs(pid)
    const terminal = this.#live.get(group)
    if (signal === 0) {
      if (terminal === undefined) throw Object.assign(new Error(`no such process ${pid}`), { code: 'ESRCH' })
      return
    }
    if (terminal === undefined) return
    this.#live.delete(group)
    terminal.end()
  }

  override readTable(_read: TableRead): Promise<string> {
    const rows = [...this.#live.keys()].map((pid) => ScriptedTerminals.#rowFor(pid))
    rows.push(ScriptedTerminals.#rowFor(ScriptedTerminals.#UNRELATED_PID))

    return Promise.resolve(`${rows.join('\n')}\n`)
  }

  static #rowFor(pid: number): string {
    return ` ${pid}  ${pid} ${ScriptedTerminals.#START}`
  }
}
