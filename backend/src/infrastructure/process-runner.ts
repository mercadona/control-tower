export type RunAndWaitOptions = {
  readonly cwd?: string,
  readonly env?: NodeJS.ProcessEnv,
  readonly timeoutMs: number,
}

export type RunFailure = {
  readonly code?: number | string | null,
  readonly killed?: boolean,
  readonly signal?: NodeJS.Signals | null,
  readonly message: string,
}

export type RunOutcome = {
  readonly failure: RunFailure | null,
  readonly stdout: string,
  readonly stderr: string,
}

export type LaunchOptions = {
  readonly cwd?: string,
  readonly env?: NodeJS.ProcessEnv,
  readonly timeout?: number,
  readonly detached?: boolean,
  readonly stdio: readonly ('ignore' | 'pipe' | 'ipc' | number)[],
}

export type LaunchedProcess = {
  readonly pid?: number,
  readonly connected?: boolean,
  readonly stderr?: {
    setEncoding(encoding: string): void,
    on(event: 'data', listener: (chunk: string) => void): void,
  } | null,
  on(event: 'error', listener: (failure: Error) => void): void,
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void,
  on(event: 'message', listener: (message: unknown) => void): void,
  once(event: 'spawn', listener: () => void): void,
  once(event: 'error', listener: (failure: Error) => void): void,
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void,
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void,
  kill(signal?: NodeJS.Signals | number): boolean,
  disconnect(): void,
  unref(): void,
}

export class ProcessRunner {
  runAndWait(binary: string, argv: readonly string[], options: RunAndWaitOptions): Promise<RunOutcome> {
    throw new Error(`${this.constructor.name} must implement runAndWait(binary, argv, options)`)
  }

  launch(binary: string, argv: readonly string[], options: LaunchOptions): LaunchedProcess {
    throw new Error(`${this.constructor.name} must implement launch(binary, argv, options)`)
  }
}
