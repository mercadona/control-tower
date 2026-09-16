import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanAgentNotLaunched, PlanAgentNotNamed } from '../../src/domain/exceptions.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'
import { PlanNonLaunch } from '../../src/domain/value-objects/plan-non-launch.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { UserStoryReference } from '../../src/domain/value-objects/user-story-reference.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { UnusedWorkspace } from '../../src/domain/value-objects/unused-workspace.ts'
import { DiskPlanRecords } from '../../src/infrastructure/disk-plan-records.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { CallDescriptor } from '../../src/infrastructure/claude-calls.ts'

class PlanRecordMother {
  static readonly FIRST_AGENT = '11111111-1111-4111-8111-111111111111'
  static readonly SECOND_AGENT = '22222222-2222-4222-8222-222222222222'
  static readonly STARTED_AT = '2026-09-15T10:00:00.000Z'

  static briefing(root: string, worktree = join(root, '.worktrees', '331')): PlanBriefing {
    return new PlanBriefing({
      story: UserStoryReference.of('CT-331'),
      issue: new PlanIssue({ number: 331, url: 'https://github.com/mercadona/control-tower-plugin/issues/331' }),
      located: new WorkspaceLocation({ root, path: worktree, branch: 'feat/331' }),
      repository: new RepositoryName('mercadona/control-tower-plugin'),
    })
  }

  static records(root: string, asked: {
    ids?: readonly string[], exists?: (path: string) => Promise<boolean>, files?: HeadlessFiles,
  } = {}): DiskPlanRecords {
    const ids = [...(asked.ids ?? [PlanRecordMother.FIRST_AGENT])]
    return new DiskPlanRecords({
      files: asked.files ?? new HeadlessFiles({ root, fs, newId: () => 'temporary-record' }),
      newId: () => ids.shift() ?? PlanRecordMother.SECOND_AGENT,
      now: () => PlanRecordMother.STARTED_AT,
      exists: asked.exists ?? (async () => true),
    })
  }

  static harvestedDescriptor(): string {
    return '{\n'
      + '  "repository": "mercadona/control-tower-plugin",\n'
      + '  "issue": {\n'
      + '    "number": 332,\n'
      + '    "url": "https://github.com/mercadona/control-tower-plugin/issues/332"\n'
      + '  },\n'
      + '  "story": null,\n'
      + '  "root": "/checkout",\n'
      + '  "worktree": "/checkout/removed-worktree",\n'
      + '  "branch": "feat/332",\n'
      + '  "startedAt": "2026-09-14T09:00:00.000Z"\n'
      + '}\n'
  }

  static completion(kind: 'error' | 'success'): string {
    return `${JSON.stringify({
      code: kind === 'success' ? 0 : 1,
      signal: null,
      finishedAt: PlanRecordMother.STARTED_AT,
      wallDurationMs: 0,
      execution: kind === 'success' ? { kind } : { kind, diagnostic: 'generic failure' },
      measurement: kind === 'success'
        ? {
          cost: { kind: 'reported', totalUsd: 0, attribution: 'initial-invocation' },
          turns: 0,
          durationMs: 0,
          unavailable: [],
        }
        : {
          cost: { kind: 'unavailable', reason: 'generic failure' },
          turns: null,
          durationMs: null,
          unavailable: ['generic failure'],
        },
    })}\n`
  }
}

