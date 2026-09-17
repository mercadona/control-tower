import * as fs from 'node:fs/promises'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GhPlanPublication } from '../../src/infrastructure/gh-plan-publication.ts'
import { PlanContractProgress } from '../../src/infrastructure/plan-contract-progress.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { RetryBudget, RetryPolicy } from '../../src/domain/policies/retry-policy.ts'
import type { PlanStateValue } from '../../src/domain/value-objects/plan-state.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { PlanProgressNotRead } from '../../src/domain/exceptions.ts'

class ProgressDouble extends PlanContractProgress {
  readonly state: PlanStateValue

  constructor(state: PlanStateValue = 'ready') {
    super({
      dispatchCheck: '/plugin/dispatch-check.mjs',
      node: async () => new ProcessOutput({ code: 1, stdout: '', stderr: 'unexpected progress command' }),
      git: async () => new ProcessOutput({ code: 1, stdout: '', stderr: 'unexpected progress command' }),
    })
    this.state = state
  }

  override async of(): Promise<PlanStateValue> {
    return this.state
  }
}

class PublicationMother {
  static readonly PLAN_PATH = 'docs/superpowers/plans/2026-09-16-issue-42-publish.md'
  static readonly PLAN = '# Plan\n\nCommitted body.\n'
  static readonly HASH = 'a'.repeat(64)
  static readonly WORKTREE = '/repo/.worktrees/42'

  readonly roots: string[]
  readonly gitCalls: string[][]
  readonly ghCalls: string[][]
  readonly postedBodies: string[]
  readonly plan: string
  readonly paths: string[]
  readonly comments: { body: string }[][][]
  readonly postAnswers: ProcessOutput[]
  readonly state: PlanStateValue

  private constructor(
    roots: string[],
    plan: string,
    paths: string[],
    comments: { body: string }[][][],
    postAnswers: ProcessOutput[],
    state: PlanStateValue,
  ) {
    this.roots = roots
    this.gitCalls = []
    this.ghCalls = []
    this.postedBodies = []
    this.plan = plan
    this.paths = paths
    this.comments = comments
    this.postAnswers = postAnswers
    this.state = state
  }

  static committed(roots: string[]): PublicationMother {
    return new PublicationMother(
      roots,
      PublicationMother.PLAN,
      [PublicationMother.PLAN_PATH],
      [[[]]],
      [new ProcessOutput({ code: 0, stdout: '', stderr: '' })],
      'ready',
    )
  }

  static uncommitted(roots: string[]): PublicationMother {
    const scenario = PublicationMother.committed(roots)
    return new PublicationMother(
      roots, scenario.plan, scenario.paths, scenario.comments, scenario.postAnswers, 'writing'
    )
  }

  static ambiguous(roots: string[]): PublicationMother {
    const scenario = PublicationMother.committed(roots)
    return new PublicationMother(
      roots,
      scenario.plan,
      [PublicationMother.PLAN_PATH, 'docs/superpowers/plans/2026-09-16-issue-42-other.md'],
      scenario.comments,
      scenario.postAnswers,
      scenario.state,
    )
  }

  static matchingOnRetry(roots: string[]): PublicationMother {
    const scenario = new PublicationMother(
      roots,
      PublicationMother.PLAN,
      [PublicationMother.PLAN_PATH],
      [[[]], [[{ body: '' }]]],
      [new ProcessOutput({ code: 0, stdout: '', stderr: '' })],
      'ready',
    )
    scenario.comments[1][0][0] = { body: scenario.body() }
    return scenario
  }

  static lostWriteResponse(roots: string[]): PublicationMother {
    const scenario = new PublicationMother(
      roots,
      PublicationMother.PLAN,
      [PublicationMother.PLAN_PATH],
      [[[]], [[{ body: '' }]]],
      [new ProcessOutput({ code: 1, stdout: '', stderr: 'unexpected EOF' })],
      'ready',
    )
    scenario.comments[1][0][0] = { body: scenario.body() }
    return scenario
  }

