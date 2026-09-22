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
  static JUDGE_FINDINGS = '- [high] src/pago.ts:41: the amount is rounded before the discount'

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

  static uncertainAmong(uncertain: number, action: RecoveryAction, ...others: number[]): Answer {
    const plans = [uncertain, ...others].map((issue) => (issue === uncertain
      ? {
        ...HeadlessPlanMother.slice(issue),
        phase: 'uncertain',
        diagnostic: HeadlessPlanMother.uncertainDiagnostic(issue),
        recovery: { action, detail: `la accion registrada es ${action}` },
      }
      : HeadlessPlanMother.slice(issue)))

    return { status: 200, body: JSON.stringify({ plans }) }
  }

  static vetoedByTheJudge(issue: number, ...others: number[]): Answer {
    const plans = [issue, ...others].map((number) => (number === issue
      ? {
        ...HeadlessPlanMother.slice(number),
        phase: 'uncertain',
        diagnostic: HeadlessPlanMother.uncertainDiagnostic(number),
        recovery: { action: 'inspect', detail: 'ct-step refused and the run is closed' },
        refusal: {
          state: 'blocked-judge',
          outcome: 'failed',
          exit: 1,
          task: 2,
          findings: HeadlessPlanMother.JUDGE_FINDINGS,
          verdict: HeadlessPlanMother.verdictOf(number),
        },
      }
      : HeadlessPlanMother.slice(number)))

    return { status: 200, body: JSON.stringify({ plans }) }
  }

  static verdictOf(issue: number): string {
    return `.agent/run-${issue}/task-2-verdict-3.json`
  }

  static uncertainDiagnostic(issue: number): string {
    return `no se puede confirmar el estado de #${issue}`
  }

  static workflowOfSlice(issue: number): WorkflowSnapshot {
    const { phase, request, plan } = HeadlessPlanMother.slice(issue)
    return { phase, request, plan }
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
    } as const
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
