import * as fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderState } from '../../../plugin/scripts/state.js'
import { StateRootMarker } from '../../../plugin/scripts/state-root-marker.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { RetryBudget, RetryPolicy } from '../../src/domain/policies/retry-policy.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { RunDeliveryUncertain } from '../../src/domain/value-objects/run-delivery.ts'
import { CheckedRunDelivery } from '../../src/infrastructure/checked-run-delivery.ts'
import { CtRunMachine, RunInspection } from '../../src/infrastructure/ct-run-machine.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { ProcessOutput, ToolRunner } from '../../src/infrastructure/tool-runner.ts'
import type { RunOptions } from '../../src/infrastructure/tool-runner.ts'
import { RunJournal } from '../../src/infrastructure/run-journal.ts'
import { Gh } from '../../src/infrastructure/gh.ts'

const REPOSITORY_FOUND_FROM_THIS_FILE_AND_NEVER_FROM_THE_WORKING_DIRECTORY =
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DISPATCH_CHECK =
  join(REPOSITORY_FOUND_FROM_THIS_FILE_AND_NEVER_FROM_THE_WORKING_DIRECTORY, 'plugin', 'scripts', 'dispatch-check.mjs')

class DeliveredMachine extends CtRunMachine {
  override async inspect(): Promise<RunInspection> { return new RunInspection({ kind: 'delivered' }) }
}

const fixturePublishers = new Set<ReturnType<typeof spawn>>()
const fixtureProcessGroups = new Set<number>()

