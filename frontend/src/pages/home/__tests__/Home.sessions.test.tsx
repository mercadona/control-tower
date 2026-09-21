import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { FakeEventSource } from './FakeEventSource'
import { FakeFitAddon, FakeTerminal } from './FakeXterm'
import { openBrainstorming, openHome } from './helpers'

type Answer = { status: number; body: string }
type ScrollableElement = { scrollIntoView?: (options?: ScrollIntoViewOptions) => void }

const NO_ACTIVE_PLANS: Answer = { status: 200, body: '{"plans":[]}' }
const SESSION_ID = 'a1'
const IMPLEMENTING_ACTIVE_PLAN: Answer = HeadlessPlanMother.implementing()
const EXTERNAL_TOOLS_READY: Answer = {
  status: 200,
  body: '{"ready":true,"tools":[{"tool":"gh","installed":true,"session":"ready","fix":null}],"metricsDelivery":{"enabled":false,"variable":"CT_HARVEST_BQ_TABLE","destination":null}}',
}
const SESSIONS: Answer = SessionsMother.oneSession()
const SESSIONS_WITH_THE_OPENED_ONE: Answer = SessionsMother.withCoordinatingSession()
const TYPED: Answer = { status: 202, body: `{"status":"typed","id":"${SESSION_ID}"}` }
const RESIZED: Answer = { status: 202, body: `{"status":"resized","id":"${SESSION_ID}","cols":80,"rows":24}` }
const NO_COORDINATING_SESSION: Answer = CoordinatingSessionMother.none()
const NO_IMPLEMENTATION_RUN_YET: Answer = {
  status: 400,
  body: '{"code":"implementation-progress-not-read","detail":"the worktree is not there yet"}',
}
const NO_IMPLEMENTATION_HISTORY_YET: Answer = {
  status: 400,
  body: '{"code":"implementation-history-not-read","detail":"the worktree is not there yet"}',
}

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status })

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

const lastTerminal = (): FakeTerminal => FakeTerminal.last()

const stubFetch = (activePlans: Answer, coordinatingSession: Answer = NO_COORDINATING_SESSION) => {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === '/active-plans') return responseFor(activePlans)
    if (url === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
    if (url === '/sessions') return responseFor(SESSIONS)
    if (url === `/sessions/${SESSION_ID}/input`) return responseFor(TYPED)
    if (url === `/sessions/${SESSION_ID}/resize`) return responseFor(RESIZED)
    if (url === '/coordinating-session' && init === undefined) return responseFor(coordinatingSession)
    if (url.startsWith('/implement-progress/')) return responseFor(NO_IMPLEMENTATION_RUN_YET)
    if (url.startsWith('/implement-history/')) return responseFor(NO_IMPLEMENTATION_HISTORY_YET)
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)
  return fetching
}

const stubFetchOpeningTheBrainstorming = () => {
  let sessions = SESSIONS
  let opened = false
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === '/active-plans') return responseFor(NO_ACTIVE_PLANS)
    if (url === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
    if (url === '/sessions') return responseFor(sessions)
    if (url === `/sessions/${CoordinatingSessionMother.SESSION.id}/input`) {
      return responseFor({ status: 202, body: JSON.stringify({ status: 'typed', id: CoordinatingSessionMother.SESSION.id }) })
    }
    if (url === '/coordinating-session' && init === undefined) {
      return responseFor(opened ? CoordinatingSessionMother.working() : NO_COORDINATING_SESSION)
    }
    if (url === '/coordinating-session') {
      opened = true
      sessions = SESSIONS_WITH_THE_OPENED_ONE
      return responseFor(CoordinatingSessionMother.opened())
    }
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)
  return fetching
}

const stubScrollIntoView = () => {
  const scrolling = vi.fn()
  ;(Element.prototype as ScrollableElement).scrollIntoView = scrolling
  return scrolling
}

describe('Home · sessions panel', () => {
  beforeEach(() => {
    FakeTerminal.install()
    FakeFitAddon.install()
    FakeEventSource.install()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    delete (Element.prototype as ScrollableElement).scrollIntoView
  })

  it('the sessions panel is on the page before a plan is requested', () => {
    stubFetch(NO_ACTIVE_PLANS)

    openHome()

    expect(screen.getByRole('complementary', { name: 'Sesión coordinadora' })).toBeInTheDocument()
  })

  it('keeps the coordinating session reachable while a slice is implemented', async () => {
    const fetching = stubFetch(IMPLEMENTING_ACTIVE_PLAN)
    openHome()

    await screen.findByText('Implementación iniciada automáticamente')
    fireEvent.click(screen.getByRole('button', { name: 'Desplegar el panel' }))
    expect(screen.getByRole('region', { name: 'Terminal de la sesión' })).toBeInTheDocument()

    const terminal = await waitFor(() => lastTerminal())
    terminal.onDataHandler?.('ls -la')

    await waitFor(() =>
      expect(fetching).toHaveBeenCalledWith(`/sessions/${SESSION_ID}/input`, expect.objectContaining({ method: 'POST' })),
    )
  })

  it('replays what was already said when the page reloads', async () => {
    stubFetch(NO_ACTIVE_PLANS)
    const { unmount } = openHome()
    await screen.findByRole('button', { name: 'Desplegar el panel' })
    fireEvent.click(screen.getByRole('button', { name: 'Desplegar el panel' }))
    await screen.findByRole('region', { name: 'Terminal de la sesión' })
    const firstStream = await waitFor(() => FakeEventSource.last())
    firstStream.receive('{"bytes":"scrollback"}')
    await waitFor(() => expect(lastTerminal().written).toEqual(['scrollback']))
    unmount()

    stubFetch(NO_ACTIVE_PLANS)
    openHome()
    await screen.findByRole('region', { name: 'Terminal de la sesión' })
    const secondStream = await waitFor(() => FakeEventSource.last())
    secondStream.receive('{"bytes":"scrollback"}')
    await waitFor(() => expect(lastTerminal().written).toEqual(['scrollback']))
  })

  it('the brainstorming terminal is immediately closeable and accepts input as soon as the entrance opens it', async () => {
    const scrolling = stubScrollIntoView()
    stubFetchOpeningTheBrainstorming()
    const { user } = openHome()

    await openBrainstorming(user)

    expect(await screen.findByRole('tab', { name: CoordinatingSessionMother.SESSION.name })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Cancelar la sesión' })).toBeEnabled()
    const terminal = await waitFor(() => lastTerminal())
    terminal.onDataHandler?.('pwd')
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/sessions/${CoordinatingSessionMother.SESSION.id}/input`,
      expect.objectContaining({ method: 'POST' }),
    ))
    expect(scrolling).toHaveBeenCalled()
  })
})
