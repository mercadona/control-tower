export type TerminalOptions = {
  readonly name: string,
  readonly cols: number,
  readonly rows: number,
  readonly cwd: string,
  readonly env: Record<string, string>,
}

export type TableRead = {
  readonly abort: AbortSignal,
  readonly timeoutMs: number,
  readonly maxBufferBytes: number,
}

export type Terminal = {
  readonly pid: number,
  onData(listener: (bytes: string) => void): void,
  onExit(listener: () => void): void,
  write(text: string): void,
  resize(cols: number, rows: number): void,
}

export class ProcessTable {
  signal(pid: number, signal: NodeJS.Signals | 0): void {
    throw new Error(`${this.constructor.name} must implement signal(pid, signal)`)
  }

  readTable(read: TableRead): Promise<string> {
    throw new Error(`${this.constructor.name} must implement readTable(read)`)
  }

  openTerminal(file: string, argv: string[], options: TerminalOptions): Terminal {
    throw new Error(`${this.constructor.name} must implement openTerminal(file, argv, options)`)
  }
}

export type TerminalSpawn = ProcessTable['openTerminal']
