import { act, screen } from '@testing-library/react'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { WorkflowSnapshotStorage } from 'app/workflow-snapshot/storage'
import { openHome } from './helpers'

describe('Home · automatic implementation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('a ready plan follows backend implementation without posting an order', async () => {
    vi.useFakeTimers()
    const changes = HeadlessPlanMother.deferredChanges()
    WorkflowSnapshotStorage.save({
      phase: 'ready',
      request: { id: StartPlanMother.TICKET, repo: StartPlanMother.REPO, path: StartPlanMother.PATH },
      plan: {
        id: StartPlanMother.TICKET,
        repo: StartPlanMother.REPO,
        issue: StartPlanMother.ISSUE,
        agent: StartPlanMother.AGENT,
        branch: StartPlanMother.BRANCH,
        worktree: StartPlanMother.WORKTREE,
      },
    })
    const fetching = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (input === '/active-plans') return changes.read()
      if (input === '/external-tools') return Promise.resolve(new Response('{"ready":true,"tools":[]}'))
      if (input === '/sessions') return Promise.resolve(new Response('{"sessions":[]}'))
      if (input === '/coordinating-session' && init === undefined) return Promise.resolve(new Response('{"status":"none"}'))
      if (input === '/spec-freeze' || input === '/epic-groom') return Promise.resolve(new Response('{"status":"none"}'))
      if (String(input).startsWith('/implement-progress/') || String(input).startsWith('/implement-history/')) {
        return Promise.resolve(new Response('{}', { status: 400 }))
      }
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetching)
    openHome()
    expect(changes.activeReadCount()).toBe(1)
    await act(async () => changes.answerWith(HeadlessPlanMother.planning()))

    expect(screen.getByRole('link', { name: 'Abrir el plan en GitHub' })).toHaveAttribute('href', StartPlanMother.ISSUE.url)
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(changes.activeReadCount()).toBe(2)
    await act(async () => changes.answerWith(HeadlessPlanMother.implementing()))

    expect(screen.getByRole('heading', { name: 'Implementación' })).toBeInTheDocument()
    expect(fetching.mock.calls.some(([input, init]) => input === '/implement-plan' || init?.method === 'POST')).toBe(false)
    expect(WorkflowSnapshotStorage.load()?.plan.agent).toBe(StartPlanMother.AGENT)
  })

  it('uncertain recorded work offers no duplicate launch', async () => {
    const answer = HeadlessPlanMother.uncertain()
    const fetching = vi.fn(async (input: string | URL | Request) => {
      if (input === '/active-plans') return new Response(answer.body, { status: answer.status })
      if (input === '/external-tools') return new Response('{"ready":true,"tools":[]}')
      if (input === '/sessions') return new Response('{"sessions":[]}')
      if (input === '/coordinating-session') return new Response('{"status":"none"}')
      if (input === '/spec-freeze' || input === '/epic-groom') return new Response('{"status":"none"}')
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetching)

    openHome()

    expect(await screen.findByRole('alert')).toHaveTextContent('No se puede confirmar el estado de implementación')
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Arrancar brainstorming' })).toBeNull()
  })
})
