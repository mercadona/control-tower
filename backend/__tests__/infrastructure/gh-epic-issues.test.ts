import { describe, it, expect } from 'vitest'
import { GhEpicIssues } from '../../src/infrastructure/gh-epic-issues.ts'
import { EpicIssue } from '../../src/domain/value-objects/epic-issue.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { RetryPolicy, RetryBudget } from '../../src/domain/policies/retry-policy.ts'
import { SleepDouble } from '../sleep-double.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { EpicIssuesNotRead, EpicIssuesNotUnderstood, EpicIssueNotPromoted } from '../../src/domain/exceptions.ts'

class Mother {
  static REPOSITORY = new RepositoryName('mercadona/control-tower')
  static MILESTONE = 'start-in-correct-loop'

  static CAPTURE = 'gh issue list --repo mercadona/control-tower --milestone "start-in-correct-loop" --state all ' +
    '--limit 200 --json number,url,title,labels,state, captured on 2026-09-15: this fixture keeps issues #329 and ' +
    '#330 of that real listing\'s stdout verbatim, labels and all, so the parse is proved against what gh actually ' +
    'prints back and not a shape imagined for it'

  static REAL_LISTING = JSON.stringify([
    {
      labels: [
        { id: 'LA_kwDOUSCKB88AAAAC0X8Tag', name: 'status:in-progress', description: '', color: 'C5DEF5' },
        { id: 'LA_kwDOUSCKB88AAAAC1K3FEg', name: 'type:ui', description: '', color: 'B60205' },
        { id: 'LA_kwDOUSCKB88AAAAC1K3GkQ', name: 'gate:visual', description: '', color: 'FBCA04' },
        { id: 'LA_kwDOUSCKB88AAAAC1K3HPg', name: 'area:gates', description: '', color: '1D76DB' },
        { id: 'LA_kwDOUSCKB88AAAAC1K3Htg', name: 'touches:github', description: '', color: 'B60205' },
      ],
      number: 330,
      state: 'OPEN',
      title: '#5 The groom and gate 2',
      url: 'https://github.com/mercadona/control-tower/issues/330',
    },
    {
      labels: [
        { id: 'LA_kwDOUSCKB88AAAAC0X8TpQ', name: 'status:in-review', description: '', color: 'C5DEF5' },
        { id: 'LA_kwDOUSCKB88AAAAC1K3FEg', name: 'type:ui', description: '', color: 'B60205' },
        { id: 'LA_kwDOUSCKB88AAAAC1K3F-Q', name: 'touches:frontend', description: '', color: '006B75' },
        { id: 'LA_kwDOUSCKB88AAAAC1K3GkQ', name: 'gate:visual', description: '', color: 'FBCA04' },
        { id: 'LA_kwDOUSCKB88AAAAC1K3HPg', name: 'area:gates', description: '', color: '1D76DB' },
      ],
      number: 329,
      state: 'CLOSED',
      title: '#4 Gate 1 — the freeze',
      url: 'https://github.com/mercadona/control-tower/issues/329',
    },
  ])

  static noStatusLabel(): EpicIssue {
    return new EpicIssue({
      number: 1,
      url: 'https://github.com/mercadona/control-tower/issues/1',
      title: 'wears no status label at all',
      status: PlanIssueStatus.BACKLOG,
      isOpen: true,
    })
  }

  static backlog(): EpicIssue {
    return new EpicIssue({
      number: 2,
      url: 'https://github.com/mercadona/control-tower/issues/2',
      title: 'wears status:backlog',
      status: PlanIssueStatus.BACKLOG,
      isOpen: true,
    })
  }

  static inProgress(): EpicIssue {
    return new EpicIssue({
      number: 3,
      url: 'https://github.com/mercadona/control-tower/issues/3',
      title: 'wears status:in-progress',
      status: PlanIssueStatus.IN_PROGRESS,
      isOpen: true,
    })
  }

  static closedBacklog(): EpicIssue {
    return new EpicIssue({
      number: 4,
      url: 'https://github.com/mercadona/control-tower/issues/4',
      title: 'closed while still wearing status:backlog',
      status: PlanIssueStatus.BACKLOG,
      isOpen: false,
    })
  }
}

class GhDouble {
  readonly answers: ProcessOutput[]
  readonly calls: string[][]
  readonly sleeping: SleepDouble

  constructor(answers: ProcessOutput[]) {
    this.answers = answers
    this.calls = []
    this.sleeping = new SleepDouble()
  }

  static answering(...printed: string[]) {
    return new GhDouble(printed.map((stdout) => new ProcessOutput({ code: 0, stdout, stderr: '' })))
  }

