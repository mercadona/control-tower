import { describe, expect, it, vi } from 'vitest'
import { DiskEpicSpecs } from '../../src/infrastructure/disk-epic-specs.ts'
import { EpicSpecNotRead, EpicSpecNotUnderstood, EpicSpecNotWritten } from '../../src/domain/exceptions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.ts'
import { UserStoryUrl } from '../../src/domain/value-objects/user-story-url.ts'

class SpecFiles {
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly STORY = new UserStoryKey('STAFF-128')
  static readonly ISSUE_STORY = new UserStoryUrl('https://github.com/owner/name/issues/12')
  static readonly RELATIVE_PATH = 'docs/superpowers/specs/STAFF-128-execution.md'
  static readonly ABSOLUTE_PATH = '/repo/docs/superpowers/specs/STAFF-128-execution.md'
  static readonly TEXT = '# B — Execution spec\n'

  static holding(files: Record<string, string | null | Error>): (path: string) => Promise<string | null> {
    return async (path) => {
      if (!(path in files)) throw new Error(`unexpected read of ${path}`)
      const held = files[path]
      if (held instanceof Error) throw held

      return held
    }
  }

  static reading(files: Record<string, string | null | Error>): DiskEpicSpecs {
    return new DiskEpicSpecs({ read: SpecFiles.holding(files), write: vi.fn() })
  }
}

describe('DiskEpicSpecs', () => {
  it('reads the execution spec at the path the story names, and nothing else', async () => {
    const specs = SpecFiles.reading({ [SpecFiles.ABSOLUTE_PATH]: SpecFiles.TEXT })

    const spec = await specs.of({ root: SpecFiles.ROOT, story: SpecFiles.STORY })

    expect(spec).toEqual(new EpicSpec({ path: SpecFiles.RELATIVE_PATH, text: SpecFiles.TEXT }))
  })

  it('a story opened from a GitHub issue reads the spec named after that issue', async () => {
    const specs = SpecFiles.reading({ '/repo/docs/superpowers/specs/owner__name-12-execution.md': SpecFiles.TEXT })

    const spec = await specs.of({ root: SpecFiles.ROOT, story: SpecFiles.ISSUE_STORY })

    expect(spec?.path).toBe('docs/superpowers/specs/owner__name-12-execution.md')
  })

  it('answers nothing when the story has no spec yet', async () => {
    const specs = SpecFiles.reading({ [SpecFiles.ABSOLUTE_PATH]: null })

    expect(await specs.of({ root: SpecFiles.ROOT, story: SpecFiles.STORY })).toBeNull()
  })

  it('a spec that cannot be read is told apart from a file that carries no title', async () => {
    const unreadable = SpecFiles.reading({ [SpecFiles.ABSOLUTE_PATH]: new Error('permission denied') })
    const untitled = SpecFiles.reading({ [SpecFiles.ABSOLUTE_PATH]: 'no heading at all\n' })

    const [readFailure, fileFailure] = await Promise.all([
      unreadable.of({ root: SpecFiles.ROOT, story: SpecFiles.STORY }).catch((cause) => cause),
      untitled.of({ root: SpecFiles.ROOT, story: SpecFiles.STORY }).catch((cause) => cause),
    ])

    expect(readFailure).toBeInstanceOf(EpicSpecNotRead)
    expect(fileFailure).toBeInstanceOf(EpicSpecNotUnderstood)
    expect(readFailure).not.toBeInstanceOf(EpicSpecNotUnderstood)
    expect(fileFailure).not.toBeInstanceOf(EpicSpecNotRead)
  })

  it('writes the spec back to the path it was read from', async () => {
    const spec = new EpicSpec({ path: SpecFiles.RELATIVE_PATH, text: SpecFiles.TEXT })
    const write = vi.fn(async () => {})
    const specs = new DiskEpicSpecs({ read: SpecFiles.holding({}), write })

    await specs.rewrite({ root: SpecFiles.ROOT, spec, text: 'the frozen text' })

    expect(write).toHaveBeenCalledWith(SpecFiles.ABSOLUTE_PATH, 'the frozen text')
  })

  it('a write that fails becomes EpicSpecNotWritten instead of a disk error', async () => {
    const spec = new EpicSpec({ path: SpecFiles.RELATIVE_PATH, text: SpecFiles.TEXT })
    const write = vi.fn(async () => { throw new Error('disk is full') })
    const specs = new DiskEpicSpecs({ read: SpecFiles.holding({}), write })

    await expect(specs.rewrite({ root: SpecFiles.ROOT, spec, text: 'the frozen text' })).rejects.toBeInstanceOf(EpicSpecNotWritten)
  })
})
