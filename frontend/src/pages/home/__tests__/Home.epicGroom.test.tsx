import { cleanup, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { FakeEventSource } from './FakeEventSource'
import { FakeFitAddon, FakeTerminal } from './FakeXterm'
import { openHome } from './helpers'

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

type Answer = { status: number; body: string }

const A_LOADED_SUITE = { timeout: 5000 }
const HEADING = 'Puerta 2 · El groom y la autorización'
const REVIEW_THE_SLICING = 'Revisar el slicing con la sesión'
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

const stubGroomableBackendWithASession = () => {
  let opened = false
  const groomLive = CoordinatingSessionMother.working().body
    .replace(CoordinatingSessionMother.TARGET, EpicGroomMother.GROOM_TARGET)
    .replace(CoordinatingSessionMother.CONVERSATION, EpicGroomMother.GROOM_CONVERSATION)
    .replace(CoordinatingSessionMother.SESSION.id, EpicGroomMother.GROOM_SESSION.id)
    .replace(CoordinatingSessionMother.SESSION.name, EpicGroomMother.GROOM_SESSION.name)
  const fetching = vi.fn(async (input: string | URL | Request) => {
    const path = String(input)
    if (path === '/spec-freeze') return responseFor(SpecFreezeMother.none())
    if (path === '/epic-groom') return responseFor(EpicGroomMother.groomable())
    if (path === '/groom-session') {
      opened = true
      return responseFor(EpicGroomMother.groomSessionOpened())
    }
    if (path === '/active-plans') return responseFor(NO_ACTIVE_PLANS)
    if (path === '/external-tools') return responseFor(ExternalToolsMother.allReady())
    if (path === '/sessions') return responseFor(SessionsMother.withGroomSession())
    if (path === '/coordinating-session') return opened
      ? new Response(groomLive)
      : responseFor(CoordinatingSessionMother.ended())
    if (path.startsWith('/work-progress/')) return responseFor(WorkProgressMother.implementing(IMPLEMENTATION_PROGRESS_NOT_READ))
    if (path.startsWith('/implement-history/')) return responseFor(IMPLEMENTATION_HISTORY_NOT_READ)
    throw new Error(`unexpected fetch to ${path}`)
  })
  vi.stubGlobal('fetch', fetching)

  return fetching
}

const stubBackend = (
  activePlans: Answer,
  coordinatingSession = CoordinatingSessionMother.working(),
  epicGroom = EpicGroomMother.groomable(),
) => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    const path = String(input)
    if (path === '/spec-freeze') return responseFor(SpecFreezeMother.none())
    if (path === '/epic-groom') return responseFor(epicGroom)
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

describe('Home and gate 2', () => {
  beforeEach(() => {
    FakeTerminal.install()
    FakeFitAddon.install()
    FakeEventSource.install()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows gate 2 as the band of the live session', async () => {
    stubBackend(NO_ACTIVE_PLANS)
    openHome()

    expect(await screen.findByRole('region', { name: HEADING }, A_LOADED_SUITE)).toBeInTheDocument()
  })

  it('a mounted live coordinator mid-turn blocks both the groom session entrance and the groom', async () => {
    const fetching = stubBackend(NO_ACTIVE_PLANS)
    openHome()
    const session = await screen.findByRole('button', { name: REVIEW_THE_SLICING }, A_LOADED_SUITE)

    expect(session).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ejecutar el groom' })).toBeDisabled()
    expect(fetching.mock.calls.filter(([input]) => String(input) === '/groom-session')).toHaveLength(0)
  })

  it.each([
    ['live groom', CoordinatingSessionMother.completedCloseFailed, EpicGroomMother.groomable, 'Ejecutar el groom'],
    ['live promotion', CoordinatingSessionMother.liveCloseFailed, EpicGroomMother.groomed, 'Autorizar el trabajo'],
    ['live reslicing', CoordinatingSessionMother.liveCloseFailed, EpicGroomMother.resliced, 'Publicar el nuevo slicing'],
  ])('keeps %s usable in the band while the failed closure reserves session opening', async (
    _scenario,
    failed,
    gate,
    action,
  ) => {
    stubBackend(NO_ACTIVE_PLANS, failed(), gate())
    openHome()

    expect(await screen.findByRole('button', { name: action }, A_LOADED_SUITE)).toBeEnabled()
    expect(screen.queryByLabelText('Ticket')).not.toBeInTheDocument()
  })

  it.each([
    ['recovered-ended groom', EpicGroomMother.groomable, 'Ejecutar el groom'],
    ['recovered-ended promotion', EpicGroomMother.groomed, 'Autorizar el trabajo'],
    ['recovered-ended reslicing', EpicGroomMother.resliced, 'Publicar el nuevo slicing'],
  ])('keeps %s usable while the failed closure reserves session opening', async (_scenario, gate, action) => {
    stubBackend(NO_ACTIVE_PLANS, CoordinatingSessionMother.endedCloseFailed(), gate())
    openHome()

    expect(await screen.findByRole('button', { name: action }, A_LOADED_SUITE)).toBeEnabled()
    expect(screen.queryByLabelText('Ticket')).not.toBeInTheDocument()
  })

  it('keeps the groom session entrance closed over a recovered-ended conversation whose closure failed', async () => {
    stubBackend(NO_ACTIVE_PLANS, CoordinatingSessionMother.endedCloseFailed(), EpicGroomMother.groomable())
    openHome()

    await screen.findByRole('button', { name: 'Ejecutar el groom' }, A_LOADED_SUITE)
    expect(screen.getByRole('button', { name: REVIEW_THE_SLICING })).toBeDisabled()
  })


  it('opens and selects a groom conversation over an idle ended coordinator', async () => {
    const fetching = stubGroomableBackendWithASession()
    const user = userEvent.setup()
    openHome()
    const session = await screen.findByRole('button', { name: REVIEW_THE_SLICING }, A_LOADED_SUITE)
    expect(session).toBeEnabled()

    await user.click(session)

    expect(await screen.findByRole('region', { name: EpicGroomMother.GROOM_SESSION.name })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar la sesión' })).toBeEnabled()
    expect(fetching.mock.calls.filter(([input]) => String(input) === '/groom-session')).toHaveLength(1)
  })
})
import { WorkProgressMother } from '__scenarios__/WorkProgressMother'
