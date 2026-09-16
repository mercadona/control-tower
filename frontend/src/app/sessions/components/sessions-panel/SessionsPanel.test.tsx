import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { FakeEventSource } from 'pages/home/__tests__/FakeEventSource'
import { FakeFitAddon, FakeTerminal } from 'pages/home/__tests__/FakeXterm'
import { SessionsPanel } from './SessionsPanel'

const TWO_SESSIONS = SessionsMother.twoSessions().body
const ONE_SESSION = '{"sessions":[{"id":"b2","name":"bash"}]}'
const ZSH_ALONE = SessionsMother.oneSession().body
const WITH_COORDINATING_SESSION = SessionsMother.withCoordinatingSession().body
const NO_SESSIONS = SessionsMother.noSessions().body

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

const answering = (body: string) => vi.fn(async () => new Response(body))

const answeringInTurn = (bodies: string[]) => {
  let call = 0
  return vi.fn(async () => {
    const body = bodies[call] ?? bodies[bodies.length - 1]
    call += 1
    return new Response(body)
  })
}

describe('SessionsPanel', () => {
  beforeEach(() => {
    FakeEventSource.install()
    FakeTerminal.install()
    FakeFitAddon.install()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('the live sessions are listed by their names as tabs', async () => {
    vi.stubGlobal('fetch', answering(TWO_SESSIONS))

    render(<SessionsPanel />)

    expect(await screen.findByRole('tab', { name: 'zsh' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'bash' })).toBeInTheDocument()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByLabelText('Terminal de la sesión')).toBeInTheDocument()
  })

  it('a single session still shows the tab bar naming that one session', async () => {
    vi.stubGlobal('fetch', answering(ZSH_ALONE))

    render(<SessionsPanel />)

    expect(await screen.findByRole('tab', { name: 'zsh' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })

  it('the first session is the one shown', async () => {
    vi.stubGlobal('fetch', answering(TWO_SESSIONS))

    render(<SessionsPanel />)

    await screen.findByRole('tab', { name: 'zsh' })

    await waitFor(() => expect(FakeEventSource.last().url).toBe('/sessions/a1/stream'))
  })

  it('choosing another session tab shows that session', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', answering(TWO_SESSIONS))

    render(<SessionsPanel />)

    await screen.findByRole('tab', { name: 'zsh' })
    await user.click(screen.getByRole('tab', { name: 'bash' }))

    await waitFor(() => expect(FakeEventSource.last().url).toBe('/sessions/b2/stream'))
  })

  it('the chosen session is the only tab marked selected', async () => {
    vi.stubGlobal('fetch', answering(TWO_SESSIONS))

    render(<SessionsPanel />)

    expect(await screen.findByRole('tab', { name: 'zsh' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'bash' })).toHaveAttribute('aria-selected', 'false')
  })

  it('walking the tab bar with an arrow key switches to the session under it', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', answering(TWO_SESSIONS))

    render(<SessionsPanel />)

    await user.click(await screen.findByRole('tab', { name: 'zsh' }))
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'bash' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(FakeEventSource.last().url).toBe('/sessions/b2/stream'))
  })

  it('no live session is said out loud instead of an empty box', async () => {
    vi.stubGlobal('fetch', answering(NO_SESSIONS))

    render(<SessionsPanel />)

    expect(await screen.findByText('No hay ninguna sesión en marcha')).toBeInTheDocument()
  })

  it('an unreachable backend is said out loud', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    render(<SessionsPanel />)

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con las sesiones en marcha')
  })

  it('a session that reports itself gone leaves the tab bar naming only the one that remains', async () => {
    vi.stubGlobal('fetch', answeringInTurn([TWO_SESSIONS, ONE_SESSION]))

    render(<SessionsPanel />)

    await screen.findByRole('tab', { name: 'zsh' })
    const stream = await waitFor(() => FakeEventSource.last())
    stream.refuseBeforeOpen()

    await waitFor(() => expect(FakeEventSource.last().url).toBe('/sessions/b2/stream'))
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'bash' })).toHaveAttribute('aria-selected', 'true')
  })

  it('the session the page just opened is fetched again and shown as the selected tab', async () => {
    const fetching = answeringInTurn([ZSH_ALONE, WITH_COORDINATING_SESSION])
    vi.stubGlobal('fetch', fetching)

    const { rerender } = render(<SessionsPanel />)

    await screen.findByRole('region', { name: 'Terminal de la sesión' })
    expect(fetching).toHaveBeenCalledTimes(1)
    rerender(<SessionsPanel opened={CoordinatingSessionMother.SESSION} />)

    expect(await screen.findByRole('tab', { name: CoordinatingSessionMother.SESSION.name })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(fetching).toHaveBeenCalledTimes(2)
  })

  it('another live session is chosen when the chosen one is gone', async () => {
    vi.stubGlobal('fetch', answeringInTurn([TWO_SESSIONS, ONE_SESSION]))

    render(<SessionsPanel />)

    await screen.findByRole('tab', { name: 'zsh' })
    const stream = await waitFor(() => FakeEventSource.last())
    stream.refuseBeforeOpen()

    await waitFor(() => expect(FakeEventSource.last().url).toBe('/sessions/b2/stream'))
  })

  it('the terminal panel is reachable and named after the chosen session', async () => {
    vi.stubGlobal('fetch', answering(TWO_SESSIONS))

    render(<SessionsPanel />)

    await screen.findByRole('tab', { name: 'zsh' })

    expect(screen.getByRole('tabpanel', { name: 'zsh' })).toBeInTheDocument()
  })
})
