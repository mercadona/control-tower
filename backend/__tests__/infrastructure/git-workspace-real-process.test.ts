import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildStateSeed } from '../../../plugin/scripts/kickoff.js'
import { Baseline } from '../../../plugin/scripts/baseline.js'
import { CleanupPlan, CleanupPlanParams } from '../../src/application/actions/cleanup-plan.ts'
import { DispatchClaims } from '../../src/domain/ports/dispatch-claims.ts'
import { PlanIssues } from '../../src/domain/ports/plan-issues.ts'
import { PlanRecords } from '../../src/domain/ports/plan-records.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanIssueStatus, type PlanIssueStatusValue } from '../../src/domain/value-objects/plan-issue-status.ts'
import { PlanNonLaunch } from '../../src/domain/value-objects/plan-non-launch.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { UnusedWorkspace } from '../../src/domain/value-objects/unused-workspace.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { GitWorkspace, SliceSeed } from '../../src/infrastructure/git-workspace.ts'
import { ProcessOutput, ToolRunner } from '../../src/infrastructure/tool-runner.ts'
import { RetryBudget, RetryPolicy } from '../../src/domain/policies/retry-policy.ts'

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
    const watch = new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: 331, url: 'https://github.com/acme/widget/issues/331' }),
      repository: new RepositoryName('acme/widget'),
      located: new WorkspaceLocation({ root, path: worktree, branch: 'feat/331' }),
      agent: '11111111-1111-4111-8111-111111111111',
    })
    await expect(workspace.confirmAbsent(watch)).rejects.toThrow('remains after cleanup')
    let snapshot: UnusedWorkspace | null = null
    let archived = false
    let status: PlanIssueStatusValue = PlanIssueStatus.IN_PROGRESS
    class Records extends PlanRecords {
      override async retired(): Promise<PlanWatch | null> { return null }
      override async recorded(): Promise<PlanWatch> { return watch }
      override async nonLaunch(): Promise<PlanNonLaunch> {
        return new PlanNonLaunch({
          conversation: watch.agent,
          callId: null,
          source: 'before-worker',
          diagnostic: 'worker never started',
          observedAt: '2026-09-16T10:00:00.000Z',
        })
      }
      override async cleanupEvidence(): Promise<UnusedWorkspace | null> { return snapshot }
      override async recordCleanupEvidence(evidence: UnusedWorkspace): Promise<void> { snapshot = evidence }
      override async archive(): Promise<void> { archived = true }
    }
    class Claims extends DispatchClaims {
      override async requeue(): Promise<void> { status = PlanIssueStatus.READY }
    }
    class Issues extends PlanIssues {
      override async statusOf(): Promise<PlanIssueStatusValue> { return status }
    }
    const cleanup = new CleanupPlan({
      records: new Records(), workspace, claims: new Claims(), planIssues: new Issues(),
    })

    await cleanup.execute(new CleanupPlanParams({
      agent: watch.agent, issue: watch.issue.number, repository: watch.repository,
    }))

    expect((snapshot as UnusedWorkspace | null)?.baseSha).toBe(baseSha)
    expect(archived).toBe(true)
    await expect(workspace.confirmAbsent(watch)).resolves.toBeUndefined()
  })
})
