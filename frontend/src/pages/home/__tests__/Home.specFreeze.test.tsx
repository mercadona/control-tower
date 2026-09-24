import { cleanup, screen } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { FakeEventSource } from './FakeEventSource'
import { FakeFitAddon, FakeTerminal } from './FakeXterm'
import { openHome } from './helpers'

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

type Answer = { status: number; body: string }

const HEADING = 'Puerta 1 · Congelación del spec'
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

const stubBackend = (activePlans: Answer, coordinatingSession = CoordinatingSessionMother.ended()) => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    const path = String(input)
    if (path === '/spec-freeze') return responseFor(SpecFreezeMother.draftReady())
    if (path === '/active-plans') return responseFor(activePlans)
    if (path === '/external-tools') return responseFor(ExternalToolsMother.allReady())
    if (path === '/sessions') return responseFor(SessionsMother.noSessions())
    if (path === '/coordinating-session') return responseFor(coordinatingSession)
    if (path.startsWith('/work-progress/')) return responseFor(WorkProgressMother.implementing(IMPLEMENTATION_PROGRESS_NOT_READ))
    if (path.startsWith('/implement-history/')) return responseFor(IMPLEMENTATION_HISTORY_NOT_READ)
    throw new Error(`unexpected fetch to ${path}`)
  })
  vi.stubGlobal('fetch', fetching)

  return fetching
}

describe('Home and gate 1', () => {
  beforeEach(() => {
    FakeTerminal.install()
    FakeFitAddon.install()
    FakeEventSource.install()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows gate 1 in the request stage and still shows it while a slice is being implemented', async () => {
    stubBackend(NO_ACTIVE_PLANS)
    const { unmount } = openHome()

    expect(await screen.findByRole('heading', { name: HEADING })).toBeInTheDocument()

    unmount()
    stubBackend({ status: 200, body: JSON.stringify({ plans: [implementingPlan()] }) })
    const implementing = openHome()

    expect(await screen.findByRole('heading', { name: IMPLEMENTATION_HEADING })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: HEADING })).toBeInTheDocument()
    implementing.unmount()
  })

  it.each([
    ['live', CoordinatingSessionMother.liveCloseFailed],
    ['recovered-ended', CoordinatingSessionMother.endedCloseFailed],
  ])('keeps spec freezing usable while a %s failed closure reserves session opening', async (_state, failed) => {
    stubBackend(NO_ACTIVE_PLANS, failed())
    openHome()

    expect(await screen.findByRole('button', { name: 'Congelar el spec' })).toBeEnabled()
    if (failed === CoordinatingSessionMother.endedCloseFailed) {
      expect(screen.getByLabelText('Ticket')).toBeDisabled()
    } else {
      expect(screen.queryByLabelText('Ticket')).not.toBeInTheDocument()
    }
  })
})
import { WorkProgressMother } from '__scenarios__/WorkProgressMother'
