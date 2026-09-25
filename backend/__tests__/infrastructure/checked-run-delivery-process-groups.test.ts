import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RetryBudget, RetryPolicy } from '../../src/domain/policies/retry-policy.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { RunDeliveryFailure, RunDeliveryUncertain } from '../../src/domain/value-objects/run-delivery.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { CheckedRunDelivery } from '../../src/infrastructure/checked-run-delivery.ts'
import { CtRunMachine } from '../../src/infrastructure/ct-run-machine.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { RunJournal } from '../../src/infrastructure/run-journal.ts'
import { ToolRunner } from '../../src/infrastructure/tool-runner.ts'
import { InProcessRun, type ScriptedStep } from './fixtures/in-process-run.ts'
import { LivingProcessGroups } from './fixtures/living-process-groups.ts'
import { Capture, ScriptedConversation, UnscriptedRequest } from './fixtures/scripted-conversation.ts'

const DELIVERED_STEPS: readonly ScriptedStep[] = [
  'implement', 'controls', 'judge', 'commit', 'reconcile-clean', 'global', 'slice-judge', 'delivered',
]

class LivePushScenario {
  static readonly SHA = 'da0a450ab847474c2645862ad63d9231ee93d47c'
  static readonly BRANCH = 'feat/7'
  static readonly PROCESS_GROUP = 4242
  static readonly ATTEMPT = 'aaaaaaaa-0000-4000-8000-000000000001'

  static async arranged(alive: Iterable<number>): Promise<{
    run: InProcessRun, watch: PlanWatch, table: LivingProcessGroups, delivery: CheckedRunDelivery, git: ScriptedConversation,
  }> {
    const run = await InProcessRun.create([])
    const watch = await run.journaled(DELIVERED_STEPS)
    await run.intended(watch, LivePushScenario.SHA)
    await LivePushScenario.#writePendingPush(run, watch)
    const table = new LivingProcessGroups(alive)
    const git = new ScriptedConversation()
      .answering(
        { binary: 'git', argv: ['-C', run.checkout, 'ls-remote', '--heads', 'origin', `refs/heads/${LivePushScenario.BRANCH}`] },
        Capture.read('git', 'ls-remote-absent-branch'),
      )
      .answering(
        { binary: 'git', argv: ['-C', run.checkout, 'symbolic-ref', '--quiet', '--short', 'HEAD'] },
        Capture.read('git', 'symbolic-ref-feat-7'),
      )
      .answering(
        { binary: 'git', argv: ['-C', run.checkout, 'rev-parse', 'HEAD'] },
        Capture.read('git', 'rev-parse-worktree-pinned'),
      )
      .answering(
        { binary: 'git', argv: ['-C', run.checkout, 'status', '--porcelain', '--untracked-files=all'] },
        Capture.read('git', 'status-clean'),
      )
      .answering(
        { binary: 'git', argv: ['-C', run.checkout, 'worktree', 'list', '--porcelain'] },
        LivePushScenario.#worktreeList(run.checkout),
      )
      .answering(
        { binary: 'git', argv: ['-C', run.checkout, 'remote', 'get-url', '--all', 'origin'] },
        Capture.read('git', 'remote-get-url-widget'),
      )
      .answering(
        { binary: 'git', argv: ['-C', run.checkout, 'remote', 'get-url', '--push', '--all', 'origin'] },
        Capture.read('git', 'remote-get-url-widget'),
      )
      .answering(
        {
          binary: 'git',
          argv: ['-C', run.checkout, 'push', 'origin', `${LivePushScenario.SHA}:refs/heads/${LivePushScenario.BRANCH}`],
          cwd: run.checkout,
        },
        Capture.read('git', 'push-rejected'),
      )
    return { run, watch, table, git, delivery: run.checkedDelivery({ git, table }) }
  }

  static #worktreeList(checkout: string): Capture {
    const template = Capture.read('git', 'worktree-list-single')
    return new Capture({
      command: template.command, version: template.version, date: template.date, code: template.code,
      stdout: template.stdout.replaceAll('<worktree>', checkout), stderr: template.stderr,
    })
  }

  static async #writePendingPush(run: InProcessRun, watch: PlanWatch): Promise<void> {
    const directory = join(run.state, 'harness', watch.agent, 'run', 'publication', 'push', LivePushScenario.ATTEMPT)
    await mkdir(directory, { recursive: true })
    const argv = ['-C', run.checkout, 'push', 'origin', `${LivePushScenario.SHA}:refs/heads/${LivePushScenario.BRANCH}`]
    await writeFile(join(directory, 'request.json'), `${JSON.stringify({
      version: 1, attempt: 1, requestedAt: '2026-09-24T09:00:00.000Z', sha: LivePushScenario.SHA,
      branch: LivePushScenario.BRANCH, argv, cwd: run.checkout,
    })}\n`)
    await writeFile(join(directory, 'owner.json'), `${JSON.stringify({
      version: 2, attempt: 1, pid: LivePushScenario.PROCESS_GROUP, processGroup: LivePushScenario.PROCESS_GROUP,
      startedAt: '2026-09-24T09:00:01.000Z',
    })}\n`)
  }
}

