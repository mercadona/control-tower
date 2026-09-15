import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanAgentNotLaunched } from '../../src/domain/exceptions.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { UserStoryReference } from '../../src/domain/value-objects/user-story-reference.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { DiskPlanRecords } from '../../src/infrastructure/disk-plan-records.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'

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
        fs: { ...fs, readdir: async () => { throw new Error('permission denied') } },
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
})
