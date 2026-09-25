import { EventEmitter } from 'node:events'
import type { LaunchedProcess, LaunchOptions } from '../../../src/infrastructure/process-runner.ts'
import { Capture, ScriptedConversation, ScriptedProcess } from './scripted-conversation.ts'

class HeldPush extends EventEmitter implements LaunchedProcess {
  static #nextPid = 1

  readonly pid: number

  constructor(wait: Promise<void>, capture: Capture) {
    super()
    this.pid = HeldPush.#nextPid++
    void wait.then(() => { this.emit('close', capture.code, null) })
  }

  kill(): boolean {
    return true
  }

  disconnect(): void {}

  unref(): void {}
}

export class ScratchOrigin extends ScriptedConversation {
  static readonly #PUSH_ACCEPTED = Capture.read('git', 'push-accepted-new-branch')
  static readonly #PUSH_REJECTED = Capture.read('git', 'push-rejected')
  static readonly #LS_REMOTE_ABSENT = Capture.read('git', 'ls-remote-absent-branch')
  static readonly #LS_REMOTE_PRESENT = Capture.read('git', 'ls-remote-present-branch')

  remote: string | null

  readonly #ref: string
  #heldPush: Promise<void> | null = null

  constructor({ branch, remote = null }: { branch: string, remote?: string | null }) {
    super()
    this.#ref = `refs/heads/${branch}`
    this.remote = remote
  }

  advance(sha: string): void {
    this.remote = sha
  }

  holdNextPush(): () => void {
    let release!: () => void
    this.#heldPush = new Promise((resolve) => { release = resolve })
    return release
  }

  override launch(binary: string, argv: readonly string[], options: LaunchOptions): LaunchedProcess {
    if (this.#isLsRemote(argv)) return new ScriptedProcess(this.#lsRemoteCapture(), options.stdio)
    const pushedSha = this.#pushedSha(argv)
    if (pushedSha !== null) {
      const held = this.#heldPush
      if (held !== null) {
        this.#heldPush = null
        return new HeldPush(held, ScratchOrigin.#PUSH_REJECTED)
      }
      this.remote = pushedSha
      return new ScriptedProcess(ScratchOrigin.#templated(ScratchOrigin.#PUSH_ACCEPTED, pushedSha), options.stdio)
    }
    return super.launch(binary, argv, options)
  }

  #isLsRemote(argv: readonly string[]): boolean {
    return argv.length === 6 && argv[0] === '-C' && argv[2] === 'ls-remote' && argv[3] === '--heads'
      && argv[4] === 'origin' && argv[5] === this.#ref
  }

  #pushedSha(argv: readonly string[]): string | null {
    if (argv.length !== 5 || argv[0] !== '-C' || argv[2] !== 'push' || argv[3] !== 'origin') return null
    const separator = argv[4].indexOf(':')
    if (separator === -1 || argv[4].slice(separator + 1) !== this.#ref) return null
    return argv[4].slice(0, separator)
  }

  #lsRemoteCapture(): Capture {
    return this.remote === null
      ? ScratchOrigin.#LS_REMOTE_ABSENT
      : ScratchOrigin.#templated(ScratchOrigin.#LS_REMOTE_PRESENT, this.remote)
  }

  static #templated(capture: Capture, sha: string): Capture {
    return new Capture({
      command: capture.command, version: capture.version, date: capture.date, code: capture.code,
      stdout: capture.stdout.replaceAll('<sha>', sha),
      stderr: capture.stderr.replaceAll('<sha>', sha),
    })
  }
}
