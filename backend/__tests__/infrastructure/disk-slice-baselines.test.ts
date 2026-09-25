import { describe, expect, it } from 'vitest'
import { SliceBaselineNotRead, SliceBaselineNotUnderstood } from '../../src/domain/exceptions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { DiskSliceBaselines } from '../../src/infrastructure/disk-slice-baselines.ts'

class SliceBaselineMarkdown {
  static readonly ISSUE = 591
  static readonly ROOT = '/repo'

  static red(): string {
    return [
      '---',
      'baseline:',
      '  outcome: rojo',
      '  command: "npm test"',
      '  summary: "exit 1"',
      '---',
      '',
    ].join('\n')
  }

  static unverified(): string {
    return [
      '---',
      'baseline:',
      '  outcome: no-verificado',
      '  command: null',
      '  summary: "no test command declared"',
      '---',
      '',
    ].join('\n')
  }

  static unparsable(): string {
    return ['---', 'baseline: [unterminated', '---', ''].join('\n')
  }

  static path(): string {
    return `${SliceBaselineMarkdown.ROOT}/.worktrees/${SliceBaselineMarkdown.ISSUE}/.agent/SLICE.md`
  }
}

class ReadDouble {
  readonly answers: Map<string, string | null>

  constructor(answers: Map<string, string | null>) {
    this.answers = answers
  }

  read = async (path: string): Promise<string | null> => {
    if (!this.answers.has(path)) throw new Error(`no answer scripted for ${path}`)
    return this.answers.get(path)!
  }
}

class ThrowingRead {
  static async read(): Promise<string | null> {
    throw new Error('disk unavailable')
  }
}

describe('DiskSliceBaselines', () => {
  it('a baseline whose outcome is rojo is red', async () => {
    const read = new ReadDouble(new Map([[SliceBaselineMarkdown.path(), SliceBaselineMarkdown.red()]]))
    const baselines = new DiskSliceBaselines({ read: read.read })

    const red = await baselines.isRed({
      root: new CheckoutRoot(SliceBaselineMarkdown.ROOT), issue: SliceBaselineMarkdown.ISSUE,
    })

    expect(red).toBe(true)
  })

  it('a baseline whose outcome is no-verificado is not red', async () => {
    const read = new ReadDouble(new Map([[SliceBaselineMarkdown.path(), SliceBaselineMarkdown.unverified()]]))
    const baselines = new DiskSliceBaselines({ read: read.read })

    const red = await baselines.isRed({
      root: new CheckoutRoot(SliceBaselineMarkdown.ROOT), issue: SliceBaselineMarkdown.ISSUE,
    })

    expect(red).toBe(false)
  })

  it('a slice with no state file is not red', async () => {
    const read = new ReadDouble(new Map([[SliceBaselineMarkdown.path(), null]]))
    const baselines = new DiskSliceBaselines({ read: read.read })

    const red = await baselines.isRed({
      root: new CheckoutRoot(SliceBaselineMarkdown.ROOT), issue: SliceBaselineMarkdown.ISSUE,
    })

    expect(red).toBe(false)
  })

  it('a state file that cannot be read is told apart from one that cannot be understood', async () => {
    const baselines = new DiskSliceBaselines({ read: ThrowingRead.read })

    await expect(baselines.isRed({
      root: new CheckoutRoot(SliceBaselineMarkdown.ROOT), issue: SliceBaselineMarkdown.ISSUE,
    })).rejects.toBeInstanceOf(SliceBaselineNotRead)

    const unparsable = new ReadDouble(new Map([[SliceBaselineMarkdown.path(), SliceBaselineMarkdown.unparsable()]]))
    const unparsableBaselines = new DiskSliceBaselines({ read: unparsable.read })

    await expect(unparsableBaselines.isRed({
      root: new CheckoutRoot(SliceBaselineMarkdown.ROOT), issue: SliceBaselineMarkdown.ISSUE,
    })).rejects.toBeInstanceOf(SliceBaselineNotUnderstood)
  })
})
