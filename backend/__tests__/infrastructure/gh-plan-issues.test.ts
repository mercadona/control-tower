import { describe, it, expect } from 'vitest'
import { GhPlanIssues } from '../../src/infrastructure/gh-plan-issues.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { RetryPolicy, RetryBudget } from '../../src/domain/policies/retry-policy.ts'
import { SleepDouble } from '../sleep-double.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { PlanStatusNotRead, PlanStatusNotUnderstood } from '../../src/domain/exceptions.ts'

class GhDouble {
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static ISSUE_NUMBER = 7

  readonly answers: ProcessOutput[]
  readonly calls: string[][]
  readonly sleeping: SleepDouble

  constructor(answers: ProcessOutput[]) {
    this.answers = answers
    this.calls = []
    this.sleeping = new SleepDouble()
  }

  static printing(printed: string) {
    return new GhDouble([new ProcessOutput({ code: 0, stdout: printed, stderr: '' })])
  }

  static refusing(said: string) {
    return new GhDouble([new ProcessOutput({ code: 1, stdout: '', stderr: said })])
  }

  static labelled(...names: string[]) {
    return GhDouble.printing(JSON.stringify({ labels: names.map((name) => ({ name })) }))
  }

  issues() {
    return new GhPlanIssues({
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

  async statusFor() {
    return this.issues().statusOf({ issueNumber: GhDouble.ISSUE_NUMBER, repository: GhDouble.REPOSITORY })
  }
}

describe('GhPlanIssues reading the status of an issue', () => {
  it('asking_where_an_issue_stands_reads_its_labels_and_nothing_else', async () => {
    const gh = GhDouble.labelled('status:in-review')

    await gh.statusFor()

    expect(gh.calls).toEqual([[
      'issue', 'view', '7', '--repo', 'josemerca/ct-loop-sandbox', '--json', 'labels',
    ]])
  })

  it.each([
    ['status:in-review', PlanIssueStatus.IN_REVIEW],
    ['status:in-progress', PlanIssueStatus.IN_PROGRESS],
    ['status:ready', PlanIssueStatus.READY],
    ['status:backlog', PlanIssueStatus.BACKLOG],
  ])('the_label_%s_comes_back_as_the_status_the_loop_calls_it', async (label, named) => {
    expect(await GhDouble.labelled(label).statusFor()).toBe(named)
  })

  it('an_issue_wearing_no_status_label_stands_at_none_which_is_a_status_and_not_an_absence', async () => {
    expect(await GhDouble.labelled('area:plan').statusFor()).toBe(PlanIssueStatus.NONE)
  })

  it('an_issue_wearing_two_status_labels_travels_out_as_not_understood_instead_of_picking_one', async () => {
    const refusal = await GhDouble.labelled('status:in-review', 'status:in-progress')
      .statusFor().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanStatusNotUnderstood)
    expect(refusal.message).toMatch(/wears more than one status label/)
  })

  it('a_status_label_the_loop_never_declared_travels_out_as_not_understood_instead_of_passing_for_none', async () => {
    const refusal = await GhDouble.labelled('status:blocked').statusFor().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanStatusNotUnderstood)
    expect(refusal.message).toMatch(/status:blocked/)
  })

  it('gh_refusing_to_read_the_labels_travels_out_typed_instead_of_answering_a_status', async () => {
    const refusal = await GhDouble.refusing('HTTP 404').statusFor().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanStatusNotRead)
    expect(refusal).not.toBeInstanceOf(PlanStatusNotUnderstood)
    expect(refusal.message).toMatch(/gh issue view --json labels failed: HTTP 404/)
  })

  it('labels_gh_sent_in_a_shape_this_cannot_read_travel_out_as_not_understood', async () => {
    const refusal = await GhDouble.printing('{"labels":"ninguna"}').statusFor().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanStatusNotUnderstood)
    expect(refusal).not.toBeInstanceOf(PlanStatusNotRead)
  })
})
