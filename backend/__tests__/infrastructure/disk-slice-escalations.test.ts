import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SliceEscalationNotRead, SliceEscalationNotUnderstood } from '../../src/domain/exceptions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { EscalationState } from '../../src/domain/value-objects/slice-escalation.ts'
import { DiskSliceEscalations } from '../../src/infrastructure/disk-slice-escalations.ts'

class EscalationMother {
  static readonly ISSUE = 460

  static raised(): string {
    return [
      '---',
      'status: in-progress',
      'blocked:',
      '  reason: "the spec does not say which repository the row lands in"',
      '  unblock: "a decision from the coordinating session"',
      '---',
      '',
      '# Slice 460',
      '',
    ].join('\n')
  }

  static working(): string {
    return ['---', 'status: in-progress', 'next_action: "write the failing test"', '---', '', '# Slice 460', ''].join('\n')
  }

  static async root(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'ct-slice-escalation-'))
  }

  static worktree(root: string): string {
    return join(root, '.worktrees', String(EscalationMother.ISSUE))
  }

  static async seed(root: string, markdown: string | null): Promise<void> {
    const agent = join(EscalationMother.worktree(root), '.agent')
    await mkdir(agent, { recursive: true })
    if (markdown !== null) await writeFile(join(agent, 'SLICE.md'), markdown, 'utf8')
  }

  static escalations(): DiskSliceEscalations {
    return new DiskSliceEscalations({ read: Disk.read, exists: Disk.exists, write: Disk.write })
  }

  static lift(root: string) {
    return EscalationMother.escalations().lift({
      root: new CheckoutRoot(root), issue: EscalationMother.ISSUE,
    })
  }

  static ask(root: string) {
    return EscalationMother.escalations().of({
      root: new CheckoutRoot(root), issue: EscalationMother.ISSUE,
    })
  }
}

class Disk {
  static async read(path: string): Promise<string | null> {
    const { readFile } = await import('node:fs/promises')
    try {
      return await readFile(path, 'utf8')
    } catch (cause) {
      if ((cause as { code?: string }).code === 'ENOENT') return null
      throw cause
    }
  }

  static async write(path: string, text: string): Promise<void> {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, text, 'utf8')
  }

  static async exists(path: string): Promise<boolean> {
    const { stat } = await import('node:fs/promises')
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }
}

describe('DiskSliceEscalations', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('a slice that declared itself blocked is reported with the reason and the unblock its agent wrote', async () => {
    const root = await EscalationMother.root()
    roots.push(root)
    await EscalationMother.seed(root, EscalationMother.raised())

    const escalation = await EscalationMother.ask(root)

    expect(escalation.state).toBe(EscalationState.RAISED)
    expect(escalation.reason).toBe('the spec does not say which repository the row lands in')
    expect(escalation.unblock).toBe('a decision from the coordinating session')
    expect(escalation.notes).toEqual([])
  })

  it('a slice that is working carries no escalation and raises nothing', async () => {
    const root = await EscalationMother.root()
    roots.push(root)
    await EscalationMother.seed(root, EscalationMother.working())

    const escalation = await EscalationMother.ask(root)

    expect(escalation.state).toBe(EscalationState.NONE)
    expect(escalation.reason).toBe('')
  })

  it('a checkout with no worktree for that issue carries no escalation', async () => {
    const root = await EscalationMother.root()
    roots.push(root)

    const escalation = await EscalationMother.ask(root)

    expect(escalation.state).toBe(EscalationState.NONE)
  })

  it('a worktree without the slice state file says the block was not checked instead of that there is none', async () => {
    const root = await EscalationMother.root()
    roots.push(root)
    await EscalationMother.seed(root, null)

    const escalation = await EscalationMother.ask(root)

    expect(escalation.state).toBe(EscalationState.UNCHECKED)
    expect(escalation.detail).toContain('.agent/SLICE.md')
  })

  it('frontmatter that is not valid yaml refuses naming the path instead of reading as not blocked', async () => {
    const root = await EscalationMother.root()
    roots.push(root)
    await EscalationMother.seed(root, '---\nblocked: [unclosed\n---\n\n# Slice 460\n')

    const refusal = await EscalationMother.ask(root).catch((cause: unknown) => cause)

    expect(refusal).toBeInstanceOf(SliceEscalationNotUnderstood)
    expect((refusal as Error).message).toContain('SLICE.md')
  })

  it('a slice state file that cannot be read refuses instead of reading as not blocked', async () => {
    const root = await EscalationMother.root()
    roots.push(root)
    await EscalationMother.seed(root, EscalationMother.raised())
    const escalations = new DiskSliceEscalations({
      read: async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) },
      exists: Disk.exists,
      write: Disk.write,
    })

    const refusal = await escalations.of({
      root: new CheckoutRoot(root), issue: EscalationMother.ISSUE,
    }).catch((cause: unknown) => cause)

    expect(refusal).toBeInstanceOf(SliceEscalationNotRead)
    expect((refusal as Error).message).toContain('EACCES')
  })

  it('lifting the block leaves the slice with nothing raised and keeps the rest of its state', async () => {
    const root = await EscalationMother.root()
    roots.push(root)
    await EscalationMother.seed(root, EscalationMother.raised())

    await EscalationMother.lift(root)

    expect((await EscalationMother.ask(root)).state).toBe(EscalationState.NONE)
    const markdown = await Disk.read(join(EscalationMother.worktree(root), '.agent', 'SLICE.md'))
    expect(markdown).toContain('status: in-progress')
    expect(markdown).toContain('# Slice 460')
  })

  it('lifting a slice that raised nothing changes nothing and refuses nothing', async () => {
    const root = await EscalationMother.root()
    roots.push(root)
    await EscalationMother.seed(root, EscalationMother.working())
    const before = await Disk.read(join(EscalationMother.worktree(root), '.agent', 'SLICE.md'))

    await EscalationMother.lift(root)

    expect(await Disk.read(join(EscalationMother.worktree(root), '.agent', 'SLICE.md'))).toBe(before)
  })

  it('a block declared only as a status word survives the lift and says what to fix', async () => {
    const root = await EscalationMother.root()
    roots.push(root)
    await EscalationMother.seed(root, '---\nstatus: blocked\n---\n\n# Slice 460\n')

    await EscalationMother.lift(root)

    const escalation = await EscalationMother.ask(root)
    expect(escalation.state).toBe(EscalationState.RAISED)
    expect(escalation.notes.join(' ')).toContain('blocked: {reason')
  })

  it('lifting where there is no worktree touches nothing', async () => {
    const root = await EscalationMother.root()
    roots.push(root)

    await expect(EscalationMother.lift(root)).resolves.toBeUndefined()
  })

  it('a block declared as a bare sentence keeps that sentence as its reason', async () => {
    const root = await EscalationMother.root()
    roots.push(root)
    await EscalationMother.seed(root, '---\nblocked: "the gate refused and I cannot tell why"\n---\n\n# Slice 460\n')

    const escalation = await EscalationMother.ask(root)

    expect(escalation.state).toBe(EscalationState.RAISED)
    expect(escalation.reason).toBe('the gate refused and I cannot tell why')
    expect(escalation.unblock).toBe('')
  })
})
