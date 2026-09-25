import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RunDeliveryFailure, RunDeliveryUncertain } from '../../src/domain/value-objects/run-delivery.ts'
import type { CheckedRunDelivery } from '../../src/infrastructure/checked-run-delivery.ts'
import { InProcessRun, type ScriptedStep } from './fixtures/in-process-run.ts'
import { LivingProcessGroups } from './fixtures/living-process-groups.ts'
import { Capture, ScriptedConversation } from './fixtures/scripted-conversation.ts'

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
