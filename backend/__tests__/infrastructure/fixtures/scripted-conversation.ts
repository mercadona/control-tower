import { EventEmitter } from 'node:events'
import { readFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProcessRunner } from '../../../src/infrastructure/process-runner.ts'
import type { LaunchedProcess, LaunchOptions, RunAndWaitOptions, RunOutcome } from '../../../src/infrastructure/process-runner.ts'

export type ScriptedRequest = {
  readonly binary: string,
  readonly argv: readonly string[],
  readonly cwd?: string,
}

export class UnscriptedRequest extends Error {
  constructor(request: ScriptedRequest) {
    super(`nobody wrote an answer for ${request.binary} ${request.argv.join(' ')} in ${request.cwd}`)
    this.name = new.target.name
  }
}

export class Capture {
  static readonly #DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', 'captures')
  static readonly #FIELDS = ['command', 'version', 'date', 'exit']
  static readonly #MALFORMED = 'a capture is missing its command, its version or its date'
  static readonly #STDOUT_MARKER = '--- stdout'
  static readonly #STDERR_MARKER = '--- stderr'

  readonly command: string
  readonly version: string
  readonly date: string
  readonly code: number
  readonly stdout: string
  readonly stderr: string

  constructor({ command, version, date, code, stdout, stderr }: {
    command: string, version: string, date: string, code: number, stdout: string, stderr: string,
  }) {
    this.command = command
    this.version = version
    this.date = date
    this.code = code
    this.stdout = stdout
    this.stderr = stderr
    Object.freeze(this)
  }

  static read(tool: string, name: string): Capture {
    return Capture.parse(readFileSync(join(Capture.#DIRECTORY, tool, `${name}.txt`), 'utf8'))
  }

  static parse(text: string): Capture {
    const lines = text.split('\n')
    const [command, version, date, exit] = Capture.#FIELDS.map((field, index) => Capture.#header(lines, index, field))
    if (lines[4] !== Capture.#STDOUT_MARKER) throw new Error(Capture.#MALFORMED)
    const stderrAt = lines.indexOf(Capture.#STDERR_MARKER, 5)
    if (stderrAt === -1) throw new Error(Capture.#MALFORMED)

    return new Capture({
      command,
      version,
      date,
      code: Number(exit),
      stdout: lines.slice(5, stderrAt).join('\n'),
      stderr: lines.slice(stderrAt + 1).join('\n'),
    })
  }

  static #header(lines: readonly string[], index: number, field: string): string {
    const prefix = `${field}: `
    const line = lines[index]
    if (line === undefined || !line.startsWith(prefix) || line.length === prefix.length) {
      throw new Error(Capture.#MALFORMED)
    }

    return line.slice(prefix.length)
  }
}

class ScriptedStderr extends EventEmitter {
  setEncoding(_encoding: string): void {}
}

class ScriptedProcess extends EventEmitter implements LaunchedProcess {
  static #nextPid = 1

  readonly pid: number
  readonly stderr = new ScriptedStderr()

  constructor(capture: Capture, stdio: LaunchOptions['stdio']) {
    super()
    this.pid = ScriptedProcess.#nextPid++
    queueMicrotask(() => ScriptedProcess.#play(this, capture, stdio))
  }

  kill(): boolean {
    return true
  }

  disconnect(): void {}

  unref(): void {}

  static #play(process: ScriptedProcess, capture: Capture, stdio: LaunchOptions['stdio']): void {
    process.emit('spawn')
    const stdout = stdio[1]
    if (typeof stdout === 'number' && capture.stdout.length > 0) writeSync(stdout, capture.stdout)
    if (capture.stderr.length > 0) process.stderr.emit('data', capture.stderr)
    process.emit('close', capture.code, null)
  }
}

export class ScriptedConversation extends ProcessRunner {
  readonly asked: ScriptedRequest[] = []
  #answers: { readonly request: ScriptedRequest, readonly capture: Capture }[] = []

  answering(request: ScriptedRequest, capture: Capture): ScriptedConversation {
    this.#answers = [...this.#answers, { request, capture }]

    return this
  }

  override async runAndWait(binary: string, argv: readonly string[], options: RunAndWaitOptions): Promise<RunOutcome> {
    const capture = this.#answerTo({ binary, argv, cwd: options.cwd })

    return {
      failure: capture.code === 0 ? null : { code: capture.code, killed: false, signal: null, message: capture.stderr },
      stdout: capture.stdout,
      stderr: capture.stderr,
    }
  }

  override launch(binary: string, argv: readonly string[], options: LaunchOptions): LaunchedProcess {
    const capture = this.#answerTo({ binary, argv, cwd: options.cwd })

    return new ScriptedProcess(capture, options.stdio)
  }

  #answerTo(request: ScriptedRequest): Capture {
    this.asked.push(request)
    const found = this.#answers.find((answer) => ScriptedConversation.#matches(answer.request, request))
    if (found === undefined) throw new UnscriptedRequest(request)

    return found.capture
  }

  static #matches(scripted: ScriptedRequest, asked: ScriptedRequest): boolean {
    return scripted.binary === asked.binary
      && scripted.cwd === asked.cwd
      && scripted.argv.length === asked.argv.length
      && scripted.argv.every((value, index) => value === asked.argv[index])
  }
}
