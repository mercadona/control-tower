import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RunNotAdvanced, RunNotUnderstood } from '../../src/domain/exceptions.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { RunJournal } from '../../src/infrastructure/run-journal.ts'

class JournalMother {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly TICKET = '22222222-2222-4222-8222-222222222222'
  static readonly MANIFEST = '{"version":1,"conversation":"11111111-1111-4111-8111-111111111111"}\n'
  static readonly REQUEST = '{"version":1,"previous":null,"argv":["next"],"cwd":"/repo/.worktrees/332","planSha256":"abc"}\n'
  static readonly RECEIPT = '{"version":1,"code":0,"stdout":"ok","stderr":"","beforeRun":null,"afterRun":"bytes"}\n'

  static watch(agent = JournalMother.CONVERSATION): PlanWatch {
    return new PlanWatch({
      story: null,
      issue: new PlanIssue({
        number: 332,
        url: 'https://github.com/mercadona/control-tower-plugin/issues/332',
      }),
      located: new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/332', branch: 'feat/332' }),
      repository: new RepositoryName('mercadona/control-tower-plugin'),
      agent,
    })
  }

  static readonly EARLY_TICKET = '33333333-3333-4333-8333-333333333333'
  static readonly LATE_TICKET = '44444444-4444-4444-8444-444444444444'
  static readonly EARLY_AT = '2026-09-19T10:00:01.000Z'
  static readonly LATE_AT = '2026-09-19T10:00:05.000Z'

  static journal(
    root: string,
    newId = () => JournalMother.TICKET,
    fileSystem = fs,
    now = () => JournalMother.LATE_AT,
  ): RunJournal {
    return new RunJournal({
      files: new HeadlessFiles({ root, fs: fileSystem, newId: () => 'temporary-record' }),
      newId,
      now,
    })
  }

  static sequence(values: readonly string[]): () => string {
    let taken = 0
    return () => {
      if (taken >= values.length) throw new Error('the sequence ran out of values')
      const value = values[taken]
      taken += 1
      return value
    }
  }

  static messages(root: string): string {
    return join(root, 'harness', JournalMother.CONVERSATION, 'run', 'messages')
  }

  static operations(root: string): string {
    return join(root, 'harness', JournalMother.CONVERSATION, 'run', 'operations')
  }

  static operation(root: string): string {
    return join(JournalMother.operations(root), JournalMother.TICKET)
  }

  static withReadFailure(path: string, cause: unknown): typeof fs {
    return new Proxy(fs, {
      get(target, property, receiver) {
        if (property !== 'readFile') return Reflect.get(target, property, receiver)
        return async (...asked: Parameters<typeof fs.readFile>) => {
          if (String(asked[0]) === path) throw cause
          return Reflect.apply(target.readFile, target, asked)
        }
      },
    })
  }

  static withLinkFailure(path: string, cause: unknown): typeof fs {
    return new Proxy(fs, {
      get(target, property, receiver) {
        if (property !== 'link') return Reflect.get(target, property, receiver)
        return async (...asked: Parameters<typeof fs.link>) => {
          if (String(asked[1]) === path) throw cause
          return Reflect.apply(target.link, target, asked)
        }
      },
    })
  }
}

