import { mkdtemp, rm } from 'node:fs/promises'
import { setTimeout as after } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiServer } from '../../../src/infrastructure/api-server.ts'
import { CtApi } from '../../../src/infrastructure/ct-api.ts'
import type { ApiHost } from '../../../src/infrastructure/ct-api.ts'
import { ProcessRunner } from '../../../src/infrastructure/process-runner.ts'
import type {
  LaunchedProcess, LaunchOptions, RunAndWaitOptions, RunOutcome,
} from '../../../src/infrastructure/process-runner.ts'
import { ProcessTable } from '../../../src/infrastructure/process-table.ts'
import type { TableRead, Terminal, TerminalOptions } from '../../../src/infrastructure/process-table.ts'
import { LivingProcessGroups } from './living-process-groups.ts'
import { ScriptedConversation } from './scripted-conversation.ts'

export class ExitRequested extends Error {
  readonly code: number

  constructor(code: number) {
    super(`the entrypoint asked to exit with code ${code}`)
    this.name = new.target.name
    this.code = code
  }
}

export class HostProcesses extends ProcessRunner implements ProcessTable {
  readonly #conversation: ProcessRunner
  readonly #table: ProcessTable

  constructor({ conversation, table }: { conversation: ProcessRunner, table: ProcessTable }) {
    super()
    this.#conversation = conversation
    this.#table = table
  }

  override runAndWait(binary: string, argv: readonly string[], options: RunAndWaitOptions): Promise<RunOutcome> {
    return this.#conversation.runAndWait(binary, argv, options)
  }

  override launch(binary: string, argv: readonly string[], options: LaunchOptions): LaunchedProcess {
    return this.#conversation.launch(binary, argv, options)
  }

  signal(pid: number, signal: NodeJS.Signals | 0): void {
    this.#table.signal(pid, signal)
  }

  readTable(read: TableRead): Promise<string> {
    return this.#table.readTable(read)
  }

  openTerminal(file: string, argv: string[], options: TerminalOptions): Terminal {
    return this.#table.openTerminal(file, argv, options)
  }
}

class HostClock {
  #stopped = false

  stop(): void {
    this.#stopped = true
  }

  wait(milliseconds: number): Promise<void> {
    return after(milliseconds, undefined, { ref: false }).then(() => new Promise<void>((resolve) => {
      if (!this.#stopped) resolve()
    }))
  }
}

export class InProcessApi {
  static readonly #instances: InProcessApi[] = []

  readonly port: number
  readonly #server: ApiServer
  readonly #stdout: string[]
  readonly #stderr: string[]
  readonly #configDirectory: string | null
  readonly #clock: HostClock

  private constructor(asked: {
    server: ApiServer,
    port: number,
    stdout: string[],
    stderr: string[],
    configDirectory: string | null,
    clock: HostClock,
  }) {
    this.#server = asked.server
    this.port = asked.port
    this.#stdout = asked.stdout
    this.#stderr = asked.stderr
    this.#configDirectory = asked.configDirectory
    this.#clock = asked.clock
  }

  said(): string {
    return this.#stdout.join('')
  }

  saidLater(): string {
    return this.#stderr.join('')
  }

  async stop(): Promise<void> {
    this.#clock.stop()
    await this.#server.stop()
  }

  async #removeConfigDirectory(): Promise<void> {
    if (this.#configDirectory === null) return
    await rm(this.#configDirectory, { recursive: true, force: true })
  }

  static async started(
    environment: NodeJS.ProcessEnv, processes?: ProcessRunner & ProcessTable
  ): Promise<InProcessApi> {
    const configDirectory = environment.CLAUDE_CONFIG_DIR === undefined
      ? await mkdtemp(join(tmpdir(), 'ct-api-in-process-config-'))
      : null
    const stdout: string[] = []
    const stderr: string[] = []
    const clock = new HostClock()
    const host: ApiHost = {
      processes: processes ?? InProcessApi.#quietProcesses(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      exit: (code) => { throw new ExitRequested(code) },
      wait: (milliseconds) => clock.wait(milliseconds),
    }
    const server = await CtApi.run([], InProcessApi.#environment(environment, configDirectory), host)
    const { port } = JSON.parse(stdout.join('')) as { port: number }
    const instance = new InProcessApi({ server, port, stdout, stderr, configDirectory, clock })
    InProcessApi.#instances.push(instance)

    return instance
  }

  static async refused(environment: NodeJS.ProcessEnv): Promise<{ status: number, said: string[] }> {
    const stderr: string[] = []
    const clock = new HostClock()
    const host: ApiHost = {
      processes: InProcessApi.#quietProcesses(),
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      exit: (code) => { throw new ExitRequested(code) },
      wait: (milliseconds) => clock.wait(milliseconds),
    }
    try {
      await CtApi.run([], environment, host)
    } catch (failure) {
      if (failure instanceof ExitRequested) return { status: failure.code, said: stderr.join('').split('\n') }
      throw failure
    } finally {
      clock.stop()
    }
    throw new Error('CtApi.run started listening instead of refusing the invocation')
  }

  static async stopAll(): Promise<void> {
    const instances = InProcessApi.#instances.splice(0)
    await Promise.all(instances.map((instance) => instance.stop()))
    await Promise.all(instances.map((instance) => instance.#removeConfigDirectory()))
  }

  static #environment(environment: NodeJS.ProcessEnv, configDirectory: string | null): NodeJS.ProcessEnv {
    return configDirectory === null ? environment : { ...environment, CLAUDE_CONFIG_DIR: configDirectory }
  }

  static #quietProcesses(): ProcessRunner & ProcessTable {
    return new HostProcesses({ conversation: new ScriptedConversation(), table: new LivingProcessGroups([]) })
  }
}