  static refusing(said: string) {
    return new GhDouble([new ProcessOutput({ code: 1, stdout: '', stderr: said })])
  }

  epicIssues(): GhEpicIssues {
    return new GhEpicIssues({
      gh: new Gh({
        launch: (argv) => {
          this.calls.push(argv)
          const answer = this.answers[this.calls.length - 1]
          if (answer === undefined) {
            throw new Error(`nobody wrote an answer for call ${this.calls.length}: ${argv.join(' ')}`)
          }

          return Promise.resolve(answer)
        },
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 3, waitSeconds: 2 }) }),
        sleep: (seconds) => this.sleeping.sleep(seconds),
      }),
    })
  }

  async listed() {
    return this.epicIssues().listOf({ repository: Mother.REPOSITORY, milestone: Mother.MILESTONE })
  }

  async listingRefusal() {
    return this.listed().catch((cause) => cause)
  }

  async promoted(issue: EpicIssue) {
    return this.epicIssues().promote({ repository: Mother.REPOSITORY, issue })
  }

  async promotionRefusal(issue: EpicIssue) {
    return this.promoted(issue).catch((cause) => cause)
  }
}

describe('EpicIssue', () => {
  it('only an open issue standing at backlog is promotable', () => {
    expect(Mother.noStatusLabel().isPromotable()).toBe(true)
    expect(Mother.backlog().isPromotable()).toBe(true)
    expect(Mother.inProgress().isPromotable()).toBe(false)
    expect(Mother.closedBacklog().isPromotable()).toBe(false)
  })
})

describe('GhEpicIssues', () => {
  it('promoting adds status:ready and removes status:backlog and nothing else', () => {
    const argv = GhEpicIssues.promoteArgvFor({ repository: Mother.REPOSITORY, issue: Mother.backlog() })

    expect(argv).toEqual([
      'issue', 'edit', '2',
      '--repo', 'mercadona/control-tower',
      '--add-label', 'status:ready',
      '--remove-label', 'status:backlog',
    ])
  })

  describe(Mother.CAPTURE, () => {
    it('the milestone is listed with every state and its issues come back sorted by number', async () => {
      const gh = GhDouble.answering(Mother.REAL_LISTING)

      const issues = await gh.listed()

      expect(gh.calls).toEqual([[
        'issue', 'list',
        '--repo', 'mercadona/control-tower',
        '--milestone', 'start-in-correct-loop',
        '--state', 'all',
        '--limit', '200',
        '--json', 'number,url,title,labels,state',
      ]])
      expect(issues.map((issue) => issue.number)).toEqual([329, 330])
      expect(issues[0]).toBeInstanceOf(EpicIssue)
      expect(issues[0].isOpen).toBe(false)
      expect(issues[0].status).toBe(PlanIssueStatus.IN_REVIEW)
      expect(issues[0].title).toBe('#4 Gate 1 — the freeze')
      expect(issues[1].isOpen).toBe(true)
      expect(issues[1].status).toBe(PlanIssueStatus.IN_PROGRESS)
    })
  })

  it('a gh that failed raises EpicIssuesNotRead and unreadable json EpicIssuesNotUnderstood', async () => {
    const notRead = await GhDouble.refusing('gh: not authenticated').listingRefusal()
    const notJson = await GhDouble.answering('this is not json').listingRefusal()
    const wrongShape = await GhDouble.answering('{"not":"a list of issues"}').listingRefusal()
    const malformedIssue = await GhDouble.answering(JSON.stringify([{
      number: 330,
      url: 'https://github.com/mercadona/control-tower/issues/330',
      title: '#5 The groom and gate 2',
      labels: [{ name: 'status:ready' }],
      state: 42,
    }])).listingRefusal()

    expect(notRead).toBeInstanceOf(EpicIssuesNotRead)
    expect(notJson).toBeInstanceOf(EpicIssuesNotUnderstood)
    expect(wrongShape).toBeInstanceOf(EpicIssuesNotUnderstood)
    expect(malformedIssue).toBeInstanceOf(EpicIssuesNotUnderstood)
    expect(notRead).not.toBeInstanceOf(EpicIssuesNotUnderstood)
  })

  it('a refused edit raises EpicIssueNotPromoted naming the issue', async () => {
    const issue = Mother.backlog()
    const gh = GhDouble.refusing('gh: not authenticated')

    const refusal = await gh.promotionRefusal(issue)

    expect(refusal).toBeInstanceOf(EpicIssueNotPromoted)
    expect(refusal.message).toContain('#2')
    expect(gh.calls).toEqual([GhEpicIssues.promoteArgvFor({ repository: Mother.REPOSITORY, issue })])
  })
})
