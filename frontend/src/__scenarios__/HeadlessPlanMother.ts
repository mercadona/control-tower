import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { WorkflowSnapshot } from 'app/workflow-snapshot/storage'

type Answer = { status: number; body: string }
type HeadlessPhase = 'planning' | 'implementing' | 'uncertain'
type RecoveryAction = 'observe' | 'continue' | 'cleanup' | 'inspect'

class DeferredHeadlessPlanChanges {
  private pending: Array<(response: Response) => void> = []

  readonly read = vi.fn((input?: string | URL | Request) => {
    if (input !== undefined && input !== '/active-plans') return Promise.resolve(new Response('{}', { status: 400 }))
    return new Promise<Response>((resolve) => this.pending.push(resolve))
  })

  activeReadCount() {
    return this.read.mock.calls.filter(([input]) => input === undefined || input === '/active-plans').length
  }

  answerWith(answer: Answer) {
    const resolve = this.pending.shift()
    if (resolve === undefined) throw new Error('no active-plans read is pending')
    resolve(new Response(answer.body, { status: answer.status }))
  }
}

class HeadlessPlanMother {
  static empty(): Answer {
    return { status: 200, body: '{"plans":[]}' }
  }

  static planning(): Answer {
    return HeadlessPlanMother.active('planning')
  }

  static implementing(): Answer {
    return HeadlessPlanMother.active('implementing')
  }

  static uncertain(): Answer {
    return HeadlessPlanMother.active('uncertain', 'inspect')
  }

  static awaitingObservation(): Answer {
    return HeadlessPlanMother.active('uncertain', 'observe')
  }

  static awaitingContinuation(): Answer {
    return HeadlessPlanMother.active('uncertain', 'continue')
  }

  static unlaunched(): Answer {
    return HeadlessPlanMother.active('uncertain', 'cleanup')
  }

  static deferredChanges(): DeferredHeadlessPlanChanges {
    return new DeferredHeadlessPlanChanges()
  }

  static slicesInFlight(...issues: number[]): Answer {
    return { status: 200, body: JSON.stringify({ plans: issues.map((issue) => HeadlessPlanMother.slice(issue)) }) }
  }

  static workflowOfSlice(issue: number): WorkflowSnapshot {
    const { request, plan } = HeadlessPlanMother.slice(issue)
    return { phase: 'implementing', request, plan }
  }

  static agentFor(issue: number): string {
    return `conversation-of-${issue}`
  }

  private static slice(issue: number) {
    return {
      phase: 'implementing',
      request: { id: null, repo: StartPlanMother.REPO, path: StartPlanMother.PATH },
      plan: {
        id: null,
        repo: StartPlanMother.REPO,
        issue: { number: issue, url: `https://github.com/${StartPlanMother.REPO}/issues/${issue}` },
        agent: HeadlessPlanMother.agentFor(issue),
        branch: `feat/${issue}`,
        worktree: `${StartPlanMother.PATH}/.worktrees/${issue}`,
      },
    }
  }

  private static active(phase: HeadlessPhase, recovery?: RecoveryAction): Answer {
    return {
      status: 200,
      body: JSON.stringify({
        plans: [{
          phase,
          ...(recovery === undefined ? {} : {
            diagnostic: `Recovery action ${recovery} requires operator attention`,
            recovery: { action: recovery, detail: `Use ${recovery} for the recorded call` },
          }),
          request: { id: StartPlanMother.TICKET, repo: StartPlanMother.REPO, path: StartPlanMother.PATH },
          plan: {
            id: StartPlanMother.TICKET,
            repo: StartPlanMother.REPO,
            issue: StartPlanMother.ISSUE,
            agent: StartPlanMother.AGENT,
            branch: StartPlanMother.BRANCH,
            worktree: StartPlanMother.WORKTREE,
          },
        }],
      }),
    }
  }
}

export { HeadlessPlanMother }
