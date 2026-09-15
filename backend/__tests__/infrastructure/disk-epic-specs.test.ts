import { describe, expect, it, vi } from 'vitest'
import { DiskEpicSpecs } from '../../src/infrastructure/disk-epic-specs.ts'
import { EpicSpecNotRead, EpicSpecNotUnderstood, EpicSpecNotWritten } from '../../src/domain/exceptions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'

const ROOT = new CheckoutRoot('/repo')
const SPECS_DIRECTORY = '/repo/docs/superpowers/specs'
const NEWEST_RELATIVE_PATH = 'docs/superpowers/specs/2026-09-11-b-execution.md'
const NEWEST_ABSOLUTE_PATH = `${SPECS_DIRECTORY}/2026-09-11-b-execution.md`
const NEWEST_TEXT = '# B — Execution spec\n'

describe('DiskEpicSpecs', () => {
  it('answers the newest execution spec and leaves the design documents and the template out', async () => {
    const list = vi.fn(async () => [
      '_TEMPLATE-execution-spec.md',
      '2026-09-01-a-execution.md',
      '2026-09-11-b-design.md',
      '2026-09-11-b-execution.md',
    ])
    const read = vi.fn(async () => NEWEST_TEXT)
    const specs = new DiskEpicSpecs({ list, read, write: vi.fn() })

    const spec = await specs.mostRecent(ROOT)

    expect(read).toHaveBeenCalledWith(NEWEST_ABSOLUTE_PATH)
    expect(spec).toEqual(new EpicSpec({ path: NEWEST_RELATIVE_PATH, text: NEWEST_TEXT }))
  })

  it('answers nothing when the checkout has no specs directory', async () => {
    const list = vi.fn(async () => null)
    const read = vi.fn(async () => null)
    const specs = new DiskEpicSpecs({ list, read, write: vi.fn() })

    expect(await specs.mostRecent(ROOT)).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  it('a directory that cannot be listed is told apart from a file that carries no title', async () => {
    const unreadableDirectory = new DiskEpicSpecs({
      list: vi.fn(async () => { throw new Error('permission denied') }),
      read: vi.fn(),
      write: vi.fn(),
    })
    const untitledFile = new DiskEpicSpecs({
      list: vi.fn(async () => ['2026-09-11-b-execution.md']),
      read: vi.fn(async () => 'no heading at all\n'),
      write: vi.fn(),
    })

    const [directoryFailure, fileFailure] = await Promise.all([
      unreadableDirectory.mostRecent(ROOT).catch((cause) => cause),
      untitledFile.mostRecent(ROOT).catch((cause) => cause),
    ])

    expect(directoryFailure).toBeInstanceOf(EpicSpecNotRead)
    expect(fileFailure).toBeInstanceOf(EpicSpecNotUnderstood)
    expect(directoryFailure).not.toBeInstanceOf(EpicSpecNotUnderstood)
    expect(fileFailure).not.toBeInstanceOf(EpicSpecNotRead)
  })

  it('reads the spec again at its own path, so a checkout that moved answers with what it holds now', async () => {
    const held = '# B — Execution spec\n**Estado:** CONGELADA\n'
    const read = vi.fn(async () => held)
    const specs = new DiskEpicSpecs({ list: vi.fn(), read, write: vi.fn() })

    const spec = await specs.reread({
      root: ROOT, spec: new EpicSpec({ path: NEWEST_RELATIVE_PATH, text: NEWEST_TEXT }),
    })

    expect(read).toHaveBeenCalledWith(NEWEST_ABSOLUTE_PATH)
    expect(spec).toEqual(new EpicSpec({ path: NEWEST_RELATIVE_PATH, text: held }))
  })

  it('answers nothing when the checkout no longer holds that spec, rather than pretending it is still there', async () => {
    const read = vi.fn(async () => null)
    const specs = new DiskEpicSpecs({ list: vi.fn(), read, write: vi.fn() })

    const spec = await specs.reread({
      root: ROOT, spec: new EpicSpec({ path: NEWEST_RELATIVE_PATH, text: NEWEST_TEXT }),
    })

    expect(spec).toBeNull()
  })

  it('a second read that fails is told apart from one that answers a file with no title', async () => {
    const spec = new EpicSpec({ path: NEWEST_RELATIVE_PATH, text: NEWEST_TEXT })
    const unreadableFile = new DiskEpicSpecs({
      list: vi.fn(),
      read: vi.fn(async () => { throw new Error('permission denied') }),
      write: vi.fn(),
    })
    const untitledFile = new DiskEpicSpecs({
      list: vi.fn(),
      read: vi.fn(async () => 'no heading at all\n'),
      write: vi.fn(),
    })

    const [readFailure, fileFailure] = await Promise.all([
      unreadableFile.reread({ root: ROOT, spec }).catch((cause) => cause),
      untitledFile.reread({ root: ROOT, spec }).catch((cause) => cause),
    ])

    expect(readFailure).toBeInstanceOf(EpicSpecNotRead)
    expect(fileFailure).toBeInstanceOf(EpicSpecNotUnderstood)
    expect(readFailure).not.toBeInstanceOf(EpicSpecNotUnderstood)
    expect(fileFailure).not.toBeInstanceOf(EpicSpecNotRead)
  })

  it('writes the spec back to the path it was read from', async () => {
    const spec = new EpicSpec({ path: NEWEST_RELATIVE_PATH, text: NEWEST_TEXT })
    const write = vi.fn(async () => {})
    const specs = new DiskEpicSpecs({ list: vi.fn(), read: vi.fn(), write })

    await specs.rewrite({ root: ROOT, spec, text: 'the frozen text' })

    expect(write).toHaveBeenCalledWith(NEWEST_ABSOLUTE_PATH, 'the frozen text')
  })

  it('a write that fails becomes EpicSpecNotWritten instead of a disk error', async () => {
    const spec = new EpicSpec({ path: NEWEST_RELATIVE_PATH, text: NEWEST_TEXT })
    const write = vi.fn(async () => { throw new Error('disk is full') })
    const specs = new DiskEpicSpecs({ list: vi.fn(), read: vi.fn(), write })

    await expect(specs.rewrite({ root: ROOT, spec, text: 'the frozen text' })).rejects.toBeInstanceOf(EpicSpecNotWritten)
  })
})
