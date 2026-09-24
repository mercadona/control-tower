import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PreparationMother } from '../preparation-mother.ts'
import { buildStateSeed } from '../../../plugin/scripts/kickoff.js'
import { issuesQueryFor } from '../../../plugin/scripts/gh-issues.js'
import { Baseline } from '../../../plugin/scripts/baseline.js'
import { CleanupPlan, CleanupPlanParams } from '../../src/application/actions/cleanup-plan.ts'
import { RetryBudget, RetryPolicy } from '../../src/domain/policies/retry-policy.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanIssueStatus, type PlanIssueStatusValue } from '../../src/domain/value-objects/plan-issue-status.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { DispatchCheckClaims } from '../../src/infrastructure/dispatch-check-claims.ts'
import { DiskPlanRecords } from '../../src/infrastructure/disk-plan-records.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { GhDispatchCandidates } from '../../src/infrastructure/gh-dispatch-candidates.ts'
import { GhPlanIssues } from '../../src/infrastructure/gh-plan-issues.ts'
import { GitWorkspace, SliceSeed } from '../../src/infrastructure/git-workspace.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { ProcessOutput, ToolRunner } from '../../src/infrastructure/tool-runner.ts'
import { SystemProcesses } from '../../src/infrastructure/process-border.ts'

const processes = new SystemProcesses()

