import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import type { CheckedRunDelivery } from '../../src/infrastructure/checked-run-delivery.ts'
import type { ProcessTable } from '../../src/infrastructure/process-table.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { Capture } from './fixtures/scripted-conversation.ts'
import { InProcessRun, type ScriptedStep } from './fixtures/in-process-run.ts'
import { LivingProcessGroups } from './fixtures/living-process-groups.ts'
import { ScratchOrigin } from './fixtures/scratch-origin.ts'
import { ScriptedGitHub } from './fixtures/scripted-github.ts'
import { ScriptedRelease } from './fixtures/scripted-release.ts'

const DELIVERED_STEPS: readonly ScriptedStep[] = [
  'implement', 'controls', 'judge', 'commit', 'reconcile-clean', 'global', 'slice-judge', 'delivered',
]

class PublicationScenario {
  static readonly BRANCH = 'feat/7'
  static readonly SHA = Capture.read('git', 'rev-parse-worktree-pinned').stdout.trim()
  static readonly REVIEW_FIX_SHA = 'a9e84013456ff85edbe36613e3a4cfcc78c7c224'

  static async arranged(): Promise<{
    run: InProcessRun, watch: PlanWatch, table: LivingProcessGroups,
    origin: ScratchOrigin, github: ScriptedGitHub, release: ScriptedRelease, delivery: CheckedRunDelivery,
  }> {
    const run = await InProcessRun.create([])
    const watch = await run.journaled(DELIVERED_STEPS)
    await run.intended(watch, PublicationScenario.SHA)
    const table = new LivingProcessGroups([])
    const origin = new ScratchOrigin({ branch: PublicationScenario.BRANCH })
    PublicationScenario.#registerGitAnswers(origin, run.checkout)
    const github = new ScriptedGitHub({ sha: PublicationScenario.SHA })
    const release = new ScriptedRelease(github)
    const delivery = PublicationScenario.rebuild(run, table, origin, github, release)
    return { run, watch, table, origin, github, release, delivery }
  }

  static rebuild(
    run: InProcessRun,
    table: ProcessTable,
    origin: ScratchOrigin,
    github: ScriptedGitHub,
    release: ScriptedRelease,
  ): CheckedRunDelivery {
    return run.checkedDelivery({ git: origin, table, github, release })
  }

  static async successfulReleaseDirectory(state: string, watch: PlanWatch): Promise<string> {
    const releases = join(state, 'harness', watch.agent, 'run', 'publication', 'release')
    for (const name of await fs.readdir(releases)) {
      const path = join(releases, name, 'result.json')
      const present = await fs.stat(path).then(() => true, () => false)
      if (!present) continue
      const result = JSON.parse(await fs.readFile(path, 'utf8'))
      if (result.code === 0) return join(releases, name)
    }
    throw new Error(`${releases} has no successful release attempt`)
  }

  static async releaseDispositionCount(state: string, watch: PlanWatch): Promise<number> {
    const releases = join(state, 'harness', watch.agent, 'run', 'publication', 'release')
    let count = 0
    for (const name of await fs.readdir(releases)) {
      if (await fs.stat(join(releases, name, 'disposition.json')).then(() => true, () => false)) count += 1
    }
    return count
  }

  static #registerGitAnswers(origin: ScratchOrigin, checkout: string): void {
    origin
      .answering(
        { binary: 'git', argv: ['-C', checkout, 'symbolic-ref', '--quiet', '--short', 'HEAD'] },
        Capture.read('git', 'symbolic-ref-feat-7'),
      )
      .answering(
        { binary: 'git', argv: ['-C', checkout, 'rev-parse', 'HEAD'] },
        Capture.read('git', 'rev-parse-worktree-pinned'),
      )
      .answering(
        { binary: 'git', argv: ['-C', checkout, 'status', '--porcelain', '--untracked-files=all'] },
        Capture.read('git', 'status-clean'),
      )
      .answering(
        { binary: 'git', argv: ['-C', checkout, 'worktree', 'list', '--porcelain'] },
        PublicationScenario.#worktreeList(checkout),
      )
      .answering(
        { binary: 'git', argv: ['-C', checkout, 'remote', 'get-url', '--all', 'origin'] },
        Capture.read('git', 'remote-get-url-widget'),
      )
      .answering(
        { binary: 'git', argv: ['-C', checkout, 'remote', 'get-url', '--push', '--all', 'origin'] },
        Capture.read('git', 'remote-get-url-widget'),
      )
      .answering(
        {
          binary: 'git',
          argv: ['-C', checkout, 'merge-base', '--is-ancestor', PublicationScenario.SHA, PublicationScenario.SHA],
        },
        Capture.read('git', 'merge-base-is-ancestor-true'),
      )
      .answering(
        {
          binary: 'git',
          argv: [
            '-C', checkout, 'merge-base', '--is-ancestor', PublicationScenario.SHA, PublicationScenario.REVIEW_FIX_SHA,
          ],
        },
        Capture.read('git', 'merge-base-is-ancestor-true'),
      )
  }

  static #worktreeList(checkout: string): Capture {
    const template = Capture.read('git', 'worktree-list-single')
    return new Capture({
      command: template.command, version: template.version, date: template.date, code: template.code,
      stdout: template.stdout.replaceAll('<worktree>', checkout), stderr: template.stderr,
    })
  }
}

