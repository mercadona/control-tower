import { screen } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { openHome } from './helpers'

type Answer = { status: number; body: string }

const HEADING = 'Puerta 2 · El groom y la autorización'
const IMPLEMENTATION_HEADING = 'Implementación'
const NO_ACTIVE_PLANS: Answer = { status: 200, body: '{"plans":[]}' }
const IMPLEMENTATION_PROGRESS_NOT_READ: Answer = {
  status: 400,
  body: '{"code":"implementation-progress-not-read","detail":"the worktree is not there yet"}',
}
const IMPLEMENTATION_HISTORY_NOT_READ: Answer = {
  status: 400,
  body: '{"code":"implementation-history-not-read","detail":"the worktree is not there yet"}',
}

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status })

const implementingPlan = () => ({
  phase: 'implementing' as const,
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

const stubBackend = (activePlans: Answer) => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    const path = String(input)
    if (path === '/spec-freeze') return responseFor(SpecFreezeMother.none())
    if (path === '/epic-groom') return responseFor(EpicGroomMother.groomable())
    if (path === '/active-plans') return responseFor(activePlans)
    if (path === '/external-tools') return responseFor(ExternalToolsMother.allReady())
    if (path === '/sessions') return responseFor(SessionsMother.noSessions())
    if (path === '/coordinating-session') return responseFor(CoordinatingSessionMother.none())
    if (path.startsWith('/implement-progress/')) return responseFor(IMPLEMENTATION_PROGRESS_NOT_READ)
    if (path.startsWith('/implement-history/')) return responseFor(IMPLEMENTATION_HISTORY_NOT_READ)
    throw new Error(`unexpected fetch to ${path}`)
  })
  vi.stubGlobal('fetch', fetching)

  return fetching
}

describe('Home and gate 2', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows gate 2 in the request stage and still shows it while a slice is being implemented', async () => {
    stubBackend(NO_ACTIVE_PLANS)
    const { unmount } = openHome()

    expect(await screen.findByRole('heading', { name: HEADING })).toBeInTheDocument()

    unmount()
    stubBackend({ status: 200, body: JSON.stringify({ plans: [implementingPlan()] }) })
    openHome()

    expect(await screen.findByRole('heading', { name: IMPLEMENTATION_HEADING })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: HEADING })).toBeInTheDocument()
  })
})
