import type { ProcessOutput } from './tool-runner.ts'
import type { RetryPolicy } from '../domain/policies/retry-policy.ts'

export type ToolLaunch = (argv: string[]) => Promise<ProcessOutput>
export type ToolSleep = (seconds: number) => Promise<void>

export class ExternalTool {
  static readonly #NETWORK = [
    'connection reset',
    'connection refused',
    'tls handshake',
    'i/o timeout',
    'context deadline exceeded',
    'unexpected eof',
    'unexpected end of json input',
    'temporary failure in name resolution',
    'dial tcp',
    'no such host',
    'network is unreachable',
    'internal server error',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
  ]

  static readonly #SERVER_STATUS = /http 5\d\d/

  readonly launch: ToolLaunch
  readonly policy: RetryPolicy
  readonly sleep: ToolSleep

  constructor({ launch, policy, sleep }: { launch: ToolLaunch, policy: RetryPolicy, sleep: ToolSleep }) {
    this.launch = launch
    this.policy = policy
    this.sleep = sleep
  }

  async run(argv: string[], { safeToRepeat }: { safeToRepeat: boolean }): Promise<ProcessOutput> {
    let output = await this.launch(argv)
    let attempted = 0
    while (output.failed) {
      const decision = this.policy.afterAFailure({
        transient: this.isTransient(output.stderr),
        safeToRepeat,
        attempted,
      })
      if (!decision.retry) break

      await this.sleep(decision.waitSeconds)
      output = await this.launch(argv)
      attempted += 1
    }

    return output
  }

  isTransient(stderr: string): boolean {
    const lowered = String(stderr).toLowerCase()

    return ExternalTool.#NETWORK.some((marker) => lowered.includes(marker)) ||
      ExternalTool.#SERVER_STATUS.test(lowered)
  }
}