describe('a living process group reads as publishing', () => {
  const runs: InProcessRun[] = []

  afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.remove()))
  })

  it('a living process group reads as publishing and never as uncertain', async () => {
    const { run, watch, delivery } = await LivePushScenario.arranged(
      [-LivePushScenario.PROCESS_GROUP, LivePushScenario.PROCESS_GROUP],
    )
    runs.push(run)

    expect(await delivery.inspect(watch)).toEqual({
      kind: 'publishing', pullRequest: null,
      diagnostic: `push process group ${LivePushScenario.PROCESS_GROUP} is still running`,
    })

    await run.settled()
    expect(run.warnings).toEqual([])
  })

  it('a dead leader with a living group still reads as publishing', async () => {
    const { run, watch, delivery } = await LivePushScenario.arranged([-LivePushScenario.PROCESS_GROUP])
    runs.push(run)

    expect(await delivery.inspect(watch)).toEqual({
      kind: 'publishing', pullRequest: null,
      diagnostic: `push process group ${LivePushScenario.PROCESS_GROUP} is still running`,
    })

    await run.settled()
    expect(run.warnings).toEqual([])
  })
})

describe('a retry waits for termination and claims nothing', () => {
  const runs: InProcessRun[] = []

  afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.remove()))
  })

  it('a dead leader alone does not authorize a retry while its group lives', async () => {
    const { run, watch, delivery, git } = await LivePushScenario.arranged([-LivePushScenario.PROCESS_GROUP])
    runs.push(run)

    const rejection = await delivery.deliver(watch).catch((cause: unknown) => cause)

    expect(rejection).toBeInstanceOf(RunDeliveryUncertain)
    expect((rejection as Error).message).toBe(`push process group ${LivePushScenario.PROCESS_GROUP} may still be running`)
    expect(git.asked.filter((request) => request.argv.includes('push'))).toEqual([])
    expect(await delivery.journal.publicationRead(watch, ['push', LivePushScenario.ATTEMPT, 'disposition.json'])).toBeNull()

    await run.settled()
    expect(run.warnings).toEqual([])
  })

  it('termination evidence permits a retry and never claims delivery', async () => {
    const { run, watch, delivery, git } = await LivePushScenario.arranged([])
    runs.push(run)

    const rejection = await delivery.deliver(watch).catch((cause: unknown) => cause)

    expect(rejection).toBeInstanceOf(RunDeliveryFailure)
    expect(rejection).not.toBeInstanceOf(RunDeliveryUncertain)
    expect((rejection as Error).message).toContain('git push failed')

    const disposition = await delivery.journal.publicationRead(watch, ['push', LivePushScenario.ATTEMPT, 'disposition.json'])
    expect(disposition).not.toBeNull()
    expect(JSON.parse(disposition as string)).toMatchObject({
      kind: 'terminated', processGroup: LivePushScenario.PROCESS_GROUP,
    })
    expect(git.asked.filter((request) => request.argv.includes('push'))).toHaveLength(1)
    expect(await delivery.journal.publicationRead(watch, ['receipt.json'])).toBeNull()
    expect((await delivery.inspect(watch)).kind).not.toBe('delivered')

    await run.settled()
    expect(run.warnings).toEqual([])
  })
})

class ProvenReceiptScenario {
  static readonly REPOSITORY = 'mercadona/control-tower'
  static readonly ISSUE = 550
  static readonly BRANCH = 'feat/550'
  static readonly BASE = 'main'
  static readonly SHA = '167cf9a4b7d9d46688cb817c734b6e581b1c8b44'
  static readonly AGENT = 'bbbbbbbb-0000-4000-8000-000000000550'
  static readonly AT = '2026-09-25T09:00:00.000Z'
  static readonly DISPATCH_CHECK = '/plugin/scripts/dispatch-check.mjs'
  static readonly TITLE = 'feat: run driver family in process'
  static readonly PULL_REQUEST = { number: 605, url: 'https://github.com/mercadona/control-tower/pull/605' }
  static readonly QUERY = 'query($owner:String!,$name:String!,$headRefName:String!,$endCursor:String)'
    + '{repository(owner:$owner,name:$name){pullRequests(first:100,after:$endCursor,headRefName:$headRefName)'
    + '{nodes{number url body state isDraft headRefName headRefOid headRepository{nameWithOwner} baseRefName '
    + 'repository{nameWithOwner}}pageInfo{hasNextPage endCursor}}}}'