describe('RunJournal', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('a held change stays pending until its delivery is settled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-journal-held-'))
    roots.push(root)
    const watch = JournalMother.watch()
    const journal = JournalMother.journal(
      root,
      JournalMother.sequence([JournalMother.LATE_TICKET, JournalMother.EARLY_TICKET]),
      fs,
      JournalMother.sequence([JournalMother.LATE_AT, JournalMother.EARLY_AT]),
    )

    const late = await journal.hold(watch, 'rename the port')
    const early = await journal.hold(watch, 'drop the flag')

    expect((await journal.pending(watch)).map((message) => message.ticket)).toEqual([early, late])
    expect((await journal.pending(watch)).map((message) => message.text)).toEqual([
      'drop the flag', 'rename the port',
    ])

    await journal.settle(watch, early, 'call-early')

    expect((await journal.pending(watch)).map((message) => message.ticket)).toEqual([late])
    expect(JSON.parse(await readFile(
      join(JournalMother.messages(root), early, 'delivery.json'), 'utf8',
    ))).toEqual({ version: 1, call: 'call-early' })
  })

  it('a held change outlives the journal that wrote it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-journal-held-restart-'))
    roots.push(root)
    const watch = JournalMother.watch()
    const ticket = await JournalMother.journal(root).hold(watch, 'split the task')
    const restarted = JournalMother.journal(root, () => {
      throw new Error('journal recovery must not allocate message identity')
    })

    const held = await restarted.pending(watch)

    expect(held).toHaveLength(1)
    expect(held[0].ticket).toBe(ticket)
    expect(held[0].askedAt).toBe(JournalMother.LATE_AT)
    expect(held[0].text).toBe('split the task')
  })

  it('a malformed held change is not understood', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-journal-held-malformed-'))
    roots.push(root)
    const watch = JournalMother.watch()
    await mkdir(join(JournalMother.messages(root), JournalMother.TICKET), { recursive: true })
    await writeFile(join(JournalMother.messages(root), JournalMother.TICKET, 'message.json'), '{"version":2}\n')

    await expect(JournalMother.journal(root).pending(watch)).rejects.toThrow(RunNotUnderstood)
  })

  it('a command request survives a missing receipt without becoming replay permission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-journal-restart-'))
    roots.push(root)
    const watch = JournalMother.watch()
    const ticket = await JournalMother.journal(root).begin(watch, JournalMother.REQUEST)
    const restarted = JournalMother.journal(root, () => {
      throw new Error('journal recovery must not allocate replay identity')
    })

    const entries = await restarted.entries(watch)

    expect(ticket).toBe(JournalMother.TICKET)
    expect(entries).toEqual([{
      ticket: JournalMother.TICKET,
      request: JournalMother.REQUEST,
      receipt: { kind: 'absent' },
    }])
    expect(Object.isFrozen(entries[0])).toBe(true)
    expect(Object.isFrozen(entries[0].receipt)).toBe(true)
  })

  it('immutable journal collisions accept only identical bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-journal-collision-'))
    roots.push(root)
    const watch = JournalMother.watch()
    const journal = JournalMother.journal(root)
    const manifestPath = join(root, 'harness', watch.agent, 'run', 'manifest.json')
    const requestPath = join(JournalMother.operation(root), 'request.json')
    const receiptPath = join(JournalMother.operation(root), 'receipt.json')

    await journal.establish(watch, JournalMother.MANIFEST)
    await journal.establish(watch, JournalMother.MANIFEST)
    await expect(journal.establish(watch, 'different manifest')).rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await readFile(manifestPath, 'utf8')).toBe(JournalMother.MANIFEST)

    expect(await journal.begin(watch, JournalMother.REQUEST)).toBe(JournalMother.TICKET)
    expect(await journal.begin(watch, JournalMother.REQUEST)).toBe(JournalMother.TICKET)
    await expect(journal.begin(watch, 'different request')).rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await readFile(requestPath, 'utf8')).toBe(JournalMother.REQUEST)

    await journal.finish(watch, JournalMother.TICKET, JournalMother.RECEIPT)
    await journal.finish(watch, JournalMother.TICKET, JournalMother.RECEIPT)
    await expect(journal.finish(watch, JournalMother.TICKET, 'different receipt'))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await readFile(receiptPath, 'utf8')).toBe(JournalMother.RECEIPT)
    expect(await journal.manifest(watch)).toBe(JournalMother.MANIFEST)
  })

  it('journal IO failures differ from malformed layouts and preserve existing bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-journal-failures-'))
    roots.push(root)
    const watch = JournalMother.watch()
    const journal = JournalMother.journal(root)
    await journal.establish(watch, JournalMother.MANIFEST)
    await journal.begin(watch, JournalMother.REQUEST)
    const manifestPath = join(root, 'harness', watch.agent, 'run', 'manifest.json')
    const requestPath = join(JournalMother.operation(root), 'request.json')
    const originalBytes = await Promise.all([
      readFile(manifestPath, 'utf8'),
      readFile(requestPath, 'utf8'),
    ])
    const diskFailure = Object.assign(new Error('journal input/output error'), { code: 'EIO' })
    const failed = JournalMother.journal(root, () => JournalMother.TICKET,
      JournalMother.withReadFailure(requestPath, diskFailure))

    const refusal = await failed.entries(watch).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(RunNotAdvanced)
    expect(refusal.message).toContain('journal input/output error')
    expect(await Promise.all([
      readFile(manifestPath, 'utf8'),
      readFile(requestPath, 'utf8'),
    ])).toEqual(originalBytes)

    const receiptPath = join(JournalMother.operation(root), 'receipt.json')
    const diskFull = Object.assign(new Error('journal disk full'), { code: 'ENOSPC' })
    const unwritable = JournalMother.journal(root, () => JournalMother.TICKET,
      JournalMother.withLinkFailure(receiptPath, diskFull))
    await expect(unwritable.finish(watch, JournalMother.TICKET, JournalMother.RECEIPT))
      .rejects.toBeInstanceOf(RunNotAdvanced)
    expect(await Promise.all([
      readFile(manifestPath, 'utf8'),
      readFile(requestPath, 'utf8'),
    ])).toEqual(originalBytes)
    await expect(readFile(receiptPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const defect = new TypeError('journal reader defect')
    await expect(JournalMother.journal(root, () => JournalMother.TICKET,
      JournalMother.withReadFailure(requestPath, defect)).entries(watch)).rejects.toBe(defect)

    await writeFile(join(JournalMother.operation(root), 'unexpected.json'), 'unexpected', 'utf8')
    await expect(journal.entries(watch)).rejects.toBeInstanceOf(RunNotUnderstood)
    await rm(join(JournalMother.operation(root), 'unexpected.json'))
    await writeFile(join(JournalMother.operations(root), 'not-a-uuid'), 'not a directory', 'utf8')
    await expect(journal.entries(watch)).rejects.toBeInstanceOf(RunNotUnderstood)
    await rm(join(JournalMother.operations(root), 'not-a-uuid'))
    await rm(requestPath)
    await expect(journal.entries(watch)).rejects.toBeInstanceOf(RunNotUnderstood)
    await writeFile(requestPath, JournalMother.REQUEST, 'utf8')
    const outsideDirectory = join(root, 'outside-operation')
    const linkedTicket = '33333333-3333-4333-8333-333333333333'
    await mkdir(outsideDirectory)
    await writeFile(join(outsideDirectory, 'request.json'), 'outside', 'utf8')
    await symlink(outsideDirectory, join(JournalMother.operations(root), linkedTicket), 'dir')
    await expect(journal.entries(watch)).rejects.toBeInstanceOf(RunNotUnderstood)

    const outsideTicket = JournalMother.journal(root, () => '../outside')
    await expect(outsideTicket.begin(watch, 'outside')).rejects.toBeInstanceOf(RunNotUnderstood)
    const outsideConversation = JournalMother.watch('../outside')
    await expect(journal.manifest(outsideConversation)).rejects.toBeInstanceOf(RunNotUnderstood)
    await expect(readFile(join(root, 'harness', 'outside', 'run', 'operations', 'request.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('a symbolic-link run ancestor refuses journal reads and publications without changing outside bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-journal-linked-run-'))
    const outside = await mkdtemp(join(tmpdir(), 'ct-run-journal-outside-run-'))
    roots.push(root, outside)
    const watch = JournalMother.watch()
    const journal = JournalMother.journal(root)
    const run = join(root, 'harness', watch.agent, 'run')
    const outsideOperation = join(outside, 'operations', JournalMother.TICKET)
    await mkdir(join(root, 'harness', watch.agent), { recursive: true })
    await mkdir(outsideOperation, { recursive: true })
    await writeFile(join(outside, 'manifest.json'), JournalMother.MANIFEST, 'utf8')
    await writeFile(join(outsideOperation, 'request.json'), JournalMother.REQUEST, 'utf8')
    await writeFile(join(outsideOperation, 'receipt.json'), JournalMother.RECEIPT, 'utf8')
    await symlink(outside, run, 'dir')
    const outsideBytes = await Promise.all([
      readFile(join(outside, 'manifest.json'), 'utf8'),
      readFile(join(outsideOperation, 'request.json'), 'utf8'),
      readFile(join(outsideOperation, 'receipt.json'), 'utf8'),
    ])

    await expect(journal.manifest(watch)).rejects.toBeInstanceOf(RunNotUnderstood)
    await expect(journal.entries(watch)).rejects.toBeInstanceOf(RunNotUnderstood)
    await expect(journal.establish(watch, JournalMother.MANIFEST)).rejects.toBeInstanceOf(RunNotUnderstood)
    await expect(journal.begin(watch, JournalMother.REQUEST)).rejects.toBeInstanceOf(RunNotUnderstood)
    await expect(journal.finish(watch, JournalMother.TICKET, JournalMother.RECEIPT))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await Promise.all([
      readFile(join(outside, 'manifest.json'), 'utf8'),
      readFile(join(outsideOperation, 'request.json'), 'utf8'),
      readFile(join(outsideOperation, 'receipt.json'), 'utf8'),
    ])).toEqual(outsideBytes)
  })

  it('a symbolic-link operation ancestor refuses journal reads and publications without changing outside bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-journal-linked-operation-'))
    const outside = await mkdtemp(join(tmpdir(), 'ct-run-journal-outside-operation-'))
    roots.push(root, outside)
    const watch = JournalMother.watch()
    const journal = JournalMother.journal(root)
    await mkdir(JournalMother.operations(root), { recursive: true })
    await writeFile(join(outside, 'request.json'), JournalMother.REQUEST, 'utf8')
    await writeFile(join(outside, 'receipt.json'), JournalMother.RECEIPT, 'utf8')
    await symlink(outside, JournalMother.operation(root), 'dir')
    const outsideBytes = await Promise.all([
      readFile(join(outside, 'request.json'), 'utf8'),
      readFile(join(outside, 'receipt.json'), 'utf8'),
    ])

    await expect(journal.entries(watch)).rejects.toBeInstanceOf(RunNotUnderstood)
    await expect(journal.begin(watch, JournalMother.REQUEST)).rejects.toBeInstanceOf(RunNotUnderstood)
    await expect(journal.finish(watch, JournalMother.TICKET, JournalMother.RECEIPT))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await Promise.all([
      readFile(join(outside, 'request.json'), 'utf8'),
      readFile(join(outside, 'receipt.json'), 'utf8'),
    ])).toEqual(outsideBytes)
  })
})
