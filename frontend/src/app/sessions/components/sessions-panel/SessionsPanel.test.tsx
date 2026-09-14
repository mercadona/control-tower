import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { FakeEventSource } from 'pages/home/__tests__/FakeEventSource'
import { SessionsPanel } from './SessionsPanel'

const TWO_SESSIONS = SessionsMother.twoSessions().body
const ONE_SESSION = '{"sessions":[{"id":"b2","name":"bash"}]}'
const ZSH_ALONE = SessionsMother.oneSession().body
const WITH_COORDINATING_SESSION = SessionsMother.withCoordinatingSession().body
const NO_SESSIONS = SessionsMother.noSessions().body

vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    open() {}
    write() {}
    reset() {}
    onData() {}
    dispose() {}
  }

  return { Terminal: MockTerminal }
})

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
  beforeEach(() => FakeEventSource.install())
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('the live sessions are listed by their names', async () => {
    vi.stubGlobal('fetch', answering(TWO_SESSIONS))

    render(<SessionsPanel />)

    expect(await screen.findByRole('button', { name: 'zsh' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'bash' })).toBeInTheDocument()
    expect(screen.getByLabelText('Terminal de la sesión')).toBeInTheDocument()
  })

  it('the first session is the one shown', async () => {
    vi.stubGlobal('fetch', answering(TWO_SESSIONS))

    render(<SessionsPanel />)

    await screen.findByRole('button', { name: 'zsh' })

    await waitFor(() => expect(FakeEventSource.last().url).toBe('/sessions/a1/stream'))
  })

  it('choosing another session shows that one', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', answering(TWO_SESSIONS))

    render(<SessionsPanel />)

    await screen.findByRole('button', { name: 'zsh' })
    await user.click(screen.getByRole('button', { name: 'bash' }))

    await waitFor(() => expect(FakeEventSource.last().url).toBe('/sessions/b2/stream'))
  })

  it('the chosen session is named as chosen for a screen reader', async () => {
    vi.stubGlobal('fetch', answering(TWO_SESSIONS))

    render(<SessionsPanel />)

    expect(await screen.findByRole('button', { name: 'zsh' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'bash' })).not.toHaveAttribute('aria-current')
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

  it('a session that reports itself gone is dropped from the list', async () => {
    vi.stubGlobal('fetch', answeringInTurn([TWO_SESSIONS, ONE_SESSION]))

    render(<SessionsPanel />)

    await screen.findByRole('button', { name: 'zsh' })
    const stream = await waitFor(() => FakeEventSource.last())
    stream.refuseBeforeOpen()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'zsh' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'bash' })).toBeInTheDocument()
  })

  it('the session the page just opened is fetched again and shown as chosen', async () => {
    const fetching = answeringInTurn([ZSH_ALONE, WITH_COORDINATING_SESSION])
    vi.stubGlobal('fetch', fetching)

    const { rerender } = render(<SessionsPanel />)

    await screen.findByRole('button', { name: 'zsh' })
    expect(fetching).toHaveBeenCalledTimes(1)
    rerender(<SessionsPanel opened={CoordinatingSessionMother.SESSION} />)

    expect(await screen.findByRole('button', { name: CoordinatingSessionMother.SESSION.name })).toHaveAttribute('aria-current', 'true')
    expect(fetching).toHaveBeenCalledTimes(2)
  })

  it('another live session is chosen when the chosen one is gone', async () => {
    vi.stubGlobal('fetch', answeringInTurn([TWO_SESSIONS, ONE_SESSION]))

    render(<SessionsPanel />)

    await screen.findByRole('button', { name: 'zsh' })
    const stream = await waitFor(() => FakeEventSource.last())
    stream.refuseBeforeOpen()

    await waitFor(() => expect(FakeEventSource.last().url).toBe('/sessions/b2/stream'))
  })
})