describe('a whole publication runs in process', () => {
  const runs: InProcessRun[] = []

  afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.remove()))
  })

  it('pins and pushes the revision, creates one exact PR, and retries only the checked release', async () => {
    const { run, watch, table, origin, github, release, delivery } = await PublicationScenario.arranged()
    runs.push(run)
    release.next({ kind: 'refused' })
    release.next({ kind: 'released' })

    await expect(delivery.deliver(watch)).rejects.toThrow('checked release failed')
    await delivery.deliver(watch)

    expect(github.pulls).toHaveLength(1)
    expect(release.releases).toHaveLength(2)
    expect(origin.remote).toBe(PublicationScenario.SHA)

    await delivery.deliver(watch)
    expect(release.releases).toHaveLength(2)

    expect(await delivery.inspect(watch)).toEqual({
      kind: 'delivered', pullRequest: { number: ScriptedGitHub.PULL_NUMBER, url: ScriptedGitHub.URL },
    })

    github.pulls[0].headRefOid = PublicationScenario.REVIEW_FIX_SHA
    origin.advance(PublicationScenario.REVIEW_FIX_SHA)
    const restarted = PublicationScenario.rebuild(run, table, origin, github, release)

    expect(await restarted.inspect(watch)).toEqual({
      kind: 'delivered', pullRequest: { number: ScriptedGitHub.PULL_NUMBER, url: ScriptedGitHub.URL },
    })
  })

  it.each([
    ['malformed receipt', async (state: string, watch: PlanWatch) => {
      const path = join(state, 'harness', watch.agent, 'run', 'publication', 'receipt.json')
      await fs.writeFile(path, `${JSON.stringify({
        version: 1, at: '2026-09-25T09:00:00.000Z', sha: PublicationScenario.SHA, pullRequest: {},
      })}\n`)
    }],
    ['orphan release result', async (state: string, watch: PlanWatch) => {
      const directory = await PublicationScenario.successfulReleaseDirectory(state, watch)
      await fs.rm(join(directory, 'request.json'))
    }],
    ['wrong release command', async (state: string, watch: PlanWatch) => {
      const path = join(await PublicationScenario.successfulReleaseDirectory(state, watch), 'result.json')
      const result = JSON.parse(await fs.readFile(path, 'utf8'))
      await fs.writeFile(path, `${JSON.stringify({ ...result, command: 'not-node' })}\n`)
    }],
    ['failed release predecessor', async (state: string, watch: PlanWatch) => {
      const path = join(await PublicationScenario.successfulReleaseDirectory(state, watch), 'result.json')
      const result = JSON.parse(await fs.readFile(path, 'utf8'))
      await fs.writeFile(path, `${JSON.stringify({ ...result, code: 7 })}\n`)
    }],
  ])('keeps %s inspection-only instead of manufacturing delivery', async (_case, corrupt) => {
    const { run, watch, table, origin, github, release, delivery } = await PublicationScenario.arranged()
    runs.push(run)
    release.next({ kind: 'refused' })
    release.next({ kind: 'released' })

    await expect(delivery.deliver(watch)).rejects.toThrow('checked release failed')
    await delivery.deliver(watch)
    await corrupt(run.state, watch)

    const before = release.releases.length
    const rebuilt = PublicationScenario.rebuild(run, table, origin, github, release)

    expect((await rebuilt.inspect(watch)).kind).toBe('uncertain')
    await expect(PublicationScenario.rebuild(run, table, origin, github, release).deliver(watch)).rejects.toThrow()
    expect(release.releases).toHaveLength(before)
  })

  it('adopts the single PR created before an interrupted response instead of creating another', async () => {
    const { run, watch, table, origin, github, release, delivery } = await PublicationScenario.arranged()
    runs.push(run)
    release.next({ kind: 'refused' })
    release.next({ kind: 'released' })
    const finishCreate = github.holdNextCreate('before')

    const interrupted = delivery.deliver(watch)
    void interrupted.catch(() => {})
    await vi.waitFor(() => expect(github.pulls).toHaveLength(1))

    await expect(PublicationScenario.rebuild(run, table, origin, github, release).deliver(watch))
      .rejects.toThrow('checked release failed')
    await PublicationScenario.rebuild(run, table, origin, github, release).deliver(watch)

    expect(github.pulls).toHaveLength(1)
    finishCreate()
    await expect(interrupted).rejects.toThrow('conflicting journal evidence')
  })

  it('reads a live publication as publishing and only its own pull request creation as in flight', async () => {
    const { run, watch, table, origin, github, release, delivery } = await PublicationScenario.arranged()
    runs.push(run)
    release.next({ kind: 'refused' })
    const finishCreate = github.holdNextCreate('after')

    const publishing = delivery.deliver(watch)
    void publishing.catch(() => {})
    await vi.waitFor(async () => expect(await delivery.inspect(watch)).toEqual({
      kind: 'publishing', pullRequest: null, diagnostic: 'pull request creation is in flight',
    }))

    expect(await PublicationScenario.rebuild(run, table, origin, github, release).inspect(watch)).toEqual({
      kind: 'uncertain', pullRequest: null, diagnostic: 'pull request creation has an unknown effect',
    })
    finishCreate()
    await expect(publishing).rejects.toThrow('checked release failed')
  })
})

