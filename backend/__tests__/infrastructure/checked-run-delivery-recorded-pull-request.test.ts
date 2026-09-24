import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
import type { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'

type Evidence = Record<string, unknown>

class DeliveredJournalMother {
  static readonly CAPTURE = 'shape of harness/<conversation>/run/publication/ as the backend wrote it for mercadona/mo.staff.django-playground#996 on 2026-09-24'
  static readonly AGENT = '93620788-018a-4d99-909a-b4b516473931'
  static readonly REPOSITORY = 'owner/name'
  static readonly ROOT = '/checkout'
  static readonly WORKTREE = '/checkout/.worktrees/7'
  static readonly BRANCH = 'feat/7'
  static readonly SHA = 'c376ee165a047424402eee801e7fbb0b6e6ece38'
  static readonly DISPATCH_CHECK = '/plugin/scripts/dispatch-check.mjs'
  static readonly AT = '2026-09-24T09:25:28.373Z'
  static readonly PULL_REQUEST = { number: 998, url: 'https://github.com/owner/name/pull/998' }
  static readonly TITLE = 'feat: Comando inspect_emperor'
  static readonly BODY = `Closes #7\n\n<!-- control-tower-delivery:owner/name#7:${DeliveredJournalMother.AGENT} -->`

  static watch(): PlanWatch {
    return new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: 7, url: 'https://github.com/owner/name/issues/7' }),
      repository: new RepositoryName(DeliveredJournalMother.REPOSITORY),
      agent: DeliveredJournalMother.AGENT,
      located: new WorkspaceLocation({
        root: DeliveredJournalMother.ROOT, path: DeliveredJournalMother.WORKTREE, branch: DeliveredJournalMother.BRANCH,
      }),
    })
  }

  static text(value: Evidence): string {
    return `${JSON.stringify(value)}\n`
  }

  static digest(text: string): string {
    return createHash('sha256').update(text).digest('hex')
  }

  static intent(): Evidence {
    return {
      version: 1, conversation: DeliveredJournalMother.AGENT, repository: DeliveredJournalMother.REPOSITORY, issue: 7,
      root: DeliveredJournalMother.ROOT, worktree: DeliveredJournalMother.WORKTREE, branch: DeliveredJournalMother.BRANCH,
      base: 'master', sha: DeliveredJournalMother.SHA, machineDigest: 'a'.repeat(64),
      title: DeliveredJournalMother.TITLE, body: DeliveredJournalMother.BODY,
    }
  }

  static result(request: string, asked: Evidence, stdout: string): string {
    const argv = asked.argv as string[]
    return DeliveredJournalMother.text({
      version: 1, attempt: 1, at: DeliveredJournalMother.AT, requestDigest: DeliveredJournalMother.digest(request),
      command: argv[0], argv, cwd: DeliveredJournalMother.WORKTREE, code: 0, stdout, stderr: '',
    })
  }

  static publication(): Record<string, string> {
    const common = { version: 1, attempt: 1, requestedAt: DeliveredJournalMother.AT, sha: DeliveredJournalMother.SHA }
    const push: Evidence = {
      ...common, branch: DeliveredJournalMother.BRANCH, cwd: DeliveredJournalMother.WORKTREE,
      argv: ['-C', DeliveredJournalMother.WORKTREE, 'push', 'origin', `${DeliveredJournalMother.SHA}:refs/heads/${DeliveredJournalMother.BRANCH}`],
    }
    const pull: Evidence = {
      ...common, head: DeliveredJournalMother.BRANCH, base: 'master', title: DeliveredJournalMother.TITLE,
      body: DeliveredJournalMother.BODY, cwd: DeliveredJournalMother.WORKTREE,
      argv: ['pr', 'create', '--repo', DeliveredJournalMother.REPOSITORY, '--head', DeliveredJournalMother.BRANCH,
        '--base', 'master', '--title', DeliveredJournalMother.TITLE, '--body', DeliveredJournalMother.BODY],
    }
    const release: Evidence = {
      ...common, pullRequest: DeliveredJournalMother.PULL_REQUEST, cwd: DeliveredJournalMother.WORKTREE,
      argv: [DeliveredJournalMother.DISPATCH_CHECK, '7', '--repo', DeliveredJournalMother.REPOSITORY, '--release', '--no-watch-merge'],
    }
    const pushRequest = DeliveredJournalMother.text(push)
    const pullRequest = DeliveredJournalMother.text(pull)
    const releaseRequest = DeliveredJournalMother.text(release)
    const pushResult = DeliveredJournalMother.result(pushRequest, push, '')
    const pullResult = DeliveredJournalMother.result(pullRequest, pull, `${DeliveredJournalMother.PULL_REQUEST.url}\n`)
    const releaseResult = DeliveredJournalMother.result(releaseRequest, release, 'released #7 → in-review\n')
    return {
      'intent.json': DeliveredJournalMother.text(DeliveredJournalMother.intent()),
      'push/58ae545e-6800-4207-b91c-df1c58906cba/request.json': pushRequest,
      'push/58ae545e-6800-4207-b91c-df1c58906cba/result.json': pushResult,
      'pull-request/request.json': pullRequest,
      'pull-request/result.json': pullResult,
      'release/dac46f04-4496-450c-9adc-24f73a41c86e/request.json': releaseRequest,
      'release/dac46f04-4496-450c-9adc-24f73a41c86e/result.json': releaseResult,
      'receipt.json': DeliveredJournalMother.text({
        version: 1, at: DeliveredJournalMother.AT, sha: DeliveredJournalMother.SHA,
        pullRequest: DeliveredJournalMother.PULL_REQUEST,
        pushAttempt: 1, pushResultDigest: DeliveredJournalMother.digest(pushResult),
        pullRequestAttempt: 1, pullRequestResultDigest: DeliveredJournalMother.digest(pullResult),
        releaseAttempt: 1, releaseResultDigest: DeliveredJournalMother.digest(releaseResult),
      }),
    }
  }
}

