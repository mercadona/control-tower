import type { ProcessOwnership, RunOptions } from '../../../src/infrastructure/tool-runner.ts'
import { ProcessOutput } from '../../../src/infrastructure/tool-runner.ts'
import type { ScriptedGitHub } from './scripted-github.ts'

export type ReleaseOutcome =
  | { readonly kind: 'released' }
  | { readonly kind: 'refused', readonly group?: number }
  | { readonly kind: 'held', readonly group: number }
  | { readonly kind: 'lost', readonly group: number }

export class ScriptedRelease {
  static readonly #REFUSAL = 'real gate refusal'
  static readonly #LOST = 'the checked release process was lost'
  static readonly #FIRST_GENERATED_GROUP = 90_000_001

  readonly releases: { readonly argv: string[], readonly cwd: string | undefined }[] = []
  readonly node: (argv: string[], options?: RunOptions) => Promise<ProcessOutput>

  readonly #github: ScriptedGitHub
  #queue: ReleaseOutcome[] = []
  #generatedGroup = ScriptedRelease.#FIRST_GENERATED_GROUP
  #settle: ((output: ProcessOutput) => void) | null = null

  constructor(github: ScriptedGitHub) {
    this.#github = github
    this.node = (argv, options) => this.#run(argv, options)
  }

  next(outcome: ReleaseOutcome): void {
    this.#queue.push(outcome)
  }

  finish(output: ProcessOutput): void {
    const settle = this.#settle
    if (settle === null) throw new Error('no held checked release is waiting to finish')
    this.#settle = null
    settle(output)
  }

  async #run(argv: string[], options?: RunOptions): Promise<ProcessOutput> {
    this.releases.push({ argv, cwd: options?.cwd })
    const outcome = this.#queue.shift() ?? { kind: 'released' as const }
    switch (outcome.kind) {
      case 'released': return this.#released()
      case 'refused': return this.#refused(outcome, options)
      case 'held': return this.#held(outcome, options)
      case 'lost': return this.#lost(outcome, options)
      default: return outcome satisfies never
    }
  }

  #released(): ProcessOutput {
    this.#github.labels = ['status:in-review']
    return new ProcessOutput({ code: 0, stdout: 'released #7 → in-review\n', stderr: '' })
  }

  async #refused(outcome: { readonly group?: number }, options?: RunOptions): Promise<ProcessOutput> {
    await this.#spawn(outcome.group ?? this.#nextGeneratedGroup(), options)
    return new ProcessOutput({ code: 7, stdout: '', stderr: `${ScriptedRelease.#REFUSAL}\n` })
  }

  async #held(outcome: { readonly group: number }, options?: RunOptions): Promise<ProcessOutput> {
    await this.#spawn(outcome.group, options)
    return new Promise<ProcessOutput>((resolve) => { this.#settle = resolve })
  }

  async #lost(outcome: { readonly group: number }, options?: RunOptions): Promise<ProcessOutput> {
    await this.#spawn(outcome.group, options)
    throw new Error(ScriptedRelease.#LOST)
  }

  async #spawn(group: number, options?: RunOptions): Promise<void> {
    const ownership: ProcessOwnership = { pid: group, processGroup: group }
    await options?.onSpawn?.(ownership)
  }

  #nextGeneratedGroup(): number {
    const group = this.#generatedGroup
    this.#generatedGroup += 1
    return group
  }
}
