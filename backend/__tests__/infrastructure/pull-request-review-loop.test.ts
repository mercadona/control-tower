import { describe, it, expect } from 'vitest'
import { ReviewWatch } from '../../src/infrastructure/review-watch.ts'
import { DispatchCheckWorkbench } from '../../src/infrastructure/dispatch-check-workbench.ts'
import { CmuxPlanAgents } from '../../src/infrastructure/cmux-plan-agents.ts'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.ts'
import { GhPullRequests } from '../../src/infrastructure/gh-pull-requests.ts'
import { GhPlanIssues } from '../../src/infrastructure/gh-plan-issues.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { RetryPolicy, RetryBudget } from '../../src/domain/policies/retry-policy.ts'
import { LaunchPolicy, LaunchBudget } from '../../src/domain/policies/launch-policy.ts'
import { ChangeAsked } from '../../src/domain/value-objects/change-asked.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { ReadFixesAsked, ReadFixesAskedParams } from '../../src/application/queries/read-fixes-asked.ts'
import { RequestFixes, RequestFixesParams } from '../../src/application/actions/request-fixes.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { MemoryReviewLog } from '../../src/infrastructure/memory-review-log.ts'

class GhProcessDouble {
  readonly answers: ProcessOutput[]
  readonly calls: string[][]

  constructor(answers: ProcessOutput[]) {
    this.answers = answers
    this.calls = []
  }

  launch(argv: string[]): Promise<ProcessOutput> {
    this.calls.push(argv)
    const answer = this.answers[this.calls.length - 1]
    if (answer === undefined) {
      throw new Error(`nobody wrote an answer for gh call ${this.calls.length}: ${argv.join(' ')}`)
    }

    return Promise.resolve(answer)
  }
}

class NodeDouble {
  readonly calls: string[][]

  constructor() {
    this.calls = []
  }

  async run(argv: string[]): Promise<ProcessOutput> {
    this.calls.push(argv)

    return new ProcessOutput({ code: 0, stdout: '', stderr: '' })
  }
}

class CmuxDouble {
  readonly calls: string[][]

  constructor() {
    this.calls = []
  }

  async run(argv: string[]): Promise<ProcessOutput> {
    this.calls.push(argv)

    return new ProcessOutput({ code: 0, stdout: '', stderr: '' })
  }
}

class Untouched {
  static readonly RUNS_IN = '/tmp/ct-plan'

  static write(path: string): Promise<void> {
    throw new Error(`asking an agent for fixes writes no launcher, it was asked to write ${path}`)
  }

  static read(path: string): Promise<string | null> {
    throw new Error(`asking an agent for fixes reads no sentinel, it was asked to read ${path}`)
  }

  static remove(path: string): Promise<void> {
    throw new Error(`asking an agent for fixes removes no sentinel, it was asked to remove ${path}`)
  }

  static sleep(): Promise<void> {
    throw new Error('asking an agent for fixes waits for no sentinel')
  }

  static realpathOf(path: string): string | null {
    throw new Error(`asking an agent for fixes resolves no directory, it was asked for ${path}`)
  }

  static policy(): LaunchPolicy {
    return new LaunchPolicy({ budget: new LaunchBudget({ attempts: 1, resends: 0 }) })
  }
}

class Sweep {
  reviews: ReviewWatch | null
  ticks: number

  constructor(reviews: ReviewWatch | null) {
    this.reviews = reviews
    this.ticks = 0
  }

  sleep(watch: PlanWatch): Promise<void> {
    this.ticks += 1
    if (this.ticks > 1) this.reviews?.stop({ issue: watch.issue.number, repository: watch.repository })

    return Promise.resolve()
  }
}

class PullRequestReviewLoop {
  static DISPATCH_CHECK = '/plugin/scripts/dispatch-check.mjs'
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static ISSUE = new PlanIssue({
    number: 7, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/7',
  })
  static AGENT = 'workspace:9'
  static CHANGE = new ChangeAsked({ id: '101', text: 'arregla el guard de []', askedAt: null })
  static PULL_REQUEST_LISTED = JSON.stringify([
    { number: 42, url: 'https://github.com/josemerca/ct-loop-sandbox/pull/42' },
  ])
  static IN_REVIEW_LABELS = JSON.stringify({ labels: [{ name: GhPlanIssues.IN_REVIEW_LABEL }] })
  static REVIEWS_PAGE = JSON.stringify([[
    { id: 101, state: 'CHANGES_REQUESTED', body: 'arregla el guard de []' },
  ]])
  static COMMENTS_PAGE = '[[]]'
  static SUBJECT = new PlanWatch({
    story: null,
    issue: PullRequestReviewLoop.ISSUE,
    located: new WorkspaceLocation({ path: '/repo/.worktrees/7', branch: 'feat/7' }),
    repository: PullRequestReviewLoop.REPOSITORY,
    agent: PullRequestReviewLoop.AGENT,
  })

  readonly node: NodeDouble
  readonly cmux: CmuxDouble
  readonly ghProcess: GhProcessDouble
  readonly pullRequests: GhPullRequests
  readonly planIssues: GhPlanIssues
  readonly brief: PlanAgentBrief

