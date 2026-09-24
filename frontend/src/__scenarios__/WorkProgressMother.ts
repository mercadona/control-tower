import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { PlanningProgressMother } from '__scenarios__/PlanningProgressMother'
import type { ActivePlan } from 'app/active-plans/ActivePlan.types'

type Answer = { status: number; body: string }

export class WorkProgressMother {
  static readonly PATH = `/work-progress/${StartPlanMother.ISSUE.number}?repo=${encodeURIComponent(StartPlanMother.REPO)}`

  static planning(state: 'writing' | 'ready' = 'writing', activity = PlanningProgressMother.running()): Answer {
    return WorkProgressMother.fromActive(WorkProgressMother.active('planning'), ImplementProgressMother.progress(), activity, state)
  }

  static implementing(execution = ImplementProgressMother.progress()): Answer {
    return WorkProgressMother.fromActive(WorkProgressMother.active('implementing'), execution)
  }

  static withLocalCompletion(active: ActivePlan): Answer {
    if (active.phase !== 'uncertain') throw new Error('local-completion scenario requires uncertain work')
    const answer = JSON.parse(WorkProgressMother.fromActive(active).body)
    answer.progress.execution = {
      kind: 'partial', detail: active.diagnostic,
      value: { pull_request: null, ...JSON.parse(ImplementProgressMother.delivered().body) },
    }
    return { status: 200, body: JSON.stringify(answer) }
  }

  static active(phase: 'planning' | 'implementing'): ActivePlan {
    return {
      phase,
      request: { id: StartPlanMother.TICKET, repo: StartPlanMother.REPO, path: StartPlanMother.PATH },
      plan: {
        id: StartPlanMother.TICKET, repo: StartPlanMother.REPO, issue: { ...StartPlanMother.ISSUE },
        agent: StartPlanMother.AGENT, branch: StartPlanMother.BRANCH, worktree: StartPlanMother.WORKTREE,
      },
    }
  }

  static fromActive(
    active: ActivePlan,
    execution = ImplementProgressMother.progress(),
    activity = PlanningProgressMother.running(),
    state: 'writing' | 'ready' = 'writing',
  ): Answer {
    const reading = (answer: Answer) => answer.status === 200
      ? { kind: 'available', value: JSON.parse(answer.body) }
      : { kind: 'unavailable', detail: JSON.parse(answer.body).detail }
    const progress = active.phase === 'uncertain'
      ? { phase: 'uncertain', diagnostic: active.diagnostic, recovery: active.recovery, refusal: active.refusal ?? null, execution: { kind: 'unavailable', detail: active.diagnostic } }
      : active.phase === 'planning'
      ? { phase: 'planning', plan: { kind: 'available', value: state }, activity: reading(activity) }
      : { phase: 'implementing', execution: execution.status === 200
          ? { kind: 'available', value: { pull_request: null, ...JSON.parse(execution.body) } }
          : reading(execution) }
    return {
      status: 200,
      body: JSON.stringify({ repo: active.plan.repo, issue: active.plan.issue.number, agent: active.plan.agent, progress }),
    }
  }
}