describe('DiskPlanRecords', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('a prepared plan is discoverable before any launch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-plan-records-'))
    roots.push(root)
    const records = PlanRecordMother.records(root)
    const briefing = PlanRecordMother.briefing('/checkout')

    const prepared = await records.prepare(briefing)
    const found = await records.find({ issue: 331, repository: briefing.repository })

    expect(prepared).toEqual(found)
    expect(found).toMatchObject({
      agent: PlanRecordMother.FIRST_AGENT,
      story: { text: 'CT-331' },
      issue: { number: 331, url: 'https://github.com/mercadona/control-tower-plugin/issues/331' },
      located: { root: '/checkout', path: '/checkout/.worktrees/331', branch: 'feat/331' },
      repository: { text: 'mercadona/control-tower-plugin' },
    })
    expect(await readFile(
      join(root, 'harness', PlanRecordMother.FIRST_AGENT, 'dispatch.json'), 'utf8'
    )).toBe(`${JSON.stringify({
      repository: 'mercadona/control-tower-plugin',
      issue: { number: 331, url: 'https://github.com/mercadona/control-tower-plugin/issues/331' },
      story: 'CT-331',
      root: '/checkout',
      worktree: '/checkout/.worktrees/331',
      branch: 'feat/331',
      startedAt: PlanRecordMother.STARTED_AT,
    }, null, 2)}\n`)
  })

  it('a second preparation preserves the original descriptor bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-plan-records-'))
    roots.push(root)
    const records = PlanRecordMother.records(root, {
      ids: [PlanRecordMother.FIRST_AGENT, PlanRecordMother.SECOND_AGENT],
    })
    const briefing = PlanRecordMother.briefing('/checkout')
    await records.prepare(briefing)
    const descriptor = join(root, 'harness', PlanRecordMother.FIRST_AGENT, 'dispatch.json')
    const original = await readFile(descriptor, 'utf8')

    await expect(records.prepare(briefing)).rejects.toBeInstanceOf(PlanAgentNotLaunched)

    expect(await readFile(descriptor, 'utf8')).toBe(original)
    await expect(readFile(
      join(root, 'harness', PlanRecordMother.SECOND_AGENT, 'dispatch.json'), 'utf8'
    )).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('corrupt records and unreadable roots refuse discovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-plan-records-'))
    roots.push(root)
    const records = PlanRecordMother.records(root)
    await mkdir(join(root, 'harness', PlanRecordMother.FIRST_AGENT), { recursive: true })
    await writeFile(
      join(root, 'harness', PlanRecordMother.FIRST_AGENT, 'dispatch.json'),
      '{not json',
      'utf8'
    )

    const corrupt = await records.inFlight()
    const unreadable = await PlanRecordMother.records('/unreadable', {
      files: new HeadlessFiles({
        root: '/unreadable',
        fs: { ...fs, readdir: async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }) } },
        newId: () => 'temporary-record',
      }),
    }).inFlight()

    expect(corrupt.wereListed).toBe(false)
    expect(corrupt.reason).toContain('cannot be read as a prepared plan')
    expect(unreadable.wereListed).toBe(false)
    expect(unreadable.reason).toContain('permission denied')
  })

  it('missing roots are empty and harvested worktrees are omitted', async () => {
    const missingRoot = await mkdtemp(join(tmpdir(), 'ct-plan-records-missing-'))
    const recordedRoot = await mkdtemp(join(tmpdir(), 'ct-plan-records-harvested-'))
    roots.push(missingRoot, recordedRoot)
    await mkdir(join(missingRoot, 'harness', PlanRecordMother.FIRST_AGENT), { recursive: true })
    const descriptor = join(recordedRoot, 'harness', PlanRecordMother.SECOND_AGENT, 'dispatch.json')
    await mkdir(join(recordedRoot, 'harness', PlanRecordMother.SECOND_AGENT), { recursive: true })
    await writeFile(descriptor, PlanRecordMother.harvestedDescriptor(), 'utf8')

    const missing = await PlanRecordMother.records(missingRoot).inFlight()
    const harvested = await PlanRecordMother.records(recordedRoot, { exists: async () => false }).inFlight()

    expect(missing.watches).toEqual([])
    expect(harvested.watches).toEqual([])
  })

  it('definite initial non-launch survives restart as proof', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-plan-records-proof-'))
    roots.push(root)
    const records = PlanRecordMother.records(root)
    const watch = await records.prepare(PlanRecordMother.briefing('/checkout'))
    const proof = new PlanNonLaunch({
      conversation: watch.agent,
      callId: null,
      source: 'before-worker',
      diagnostic: 'worker preparation was refused before spawn',
      observedAt: PlanRecordMother.STARTED_AT,
    })
    await records.recordNonLaunch(watch, proof)

    const restarted = PlanRecordMother.records(root)

    expect(await restarted.nonLaunch(watch)).toEqual(proof)
  })

  it('conflicting proof is not a launch outcome', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-plan-records-proof-'))
    roots.push(root)
    const records = PlanRecordMother.records(root)
    const watch = await records.prepare(PlanRecordMother.briefing('/checkout'))
    await records.recordNonLaunch(watch, new PlanNonLaunch({
      conversation: '22222222-2222-4222-8222-222222222222',
      callId: null,
      source: 'before-worker',
      diagnostic: 'foreign proof',
      observedAt: PlanRecordMother.STARTED_AT,
    }))

    await expect(records.nonLaunch(watch)).rejects.toThrow('identity')
  })

  it('partial proof rejects contradictory execution evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-plan-records-proof-'))
    roots.push(root)
    const records = PlanRecordMother.records(root)
    const watch = await records.prepare(PlanRecordMother.briefing('/checkout'))
    const call = '33333333-3333-4333-8333-333333333333'
    const proof = new PlanNonLaunch({
      conversation: watch.agent,
      callId: call,
      source: 'before-worker',
      diagnostic: 'descriptor publication failed before worker spawn',
      observedAt: PlanRecordMother.STARTED_AT,
    })
    await records.recordNonLaunch(watch, proof)

    expect(await records.nonLaunch(watch)).toEqual(proof)

    const directory = join(root, 'harness', watch.agent, 'calls', call)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'stream.ndjson'), '\n', 'utf8')

    await expect(records.nonLaunch(watch)).rejects.toBeInstanceOf(PlanAgentNotNamed)
    await expect(records.nonLaunch(watch)).rejects.toThrow('launch evidence')
  })

  it.each([
    ['a generic completion', async (directory: string) => writeFile(
      join(directory, 'completion.json'), PlanRecordMother.completion('error'), 'utf8',
    )],
    ['a successful completion', async (directory: string) => writeFile(
      join(directory, 'completion.json'), PlanRecordMother.completion('success'), 'utf8',
    )],
    ['a foreign call directory', async (directory: string) => mkdir(
      join(directory, '..', '44444444-4444-4444-8444-444444444444'), { recursive: true },
    )],
  ] as const)('partial proof refuses %s', async (_name, contradict) => {
    const root = await mkdtemp(join(tmpdir(), 'ct-plan-records-proof-'))
    roots.push(root)
    const records = PlanRecordMother.records(root)
    const watch = await records.prepare(PlanRecordMother.briefing('/checkout'))
    const call = '33333333-3333-4333-8333-333333333333'
    const proof = new PlanNonLaunch({
      conversation: watch.agent,
      callId: call,
      source: 'before-worker',
      diagnostic: 'descriptor publication failed before worker spawn',
      observedAt: PlanRecordMother.STARTED_AT,
    })
    await records.recordNonLaunch(watch, proof)
    const directory = join(root, 'harness', watch.agent, 'calls', call)
    await mkdir(directory, { recursive: true })
    await contradict(directory)

    await expect(records.nonLaunch(watch)).rejects.toBeInstanceOf(PlanAgentNotNamed)
  })

  it('child spawn proof refuses each terminal contradiction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-plan-records-terminal-'))
    roots.push(root)
    const records = PlanRecordMother.records(root)
    const watch = await records.prepare(PlanRecordMother.briefing('/checkout'))
    const callId = '33333333-3333-4333-8333-333333333333'
    const diagnostic = 'recorded child could not be spawned: binary absent'
    const proof = new PlanNonLaunch({
      conversation: watch.agent,
      callId,
      source: 'child-spawn',
      diagnostic,
      observedAt: PlanRecordMother.STARTED_AT,
    })
    await records.recordNonLaunch(watch, proof)
    const directory = join(root, 'harness', watch.agent, 'calls', callId)
    const descriptorPath = join(directory, CallDescriptor.FILE)
    const completionPath = join(directory, CallDescriptor.COMPLETION)
    const streamPath = join(directory, CallDescriptor.STREAM)
    await mkdir(directory, { recursive: true })
    const descriptor = new CallDescriptor({
      conversation: watch.agent,
      purpose: 'plan',
      requestId: null,
      cwd: watch.located.path,
      binary: 'claude',
      argv: ['--session-id', watch.agent],
      startedAt: PlanRecordMother.STARTED_AT,
      budgetMs: 10_000,
      killGraceMs: 5_000,
    })
    type TerminalFixture = {
      code: number | null,
      signal: string | null,
      finishedAt: string,
      wallDurationMs: number,
      execution: Record<string, unknown>,
      measurement: {
        cost: Record<string, unknown>,
        turns: number | null,
        durationMs: number | null,
        unavailable: string[],
      },
    }
    const terminal: TerminalFixture = {
      code: null,
      signal: null,
      finishedAt: PlanRecordMother.STARTED_AT,
      wallDurationMs: 0,
      execution: { kind: 'child-spawn-failed', conversation: watch.agent, callId, diagnostic },
      measurement: {
        cost: { kind: 'unavailable', reason: diagnostic },
        turns: null,
        durationMs: null,
        unavailable: [diagnostic],
      },
    }
    const persist = async (asked: {
      terminal?: Record<string, unknown> | null,
      descriptor?: CallDescriptor,
      stream?: string,
    } = {}): Promise<void> => {
      await writeFile(descriptorPath, (asked.descriptor ?? descriptor).text(), 'utf8')
      await writeFile(streamPath, asked.stream ?? '', 'utf8')
      await rm(completionPath, { force: true })
      if (asked.terminal !== null) {
        await writeFile(completionPath, `${JSON.stringify(asked.terminal ?? terminal)}\n`, 'utf8')
      }
    }
    await persist()
    expect(await records.nonLaunch(watch)).toEqual(proof)

    const changed = (change: (copy: TerminalFixture) => void): Record<string, unknown> => {
      const copy = structuredClone(terminal)
      change(copy)
      return copy
    }
    const foreignCall = '44444444-4444-4444-8444-444444444444'
    const resume = new CallDescriptor({
      conversation: watch.agent,
      purpose: 'plan',
      requestId: null,
      cwd: watch.located.path,
      binary: 'claude',
      argv: ['--resume', watch.agent],
      startedAt: PlanRecordMother.STARTED_AT,
      budgetMs: 10_000,
      killGraceMs: 5_000,
    })
    const cases: readonly [string, () => Promise<void>][] = [
      ['terminal conversation', () => persist({ terminal: changed((copy) => { copy.execution.conversation = PlanRecordMother.SECOND_AGENT }) })],
      ['terminal call id', () => persist({ terminal: changed((copy) => { copy.execution.callId = foreignCall }) })],
      ['terminal diagnostic', () => persist({ terminal: changed((copy) => { copy.execution.diagnostic = 'different diagnostic' }) })],
      ['terminal timestamp', () => persist({ terminal: changed((copy) => { copy.finishedAt = '2026-09-15T10:00:00.001Z' }) })],
      ['numeric exit', () => persist({ terminal: changed((copy) => { copy.code = 1 }) })],
      ['signal exit', () => persist({ terminal: changed((copy) => { copy.signal = 'SIGTERM' }) })],
      ['reported cost', () => persist({ terminal: changed((copy) => { copy.measurement.cost = { kind: 'reported', totalUsd: 1, attribution: 'initial-invocation' } }) })],
      ['reported turns', () => persist({ terminal: changed((copy) => { copy.measurement.turns = 1 }) })],
      ['reported cli duration', () => persist({ terminal: changed((copy) => { copy.measurement.durationMs = 1 }) })],
      ['missing terminal', () => persist({ terminal: null })],
      ['resume descriptor', () => persist({ descriptor: resume })],
      ['generic error terminal', () => persist({ terminal: changed((copy) => { copy.execution = { kind: 'error', diagnostic } }) })],
      ['unavailable terminal', () => persist({ terminal: changed((copy) => { copy.execution = { kind: 'unavailable', diagnostic } }) })],
      ['successful terminal', () => persist({ terminal: changed((copy) => { copy.execution = { kind: 'success' } }) })],
      ['nonempty stream', () => persist({ stream: '{"type":"assistant"}\n' })],
    ]
    for (const [name, arrange] of cases) {
      await arrange()
      const refusal = await records.nonLaunch(watch).catch((cause) => cause)
      expect(refusal, name).toBeInstanceOf(PlanAgentNotNamed)
    }
  })

  it('record I/O failures retain their typed cause while implementation defects escape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-plan-records-io-'))
    roots.push(root)
    const original = PlanRecordMother.records(root)
    const watch = await original.prepare(PlanRecordMother.briefing('/checkout'))
    const proof = new PlanNonLaunch({
      conversation: watch.agent,
      callId: null,
      source: 'before-worker',
      diagnostic: 'worker preparation failed',
      observedAt: PlanRecordMother.STARTED_AT,
    })
    const readFailure = Object.assign(new Error('input/output error'), { code: 'EIO' })
    const unreadableFiles = Object.assign(
      new HeadlessFiles({ root, fs, newId: () => 'temporary-record' }),
      { read: async () => { throw readFailure } },
    )
    await expect(PlanRecordMother.records(root, { files: unreadableFiles }).nonLaunch(watch))
      .rejects.toBeInstanceOf(PlanAgentNotLaunched)

    const writeFailure = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    const unwritableFiles = Object.assign(
      new HeadlessFiles({ root, fs, newId: () => 'temporary-record' }),
      { writeOnce: async () => { throw writeFailure } },
    )
    await expect(PlanRecordMother.records(root, { files: unwritableFiles }).recordNonLaunch(watch, proof))
      .rejects.toBeInstanceOf(PlanAgentNotLaunched)

    const defect = new TypeError('existence implementation defect')
    const defective = PlanRecordMother.records(root, { exists: async () => { throw defect } })
    await expect(defective.find({ issue: watch.issue.number, repository: watch.repository })).rejects.toBe(defect)
  })

  it('retirement preserves bytes and permits preparation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-plan-records-retirement-'))
    roots.push(root)
    const records = PlanRecordMother.records(root, {
      ids: [PlanRecordMother.FIRST_AGENT, PlanRecordMother.SECOND_AGENT],
    })
    const briefing = PlanRecordMother.briefing('/checkout')
    const watch = await records.prepare(briefing)
    const descriptor = await readFile(join(root, 'harness', watch.agent, 'dispatch.json'), 'utf8')
    await records.recordCleanupEvidence(new UnusedWorkspace({
      watch,
      baseSha: 'a'.repeat(40),
      checkedAt: PlanRecordMother.STARTED_AT,
    }))

    await records.archive(watch)

    expect(await records.recorded(watch.agent)).toBeNull()
    expect(await records.retired(watch.agent)).toEqual(watch)
    expect(await readFile(join(root, 'retired-harness', watch.agent, 'dispatch.json'), 'utf8')).toBe(descriptor)
    const prepared = await records.prepare(briefing)
    expect(prepared.agent).toBe(PlanRecordMother.SECOND_AGENT)
  })

  it('archive failure blocks redispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-plan-records-retirement-'))
    roots.push(root)
    const records = PlanRecordMother.records(root)
    const briefing = PlanRecordMother.briefing('/checkout')
    const watch = await records.prepare(briefing)
    await mkdir(join(root, 'retired-harness', watch.agent), { recursive: true })

    await expect(records.archive(watch)).rejects.toThrow('already exists')

    expect(await records.recorded(watch.agent)).toEqual(watch)
    await expect(records.prepare(briefing)).rejects.toBeInstanceOf(PlanAgentNotLaunched)
  })
})