  constructor() {
    this.node = new NodeDouble()
    this.cmux = new CmuxDouble()
    this.ghProcess = new GhProcessDouble([
      new ProcessOutput({ code: 0, stdout: PullRequestReviewLoop.PULL_REQUEST_LISTED, stderr: '' }),
      new ProcessOutput({ code: 0, stdout: PullRequestReviewLoop.IN_REVIEW_LABELS, stderr: '' }),
      new ProcessOutput({ code: 0, stdout: PullRequestReviewLoop.REVIEWS_PAGE, stderr: '' }),
      new ProcessOutput({ code: 0, stdout: PullRequestReviewLoop.COMMENTS_PAGE, stderr: '' }),
    ])
    const gh = new Gh({
      launch: (argv) => this.ghProcess.launch(argv),
      policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 3, waitSeconds: 2 }) }),
      sleep: () => Promise.resolve(),
    })
    this.pullRequests = new GhPullRequests({ gh })
    this.planIssues = new GhPlanIssues({ gh, stderr: () => {} })
    this.brief = new PlanAgentBrief({
      dispatchCheck: PullRequestReviewLoop.DISPATCH_CHECK,
      conventions: '/plugin/conventions',
      ctStep: '/plugin/scripts/ct-step.mjs',
    })
  }

  #graph(): ReviewWatch {
    const readFixesAsked = new ReadFixesAsked({ pullRequests: this.pullRequests, planIssues: this.planIssues })
    const workbench = new DispatchCheckWorkbench({
      node: (argv) => this.node.run(argv),
      dispatchCheck: PullRequestReviewLoop.DISPATCH_CHECK,
    })
    const planAgents = new CmuxPlanAgents({
      brief: this.brief,
      run: (argv) => this.cmux.run(argv),
      write: Untouched.write,
      read: Untouched.read,
      remove: Untouched.remove,
      sleep: Untouched.sleep,
      realpathOf: Untouched.realpathOf,
      runsIn: Untouched.RUNS_IN,
      policy: Untouched.policy(),
    })
    const requestFixes = new RequestFixes({ workbench, planAgents })
    const sweep = new Sweep(null)
    const reviews = new ReviewWatch({
      asked: (watch) => readFixesAsked.execute(new ReadFixesAskedParams(watch)),
      review: (params) => requestFixes.execute(new RequestFixesParams(params)),
      sleep: () => sweep.sleep(PullRequestReviewLoop.SUBJECT),
      stderr: () => {},
      label: 'pull request review watch',
      log: new MemoryReviewLog(),
    })
    sweep.reviews = reviews

    return reviews
  }

  async run(): Promise<void> {
    return this.#graph().start(PullRequestReviewLoop.SUBJECT)
  }
}

describe('the pull request review loop composed end to end, only gh, node and cmux doubled', () => {
  it('reopens_the_exact_issue_the_review_named_instead_of_sending_undefined_to_dispatch_check', async () => {
    const loop = new PullRequestReviewLoop()

    await loop.run()

    expect(loop.node.calls).toEqual([[
      PullRequestReviewLoop.DISPATCH_CHECK, '7', '--repo', 'josemerca/ct-loop-sandbox', '--reopen',
    ]])
  })

  it('types_an_errand_naming_the_real_issue_instead_of_issue_hash_undefined', async () => {
    const loop = new PullRequestReviewLoop()

    await loop.run()

    const expectedErrand = loop.brief.fixErrandFor({
      issueNumber: 7,
      repository: PullRequestReviewLoop.REPOSITORY,
      changes: PullRequestReviewLoop.CHANGE.text,
    })
    expect(loop.cmux.calls).toEqual([
      ['send', '--workspace', PullRequestReviewLoop.AGENT, expectedErrand],
      ['send-key', '--workspace', PullRequestReviewLoop.AGENT, 'Enter'],
    ])
    expect(expectedErrand).toContain('#7')
    expect(expectedErrand).not.toContain('undefined')
  })

  it('the_real_gh_pull_requests_adapter_reads_the_reviews_and_the_comments_as_a_get_and_never_as_a_write', async () => {
    const loop = new PullRequestReviewLoop()

    await loop.run()

    expect(loop.ghProcess.calls).toEqual([
      [
        'pr', 'list', '--repo', 'josemerca/ct-loop-sandbox',
        '--head', 'feat/7', '--state', 'open', '--json', 'number,url', '--limit', '1',
      ],
      [
        'issue', 'view', '7', '--repo', 'josemerca/ct-loop-sandbox', '--json', 'labels',
      ],
      [
        'api', 'repos/josemerca/ct-loop-sandbox/pulls/42/reviews',
        '-f', 'per_page=100', '--paginate', '--slurp', '--method', 'GET',
      ],
      [
        'api', 'repos/josemerca/ct-loop-sandbox/pulls/42/comments',
        '-f', 'per_page=100', '--paginate', '--slurp', '--method', 'GET',
      ],
    ])
    for (const argv of loop.ghProcess.calls) {
      if (argv[0] === 'api' && argv.includes('-f')) expect(argv).toEqual(expect.arrayContaining(['--method', 'GET']))
    }
  })
})
