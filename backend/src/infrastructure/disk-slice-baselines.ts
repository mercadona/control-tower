import { parseStateSafe } from '../../../plugin/scripts/state.js'
import { BaselineOutcome } from '../../../plugin/scripts/baseline.js'
import { SliceBaselineNotRead, SliceBaselineNotUnderstood } from '../domain/exceptions.ts'
import { SliceBaselines } from '../domain/ports/slice-baselines.ts'
import { DiskSliceEscalations } from './disk-slice-escalations.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'

export class DiskSliceBaselines extends SliceBaselines {
  readonly read: (path: string) => Promise<string | null>

  constructor({ read }: { read: (path: string) => Promise<string | null> }) {
    super()
    this.read = read
  }

  override async isRed({ root, issue }: { root: CheckoutRoot, issue: number }): Promise<boolean> {
    const path = DiskSliceEscalations.stateFileFor(root.text, issue)
    let markdown: string | null
    try {
      markdown = await this.read(path)
    } catch (cause) {
      throw new SliceBaselineNotRead(`${path} could not be read: ${DiskSliceBaselines.#messageOf(cause)}`)
    }
    if (markdown === null) return false
    const parsed = parseStateSafe(markdown)
    if (parsed.error !== null) {
      throw new SliceBaselineNotUnderstood(`the frontmatter of ${path} is not valid YAML: ${parsed.error}`)
    }

    return (parsed.meta as { baseline?: { outcome?: string } }).baseline?.outcome === BaselineOutcome.RED
  }

  static #messageOf(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
  }
}