describe('GitWorkspace real cleanup', () => {
  const roots: string[] = []
  const agent = '11111111-1111-4111-8111-111111111111'
  const nextAgent = '22222222-2222-4222-8222-222222222222'
  const repository = new RepositoryName('acme/widget')
  const issue = new PlanIssue({ number: 331, url: 'https://github.com/acme/widget/issues/331' })
  const dispatchCheck = '/fixture/plugin/dist/dispatch-check.js'
  const startedAt = '2026-09-16T10:00:00.000Z'

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  class GitProcess {
    static run(cwd: string, ...argv: string[]): string {
      return execFileSync('git', argv, { cwd, encoding: 'utf8', timeout: 5_000 }).trim()
    }
  }

  class DurableBytes {
    static dispatch(root: string, worktree: string): string {
      return `${JSON.stringify({
        repository: repository.text,
        issue: { number: issue.number, url: issue.url },
        story: null,
        root,
        worktree,
        branch: 'feat/331',
        startedAt,
      }, null, 2)}\n`
    }

    static proof(): string {
      return `${JSON.stringify({
        conversation: agent,
        callId: null,
        source: 'before-worker',
        diagnostic: 'worker never started',
        observedAt: startedAt,
      }, null, 2)}\n`
    }
  }

  it.each(['full cleanup', 'branch removal', 'checked requeue', 'archive rename'] as const)(
    'durable cleanup retries preserve evidence and finish retirement after %s', async (cut) => {
      const fixture = await mkdtemp(join(tmpdir(), `ct-workspace-${cut.replace(' ', '-')}-`))
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
      const active = join(stateRoot, DiskPlanRecords.DIRECTORY, agent)
      const descriptorPath = join(active, 'dispatch.json')
      const proofPath = join(active, DiskPlanRecords.NON_LAUNCH)
      const snapshotPath = join(active, DiskPlanRecords.CLEANUP_EVIDENCE)
      const descriptorBytes = DurableBytes.dispatch(root, worktree)
      const proofBytes = DurableBytes.proof()
      await mkdir(active, { recursive: true })
      await writeFile(descriptorPath, descriptorBytes)
      await writeFile(proofPath, proofBytes)

      let faultEnabled = cut !== 'full cleanup'
      let status: PlanIssueStatusValue = PlanIssueStatus.IN_PROGRESS
      let successfulRequeues = 0
      const statusArgv = ['issue', 'view', '331', '--repo', 'acme/widget', '--json', 'labels']
      const requeueArgv = [dispatchCheck, '331', '--repo', 'acme/widget', '--requeue']
      const files = (): HeadlessFiles => new HeadlessFiles({
        root: stateRoot,
        fs: {
          ...fs,
          rename: async (source, destination) => {
            if (cut === 'archive rename' && faultEnabled && String(source) === active) {
              throw Object.assign(new Error('scripted archive rename refusal'), { code: 'EACCES' })
            }
            await fs.rename(source, destination)
          },
        },
        newId: () => 'temporary-record',
      })
      const records = (): DiskPlanRecords => new DiskPlanRecords({
        files: files(),
        newId: () => nextAgent,
        now: () => startedAt,
        exists: async (path) => fs.stat(path).then(() => true, () => false),
      })
      const runner = new ToolRunner({ bin: 'git', budgetMs: 5_000, processes })
      const action = (): CleanupPlan => {
        const workspace = new GitWorkspace({
          preparation: PreparationMother.check(),
          run: async (argv) => {
            if (JSON.stringify(argv) === JSON.stringify([
              '-C', root, 'ls-remote', '--heads', 'origin', 'feat/331',
            ])) {
              expect(argv).toEqual(['-C', root, 'ls-remote', '--heads', 'origin', 'feat/331'])
              return new ProcessOutput({ code: 0, stdout: '', stderr: '' })
            }
            if (cut === 'branch removal' && faultEnabled
              && JSON.stringify(argv) === JSON.stringify(['-C', root, 'branch', '-d', 'feat/331'])) {
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
        const claims = new DispatchCheckClaims({
          dispatchCheck,
          node: async (argv, options) => {
            expect(argv).toEqual(requeueArgv)
            expect(options).toEqual({ cwd: root })
            if (cut === 'checked requeue' && faultEnabled) {
              return new ProcessOutput({ code: 1, stdout: '', stderr: 'scripted checked requeue refusal' })
            }
            status = PlanIssueStatus.READY
            successfulRequeues += 1
            return new ProcessOutput({ code: 0, stdout: '', stderr: '' })
          },
        })
        const planIssues = new GhPlanIssues({
          gh: new Gh({
            launch: async (argv) => {
              expect(argv).toEqual(statusArgv)
              return new ProcessOutput({
                code: 0,
                stdout: JSON.stringify({ labels: [{ name: `status:${status}` }] }),
                stderr: '',
              })
            },
            policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
            sleep: async () => {},
          }),
          stderr: () => {},
        })
        return new CleanupPlan({ records: records(), workspace, claims, planIssues })
      }
      const params = new CleanupPlanParams({ agent, issue: 331, repository })
      const initialRecords = records()
      const watch = await initialRecords.recorded(agent)
      expect(watch).not.toBeNull()
      expect(await readFile(descriptorPath, 'utf8')).toBe(descriptorBytes)
      expect(await readFile(proofPath, 'utf8')).toBe(proofBytes)

      const initialWorkspace = action().workspace
      await expect(initialWorkspace.confirmAbsent(watch!)).rejects.toThrow('remains after cleanup')

      if (cut !== 'full cleanup') {
        await expect(action().execute(params)).rejects.toThrow(cut === 'branch removal'
          ? 'scripted branch removal refusal'
          : cut === 'checked requeue' ? 'scripted checked requeue refusal' : 'scripted archive rename refusal')

        const snapshotBytes = await readFile(snapshotPath, 'utf8')
        expect(await readFile(descriptorPath, 'utf8')).toBe(descriptorBytes)
        expect(await readFile(proofPath, 'utf8')).toBe(proofBytes)
        expect(await readFile(snapshotPath, 'utf8')).toBe(snapshotBytes)
        expect(snapshotBytes).toContain(`"baseSha": "${baseSha}"`)
        expect(await initialRecords.recorded(agent)).toEqual(watch)
        expect(await initialRecords.retired(agent)).toBeNull()

        const registration = GitProcess.run(root, 'worktree', 'list', '--porcelain')
        expect(registration).not.toContain(worktree)
        await expect(fs.lstat(worktree)).rejects.toMatchObject({ code: 'ENOENT' })
        if (cut === 'branch removal') {
          expect(GitProcess.run(root, 'rev-parse', '--verify', 'refs/heads/feat/331')).toBe(baseSha)
          expect(status).toBe(PlanIssueStatus.IN_PROGRESS)
          expect(successfulRequeues).toBe(0)
        } else {
          expect(GitProcess.run(root, 'branch', '--list', 'feat/331')).toBe('')
          expect(status).toBe(cut === 'archive rename' ? PlanIssueStatus.READY : PlanIssueStatus.IN_PROGRESS)
          expect(successfulRequeues).toBe(cut === 'archive rename' ? 1 : 0)
        }

        faultEnabled = false
        await action().execute(params)
        const retired = join(stateRoot, DiskPlanRecords.RETIRED_DIRECTORY, agent)
        expect(await readFile(join(retired, DiskPlanRecords.CLEANUP_EVIDENCE), 'utf8')).toBe(snapshotBytes)
      } else {
        await action().execute(params)
      }

      const retired = join(stateRoot, DiskPlanRecords.RETIRED_DIRECTORY, agent)
      const retiredSnapshotBytes = await readFile(join(retired, DiskPlanRecords.CLEANUP_EVIDENCE), 'utf8')
      expect(await records().recorded(agent)).toBeNull()
      expect(await records().retired(agent)).toEqual(watch)
      expect(await readFile(join(retired, 'dispatch.json'), 'utf8')).toBe(descriptorBytes)
      expect(await readFile(join(retired, DiskPlanRecords.NON_LAUNCH), 'utf8')).toBe(proofBytes)
      expect(retiredSnapshotBytes).toContain(`"baseSha": "${baseSha}"`)
      expect(await records().cleanupEvidence(watch!)).toBeNull()
      await expect(fs.stat(active)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(GitProcess.run(root, 'worktree', 'list', '--porcelain')).not.toContain(worktree)
      expect(GitProcess.run(root, 'branch', '--list', 'feat/331')).toBe('')
      await expect(fs.lstat(worktree)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(status).toBe(PlanIssueStatus.READY)
      expect(successfulRequeues).toBe(1)
      await expect(initialWorkspace.confirmAbsent(watch!)).resolves.toBeUndefined()

      const candidateIssue = {
        number: 331,
        url: issue.url,
        title: 'Cleanup candidate',
        body: '<!-- ct-order:1 -->',
        state: 'OPEN',
        stateReason: null,
        milestone: { number: 331, title: 'CT331', description: null },
        labels: { nodes: [{ name: `status:${status}` }, { name: 'gate:none' }] },
      }
      const page = (nodes: unknown[]): string => JSON.stringify([
        { data: { repository: { issues: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } },
      ])
      const candidates = new GhDispatchCandidates({
        gh: new Gh({
          launch: async (argv) => {
            const state = argv.some((argument) => argument.includes('states:[OPEN]')) ? 'OPEN' : 'CLOSED'
            expect(argv).toEqual([
              'api', 'graphql', '--paginate', '--slurp',
              '-f', `query=${issuesQueryFor([state])}`, '-f', 'owner=acme', '-f', 'name=widget',
            ])
            return new ProcessOutput({
              code: 0,
              stdout: page(state === 'OPEN' ? [candidateIssue] : []),
              stderr: '',
            })
          },
          policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
          sleep: async () => {},
        }),
      })
      const admissible = await candidates.admissible({ repository, milestone: 'CT331' })
      expect(admissible).toEqual([issue])
      const candidate = admissible[0]
      const prepared = await records().prepare(new PlanBriefing({
        story: null,
        issue: candidate,
        repository,
        located: watch!.located,
      }))
      expect(prepared.agent).toBe(nextAgent)
      expect(await records().recorded(nextAgent)).toEqual(prepared)
      expect(await readFile(join(stateRoot, DiskPlanRecords.DIRECTORY, nextAgent, 'dispatch.json'), 'utf8'))
        .toContain('"number": 331')
    },
  )

  it('invalid checkout queries never prove absence', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'ct-invalid-cleanup-checkout-'))
    roots.push(fixture)
    const invalidRoot = join(fixture, 'missing-checkout')
    const worktree = join(invalidRoot, '.worktrees', '331')
    const stateRoot = join(fixture, 'state')
    const active = join(stateRoot, DiskPlanRecords.DIRECTORY, agent)
    const descriptorBytes = DurableBytes.dispatch(invalidRoot, worktree)
    const proofBytes = DurableBytes.proof()
    await mkdir(active, { recursive: true })
    await writeFile(join(active, 'dispatch.json'), descriptorBytes)
    await writeFile(join(active, DiskPlanRecords.NON_LAUNCH), proofBytes)
    const records = new DiskPlanRecords({
      files: new HeadlessFiles({ root: stateRoot, fs, newId: () => 'temporary-record' }),
      newId: () => nextAgent,
      now: () => startedAt,
      exists: async () => false,
    })
    let requeues = 0
    const claims = new DispatchCheckClaims({
      dispatchCheck,
      node: async () => {
        requeues += 1
        throw new Error('invalid checkout must stop before requeue')
      },
    })
    const planIssues = new GhPlanIssues({
      gh: new Gh({
        launch: async (argv) => {
          expect(argv).toEqual(['issue', 'view', '331', '--repo', 'acme/widget', '--json', 'labels'])
          return new ProcessOutput({
            code: 0,
            stdout: JSON.stringify({ labels: [{ name: 'status:in-progress' }] }),
            stderr: '',
          })
        },
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
        sleep: async () => {},
      }),
      stderr: () => {},
    })
    const runner = new ToolRunner({ bin: 'git', budgetMs: 5_000, processes })
    const workspace = new GitWorkspace({
      preparation: PreparationMother.check(),
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
    const cleanup = new CleanupPlan({ records, workspace, claims, planIssues })
    const watch = await records.recorded(agent)

    await expect(cleanup.execute(new CleanupPlanParams({
      agent, issue: 331, repository,
    }))).rejects.toThrow('checkout remote could not be read')

    expect(requeues).toBe(0)
    expect(await records.recorded(agent)).toEqual(watch)
    expect(await records.retired(agent)).toBeNull()
    expect(await readFile(join(active, 'dispatch.json'), 'utf8')).toBe(descriptorBytes)
    expect(await readFile(join(active, DiskPlanRecords.NON_LAUNCH), 'utf8')).toBe(proofBytes)
    await expect(fs.stat(join(active, DiskPlanRecords.CLEANUP_EVIDENCE))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
