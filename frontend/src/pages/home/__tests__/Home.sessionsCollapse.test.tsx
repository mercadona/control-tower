import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { FakeEventSource } from './FakeEventSource'
import { FakeFitAddon, FakeTerminal } from './FakeXterm'
import { openHome } from './helpers'

type Answer = { status: number; body: string }

const NO_ACTIVE_PLANS: Answer = { status: 200, body: '{"plans":[]}' }
const EXTERNAL_TOOLS_READY: Answer = ExternalToolsMother.allReady()
const NO_COORDINATING_SESSION: Answer = CoordinatingSessionMother.none()
const ONE_SESSION: Answer = SessionsMother.oneSession()
const NO_SESSIONS: Answer = SessionsMother.noSessions()
const STORED_WIDTH_KEY = 'ct.sessions-column-width'
const STORED_COLLAPSE_KEY = 'ct.sessions-column-collapsed'
const COLLAPSE_LABEL = 'Colapsar panel de sesiones'
const EXPAND_LABEL = 'Expandir panel de sesiones'
const COLUMN_WIDTH_LABEL = 'Ancho del panel de sesiones'

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status })

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

const stubFetch = (sessions: () => Answer) => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === '/active-plans') return responseFor(NO_ACTIVE_PLANS)
    if (url === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
    if (url === '/sessions') return responseFor(sessions())
    if (url === '/coordinating-session') return responseFor(NO_COORDINATING_SESSION)
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)
  return fetching
}

describe('Home · sessions rail collapse', () => {
  beforeEach(() => {
    FakeTerminal.install()
    FakeFitAddon.install()
    FakeEventSource.install()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('the toggle collapses the rail, and the choice survives a reload', async () => {
    stubFetch(() => ONE_SESSION)
    const { unmount } = openHome()

    await screen.findByRole('button', { name: COLLAPSE_LABEL })
    fireEvent.click(screen.getByRole('button', { name: COLLAPSE_LABEL }))

    expect(document.querySelector('.home__side')).toHaveClass('home__side--collapsed')
    expect(screen.getByRole('button', { name: EXPAND_LABEL })).toHaveAttribute('aria-expanded', 'false')
    unmount()

    stubFetch(() => ONE_SESSION)
    openHome()

    await screen.findByRole('button', { name: EXPAND_LABEL })
    expect(document.querySelector('.home__side')).toHaveClass('home__side--collapsed')
  })

  it('the rail narrows once every live session is gone, with nobody clicking', async () => {
    vi.useFakeTimers()
    let sessions = ONE_SESSION
    stubFetch(() => sessions)
    openHome()

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(document.querySelector('.home__side')).not.toHaveClass('home__side--collapsed')

    sessions = NO_SESSIONS
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })

    expect(document.querySelector('.home__side')).toHaveClass('home__side--collapsed')
  })

  it('a session starting again re-expands it and re-enables the toggle', async () => {
    vi.useFakeTimers()
    let sessions = NO_SESSIONS
    stubFetch(() => sessions)
    openHome()

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(document.querySelector('.home__side')).toHaveClass('home__side--collapsed')
    expect(screen.getByRole('button', { name: EXPAND_LABEL })).toBeDisabled()

    sessions = ONE_SESSION
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })

    expect(document.querySelector('.home__side')).not.toHaveClass('home__side--collapsed')
    expect(screen.getByRole('button', { name: COLLAPSE_LABEL })).toBeEnabled()
  })

  it('collapsing opens no new stream and closes none', async () => {
    stubFetch(() => ONE_SESSION)
    openHome()

    await screen.findByRole('tab', { name: 'zsh' })
    const streamsBefore = FakeEventSource.opened.length
    const streamBefore = FakeEventSource.last()
    const terminalBefore = FakeTerminal.last()

    fireEvent.click(screen.getByRole('button', { name: COLLAPSE_LABEL }))

    expect(FakeEventSource.opened).toHaveLength(streamsBefore)
    expect(FakeEventSource.last()).toBe(streamBefore)
    expect(streamBefore.closes).toBe(0)
    expect(FakeTerminal.last()).toBe(terminalBefore)
  })

  it('a manual collapse works while sessions are live', async () => {
    stubFetch(() => ONE_SESSION)
    openHome()

    await screen.findByRole('button', { name: COLLAPSE_LABEL })
    fireEvent.click(screen.getByRole('button', { name: COLLAPSE_LABEL }))

    expect(localStorage.getItem(STORED_COLLAPSE_KEY)).toBe('true')
    expect(document.querySelector('.home__side')).toHaveClass('home__side--collapsed')
  })

  it('the separator ignores a drag while collapsed', async () => {
    stubFetch(() => ONE_SESSION)
    openHome()

    await screen.findByRole('button', { name: COLLAPSE_LABEL })
    fireEvent.click(screen.getByRole('button', { name: COLLAPSE_LABEL }))
    await screen.findByRole('button', { name: EXPAND_LABEL })

    const separator = screen.getByRole('separator', { name: COLUMN_WIDTH_LABEL })
    const pointerEvent = (type: string, init: { clientX?: number; pointerId?: number }) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(event, init)
      return event
    }
    fireEvent(separator, pointerEvent('pointerdown', { pointerId: 1, clientX: 800 }))
    fireEvent(separator, pointerEvent('pointermove', { pointerId: 1, clientX: 500 }))

    expect(localStorage.getItem(STORED_WIDTH_KEY)).toBeNull()
  })
})
