import { cleanup, screen } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { FakeEventSource } from './FakeEventSource'
import { FakeFitAddon, FakeTerminal } from './FakeXterm'
import { openHome } from './helpers'

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

type Answer = { status: number; body: string }

const HEADING = 'Puerta 1 · Congelación del spec'
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

  it('shows gate 1 in the request stage', async () => {
    stubBackend(NO_ACTIVE_PLANS)
    openHome()

    expect(await screen.findByRole('region', { name: HEADING })).toBeInTheDocument()
  })

  it('keeps spec freezing usable in the band while a live failed closure reserves session opening', async () => {
    stubBackend(NO_ACTIVE_PLANS, CoordinatingSessionMother.liveCloseFailed())
    openHome()

    expect(await screen.findByRole('button', { name: 'Congelar el spec' })).toBeEnabled()
    expect(screen.queryByLabelText('Ticket')).not.toBeInTheDocument()
  })

  it('keeps spec freezing usable while a recovered-ended failed closure reserves session opening', async () => {
    stubBackend(NO_ACTIVE_PLANS, CoordinatingSessionMother.endedCloseFailed())
    openHome()

    expect(await screen.findByRole('button', { name: 'Congelar el spec' })).toBeEnabled()
    expect(screen.queryByLabelText('Ticket')).not.toBeInTheDocument()
  })

})
import { WorkProgressMother } from '__scenarios__/WorkProgressMother'
