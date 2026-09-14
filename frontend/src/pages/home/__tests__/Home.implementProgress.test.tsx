import { screen, waitFor } from '@testing-library/react'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { openHome } from './helpers'

const EXTERNAL_TOOLS_READY = { status: 200, body: '{"ready":true,"tools":[{"tool":"gh","installed":true,"session":"ready","fix":null}]}' }
const NO_SESSIONS = SessionsMother.noSessions()

const responseFor = (answer: { status: number; body: string }) => new Response(answer.body, { status: answer.status })

const activePlanImplementing = (root?: string, worktree: string = StartPlanMother.WORKTREE) => ({
  phase: 'implementing' as const,
  request: { id: StartPlanMother.TICKET, repo: StartPlanMother.REPO, path: StartPlanMother.PATH },
  plan: {
    id: StartPlanMother.TICKET,
    repo: StartPlanMother.REPO,
    issue: StartPlanMother.ISSUE,
    agent: StartPlanMother.AGENT,
    branch: StartPlanMother.BRANCH,
    worktree,
    ...(root !== undefined ? { root } : {}),
  },
})

const stubFetchByPath = (byPath: (url: string) => { status: number; body: string }) => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    if (input === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
    if (input === '/sessions') return responseFor(NO_SESSIONS)
    return responseFor(byPath(String(input)))
  })
  vi.stubGlobal('fetch', fetching)

  return fetching
}

describe('Home · implement progress', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should ask for progress with the non-canonical root the plan started with, not the path the user typed', async () => {
    const fetching = stubFetchByPath((url) => {
      if (url === '/active-plans') {
        const plan = activePlanImplementing(StartPlanMother.NON_CANONICAL_ROOT, StartPlanMother.NON_CANONICAL_WORKTREE)
        return { status: 200, body: JSON.stringify({ plans: [plan] }) }
      }
      if (url.startsWith('/implement-progress/')) return ImplementProgressMother.notRead()
      throw new Error(`unexpected fetch to ${url}`)
    })

    openHome()

    await screen.findByText('Agente asignado')
    await waitFor(() =>
      expect(fetching).toHaveBeenCalledWith(
        `/implement-progress/${StartPlanMother.ISSUE.number}?root=${encodeURIComponent(StartPlanMother.NON_CANONICAL_ROOT)}&repo=${encodeURIComponent(StartPlanMother.REPO)}`,
      ),
    )
  })

  it('should fall back to the request path when a recovered plan carries no canonical root', async () => {
    const fetching = stubFetchByPath((url) => {
      if (url === '/active-plans') return { status: 200, body: JSON.stringify({ plans: [activePlanImplementing()] }) }
      if (url.startsWith('/implement-progress/')) return ImplementProgressMother.notRead()
      throw new Error(`unexpected fetch to ${url}`)
    })

    openHome()

    await screen.findByText('Agente asignado')
    await waitFor(() =>
      expect(fetching).toHaveBeenCalledWith(
        `/implement-progress/${StartPlanMother.ISSUE.number}?root=${encodeURIComponent(StartPlanMother.PATH)}&repo=${encodeURIComponent(StartPlanMother.REPO)}`,
      ),
    )
  })

  it('should show the task, the step and the task name once the run reports progress', async () => {
    stubFetchByPath((url) => {
      if (url === '/active-plans') {
        return { status: 200, body: JSON.stringify({ plans: [activePlanImplementing(StartPlanMother.PATH)] }) }
      }
      if (url.startsWith('/implement-progress/')) return ImplementProgressMother.progress()
      throw new Error(`unexpected fetch to ${url}`)
    })

    openHome()

    expect(await screen.findByText(/Tarea 3 de 7/)).toBeInTheDocument()
    expect(screen.getByText(/el lector del plan/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Implementación' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Flujo del plan' }).querySelector('[aria-current="step"]')).toHaveTextContent('Implementación')
  })

  it('should not claim the agent is implementing once the review is the real step', async () => {
    stubFetchByPath((url) => {
      if (url === '/active-plans') {
        return { status: 200, body: JSON.stringify({ plans: [activePlanImplementing(StartPlanMother.PATH)] }) }
      }
      if (url.startsWith('/implement-progress/')) return ImplementProgressMother.inReview()
      throw new Error(`unexpected fetch to ${url}`)
    })

    openHome()

    await screen.findByText(/En revisión/)
    expect(screen.queryByText(/\bimplementa\b/i)).toBeNull()
  })

  it('should keep naming the agent while the real step is the implementation itself', async () => {
    stubFetchByPath((url) => {
      if (url === '/active-plans') {
        return { status: 200, body: JSON.stringify({ plans: [activePlanImplementing(StartPlanMother.PATH)] }) }
      }
      if (url.startsWith('/implement-progress/')) return ImplementProgressMother.progress()
      throw new Error(`unexpected fetch to ${url}`)
    })

    openHome()

    expect(await screen.findByText(/Tarea 3 de 7/)).toBeInTheDocument()
    expect(screen.getByText('Agente asignado')).toBeInTheDocument()
    expect(screen.getAllByText(StartPlanMother.AGENT)).not.toHaveLength(0)
  })

  it('should stop polling once the page is left', async () => {
    const fetching = stubFetchByPath((url) => {
      if (url === '/active-plans') {
        return { status: 200, body: JSON.stringify({ plans: [activePlanImplementing(StartPlanMother.PATH)] }) }
      }
      if (url.startsWith('/implement-progress/')) return ImplementProgressMother.notRead()
      throw new Error(`unexpected fetch to ${url}`)
    })

    const { unmount } = openHome()
    await waitFor(() => expect(fetching.mock.calls.some(([input]) => String(input).startsWith('/implement-progress/'))).toBe(true))
    const callsBeforeUnmount = fetching.mock.calls.length

    unmount()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(fetching.mock.calls.length).toBe(callsBeforeUnmount)
  })
})