describe('checked run delivery with real git', () => {
  const roots: string[] = []

  afterEach(async () => {
    for (const child of fixturePublishers) child.kill('SIGKILL')
    for (const group of fixtureProcessGroups) {
      try { process.kill(-group, 'SIGKILL') } catch {}
    }
    fixturePublishers.clear()
    fixtureProcessGroups.clear()
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('pins and pushes the revision, creates one exact PR, and retries only the checked release', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-checked-delivery-'))))
    roots.push(fixture.home)

    await expect(fixture.delivery.deliver(fixture.watch)).rejects.toThrow('checked release failed')
    expect(fixture.pulls).toHaveLength(1)
    expect(await fixture.remoteSha()).toBe(fixture.sha)

    const restarted = fixture.rebuild()
    await restarted.deliver(fixture.watch)
    await restarted.deliver(fixture.watch)

    expect(fixture.pulls).toHaveLength(1)
    expect(fixture.releases).toHaveLength(2)
    expect(fixture.releases[0].argv).toEqual([
      '/plugin/scripts/dispatch-check.mjs', '7', '--repo', 'owner/name', '--release', '--no-watch-merge',
    ])
    expect(fixture.releases.every((release) => release.cwd === fixture.worktree)).toBe(true)
    expect(fixture.queries[0]).toEqual(expect.arrayContaining(['api', 'graphql', '--paginate', '--slurp']))
    expect(fixture.queries[0].join(' ')).toContain('headRepository{nameWithOwner}')
    expect(fixture.queries[0].join(' ')).toContain('repository{nameWithOwner}')
    expect(await restarted.inspect(fixture.watch)).toEqual({
      kind: 'delivered', pullRequest: { number: 41, url: 'https://github.com/owner/name/pull/41' },
    })

    await fixture.advanceForReviewFix()
    expect(await fixture.rebuild().inspect(fixture.watch)).toEqual({
      kind: 'delivered', pullRequest: { number: 41, url: 'https://github.com/owner/name/pull/41' },
    })
  })

  it.each([
    ['malformed receipt', async (fixture: Awaited<ReturnType<typeof DeliveryFixture.at>>) => {
      await fs.writeFile(fixture.receiptPath, JSON.stringify({ version: 1, at: '2026-09-22T10:00:00.000Z', sha: fixture.sha, pullRequest: {} }))
    }],
    ['orphan release result', async (fixture: Awaited<ReturnType<typeof DeliveryFixture.at>>) => {
      await fs.rm(join(await fixture.releaseDirectory(), 'request.json'))
    }],
    ['wrong release command', async (fixture: Awaited<ReturnType<typeof DeliveryFixture.at>>) => {
      const path = join(await fixture.releaseDirectory(), 'result.json')
      const result = JSON.parse(await fs.readFile(path, 'utf8'))
      await fs.writeFile(path, JSON.stringify({ ...result, command: 'not-node' }))
    }],
    ['failed release predecessor', async (fixture: Awaited<ReturnType<typeof DeliveryFixture.at>>) => {
      const path = join(await fixture.releaseDirectory(), 'result.json')
      const result = JSON.parse(await fs.readFile(path, 'utf8'))
      await fs.writeFile(path, JSON.stringify({ ...result, code: 7 }))
    }],
  ])('keeps %s inspection-only instead of manufacturing delivery', async (_case, corrupt) => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-corrupt-delivery-'))))
    roots.push(fixture.home)
    await expect(fixture.delivery.deliver(fixture.watch)).rejects.toThrow('checked release failed')
    const restarted = fixture.rebuild()
    await restarted.deliver(fixture.watch)
    await corrupt(fixture)

    const before = fixture.releases.length
    const inspection = await fixture.rebuild().inspect(fixture.watch)

    expect(inspection.kind).toBe('uncertain')
    await expect(fixture.rebuild().deliver(fixture.watch)).rejects.toThrow()
    expect(fixture.releases).toHaveLength(before)
  })

  it('does not start a second checked release while the recorded child is really alive', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-live-release-'))))
    roots.push(fixture.home)
    let child: ReturnType<typeof spawn> | null = null
    fixture.setReleaseLaunch(async (_argv, options) => new Promise((resolve) => {
      child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true })
      void options?.onSpawn?.({ pid: child.pid!, processGroup: child.pid! })
      child.on('close', () => resolve(new ProcessOutput({ code: 9, stdout: '', stderr: 'interrupted\n' })))
    }))
    const interrupted = fixture.delivery.deliver(fixture.watch)
    await vi.waitFor(() => expect(child?.pid).toBeTypeOf('number'), { timeout: 10_000 })
    await vi.waitFor(async () => expect(await fixture.rebuild().inspect(fixture.watch)).toMatchObject({
      kind: 'publishing', diagnostic: expect.stringContaining('is still running'),
    }))

    expect(fixture.releases).toHaveLength(1)
    child!.kill('SIGTERM')
    await expect(interrupted).rejects.toThrow('checked release failed')
    fixture.succeedRelease()
    await fixture.rebuild().deliver(fixture.watch)
    expect(fixture.releases).toHaveLength(2)
  })

  it('does not repeat a held push after restart and continues once its child terminates', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-live-push-'))))
    roots.push(fixture.home)
    let child: ReturnType<typeof spawn> | null = null
    let pushes = 0
    fixture.setGitLaunch(async (argv, options) => {
      if (!(argv.includes('push') && argv.includes('origin'))) return fixture.rawGit(argv, options)
      pushes += 1
      if (pushes > 1) return fixture.rawGit(argv, options)
      return new Promise((resolve) => {
        child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true })
        void options?.onSpawn?.({ pid: child.pid!, processGroup: child.pid! })
        child.on('close', () => resolve(new ProcessOutput({ code: 9, stdout: '', stderr: 'interrupted\n' })))
      })
    })

    const interrupted = fixture.delivery.deliver(fixture.watch)
    await vi.waitFor(() => expect(child?.pid).toBeTypeOf('number'), { timeout: 10_000 })
    await expect(fixture.rebuild().deliver(fixture.watch)).rejects.toThrow('may still be running')
    expect(pushes).toBe(1)
    expect(fixture.pulls).toHaveLength(0)

    child!.kill('SIGTERM')
    await expect(interrupted).rejects.toThrow('git push failed')
    await expect(fixture.rebuild().deliver(fixture.watch)).rejects.toThrow('checked release failed')
    await fixture.rebuild().deliver(fixture.watch)
    expect(pushes).toBe(2)
    expect(fixture.pulls).toHaveLength(1)
  })

  it('adopts the single PR created before an interrupted response instead of creating another', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-create-interruption-'))))
    roots.push(fixture.home)
    let finishCreate: (() => void) | null = null
    fixture.setCreateLaunch(async (create) => {
      create()
      await new Promise<void>((resolve) => { finishCreate = resolve })
      return DeliveryFixture.output('https://github.com/owner/name/pull/41\n')
    })

    const interrupted = fixture.delivery.deliver(fixture.watch)
    void interrupted.catch(() => {})
    await vi.waitFor(() => expect(fixture.pulls).toHaveLength(1), { timeout: 10_000 })
    await expect(fixture.rebuild().deliver(fixture.watch)).rejects.toThrow('checked release failed')
    await fixture.rebuild().deliver(fixture.watch)

    expect(fixture.pulls).toHaveLength(1)
    finishCreate!()
    await expect(interrupted).rejects.toThrow('conflicting journal evidence')
  })

  it('runs the actual checked release executable through a persistent external GitHub boundary', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-real-gate-'))))
    roots.push(fixture.home)

    await fixture.realDelivery().deliver(fixture.watch)

    expect(await fixture.remoteSha()).toBe(fixture.sha)
    expect(await fixture.externalState()).toMatchObject({ labels: ['status:in-review'] })
    expect(await fixture.realDelivery().inspect(fixture.watch)).toMatchObject({ kind: 'delivered' })
  })

  it('isolates the real gate from an unrelated inherited account marker', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-account-isolation-'))))
    roots.push(fixture.home)
    const inheritedConfig = join(fixture.home, 'inherited-account')
    const marker = StateRootMarker.pathIn({ configDir: inheritedConfig })
    await fs.mkdir(dirname(marker), { recursive: true })
    await fs.writeFile(marker, StateRootMarker.contentFor(join(fixture.home, 'other-backend-state'), {
      pid: process.pid, at: new Date().toISOString(),
    }))
    vi.stubEnv('CLAUDE_CONFIG_DIR', inheritedConfig)

    try {
      await fixture.realDelivery().deliver(fixture.watch)
      expect(await fixture.externalState()).toMatchObject({ labels: ['status:in-review'] })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('persists a refusal from the actual checked release gate without claiming delivery', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-real-refusal-'))))
    roots.push(fixture.home)
    await fs.writeFile(fixture.runPath, JSON.stringify({ issue: 7, task: 1, tasksTotal: 1, step: 'commit', closed: 'active' }))

    await expect(fixture.realDelivery().deliver(fixture.watch)).rejects.toThrow('checked release failed')

    expect(await fixture.externalState()).toMatchObject({ labels: ['status:in-progress'] })
    const inspected = await fixture.realDelivery().inspect(fixture.watch)
    expect(inspected, JSON.stringify(inspected)).toMatchObject({ kind: 'publishing' })
  })

  it('keeps inspection read-only while a failed owned release result is pending and accepts its bound disposition', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-release-result-race-'))))
    roots.push(fixture.home)
    const runner = new ToolRunner({ bin: process.execPath, budgetMs: 10_000 })
    let commandExited!: () => void
    let persistResult!: () => void
    const exited = new Promise<void>((resolve) => { commandExited = resolve })
    const mayPersist = new Promise<void>((resolve) => { persistResult = resolve })
    fixture.setReleaseLaunch(async (_argv, options) => {
      const output = await runner.runWholeOutput(['-e', 'process.exitCode = 7'], options)
      commandExited()
      await mayPersist
      return output
    })

    const failed = fixture.delivery.deliver(fixture.watch)
    void failed.catch(() => {})
    await exited

    expect(await fixture.rebuild().inspect(fixture.watch)).toMatchObject({ kind: 'publishing' })
    expect(await fixture.releaseDispositionCount()).toBe(0)
    await fixture.writeReleaseDisposition(1)
    persistResult()
    await expect(failed).rejects.toThrow('checked release failed')

    fixture.succeedRelease()
    const continued = fixture.rebuild()
    await continued.deliver(fixture.watch)
    expect(fixture.releases).toHaveLength(2)
    expect(await continued.inspect(fixture.watch)).toMatchObject({ kind: 'delivered' })
  })

  it('refuses an invalid disposition paired with a valid failed result', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-invalid-release-disposition-'))))
    roots.push(fixture.home)
    const runner = new ToolRunner({ bin: process.execPath, budgetMs: 10_000 })
    fixture.setReleaseLaunch((_argv, options) => runner.runWholeOutput(['-e', 'process.exitCode = 7'], options))
    await expect(fixture.delivery.deliver(fixture.watch)).rejects.toThrow('checked release failed')
    await fixture.writeReleaseDisposition(1, { ownerDigest: '0'.repeat(64) })
    fixture.succeedRelease()

    await expect(fixture.rebuild().deliver(fixture.watch)).rejects.toThrow('termination disposition is malformed or unbound')
    expect(fixture.releases).toHaveLength(1)
  })

  it('does not replay a failed release result while its owned process group has a live descendant', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-failed-release-group-'))))
    roots.push(fixture.home)
    const descendantPath = join(fixture.home, 'release-descendant.pid')
    const runner = new ToolRunner({ bin: process.execPath, budgetMs: 10_000 })
    fixture.setReleaseLaunch((_argv, options) => runner.runWholeOutput(['-e', `
      const { spawn } = require('node:child_process')
      const { writeFileSync } = require('node:fs')
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: ['ignore', 'ignore', 'ignore'],
      })
      writeFileSync(${JSON.stringify(descendantPath)}, String(child.pid))
      child.unref()
      process.exit(7)
    `], options))

    await expect(fixture.delivery.deliver(fixture.watch)).rejects.toThrow('checked release failed')
    const owner = await fixture.waitForReleaseOwner(1)
    const descendant = Number(await fs.readFile(descendantPath, 'utf8'))
    expect(() => process.kill(descendant, 0)).not.toThrow()
    fixture.succeedRelease()

    expect(await fixture.rebuild().inspect(fixture.watch)).toMatchObject({
      kind: 'publishing', diagnostic: expect.stringContaining(`process group ${owner.processGroup} is still running`),
    })
    await expect(fixture.rebuild().deliver(fixture.watch)).rejects.toThrow('may still be running')
    expect(fixture.releases).toHaveLength(1)

    process.kill(-owner.processGroup, 'SIGKILL')
    await fixture.waitForGroupExit(owner.processGroup)
    await fixture.rebuild().deliver(fixture.watch)
    expect(fixture.releases).toHaveLength(2)
  })

  it('loses the result writer, waits for the surviving checked-release group, and survives another lost retry writer', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-lost-writer-'))))
    roots.push(fixture.home)
    const hold = join(fixture.home, 'hold-gh-edit')
    await fs.writeFile(hold, '')

    const first = await fixture.spawnPublisher(hold, 'first.json')
    const firstOwner = await fixture.waitForReleaseOwner(1)
    await fixture.waitForEditStarts(1)
    first.kill('SIGKILL')
    await fixture.waitForExit(first)
    process.kill(firstOwner.pid, 'SIGKILL')

    const blocked = await fixture.spawnPublisher(hold, 'blocked.json')
    await fixture.waitForExit(blocked)
    expect(await fixture.publisherOutcome('blocked.json')).toMatchObject({
      delivered: false, error: expect.stringContaining(`process group ${firstOwner.processGroup} may still be running`),
    })
    expect((await fixture.externalState()).editStarts).toBe(1)

    process.kill((await fixture.externalState()).heldEditPid, 'SIGKILL')
    await fixture.waitForGroupExit(firstOwner.processGroup)

    const second = await fixture.spawnPublisher(hold, 'second.json')
    const secondOwner = await fixture.waitForReleaseOwner(2)
    await fixture.waitForEditStarts(2)
    second.kill('SIGKILL')
    process.kill(-secondOwner.processGroup, 'SIGKILL')
    await fixture.waitForExit(second)
    await fixture.waitForGroupExit(secondOwner.processGroup)

    await fs.rm(hold)
    const completed = await fixture.spawnPublisher(hold, 'completed.json')
    await fixture.waitForExit(completed)

    expect(await fixture.publisherOutcome('completed.json')).toMatchObject({
      delivered: true,
      inspection: { kind: 'delivered', pullRequest: { number: 41 } },
    })
    expect(await fixture.externalState()).toMatchObject({ editStarts: 3, editCompletions: 1 })
    expect(await fixture.remoteSha()).toBe(fixture.sha)
    expect(await fixture.pullCount()).toBe(1)
    expect(await fixture.releaseDispositionCount()).toBe(2)
  })

  it('reads a live publication as publishing and only its own pull request creation as in flight', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-in-flight-create-'))))
    roots.push(fixture.home)
    let finishCreate: (() => void) | null = null
    fixture.setCreateLaunch(async (create) => {
      await new Promise<void>((resolve) => { finishCreate = resolve })
      create()
      return DeliveryFixture.output('https://github.com/owner/name/pull/41\n')
    })

    const publishing = fixture.delivery.deliver(fixture.watch)
    void publishing.catch(() => {})
    await vi.waitFor(async () => expect(await fixture.delivery.inspect(fixture.watch)).toEqual({
      kind: 'publishing', pullRequest: null, diagnostic: 'pull request creation is in flight',
    }), { timeout: 10_000 })

    expect(await fixture.rebuild().inspect(fixture.watch)).toEqual({
      kind: 'uncertain', pullRequest: null, diagnostic: 'pull request creation has an unknown effect',
    })
    finishCreate!()
    await expect(publishing).rejects.toThrow('checked release failed')
  })

  it('keeps reading a merged delivery as delivered once the branch and the issue are closed', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-merged-delivery-'))))
    roots.push(fixture.home)
    await expect(fixture.delivery.deliver(fixture.watch)).rejects.toThrow('checked release failed')
    await fixture.rebuild().deliver(fixture.watch)

    await fixture.mergeDelivery()

    expect(await fixture.rebuild().inspect(fixture.watch)).toEqual({
      kind: 'delivered', pullRequest: { number: 41, url: 'https://github.com/owner/name/pull/41' },
    })
  })

  it('names the pull request of a delivered slice from its journal once its worktree is harvested, asking nothing of GitHub', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-recorded-pull-'))))
    roots.push(fixture.home)
    await expect(fixture.delivery.deliver(fixture.watch)).rejects.toThrow('checked release failed')
    await fixture.rebuild().deliver(fixture.watch)
    await rm(fixture.worktree, { recursive: true, force: true })
    const queries = fixture.queries.length
    const issueReads = fixture.issueReads.length

    expect(await fixture.rebuild().recordedPullRequest(fixture.watch)).toEqual({
      number: 41, url: 'https://github.com/owner/name/pull/41',
    })
    expect(fixture.queries).toHaveLength(queries)
    expect(fixture.issueReads).toHaveLength(issueReads)
  })

  it('names no pull request for a slice whose publication never produced a receipt', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-recorded-pull-'))))
    roots.push(fixture.home)
    await expect(fixture.delivery.deliver(fixture.watch)).rejects.toThrow('checked release failed')

    expect(await fixture.rebuild().recordedPullRequest(fixture.watch)).toBeNull()
  })

  it('names no pull request for a slice that never started its publication', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-recorded-pull-'))))
    roots.push(fixture.home)

    expect(await fixture.rebuild().recordedPullRequest(fixture.watch)).toBeNull()
  })

  it('refuses to name the pull request of a receipt that names another revision', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-recorded-pull-'))))
    roots.push(fixture.home)
    await expect(fixture.delivery.deliver(fixture.watch)).rejects.toThrow('checked release failed')
    await fixture.rebuild().deliver(fixture.watch)
    const receipt = JSON.parse(await fs.readFile(fixture.receiptPath, 'utf8'))
    await fs.writeFile(fixture.receiptPath, JSON.stringify({ ...receipt, sha: 'f'.repeat(40) }))

    await expect(fixture.rebuild().recordedPullRequest(fixture.watch)).rejects.toBeInstanceOf(RunDeliveryUncertain)
  })

  it('proves the receipt once and answers later reads without asking GitHub again', async () => {
    const fixture = await DeliveryFixture.at(await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-remembered-receipt-'))))
    roots.push(fixture.home)
    await expect(fixture.delivery.deliver(fixture.watch)).rejects.toThrow('checked release failed')
    await fixture.rebuild().deliver(fixture.watch)
    const reader = fixture.rebuild()
    expect(await reader.inspect(fixture.watch)).toMatchObject({ kind: 'delivered' })

    const queries = fixture.queries.length
    const issueReads = fixture.issueReads.length
    expect(await reader.inspect(fixture.watch)).toMatchObject({ kind: 'delivered' })

    expect(fixture.queries).toHaveLength(queries)
    expect(fixture.issueReads).toHaveLength(issueReads)
    expect(await fixture.rebuild().inspect(fixture.watch)).toMatchObject({ kind: 'delivered' })
    expect(fixture.queries.length).toBeGreaterThan(queries)
  })
})