  static largePlan(roots: string[], plan: string): PublicationMother {
    return new PublicationMother(
      roots,
      plan,
      [PublicationMother.PLAN_PATH],
      [[[]]],
      Array.from({ length: 3 }, () => new ProcessOutput({ code: 0, stdout: '', stderr: '' })),
      'ready',
    )
  }

  static differentMarker(roots: string[]): PublicationMother {
    const scenario = PublicationMother.committed(roots)
    scenario.comments[0][0].push({ body: scenario.body('different committed body') })
    return scenario
  }

  watch(): PlanWatch {
    return new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: 42, url: 'https://github.com/owner/name/issues/42' }),
      located: new WorkspaceLocation({ path: PublicationMother.WORKTREE, branch: 'feat/42' }),
      repository: new RepositoryName('owner/name'),
      agent: '11111111-1111-4111-8111-111111111111',
    })
  }

  async publication(): Promise<GhPlanPublication> {
    const root = await mkdtemp(join(tmpdir(), 'ct-plan-publication-'))
    this.roots.push(root)
    const files = new HeadlessFiles({ root, fs, newId: () => 'temporary' })
    const gh = new Gh({
      launch: async (argv) => {
        this.ghCalls.push(argv)
        if (argv[0] === 'api') {
          const answer = this.comments.shift()
          if (answer === undefined) throw new Error(`nobody wrote an answer for gh ${argv.join(' ')}`)
          return new ProcessOutput({ code: 0, stdout: JSON.stringify(answer), stderr: '' })
        }
        if (argv[0] === 'issue' && argv[1] === 'comment') {
          this.postedBodies.push(await readFile(argv[argv.indexOf('--body-file') + 1], 'utf8'))
          const answer = this.postAnswers.shift()
          if (answer === undefined) throw new Error(`nobody wrote an answer for gh ${argv.join(' ')}`)
          return answer
        }
        throw new Error(`nobody wrote an answer for gh ${argv.join(' ')}`)
      },
      policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 1, waitSeconds: 0 }) }),
      sleep: async () => undefined,
    })
    return new GhPlanPublication({
      gh,
      git: async (argv) => {
        this.gitCalls.push(argv)
        if (argv.includes('ls-tree')) {
          return new ProcessOutput({ code: 0, stdout: `${this.paths.join('\n')}\n`, stderr: '' })
        }
        if (argv.includes('show')) {
          return new ProcessOutput({ code: 0, stdout: this.plan, stderr: '' })
        }
        throw new Error(`nobody wrote an answer for git ${argv.join(' ')}`)
      },
      progress: new ProgressDouble(this.state),
      files,
      digest: () => PublicationMother.HASH,
    })
  }

  body(plan = this.plan): string {
    return `Plan ${PublicationMother.HASH} — part 1/1\nSource: ${PublicationMother.PLAN_PATH}\n\n${plan}`
  }

  bodyPath(root: string): string {
    return join(
      root,
      'harness',
      '11111111-1111-4111-8111-111111111111',
      'publication',
      PublicationMother.HASH,
      'part-1.md',
    )
  }
}