class RecordedPullRequestScenario {
  static readonly roots: string[] = []
  readonly asked: string[] = []
  root = ''

  static async cleanUp(): Promise<void> {
    await Promise.all(RecordedPullRequestScenario.roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  }

  async withJournal(files: Record<string, string>): Promise<RecordedPullRequestScenario> {
    this.root = await mkdtemp(join(tmpdir(), 'ct-recorded-pull-'))
    RecordedPullRequestScenario.roots.push(this.root)
    const publication = join(this.root, 'harness', DeliveredJournalMother.AGENT, 'run', 'publication')
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(publication, path, '..'), { recursive: true })
      await writeFile(join(publication, path), text, 'utf8')
    }
    return this
  }

  publicationPath(path: string): string {
    return join(this.root, 'harness', DeliveredJournalMother.AGENT, 'run', 'publication', path)
  }

  #refusing(tool: string): (argv: string[]) => Promise<ProcessOutput> {
    return async (argv) => {
      this.asked.push(`${tool} ${argv.join(' ')}`)
      throw new Error(`${tool} was asked ${argv.join(' ')} while naming a recorded pull request`)
    }
  }

  #refusingSignal(): (pid: number, signal: NodeJS.Signals | 0) => void {
    return (pid, signal) => {
      this.asked.push(`signal ${signal} ${pid}`)
      throw new Error(`signal ${signal} was sent to ${pid} while naming a recorded pull request`)
    }
  }

  delivery(): CheckedRunDelivery {
    const journal = new RunJournal({
      files: new HeadlessFiles({ root: this.root, fs, newId: () => 'temporary' }), newId: () => 'unused', now: () => DeliveredJournalMother.AT,
    })
    return new CheckedRunDelivery({
      journal,
      machine: new CtRunMachine({
        journal, node: this.#refusing('node'), git: this.#refusing('git'), read: async () => null,
        ctStep: '/plugin/ct-step.mjs', dispatchCheck: DeliveredJournalMother.DISPATCH_CHECK, pluginRoot: '/plugin',
      }),
      git: this.#refusing('git'),
      node: this.#refusing('node'),
      gh: new Gh({
        launch: this.#refusing('gh'),
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
        sleep: async () => {},
      }),
      read: async () => null,
      dispatchCheck: DeliveredJournalMother.DISPATCH_CHECK,
      newId: () => 'unused',
      now: () => DeliveredJournalMother.AT,
      signal: this.#refusingSignal(),
    })
  }

  async named(): Promise<unknown> {
    return this.delivery().recordedPullRequest(DeliveredJournalMother.watch()).catch((cause) => cause)
  }
}