const minimalPlan = `# #7 - fixture slice

> **Task-scoped subagents execute this plan. They arrive with no context.**

## 1. Context and goal
Fixture.
### Desired end state
Work done.
### Out of scope
N/A - fixture.
## 2. Closed decisions
| Decision | Value |
|---|---|
| fixture | yes |
## 3. Reference patterns
N/A - fixture.
## 4. Inventory
work.txt
## 5. Interfaces
Consumes: N/A. Produces: N/A.
## 6. Test strategy
N/A - fixture.
## 7. Tasks
### Task 1 — do the work
${'**Objective:**'} add the fixture work.

${'**Files:**'} work.txt
Final text (work.txt):
\`\`\`
implemented
\`\`\`
${'**TDD:**'} No TDD - fixture.
${'**Tests:**'} N/A - fixture.
${'**Verification:**'} inspect the commit.
\`\`\`bash
git log --oneline -1
\`\`\`
## 8. Global verification
N/A - fixture.
## 9. Assumptions
None.
`

class DeliveryFixture {
  static async at(home: string) {
  const root = join(home, 'checkout')
  const remote = join(home, 'remote.git')
  const state = join(home, 'state')
  const accountDirectory = join(home, 'claude-config')
  const worktree = join(root, '.worktrees', '7')
  await fs.mkdir(root, { recursive: true })
  await fs.mkdir(accountDirectory, { recursive: true })
  const rawGit = new ToolRunner({ bin: 'git', budgetMs: 10_000 })
  const rawNode = new ToolRunner({ bin: process.execPath, budgetMs: 10_000 })
  const runGit = async (argv: string[], options: { cwd?: string } = {}) => {
    const output = await rawGit.runWholeOutput(argv, options)
    if (output.failed) throw new Error(`git ${argv.join(' ')}: ${output.stderr}`)
    return output.stdout.trim()
  }
  await runGit(['init', '--bare', remote])
  await runGit(['init', '-b', 'main', root])
  await runGit(['-C', root, 'config', 'user.email', 'test@example.com'])
  await runGit(['-C', root, 'config', 'user.name', 'Test'])
  await fs.writeFile(join(root, 'README.md'), 'base\n')
  await runGit(['-C', root, 'add', 'README.md'])
  await runGit(['-C', root, 'commit', '-m', 'base'])
  const baseSha = await runGit(['-C', root, 'rev-parse', 'HEAD'])
  await runGit(['-C', root, 'remote', 'add', 'origin', remote])
  await runGit(['-C', root, 'push', 'origin', 'main'])
  await fs.mkdir(join(root, '.worktrees'), { recursive: true })
  await runGit(['-C', root, 'worktree', 'add', '-b', 'feat/7', worktree, 'main'])
  await fs.writeFile(join(worktree, 'work.txt'), 'implemented\n')
  await fs.mkdir(join(worktree, 'docs', 'superpowers', 'plans'), { recursive: true })
  await fs.writeFile(join(worktree, 'docs', 'superpowers', 'plans', '2026-09-22-issue-7-work.md'), minimalPlan)
  await runGit(['-C', worktree, 'add', 'work.txt'])
  await runGit(['-C', worktree, 'add', 'docs/superpowers/plans/2026-09-22-issue-7-work.md'])
  await runGit(['-C', worktree, 'commit', '-m', 'feat: implementation'])
  const sha = await runGit(['-C', worktree, 'rev-parse', 'HEAD'])
  await fs.mkdir(join(worktree, '.agent'), { recursive: true })
  await fs.appendFile(join(root, '.git', 'info', 'exclude'), '\n.agent/\n')
  await fs.writeFile(join(worktree, '.agent', 'SLICE.md'), renderState({
    meta: { task: 'Deliver issue', branch: 'feat/7', base: 'main', base_sha: baseSha, github_issue: 7 }, body: '',
  }))
  const runPath = join(worktree, '.agent', 'run-7.json')
  await fs.writeFile(runPath, JSON.stringify({
    plan: 'docs/superpowers/plans/2026-09-22-issue-7-work.md', issue: 7,
    task: 1, tasksTotal: 1, step: 'commit', closed: 'delivered',
  }))

  const files = new HeadlessFiles({ root: state, fs, newId: () => 'temporary' })
  let id = 0
  const journal = new RunJournal({
    files, newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => '2026-09-22T10:00:00.000Z',
  })
  const watch = new PlanWatch({
    story: null,
    issue: new PlanIssue({ number: 7, url: 'https://github.com/owner/name/issues/7' }),
    located: new WorkspaceLocation({ root, path: worktree, branch: 'feat/7' }),
    repository: new RepositoryName('owner/name'),
    agent: '11111111-1111-4111-8111-111111111111',
  })
  const machine = new DeliveredMachine({
    journal, node: async () => new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
    git: async () => new ProcessOutput({ code: 0, stdout: '', stderr: '' }), read: async () => null,
    ctStep: '/plugin/ct-step.mjs', dispatchCheck: '/plugin/scripts/dispatch-check.mjs', pluginRoot: '/plugin',
  })
  const pulls: Record<string, unknown>[] = []
  const queries: string[][] = []
  const issueReads: string[][] = []
  let labels = ['status:in-progress']
  let issueState = 'OPEN'
  const externalStatePath = join(home, 'github-state.json')
  const fakeBin = join(home, 'bin')
  await fs.mkdir(fakeBin, { recursive: true })
  await fs.writeFile(externalStatePath, JSON.stringify({
    labels: ['status:in-progress'], pull: null, editStarts: 0, editCompletions: 0, heldEditPid: null,
  }))
  await fs.writeFile(join(fakeBin, 'gh'), DeliveryFixture.externalGh())
  await fs.chmod(join(fakeBin, 'gh'), 0o755)
  let createLaunch: ((create: () => void) => Promise<ProcessOutput>) | null = null
  const createPull = (argv: string[]) => {
    const body = argv[argv.indexOf('--body') + 1]
    pulls.push({
      number: 41, url: 'https://github.com/owner/name/pull/41', body, state: 'OPEN', isDraft: false,
      headRefName: 'feat/7', headRefOid: sha, headRepository: { nameWithOwner: 'owner/name' },
      baseRefName: 'main', baseRepository: { nameWithOwner: 'owner/name' },
    })
  }
  const gh = {
    run: async (argv: string[]) => {
      if (argv[0] === 'api' && argv[1] === 'graphql') {
        queries.push([...argv])
        return DeliveryFixture.output(JSON.stringify([{ data: { repository: { pullRequests: {
          nodes: pulls.map(({ baseRepository: _baseRepository, ...pull }) => ({
            ...pull, repository: { nameWithOwner: 'owner/name' },
          })),
          pageInfo: { hasNextPage: false, endCursor: null },
        } } } }]))
      }
      if (argv[0] === 'pr' && argv[1] === 'create') {
        if (createLaunch !== null) return createLaunch(() => createPull(argv))
        createPull(argv)
        return DeliveryFixture.output('https://github.com/owner/name/pull/41\n')
      }
      if (argv[0] === 'issue' && argv[1] === 'view') {
        issueReads.push([...argv])
        return DeliveryFixture.output(JSON.stringify({ state: issueState, labels: labels.map((name) => ({ name })) }))
      }
      return new ProcessOutput({ code: 1, stdout: '', stderr: `unexpected gh argv: ${argv.join(' ')}` })
    },
  } as unknown as Gh
  const releases: { argv: string[], cwd: string | undefined }[] = []
  const rawFixtureGit = async (argv: string[], options?: RunOptions) => {
    if (argv.slice(2).join(' ') === 'remote get-url --all origin'
      || argv.slice(2).join(' ') === 'remote get-url --push --all origin') {
      return DeliveryFixture.output('https://github.com/owner/name.git\n')
    }
    return rawGit.runWholeOutput(argv, options)
  }
  let gitLaunch = rawFixtureGit
  const git = (argv: string[], options?: RunOptions) => gitLaunch(argv, options)
  let releaseLaunch: (argv: string[], options?: RunOptions) => Promise<ProcessOutput> = async (_argv, options) => {
    if (releases.length === 1) {
      return rawNode.runWholeOutput(['-e', "process.stderr.write('real gate refusal\\n'); process.exit(7)"], options)
    }
    labels = ['status:in-review']
    return rawNode.runWholeOutput(['-e', "process.stdout.write('warning: no-verificado\\nreleased #7 → in-review\\n')"], options)
  }
  const node = (argv: string[], options?: RunOptions) => {
    releases.push({ argv, cwd: options?.cwd })
    return releaseLaunch(argv, options)
  }
  const build = () => new CheckedRunDelivery({
    journal, machine, git, node, gh, read: async (path) => fs.readFile(path, 'utf8').catch(() => null),
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    newId: () => `10000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => '2026-09-22T10:00:00.000Z',
  })
  const realBuild = () => {
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, FAKE_GITHUB_STATE: externalStatePath,
      FAKE_HEAD_SHA: sha,
      CT_STATE_DIR: join(home, 'control-state'), CLAUDE_CONFIG_DIR: accountDirectory }
    const ghRunner = new ToolRunner({ bin: join(fakeBin, 'gh'), budgetMs: 10_000, env })
    const releaseRunner = new ToolRunner({ bin: process.execPath, budgetMs: 30_000, env })
    const externalGh = new Gh({
      launch: (argv) => ghRunner.runWholeOutput(argv),
      policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
      sleep: async () => {},
    })
    return new CheckedRunDelivery({
      journal, machine, git, node: releaseRunner.runWholeOutput.bind(releaseRunner), gh: externalGh,
      read: async (path) => fs.readFile(path, 'utf8').catch(() => null),
      dispatchCheck: DISPATCH_CHECK,
      newId: () => `20000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
      now: () => '2026-09-22T10:00:00.000Z',
    })
  }
  return {
    home, root, remote, worktree, sha, watch, pulls, queries, issueReads, releases, delivery: build(), rebuild: build,
    receiptPath: join(state, 'harness', watch.agent, 'run', 'publication', 'receipt.json'),
    releaseDirectory: async () => {
      const root = join(state, 'harness', watch.agent, 'run', 'publication', 'release')
      const names = await fs.readdir(root)
      for (const name of names) {
        if (await fs.stat(join(root, name, 'result.json')).then(() => true).catch(() => false)) {
          const result = JSON.parse(await fs.readFile(join(root, name, 'result.json'), 'utf8'))
          if (result.code === 0) return join(root, name)
        }
      }
      throw new Error('successful release directory is absent')
    },
    setReleaseLaunch: (launch: typeof releaseLaunch) => { releaseLaunch = launch },
    succeedRelease: () => {
      releaseLaunch = async (_argv, options) => {
        labels = ['status:in-review']
        return rawNode.runWholeOutput(['-e', "process.stdout.write('released #7 → in-review\\n')"], options)
      }
    },
    setGitLaunch: (launch: typeof gitLaunch) => { gitLaunch = launch },
    setCreateLaunch: (launch: NonNullable<typeof createLaunch>) => { createLaunch = launch },
    rawGit: rawFixtureGit,
    runPath, realDelivery: realBuild,
    externalState: async () => JSON.parse(await fs.readFile(externalStatePath, 'utf8')),
    spawnPublisher: async (hold: string, outcome: string) => {
      const publisherConfigPath = join(home, 'publisher-config.json')
      await fs.writeFile(publisherConfigPath, JSON.stringify({
        root, worktree, state, fakeGh: join(fakeBin, 'gh'), accountDirectory,
        dispatchCheck: DISPATCH_CHECK,
      }))
      const child = spawn(process.execPath, [
        join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'delivery-publisher.ts'), publisherConfigPath, join(home, outcome),
      ], {
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, FAKE_GITHUB_STATE: externalStatePath,
          FAKE_HEAD_SHA: sha, FAKE_GITHUB_HOLD_EDIT: hold, CT_STATE_DIR: join(home, 'control-state'),
          CLAUDE_CONFIG_DIR: accountDirectory },
        stdio: ['ignore', 'ignore', 'ignore'],
      })
      fixturePublishers.add(child)
      return child
    },
    waitForExit: (child: ReturnType<typeof spawn>) => child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve().then(() => { fixturePublishers.delete(child) })
      : new Promise<void>((resolve, reject) => {
          child.once('error', reject)
          child.once('exit', () => {
            fixturePublishers.delete(child)
            resolve()
          })
        }),
    publisherOutcome: async (name: string) => JSON.parse(await fs.readFile(join(home, name), 'utf8')),
    waitForEditStarts: async (count: number) => vi.waitFor(async () => {
      expect((await JSON.parse(await fs.readFile(externalStatePath, 'utf8'))).editStarts).toBe(count)
    }, { timeout: 10_000 }),
    waitForReleaseOwner: async (attempt: number) => {
      const publication = join(state, 'harness', watch.agent, 'run', 'publication', 'release')
      let found: { pid: number, processGroup: number } | null = null
      await vi.waitFor(async () => {
        for (const name of await fs.readdir(publication).catch(() => [])) {
          const owner = await fs.readFile(join(publication, name, 'owner.json'), 'utf8').then(JSON.parse).catch(() => null)
          if (owner?.attempt === attempt) found = owner
        }
        expect(found).not.toBeNull()
      }, { timeout: 10_000 })
      fixtureProcessGroups.add(found!.processGroup)
      return found!
    },
    waitForGroupExit: async (group: number) => vi.waitFor(() => {
      let alive = true
      try { process.kill(-group, 0) } catch { alive = false }
      expect(alive).toBe(false)
    }, { timeout: 10_000 }).then(() => { fixtureProcessGroups.delete(group) }),
    pullCount: async () => (JSON.parse(await fs.readFile(externalStatePath, 'utf8')).pull === null ? 0 : 1),
    releaseDispositionCount: async () => {
      const publication = join(state, 'harness', watch.agent, 'run', 'publication', 'release')
      let count = 0
      for (const name of await fs.readdir(publication)) {
        if (await fs.stat(join(publication, name, 'disposition.json')).then(() => true).catch(() => false)) count += 1
      }
      return count
    },
    writeReleaseDisposition: async (attempt: number, overrides: Record<string, unknown> = {}) => {
      const publication = join(state, 'harness', watch.agent, 'run', 'publication', 'release')
      for (const name of await fs.readdir(publication)) {
        const directory = join(publication, name)
        const request = await fs.readFile(join(directory, 'request.json'), 'utf8')
        if (JSON.parse(request).attempt !== attempt) continue
        const owner = await fs.readFile(join(directory, 'owner.json'), 'utf8')
        const processGroup = JSON.parse(owner).processGroup
        const digest = (text: string) => createHash('sha256').update(text).digest('hex')
        await fs.writeFile(join(directory, 'disposition.json'), `${JSON.stringify({
          version: 1, attempt, at: '2026-09-22T10:00:00.000Z', kind: 'terminated',
          requestDigest: digest(request), ownerDigest: digest(owner), processGroup, ...overrides,
        })}\n`)
        return
      }
      throw new Error(`release attempt ${attempt} is absent`)
    },
    remoteSha: () => runGit(['--git-dir', remote, 'rev-parse', 'refs/heads/feat/7']),
    mergeDelivery: async () => {
      pulls[0].state = 'MERGED'
      await runGit(['--git-dir', remote, 'update-ref', '-d', 'refs/heads/feat/7'])
      issueState = 'CLOSED'
      labels = []
    },
    advanceForReviewFix: async () => {
      await fs.writeFile(join(worktree, 'fix.txt'), 'review fix\n')
      await runGit(['-C', worktree, 'add', 'fix.txt'])
      await runGit(['-C', worktree, 'commit', '-m', 'fix: review feedback'])
      await runGit(['-C', worktree, 'push', 'origin', 'feat/7'])
      pulls[0].headRefOid = await runGit(['-C', worktree, 'rev-parse', 'HEAD'])
      labels = ['status:in-progress']
    },
  }
  }

  static output(stdout: string): ProcessOutput {
    return new ProcessOutput({ code: 0, stdout, stderr: '' })
  }

  static externalGh(): string {
    return `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
const argv = process.argv.slice(2)
const file = process.env.FAKE_GITHUB_STATE
const state = JSON.parse(readFileSync(file, 'utf8'))
if (argv[0] === 'api' && argv[1] === 'graphql' && argv.join(' ').includes('pullRequests')) {
  const nodes = state.pull === null ? [] : [{ ...state.pull, repository: { nameWithOwner: 'owner/name' } }]
  process.stdout.write(JSON.stringify([{ data: { repository: { pullRequests: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } }]))
} else if (argv[0] === 'api' && argv[1] === 'graphql') {
  process.stdout.write(JSON.stringify([{ data: { repository: { issues: { nodes: [{ number: 7, title: 'Deliver issue', body: '', state: 'OPEN', stateReason: null, milestone: null, labels: { nodes: state.labels.map(name => ({ name })) } }], pageInfo: { hasNextPage: false, endCursor: null } } } } }]))
} else if (argv[0] === 'pr' && argv[1] === 'create') {
  state.pull = { number: 41, url: 'https://github.com/owner/name/pull/41', body: argv[argv.indexOf('--body') + 1], state: 'OPEN', isDraft: false, headRefName: 'feat/7', headRefOid: process.env.FAKE_HEAD_SHA, headRepository: { nameWithOwner: 'owner/name' }, baseRefName: 'main' }
  writeFileSync(file, JSON.stringify(state)); process.stdout.write(state.pull.url + '\\n')
} else if (argv[0] === 'issue' && argv[1] === 'view' && argv.includes('body')) {
  process.stdout.write('')
} else if (argv[0] === 'issue' && argv[1] === 'view' && argv.includes('-q')) {
  process.stdout.write(JSON.stringify(state.labels))
} else if (argv[0] === 'issue' && argv[1] === 'view') {
  process.stdout.write(JSON.stringify({ state: 'OPEN', labels: state.labels.map(name => ({ name })) }))
} else if (argv[0] === 'issue' && argv[1] === 'edit') {
  state.editStarts = (state.editStarts || 0) + 1
  state.heldEditPid = process.pid
  writeFileSync(file, JSON.stringify(state))
  while (process.env.FAKE_GITHUB_HOLD_EDIT && existsSync(process.env.FAKE_GITHUB_HOLD_EDIT)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
  }
  state.labels = state.labels.filter(name => name !== argv[argv.indexOf('--remove-label') + 1])
  state.labels.push(argv[argv.indexOf('--add-label') + 1])
  state.editCompletions = (state.editCompletions || 0) + 1
  state.heldEditPid = null
  writeFileSync(file, JSON.stringify(state))
} else { console.error('unsupported fake gh command: ' + argv.join(' ')); process.exitCode = 1 }
`
  }
}