describe('a living release group holds back the next release', () => {
  const runs: InProcessRun[] = []
  const GROUP = 4343

  afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.remove()))
  })

  it('does not start a second checked release while the recorded release group is alive', async () => {
    const { run, watch, table, origin, github, release, delivery } = await PublicationScenario.arranged()
    runs.push(run)
    table.alive.add(-GROUP)
    release.next({ kind: 'held', group: GROUP })

    const held = delivery.deliver(watch)
    void held.catch(() => {})
    await vi.waitFor(async () => expect(await PublicationScenario.rebuild(run, table, origin, github, release).inspect(watch))
      .toMatchObject({ kind: 'publishing', diagnostic: expect.stringContaining('is still running') }))
    expect(release.releases).toHaveLength(1)

    release.finish(new ProcessOutput({ code: 9, stdout: '', stderr: 'interrupted\n' }))
    await expect(held).rejects.toThrow('checked release failed')

    table.alive.delete(-GROUP)
    release.next({ kind: 'released' })
    await PublicationScenario.rebuild(run, table, origin, github, release).deliver(watch)
    expect(release.releases).toHaveLength(2)
  })

  it('does not replay a failed release result while its owned process group has a live descendant', async () => {
    const { run, watch, table, origin, github, release, delivery } = await PublicationScenario.arranged()
    runs.push(run)
    table.alive.add(-GROUP)
    release.next({ kind: 'refused', group: GROUP })

    await expect(delivery.deliver(watch)).rejects.toThrow('checked release failed')
    expect(await PublicationScenario.rebuild(run, table, origin, github, release).inspect(watch)).toMatchObject({
      kind: 'publishing', diagnostic: expect.stringContaining(`process group ${GROUP} is still running`),
    })
    await expect(PublicationScenario.rebuild(run, table, origin, github, release).deliver(watch)).rejects.toThrow('may still be running')
    expect(release.releases).toHaveLength(1)

    table.alive.delete(-GROUP)
    release.next({ kind: 'released' })
    await PublicationScenario.rebuild(run, table, origin, github, release).deliver(watch)
    expect(release.releases).toHaveLength(2)
  })

  it('loses the result writer, waits for the surviving checked-release group, and survives another lost retry writer', async () => {
    const { run, watch, table, origin, github, release, delivery } = await PublicationScenario.arranged()
    runs.push(run)
    table.alive.add(-GROUP)
    release.next({ kind: 'lost', group: GROUP })
    release.next({ kind: 'lost', group: GROUP })
    release.next({ kind: 'released' })

    await expect(delivery.deliver(watch)).rejects.toThrow('the checked release process was lost')
    await expect(PublicationScenario.rebuild(run, table, origin, github, release).deliver(watch)).rejects.toThrow('may still be running')

    table.alive.delete(-GROUP)
    await expect(PublicationScenario.rebuild(run, table, origin, github, release).deliver(watch)).rejects.toThrow('the checked release process was lost')
    await PublicationScenario.rebuild(run, table, origin, github, release).deliver(watch)

    expect(await PublicationScenario.rebuild(run, table, origin, github, release).inspect(watch)).toEqual({
      kind: 'delivered', pullRequest: { number: ScriptedGitHub.PULL_NUMBER, url: ScriptedGitHub.URL },
    })
    expect(await PublicationScenario.releaseDispositionCount(run.state, watch)).toBe(2)
  })
})
