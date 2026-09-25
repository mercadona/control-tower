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

    return DiskSliceBaselines.#outcomeOf(parsed.meta, path) === BaselineOutcome.RED
  }

  static #outcomeOf(meta: unknown, path: string): string | null {
    const baseline = DiskSliceBaselines.#isMapping(meta) ? meta.baseline : undefined
    if (baseline === undefined || baseline === null) return null
    if (!DiskSliceBaselines.#isMapping(baseline)) {
      throw new SliceBaselineNotUnderstood(`the frontmatter of ${path} has a baseline that is not a mapping`)
    }
    const outcome = baseline.outcome
    if (outcome === undefined || outcome === null) return null
    if (typeof outcome !== 'string') {
      throw new SliceBaselineNotUnderstood(`the frontmatter of ${path} has a baseline.outcome that is not text`)
    }

    return outcome
  }

  static #isMapping(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  static #messageOf(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
  }
}
