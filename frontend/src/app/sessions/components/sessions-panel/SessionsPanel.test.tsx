import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { FakeEventSource } from 'pages/home/__tests__/FakeEventSource'
import { SessionsPanel } from './SessionsPanel'

const TWO_SESSIONS = '{"sessions":[{"id":"a1","name":"zsh"},{"id":"b2","name":"bash"}]}'
const NO_SESSIONS = SessionsMother.noSessions().body

vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    open() {}
    write() {}
    onData() {}
    dispose() {}
  }

  return { Terminal: MockTerminal }
})

const answering = (body: string) => vi.fn(async () => new Response(body))

describe('SessionsPanel', () => {
  beforeEach(() => FakeEventSource.install())
  afterEach(() => vi.unstubAllGlobals())

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
    expect(FakeEventSource.last().url).toBe('/sessions/a1/stream')
  })

  it('choosing another session shows that one', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', answering(TWO_SESSIONS))

    render(<SessionsPanel />)

    await screen.findByRole('button', { name: 'zsh' })
    await user.click(screen.getByRole('button', { name: 'bash' }))

    expect(FakeEventSource.last().url).toBe('/sessions/b2/stream')
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
})