describe(`CheckedRunDelivery names a delivered slice's pull request from its journal alone (${DeliveredJournalMother.CAPTURE})`, () => {
  afterEach(() => RecordedPullRequestScenario.cleanUp())

  it('names the pull request its receipt binds, with no worktree on disk and nothing asked of git or GitHub', async () => {
    const scenario = await new RecordedPullRequestScenario().withJournal(DeliveredJournalMother.publication())

    expect(await scenario.named()).toEqual(DeliveredJournalMother.PULL_REQUEST)
    expect(scenario.asked).toEqual([])
  })

  it('names no pull request for a slice whose publication never produced a receipt', async () => {
    const { 'receipt.json': _receipt, ...unreceipted } = DeliveredJournalMother.publication()
    const scenario = await new RecordedPullRequestScenario().withJournal(unreceipted)

    expect(await scenario.named()).toBeNull()
  })

  it('names no pull request for a slice that never started its publication', async () => {
    const scenario = await new RecordedPullRequestScenario().withJournal({})

    expect(await scenario.named()).toBeNull()
  })

  it('refuses a receipt that names another revision instead of naming its pull request', async () => {
    const publication = DeliveredJournalMother.publication()
    const receipt = JSON.parse(publication['receipt.json'])
    const scenario = await new RecordedPullRequestScenario().withJournal({
      ...publication, 'receipt.json': DeliveredJournalMother.text({ ...receipt, sha: 'f'.repeat(40) }),
    })

    expect(await scenario.named()).toBeInstanceOf(RunDeliveryUncertain)
  })

  it('refuses a receipt whose bound pull request result was rewritten after the fact', async () => {
    const publication = DeliveredJournalMother.publication()
    const scenario = await new RecordedPullRequestScenario().withJournal({
      ...publication, 'pull-request/result.json': publication['pull-request/result.json'].replace('"code":0', '"code":0 '),
    })

    expect(await scenario.named()).toBeInstanceOf(RunDeliveryUncertain)
  })

  it('refuses an intent recorded by another conversation of the same slice', async () => {
    const scenario = await new RecordedPullRequestScenario().withJournal({
      ...DeliveredJournalMother.publication(),
      'intent.json': DeliveredJournalMother.text({
        ...DeliveredJournalMother.intent(), conversation: '11111111-1111-4111-8111-111111111111',
      }),
    })

    expect(await scenario.named()).toBeInstanceOf(RunDeliveryUncertain)
  })

  it('tells a journal it cannot understand apart as an uncertain delivery, not as a defect', async () => {
    const { 'receipt.json': _receipt, ...unreceipted } = DeliveredJournalMother.publication()
    const scenario = await new RecordedPullRequestScenario().withJournal(unreceipted)
    await mkdir(scenario.publicationPath('receipt.json'))

    expect(await scenario.named()).toBeInstanceOf(RunDeliveryUncertain)
  })

  it('tells a journal the disk refused to read apart as a failed delivery read, not as an uncertain one', async () => {
    const scenario = await new RecordedPullRequestScenario().withJournal(DeliveredJournalMother.publication())
    const refused = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const delivery = scenario.delivery()
    Object.assign(delivery.journal.files, { read: async () => { throw refused } })

    const failure = await delivery.recordedPullRequest(DeliveredJournalMother.watch()).catch((cause) => cause)

    expect(failure).toBeInstanceOf(RunDeliveryFailure)
    expect(failure).not.toBeInstanceOf(RunDeliveryUncertain)
    expect(failure.message).toContain('permission denied')
  })
})