  static readonly roots: string[] = []

  static async cleanUp(): Promise<void> {
    await Promise.all(ProvenReceiptScenario.roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  }

  static body(): string {
    return `Closes #${ProvenReceiptScenario.ISSUE}\n\n`
      + `<!-- control-tower-delivery:${ProvenReceiptScenario.REPOSITORY}#${ProvenReceiptScenario.ISSUE}:${ProvenReceiptScenario.AGENT} -->`
  }

  static text(value: Record<string, unknown>): string {
    return `${JSON.stringify(value)}\n`
  }

  static digest(text: string): string {
    return createHash('sha256').update(text).digest('hex')
  }

  static async arranged(): Promise<{
    watch: PlanWatch, delivery: CheckedRunDelivery, git: ScriptedConversation, gh: ScriptedConversation,
  }> {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'ct-proven-receipt-')))
    ProvenReceiptScenario.roots.push(home)
    const root = join(home, 'checkout')
    const worktree = join(root, '.worktrees', String(ProvenReceiptScenario.ISSUE))
    const state = join(home, 'state')
    await mkdir(worktree, { recursive: true })
    await mkdir(state, { recursive: true })

    const watch = new PlanWatch({
      story: null,
      issue: new PlanIssue({
        number: ProvenReceiptScenario.ISSUE,
        url: `https://github.com/${ProvenReceiptScenario.REPOSITORY}/issues/${ProvenReceiptScenario.ISSUE}`,
      }),
      repository: new RepositoryName(ProvenReceiptScenario.REPOSITORY),
      agent: ProvenReceiptScenario.AGENT,
      located: new WorkspaceLocation({ root, path: worktree, branch: ProvenReceiptScenario.BRANCH }),
    })

    const files = new HeadlessFiles({ root: state, fs, newId: () => 'unused' })
    const journal = new RunJournal({ files, newId: () => 'unused', now: () => ProvenReceiptScenario.AT })

    const intent = {
      version: 1, conversation: ProvenReceiptScenario.AGENT, repository: ProvenReceiptScenario.REPOSITORY,
      issue: ProvenReceiptScenario.ISSUE, root, worktree, branch: ProvenReceiptScenario.BRANCH,
      base: ProvenReceiptScenario.BASE, sha: ProvenReceiptScenario.SHA,
      machineDigest: ProvenReceiptScenario.digest(JSON.stringify({ manifest: null, entries: [] })),
      title: ProvenReceiptScenario.TITLE, body: ProvenReceiptScenario.body(),
    }

    const pushArgv = ['-C', worktree, 'push', 'origin', `${ProvenReceiptScenario.SHA}:refs/heads/${ProvenReceiptScenario.BRANCH}`]
    const pullArgv = ['pr', 'create', '--repo', ProvenReceiptScenario.REPOSITORY, '--head', ProvenReceiptScenario.BRANCH,
      '--base', ProvenReceiptScenario.BASE, '--title', ProvenReceiptScenario.TITLE, '--body', ProvenReceiptScenario.body()]
    const releaseArgv = [ProvenReceiptScenario.DISPATCH_CHECK, String(ProvenReceiptScenario.ISSUE), '--repo', ProvenReceiptScenario.REPOSITORY,
      '--release', '--no-watch-merge']

    const pushRequest = ProvenReceiptScenario.text({
      version: 1, attempt: 1, requestedAt: ProvenReceiptScenario.AT, sha: ProvenReceiptScenario.SHA,
      branch: ProvenReceiptScenario.BRANCH, argv: pushArgv, cwd: worktree,
    })
    const pullRequestRequest = ProvenReceiptScenario.text({
      version: 1, attempt: 1, requestedAt: ProvenReceiptScenario.AT, head: ProvenReceiptScenario.BRANCH,
      base: ProvenReceiptScenario.BASE, sha: ProvenReceiptScenario.SHA, title: ProvenReceiptScenario.TITLE,
      body: ProvenReceiptScenario.body(), argv: pullArgv, cwd: worktree,
    })
    const releaseRequest = ProvenReceiptScenario.text({
      version: 1, attempt: 1, requestedAt: ProvenReceiptScenario.AT, sha: ProvenReceiptScenario.SHA,
      pullRequest: ProvenReceiptScenario.PULL_REQUEST, argv: releaseArgv, cwd: worktree,
    })

    const result = (request: string, argv: readonly string[], stdout: string): string => ProvenReceiptScenario.text({
      version: 1, attempt: 1, at: ProvenReceiptScenario.AT, requestDigest: ProvenReceiptScenario.digest(request),
      command: argv[0], argv, cwd: worktree, code: 0, stdout, stderr: '',
    })

    const pushResult = result(pushRequest, pushArgv, '')
    const pullResult = result(pullRequestRequest, pullArgv, `${ProvenReceiptScenario.PULL_REQUEST.url}\n`)
    const releaseResult = result(releaseRequest, releaseArgv, `released #${ProvenReceiptScenario.ISSUE} → in-review\n`)

    await journal.publicationWrite(watch, ['intent.json'], ProvenReceiptScenario.text(intent))
    await journal.publicationWrite(watch, ['push', '11111111-1111-4111-8111-111111111111', 'request.json'], pushRequest)
    await journal.publicationWrite(watch, ['push', '11111111-1111-4111-8111-111111111111', 'result.json'], pushResult)
    await journal.publicationWrite(watch, ['pull-request', 'request.json'], pullRequestRequest)
    await journal.publicationWrite(watch, ['pull-request', 'result.json'], pullResult)
    await journal.publicationWrite(watch, ['release', '22222222-2222-4222-8222-222222222222', 'request.json'], releaseRequest)
    await journal.publicationWrite(watch, ['release', '22222222-2222-4222-8222-222222222222', 'result.json'], releaseResult)
    await journal.publicationWrite(watch, ['receipt.json'], ProvenReceiptScenario.text({
      version: 1, at: ProvenReceiptScenario.AT, sha: ProvenReceiptScenario.SHA, pullRequest: ProvenReceiptScenario.PULL_REQUEST,
      pushAttempt: 1, pushResultDigest: ProvenReceiptScenario.digest(pushResult),
      pullRequestAttempt: 1, pullRequestResultDigest: ProvenReceiptScenario.digest(pullResult),
      releaseAttempt: 1, releaseResultDigest: ProvenReceiptScenario.digest(releaseResult),
    }))

    const table = new LivingProcessGroups([])
    const signal = table.signal.bind(table)
    const git = new ScriptedConversation()
    const gh = new ScriptedConversation()
      .answering(
        {
          binary: 'gh',
          argv: ['api', 'graphql', '--paginate', '--slurp', '-f', `query=${ProvenReceiptScenario.QUERY}`,
            '-f', 'owner=mercadona', '-f', 'name=control-tower', '-f', `headRefName=${ProvenReceiptScenario.BRANCH}`],
        },
        Capture.read('gh', 'graphql-pull-requests-merged'),
      )
    const gitRunner = new ToolRunner({ bin: 'git', budgetMs: 30_000, processes: git, signal })
    const ghRunner = new ToolRunner({ bin: 'gh', budgetMs: 30_000, processes: gh, signal })

    const delivery = new CheckedRunDelivery({
      journal,
      machine: new CtRunMachine({
        journal,
        node: ProvenReceiptScenario.#refusing('node'),
        git: ProvenReceiptScenario.#refusing('git'),
        read: async () => null,
        ctStep: '/plugin/scripts/ct-step.mjs',
        dispatchCheck: ProvenReceiptScenario.DISPATCH_CHECK,
        pluginRoot: '/plugin',
      }),
      git: gitRunner.runWholeOutput.bind(gitRunner),
      node: ProvenReceiptScenario.#refusing('node'),
      gh: new Gh({
        launch: (argv) => ghRunner.runWholeOutput(argv),
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
        sleep: async () => {},
      }),
      read: async () => null,
      dispatchCheck: ProvenReceiptScenario.DISPATCH_CHECK,
      newId: () => 'unused',
      now: () => ProvenReceiptScenario.AT,
      signal,
    })

    return { watch, delivery, git, gh }
  }

  static #refusing(binary: string): (argv: string[]) => Promise<never> {
    return async (argv) => { throw new UnscriptedRequest({ binary, argv }) }
  }
}

describe('a proven receipt answers later reads by itself', () => {
  afterEach(() => ProvenReceiptScenario.cleanUp())

  it('a proven receipt answers later reads without asking GitHub again', async () => {
    const { watch, delivery, gh } = await ProvenReceiptScenario.arranged()

    expect(await delivery.inspect(watch)).toEqual({ kind: 'delivered', pullRequest: ProvenReceiptScenario.PULL_REQUEST })
    expect(await delivery.inspect(watch)).toEqual({ kind: 'delivered', pullRequest: ProvenReceiptScenario.PULL_REQUEST })

    expect(gh.asked).toHaveLength(1)
  })

  it('a merged pull request still reads as delivered once the branch and the issue are closed', async () => {
    const { watch, delivery, git } = await ProvenReceiptScenario.arranged()

    expect(await delivery.inspect(watch)).toEqual({ kind: 'delivered', pullRequest: ProvenReceiptScenario.PULL_REQUEST })

    expect(git.asked).toEqual([])
  })
})