describe('GhPlanPublication', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('the committed plan is posted and no approval reply is requested', async () => {
    const scenario = PublicationMother.committed(roots)
    const publication = await scenario.publication()

    await publication.publish(scenario.watch())

    expect(scenario.gitCalls).toEqual([
      ['-C', PublicationMother.WORKTREE, 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'docs/superpowers/plans'],
      ['-C', PublicationMother.WORKTREE, 'show', `HEAD:${PublicationMother.PLAN_PATH}`],
    ])
    expect(scenario.ghCalls.map((argv) => argv.slice(0, 2))).toEqual([
      ['api', 'repos/owner/name/issues/42/comments'],
      ['issue', 'comment'],
    ])
    expect(scenario.ghCalls[0]).toEqual([
      'api', 'repos/owner/name/issues/42/comments', '--paginate', '--slurp',
    ])
    expect(scenario.ghCalls[1]).toEqual([
      'issue', 'comment', '42', '--repo', 'owner/name', '--body-file', scenario.bodyPath(roots[0]),
    ])
    expect(scenario.postedBodies).toEqual([
      scenario.body(),
    ])
  })

  it('uncommitted invalid and ambiguous plans are not published', async () => {
    const uncommitted = PublicationMother.uncommitted(roots)
    const ambiguous = PublicationMother.ambiguous(roots)

    const uncommittedFailure = await (await uncommitted.publication())
      .publish(uncommitted.watch()).catch((cause) => cause)
    const ambiguousFailure = await (await ambiguous.publication())
      .publish(ambiguous.watch()).catch((cause) => cause)

    expect(uncommittedFailure).toBeInstanceOf(PlanProgressNotRead)
    expect(uncommittedFailure.message).toBe('the plan for #42 is writing, not ready for publication')
    expect(ambiguousFailure).toBeInstanceOf(PlanProgressNotRead)
    expect(ambiguousFailure.message).toContain('expected exactly one committed plan for #42, found 2')
    expect(uncommitted.ghCalls).toEqual([])
    expect(ambiguous.ghCalls).toEqual([])
  })

  it('already matching parts are not posted again', async () => {
    const scenario = PublicationMother.matchingOnRetry(roots)
    const publication = await scenario.publication()

    await publication.publish(scenario.watch())
    await publication.publish(scenario.watch())

    expect(scenario.postedBodies).toEqual([scenario.body()])
    expect(scenario.ghCalls.map((argv) => argv[0])).toEqual(['api', 'issue', 'api'])
  })

  it('an unreadable existing publication part is a typed failure and nothing is published', async () => {
    const scenario = PublicationMother.committed(roots)
    const publication = await scenario.publication()
    const path = scenario.bodyPath(roots[0])
    await fs.mkdir(path, { recursive: true })

    const failure = await publication.publish(scenario.watch()).catch((cause) => cause)

    expect(failure).toBeInstanceOf(PlanProgressNotRead)
    expect(failure.message).toContain(path)
    expect(failure.message).toContain('EISDIR')
    expect(scenario.ghCalls).toEqual([])
  })

  it('a lost write response is read back rather than blindly retried', async () => {
    const scenario = PublicationMother.lostWriteResponse(roots)

    await (await scenario.publication()).publish(scenario.watch())

    expect(scenario.ghCalls.map((argv) => argv[0])).toEqual(['api', 'issue', 'api'])
    expect(scenario.postedBodies).toEqual([scenario.body()])
  })

  it('large plans are published in full without splitting a surrogate pair', async () => {
    const firstPayloadUnits = 60_000 - PublicationMother.committed(roots).body('').length
    const plan = `${'a'.repeat(firstPayloadUnits - 1)}😀${'b'.repeat(100)}\n`
    const scenario = PublicationMother.largePlan(roots, plan)

    await (await scenario.publication()).publish(scenario.watch())

    expect(scenario.postedBodies.length).toBeGreaterThan(1)
    expect(scenario.postedBodies.every((body) => body.length <= 60_000)).toBe(true)
    const payloads = scenario.postedBodies.map((body) => body.slice(body.indexOf('\n\n') + 2))
    expect(payloads.join('')).toBe(plan)
    expect(payloads.every((payload) => {
      const last = payload.charCodeAt(payload.length - 1)
      return payload.length === 0 || last < 0xD800 || last > 0xDBFF
    })).toBe(true)
  })

  it('a marker with different content is not publication evidence', async () => {
    const scenario = PublicationMother.differentMarker(roots)

    await (await scenario.publication()).publish(scenario.watch())

    expect(scenario.postedBodies).toEqual([scenario.body()])
  })
})
