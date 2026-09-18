type Answer = { status: number; body: string }

class RestartedBackendMother {
  static readonly CAPTURE =
    'npx vitest run backend/__tests__/infrastructure/restart-recovery-real-process.test.ts, on 2026-09-18: '
    + 'what GET /active-plans answers after the backend is killed with a plan in flight and started again, '
    + 'kept verbatim including the absent ticket the loose entrance leaves behind'

  static readonly REPO = 'acme/widget'
  static readonly ISSUE = 41
  static readonly AGENT = 'dea84c67-aa15-4708-b8d3-aa97e5133001'
  static readonly BRANCH = 'feat/41'
  static readonly CALL = '762fbe17-bf6d-4523-b023-d98534dbb196'
  static readonly CHECKOUT =
    '/private/var/folders/tb/x9xhh8dn1zncbhkqmdt69xyr0000gp/T/ct-api-headless-runtime-VvJljg/checkout'
  static readonly WORKTREE = `${RestartedBackendMother.CHECKOUT}/.worktrees/${RestartedBackendMother.ISSUE}`
  static readonly DIAGNOSTIC =
    `incomplete call ${RestartedBackendMother.CALL} is not owned by this API process; `
    + `plan call ${RestartedBackendMother.CALL} is incomplete within its recorded deadline`

  static request(): { id: null, repo: string, path: string } {
    return { id: null, repo: RestartedBackendMother.REPO, path: RestartedBackendMother.CHECKOUT }
  }

  static plan(): {
    id: null, repo: string, issue: { number: number, url: string }, agent: string, branch: string, worktree: string,
  } {
    return {
      id: null,
      repo: RestartedBackendMother.REPO,
      issue: {
        number: RestartedBackendMother.ISSUE,
        url: `https://github.com/${RestartedBackendMother.REPO}/issues/${RestartedBackendMother.ISSUE}`,
      },
      agent: RestartedBackendMother.AGENT,
      branch: RestartedBackendMother.BRANCH,
      worktree: RestartedBackendMother.WORKTREE,
    }
  }

  static disownedPlan(): Answer {
    return {
      status: 200,
      body: JSON.stringify({
        plans: [{
          phase: 'uncertain',
          diagnostic: RestartedBackendMother.DIAGNOSTIC,
          request: RestartedBackendMother.request(),
          plan: RestartedBackendMother.plan(),
          recovery: { action: 'inspect', detail: RestartedBackendMother.DIAGNOSTIC },
        }],
      }),
    }
  }
}

export { RestartedBackendMother }
