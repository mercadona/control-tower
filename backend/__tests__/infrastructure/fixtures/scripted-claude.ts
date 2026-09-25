import { readFileSync, writeFileSync, writeSync } from 'node:fs'
import { ClaudeRunCalls } from '../../../src/infrastructure/claude-run-calls.ts'
import { ProcessRunner } from '../../../src/infrastructure/process-runner.ts'
import type { LaunchedProcess, LaunchOptions, RunAndWaitOptions, RunOutcome } from '../../../src/infrastructure/process-runner.ts'
import { Capture, ScriptedProcess, UnscriptedRequest } from './scripted-conversation.ts'

export class ClaudeRequest {
  readonly conversation: string
  readonly role: string
  readonly argv: readonly string[]
  readonly prompt: string

  constructor(asked: { conversation: string, role: string, argv: readonly string[], prompt: string }) {
    this.conversation = asked.conversation
    this.role = asked.role
    this.argv = Object.freeze([...asked.argv])
    this.prompt = asked.prompt
    Object.freeze(this)
  }
}

export class ScriptedClaude extends ProcessRunner {
  static readonly #IMPLEMENT_STRUCTURED_OUTPUT = Object.freeze({
    paths: Object.freeze(['work.txt']),
    summary: 'Scripted implementer response.',
  })
  static readonly #ADVISOR_STRUCTURED_OUTPUT = Object.freeze({
    approach: 'Keep the scripted scope.',
    files_to_reconsider: Object.freeze([]),
  })
  static readonly #ERRAND = /^Read the file at (.+) and do exactly what it says\.$/

  readonly asked: ClaudeRequest[] = []
  readonly #capture: Capture

  constructor(capture: Capture) {
    super()
    this.#capture = capture
  }

  override launch(_binary: string, argv: readonly string[], options: LaunchOptions): LaunchedProcess {
    const request = ScriptedClaude.#request(argv)
    this.asked.push(request)
    ScriptedClaude.#answerFileErrand(request.prompt)
    const capture = this.#played(request)
    ScriptedClaude.#writeStdoutWhileItsDescriptorIsStillOpen(options.stdio, capture)

    return new ScriptedProcess(ScriptedClaude.#alreadyDeliveredStdout(capture), options.stdio)
  }

  override async runAndWait(binary: string, argv: readonly string[], options: RunAndWaitOptions): Promise<RunOutcome> {
    throw new UnscriptedRequest({ binary, argv, cwd: options.cwd })
  }

  #played(request: ClaudeRequest): Capture {
    const result = JSON.parse(this.#capture.stdout) as Record<string, unknown>
    result.session_id = request.conversation
    if (request.role === 'implement') result.structured_output = ScriptedClaude.#IMPLEMENT_STRUCTURED_OUTPUT
    if (request.role === 'ct-advisor') result.structured_output = ScriptedClaude.#ADVISOR_STRUCTURED_OUTPUT

    return new Capture({
      command: this.#capture.command,
      version: this.#capture.version,
      date: this.#capture.date,
      code: this.#capture.code,
      stdout: `${JSON.stringify(result)}\n`,
      stderr: this.#capture.stderr,
    })
  }

  static #writeStdoutWhileItsDescriptorIsStillOpen(stdio: LaunchOptions['stdio'], capture: Capture): void {
    const descriptor = stdio[1]
    if (typeof descriptor === 'number' && capture.stdout.length > 0) writeSync(descriptor, capture.stdout)
  }

  static #alreadyDeliveredStdout(capture: Capture): Capture {
    return new Capture({
      command: capture.command,
      version: capture.version,
      date: capture.date,
      code: capture.code,
      stdout: '',
      stderr: capture.stderr,
    })
  }

  static #request(argv: readonly string[]): ClaudeRequest {
    return new ClaudeRequest({
      conversation: ScriptedClaude.#conversation(argv),
      role: ScriptedClaude.#role(argv),
      argv,
      prompt: ScriptedClaude.#prompt(argv),
    })
  }

  static #conversation(argv: readonly string[]): string {
    const option = argv.includes('--session-id') ? '--session-id' : '--resume'
    const at = argv.indexOf(option)
    const conversation = at < 0 ? undefined : argv[at + 1]
    if (conversation === undefined) {
      throw new Error(`argv carries neither --session-id nor --resume: ${JSON.stringify(argv)}`)
    }

    return conversation
  }

  static #role(argv: readonly string[]): string {
    if (argv.includes('--session-id')) return 'plan'
    const at = argv.indexOf('--agent')
    const named = at < 0 ? undefined : argv[at + 1]

    return named ?? 'implement'
  }

  static #prompt(argv: readonly string[]): string {
    const errand = argv.at(-1)
    const match = errand === undefined ? null : ScriptedClaude.#ERRAND.exec(errand)
    if (match === null) throw new Error(`unexpected CLI errand: ${JSON.stringify(errand)}`)

    return readFileSync(match[1], 'utf8')
  }

  static #answerFileErrand(prompt: string): void {
    const lines = prompt.split('\n')
    const path = lines.at(-1)
    if (path === undefined || lines.at(-2) !== ClaudeRunCalls.FILE_ERRAND_END) return

    writeFileSync(path, `${JSON.stringify({ ruling: 'PASS' })}\n`)
  }
}
