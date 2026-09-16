import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildStateSeed } from '../../../plugin/scripts/kickoff.js'
import { Baseline } from '../../../plugin/scripts/baseline.js'
import { CleanupPlan, CleanupPlanParams } from '../../src/application/actions/cleanup-plan.ts'
import { DispatchClaims } from '../../src/domain/ports/dispatch-claims.ts'
import { PlanIssues } from '../../src/domain/ports/plan-issues.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanIssueStatus, type PlanIssueStatusValue } from '../../src/domain/value-objects/plan-issue-status.ts'
import { PlanNonLaunch } from '../../src/domain/value-objects/plan-non-launch.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { UnusedWorkspace } from '../../src/domain/value-objects/unused-workspace.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { DiskPlanRecords } from '../../src/infrastructure/disk-plan-records.ts'
import { GitWorkspace, SliceSeed } from '../../src/infrastructure/git-workspace.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { ProcessOutput, ToolRunner } from '../../src/infrastructure/tool-runner.ts'
import { RetryBudget, RetryPolicy } from '../../src/domain/policies/retry-policy.ts'
import { PlanIssueNotClaimed } from '../../src/domain/exceptions.ts'

describe('GitWorkspace real cleanup', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  class GitProcess {
    static run(cwd: string, ...argv: string[]): string {
      return execFileSync('git', argv, { cwd, encoding: 'utf8' }).trim()
    }
  }

  it('real Git cleanup reaches verified absence and retirement', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'ct-workspace-cleanup-'))
    roots.push(fixture)
    await mkdir(join(fixture, 'checkout'))
    const root = await realpath(join(fixture, 'checkout'))
    const worktree = join(root, '.worktrees', '331')
    GitProcess.run(root, 'init', '-q')
    GitProcess.run(root, 'config', 'user.email', 'fixture@example.test')
    GitProcess.run(root, 'config', 'user.name', 'Fixture')
    await writeFile(join(root, 'README.md'), 'fixture\n')
    GitProcess.run(root, 'add', 'README.md')
    GitProcess.run(root, 'commit', '-q', '-m', 'fixture baseline')
    GitProcess.run(root, 'branch', '-M', 'main')
    GitProcess.run(root, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git')
    GitProcess.run(root, 'worktree', 'add', '-q', '-b', 'feat/331', worktree, 'HEAD')
    const baseSha = GitProcess.run(root, 'rev-parse', 'HEAD')
    const state = join(worktree, SliceSeed.RELATIVE_PATH)
    await mkdir(dirname(state), { recursive: true })
    await writeFile(state, buildStateSeed(
      { name: 'fixture', issue: '#331', ac: ['cleanup is checked'] },
      { branch: 'feat/331', base: 'main', baseSha },
    ))
    await writeFile(join(root, '.git', 'info', 'exclude'), `${SliceSeed.RELATIVE_PATH}\n`, { flag: 'a' })

    const runner = new ToolRunner({ bin: 'git', budgetMs: 5_000 })
    const workspace = new GitWorkspace({
      run: (argv) => argv.includes('ls-remote')
        ? Promise.resolve(new ProcessOutput({ code: 0, stdout: '', stderr: '' }))
        : runner.run(argv),
      write: async () => {},
      read: async (path) => path === state ? await readFile(path, 'utf8') : null,
      stderr: () => {},
      baseline: new Baseline({ run: async () => ({ code: 0, stdout: '', stderr: '' }), read: () => '' }),
      gh: new Gh({
        launch: async () => new ProcessOutput({ code: 0, stdout: '[]', stderr: '' }),
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
        sleep: async () => {},
      }),
    })
    const agent = '11111111-1111-4111-8111-111111111111'
    const nextAgent = '22222222-2222-4222-8222-222222222222'
    const stateRoot = join(fixture, 'state')
    const ids = [agent, nextAgent]
    const records = new DiskPlanRecords({
      files: new HeadlessFiles({ root: stateRoot, fs, newId: () => 'temporary-record' }),
      newId: () => ids.shift() ?? nextAgent,
      now: () => '2026-09-16T10:00:00.000Z',
      exists: async (path) => fs.stat(path).then(() => true, () => false),
    })
    const watch = await records.prepare(new PlanBriefing({
      story: null,
      issue: new PlanIssue({ number: 331, url: 'https://github.com/acme/widget/issues/331' }),
      repository: new RepositoryName('acme/widget'),
      located: new WorkspaceLocation({ root, path: worktree, branch: 'feat/331' }),
    }))
    const proof = new PlanNonLaunch({
      conversation: watch.agent,
      callId: null,
      source: 'before-worker',
      diagnostic: 'worker never started',
      observedAt: '2026-09-16T10:00:00.000Z',
    })
    await records.recordNonLaunch(watch, proof)
    await expect(workspace.confirmAbsent(watch)).rejects.toThrow('remains after cleanup')
    let status: PlanIssueStatusValue = PlanIssueStatus.IN_PROGRESS
    class Claims extends DispatchClaims {
      override async requeue(): Promise<void> { status = PlanIssueStatus.READY }
    }
    class Issues extends PlanIssues {
      override async statusOf(): Promise<PlanIssueStatusValue> { return status }
    }
    const cleanup = new CleanupPlan({
      records, workspace, claims: new Claims(), planIssues: new Issues(),
    })
    const active = join(stateRoot, 'harness', watch.agent)
    const descriptorBytes = await readFile(join(active, 'dispatch.json'), 'utf8')
    const proofBytes = await readFile(join(active, 'non-launch.json'), 'utf8')

    await cleanup.execute(new CleanupPlanParams({
      agent: watch.agent, issue: watch.issue.number, repository: watch.repository,
    }))

    const retired = join(stateRoot, 'retired-harness', watch.agent)
    expect(await records.recorded(watch.agent)).toBeNull()
    expect(await records.retired(watch.agent)).toEqual(watch)
    expect(await readFile(join(retired, 'dispatch.json'), 'utf8')).toBe(descriptorBytes)
    expect(await readFile(join(retired, 'non-launch.json'), 'utf8')).toBe(proofBytes)
    expect((await records.cleanupEvidence(watch))).toBeNull()
    expect((await readFile(join(retired, 'cleanup-evidence.json'), 'utf8'))).toContain(baseSha)
    await expect(workspace.confirmAbsent(watch)).resolves.toBeUndefined()
    const prepared = await records.prepare(new PlanBriefing({
      story: null,
      issue: watch.issue,
      repository: watch.repository,
      located: watch.located,
    }))
    expect(prepared.agent).toBe(nextAgent)
  })

  it.each(['branch removal', 'checked requeue', 'archive rename'] as const)(
    'durable cleanup retries preserve evidence and finish retirement after %s refusal', async (cut) => {
      const fixture = await mkdtemp(join(tmpdir(), `ct-workspace-retry-${cut.replace(' ', '-')}-`))
      roots.push(fixture)
      await mkdir(join(fixture, 'checkout'))
      const root = await realpath(join(fixture, 'checkout'))
      const worktree = join(root, '.worktrees', '331')
      GitProcess.run(root, 'init', '-q')
      GitProcess.run(root, 'config', 'user.email', 'fixture@example.test')
      GitProcess.run(root, 'config', 'user.name', 'Fixture')
      await writeFile(join(root, 'README.md'), 'fixture\n')
      GitProcess.run(root, 'add', 'README.md')
      GitProcess.run(root, 'commit', '-q', '-m', 'fixture baseline')
      GitProcess.run(root, 'branch', '-M', 'main')
      GitProcess.run(root, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git')
      GitProcess.run(root, 'worktree', 'add', '-q', '-b', 'feat/331', worktree, 'HEAD')
      const baseSha = GitProcess.run(root, 'rev-parse', 'HEAD')
      const seedPath = join(worktree, SliceSeed.RELATIVE_PATH)
      await mkdir(dirname(seedPath), { recursive: true })
      await writeFile(seedPath, buildStateSeed(
        { name: 'fixture', issue: '#331', ac: ['cleanup retry is checked'] },
        { branch: 'feat/331', base: 'main', baseSha },
      ))
      await writeFile(join(root, '.git', 'info', 'exclude'), `${SliceSeed.RELATIVE_PATH}\n`, { flag: 'a' })

      const stateRoot = join(fixture, 'state')
      const agent = '11111111-1111-4111-8111-111111111111'
      let faultEnabled = true
      let status: PlanIssueStatusValue = PlanIssueStatus.IN_PROGRESS
      let successfulRequeues = 0
      const files = (): HeadlessFiles => new HeadlessFiles({
        root: stateRoot,
        fs: {
          ...fs,
          rename: async (source, destination) => {
            if (cut === 'archive rename' && faultEnabled && String(source).includes(`/harness/${agent}`)) {
              throw Object.assign(new Error('scripted archive rename refusal'), { code: 'EACCES' })
            }
            await fs.rename(source, destination)
          },
        },
        newId: () => 'temporary-record',
      })
      const records = (): DiskPlanRecords => new DiskPlanRecords({
        files: files(),
        newId: () => agent,
        now: () => '2026-09-16T10:00:00.000Z',
        exists: async (path) => fs.stat(path).then(() => true, () => false),
      })
      const initialRecords = records()
      const watch = await initialRecords.prepare(new PlanBriefing({
        story: null,
        issue: new PlanIssue({ number: 331, url: 'https://github.com/acme/widget/issues/331' }),
        repository: new RepositoryName('acme/widget'),
        located: new WorkspaceLocation({ root, path: worktree, branch: 'feat/331' }),
      }))
      await initialRecords.recordNonLaunch(watch, new PlanNonLaunch({
        conversation: watch.agent,
        callId: null,
        source: 'before-worker',
        diagnostic: 'worker never started',
        observedAt: '2026-09-16T10:00:00.000Z',
      }))
      const descriptorPath = join(stateRoot, 'harness', agent, 'dispatch.json')
      const proofPath = join(stateRoot, 'harness', agent, 'non-launch.json')
      const descriptorBytes = await readFile(descriptorPath, 'utf8')
      const proofBytes = await readFile(proofPath, 'utf8')
      const runner = new ToolRunner({ bin: 'git', budgetMs: 5_000 })

      const action = (): CleanupPlan => {
        const workspace = new GitWorkspace({
          run: async (argv) => {
            if (argv.includes('ls-remote')) {
              expect(argv).toEqual(['-C', root, 'ls-remote', '--heads', 'origin', 'feat/331'])
              return new ProcessOutput({ code: 0, stdout: '', stderr: '' })
            }
            if (cut === 'branch removal' && faultEnabled && argv.includes('branch') && argv.includes('-d')) {
              return new ProcessOutput({ code: 1, stdout: '', stderr: 'scripted branch removal refusal' })
            }
            return runner.run(argv)
          },
          write: async () => {},
          read: async (path) => path === seedPath ? await readFile(path, 'utf8') : null,
          stderr: () => {},
          baseline: new Baseline({ run: async () => ({ code: 0, stdout: '', stderr: '' }), read: () => '' }),
          gh: new Gh({
            launch: async (argv) => {
              expect(argv).toEqual([
                'pr', 'list', '--repo', 'acme/widget', '--state', 'all', '--head', 'feat/331',
                '--json', 'number', '--limit', '1',
              ])
              return new ProcessOutput({ code: 0, stdout: '[]', stderr: '' })
            },
            policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
            sleep: async () => {},
          }),
        })
        class Claims extends DispatchClaims {
          override async requeue(asked: { issue: PlanIssue, repository: RepositoryName }): Promise<void> {
            expect(asked.issue.number).toBe(331)
            expect(asked.repository.text).toBe('acme/widget')
            if (cut === 'checked requeue' && faultEnabled) {
              throw new PlanIssueNotClaimed('scripted checked requeue refusal')
            }
            status = PlanIssueStatus.READY
            successfulRequeues += 1
          }
        }
        class Issues extends PlanIssues {
          override async statusOf(asked: { issueNumber: number, repository: RepositoryName }): Promise<PlanIssueStatusValue> {
            expect(asked).toMatchObject({ issueNumber: 331, repository: { text: 'acme/widget' } })
            return status
          }
        }
        return new CleanupPlan({ records: records(), workspace, claims: new Claims(), planIssues: new Issues() })
      }

      await expect(action().execute(new CleanupPlanParams({
        agent, issue: 331, repository: new RepositoryName('acme/widget'),
      }))).rejects.toThrow(cut === 'branch removal'
        ? 'scripted branch removal refusal'
        : cut === 'checked requeue' ? 'scripted checked requeue refusal' : 'scripted archive rename refusal')

      expect(await readFile(descriptorPath, 'utf8')).toBe(descriptorBytes)
      expect(await readFile(proofPath, 'utf8')).toBe(proofBytes)
      expect(await readFile(join(stateRoot, 'harness', agent, 'cleanup-evidence.json'), 'utf8')).toContain(baseSha)
      faultEnabled = false

      await action().execute(new CleanupPlanParams({
        agent, issue: 331, repository: new RepositoryName('acme/widget'),
      }))

      const retired = join(stateRoot, 'retired-harness', agent)
      expect(await readFile(join(retired, 'dispatch.json'), 'utf8')).toBe(descriptorBytes)
      expect(await readFile(join(retired, 'non-launch.json'), 'utf8')).toBe(proofBytes)
      await expect(fs.stat(join(stateRoot, 'harness', agent))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(GitProcess.run(root, 'branch', '--list', 'feat/331')).toBe('')
      await expect(fs.lstat(worktree)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(status).toBe(PlanIssueStatus.READY)
      expect(successfulRequeues).toBe(1)
    }
  )

  it('invalid checkout queries never prove absence', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'ct-invalid-cleanup-checkout-'))
    roots.push(fixture)
    const invalidRoot = join(fixture, 'missing-checkout')
    const stateRoot = join(fixture, 'state')
    const agent = '11111111-1111-4111-8111-111111111111'
    const records = new DiskPlanRecords({
      files: new HeadlessFiles({ root: stateRoot, fs, newId: () => 'temporary-record' }),
      newId: () => agent,
      now: () => '2026-09-16T10:00:00.000Z',
      exists: async () => false,
    })
    const watch = await records.prepare(new PlanBriefing({
      story: null,
      issue: new PlanIssue({ number: 331, url: 'https://github.com/acme/widget/issues/331' }),
      repository: new RepositoryName('acme/widget'),
      located: new WorkspaceLocation({
        root: invalidRoot, path: join(invalidRoot, '.worktrees', '331'), branch: 'feat/331',
      }),
    }))
    await records.recordNonLaunch(watch, new PlanNonLaunch({
      conversation: agent,
      callId: null,
      source: 'before-worker',
      diagnostic: 'worker never started',
      observedAt: '2026-09-16T10:00:00.000Z',
    }))
    let requeues = 0
    class Claims extends DispatchClaims {
      override async requeue(): Promise<void> { requeues += 1 }
    }
    class Issues extends PlanIssues {
      override async statusOf(): Promise<PlanIssueStatusValue> { return PlanIssueStatus.IN_PROGRESS }
    }
    const runner = new ToolRunner({ bin: 'git', budgetMs: 5_000 })
    const workspace = new GitWorkspace({
      run: runner.run.bind(runner),
      write: async () => {},
      read: async () => null,
      stderr: () => {},
      baseline: new Baseline({ run: async () => ({ code: 0, stdout: '', stderr: '' }), read: () => '' }),
      gh: new Gh({
        launch: async () => { throw new Error('invalid checkout must stop before GitHub') },
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
        sleep: async () => {},
      }),
    })
    const cleanup = new CleanupPlan({ records, workspace, claims: new Claims(), planIssues: new Issues() })

    await expect(cleanup.execute(new CleanupPlanParams({
      agent, issue: 331, repository: new RepositoryName('acme/widget'),
    }))).rejects.toThrow('checkout remote could not be read')

    expect(requeues).toBe(0)
    expect(await records.recorded(agent)).toEqual(watch)
    expect(await records.retired(agent)).toBeNull()
  })
})
