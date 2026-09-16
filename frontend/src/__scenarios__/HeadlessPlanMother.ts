import { StartPlanMother } from '__scenarios__/StartPlanMother'

type Answer = { status: number; body: string }
type HeadlessPhase = 'planning' | 'implementing' | 'uncertain'

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
    return HeadlessPlanMother.active('uncertain')
  }

  static deferredChanges(): DeferredHeadlessPlanChanges {
    return new DeferredHeadlessPlanChanges()
  }

  private static active(phase: HeadlessPhase): Answer {
    return {
      status: 200,
      body: JSON.stringify({
        plans: [{
          phase,
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
