import type { RecoveryAction } from 'app/active-plans/ActivePlan.types'

type WireSliceLine = Record<string, unknown>
type WireAnswer = { status: number; body: string }

export class MilestoneProgressMother {
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'
  static readonly MILESTONE = 'The focused view follows the story through implementation'

  static none(): WireAnswer {
    return { status: 200, body: '{"status":"none"}' }
  }

  static answer(issues: WireSliceLine[], milestone = MilestoneProgressMother.MILESTONE): WireAnswer {
    const delivered = issues.filter((issue) => issue.state === 'delivered').length

    return {
      status: 200,
      body: JSON.stringify({
        status: 'milestone',
        target: MilestoneProgressMother.TARGET,
        milestone,
        delivered,
        total: issues.length,
        issues,
      }),
    }
  }

  static pending(number: number): WireSliceLine {
    return MilestoneProgressMother.#base(number, { state: 'pending' })
  }

  static running(number: number, overrides: Partial<WireSliceLine> = {}): WireSliceLine {
    return {
      ...MilestoneProgressMother.#base(number, {
        state: 'running',
        step: 'implement',
        task: 2,
        total_tasks: 4,
        step_started_at: '2026-09-25T09:00:00.000Z',
        last_tool: { name: 'Edit', argument: 'src/a.ts' },
        last_text: 'ready',
      }),
      ...overrides,
    }
  }

  static delivered(number: number): WireSliceLine {
    return MilestoneProgressMother.#base(number, {
      state: 'delivered',
      pull_request: { number: 900 + number, url: `https://github.com/owner/name/pull/${900 + number}` },
    })
  }

  static vetoed(number: number): WireSliceLine {
    return MilestoneProgressMother.#base(number, {
      state: 'needs-person',
      attention: { kind: 'veto', task: 3, findings: 'the endpoint returned 500 on the boundary case', verdict: 'failed' },
    })
  }

  static uncertain(number: number, action: RecoveryAction): WireSliceLine {
    return MilestoneProgressMother.#base(number, {
      state: 'needs-person',
      attention: { kind: 'uncertain', action, detail: 'the worktree could not be reached' },
    })
  }

  static partial(number: number): WireSliceLine {
    return MilestoneProgressMother.#base(number, {
      state: 'needs-person',
      attention: { kind: 'partial', detail: 'the pull request could not be confirmed' },
    })
  }

  static unreadable(number: number): WireSliceLine {
    return MilestoneProgressMother.#base(number, {
      state: 'needs-person',
      attention: { kind: 'unreadable', detail: 'the run journal could not be parsed' },
    })
  }

  static #base(number: number, overrides: Partial<WireSliceLine>): WireSliceLine {
    return {
      number,
      url: `https://github.com/owner/name/issues/${number}`,
      title: `Slice #${number}`,
      state: 'pending',
      step: null,
      task: null,
      total_tasks: null,
      step_started_at: null,
      last_tool: null,
      last_text: null,
      pull_request: null,
      attention: null,
      baseline_red: false,
      tasks: [],
      ...overrides,
    }
  }
}
