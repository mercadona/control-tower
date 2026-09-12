import { render, screen, waitFor } from '@testing-library/react'
import { Terminal } from '@xterm/xterm'
import { FakeEventSource } from 'pages/home/__tests__/FakeEventSource'
import { SessionTerminal } from 'app/sessions/components/session-terminal/SessionTerminal'

const SESSION = { id: 'a1', name: 'zsh' }

const NOOP_ON_GONE = () => undefined

type FakeTerminal = {
  written: string[]
  disposed: boolean
  onDataHandler: ((text: string) => void) | null
  opened: Element | null
}

vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    static instances: MockTerminal[] = []
    written: string[] = []
    disposed = false
    onDataHandler: ((text: string) => void) | null = null
    opened: Element | null = null

    constructor() {
      MockTerminal.instances.push(this)
    }

    open(screen: Element) {
      this.opened = screen
    }

    write(data: string) {
      this.written.push(data)
    }

    reset() {
      this.written = []
    }

    onData(handler: (text: string) => void) {
      this.onDataHandler = handler
    }

    dispose() {
      this.disposed = true
    }
  }

  return { Terminal: MockTerminal }
})

const refusedWrite = () => new Response(JSON.stringify({ code: 'session-not-live', detail: 'no live session answers to that id' }), { status: 400 })

const typedWrite = () => new Response(JSON.stringify({ status: 'typed', id: SESSION.id }), { status: 202 })

const lastTerminal = (): FakeTerminal => {
  const instances = (Terminal as unknown as { instances: FakeTerminal[] }).instances
  const instance = instances.at(-1)
  if (instance === undefined) throw new Error('no terminal was created')
  return instance
}

describe('SessionTerminal', () => {
  beforeEach(() => FakeEventSource.install())
  afterEach(() => vi.unstubAllGlobals())

  it('the bytes the stream delivers are written to the terminal', () => {
    render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)

    FakeEventSource.last().receive('{"bytes":"hola"}')

    expect(lastTerminal().written).toEqual(['hola'])
  })

  it('what the person types is sent to that session', async () => {
    const posting = vi.fn(async () => new Response(JSON.stringify({ status: 'typed', id: SESSION.id }), { status: 202 }))
    vi.stubGlobal('fetch', posting)

    render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)
    lastTerminal().onDataHandler?.('ls -la')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(posting).toHaveBeenCalledWith(`/sessions/${SESSION.id}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'ls -la' }),
      signal: expect.any(AbortSignal),
    })
  })

  it('unmounting closes the subscription and disposes the terminal', () => {
    const { unmount } = render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)
    const terminal = lastTerminal()

    unmount()

    expect(FakeEventSource.last().closes).toBe(1)
    expect(terminal.disposed).toBe(true)
  })

  it('the terminal is opened on the screen it renders', () => {
    const { container } = render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)

    expect(lastTerminal().opened).toBe(container.querySelector('.session-terminal__screen'))
  })

  it('an unreachable stream says so instead of staying mute', async () => {
    render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)

    FakeEventSource.last().dropConnection()

    expect(await screen.findByText('No se puede leer esta sesión')).toBeInTheDocument()
  })

  it('a session the backend no longer holds is said to be gone', async () => {
    render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)

    FakeEventSource.last().refuseBeforeOpen()

    expect(await screen.findByText('Esta sesión ya no existe')).toBeInTheDocument()
  })

  it('a refused keystroke is said on screen without clearing the terminal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => refusedWrite()))

    render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)
    FakeEventSource.last().receive('{"bytes":"hola"}')
    lastTerminal().onDataHandler?.('ls -la')

    expect(await screen.findByText('No se ha podido enviar lo que has escrito')).toBeInTheDocument()
    expect(lastTerminal().written).toEqual(['hola'])
  })

  it('a keystroke that cannot reach the backend is said on screen', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)
    lastTerminal().onDataHandler?.('ls -la')

    expect(await screen.findByText('Sin conexión con el backend')).toBeInTheDocument()
  })

  it('a write that succeeds after a failed one clears the message', async () => {
    const posting = vi.fn(async () => refusedWrite())
    vi.stubGlobal('fetch', posting)

    render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)
    lastTerminal().onDataHandler?.('ls -la')
    await screen.findByText('No se ha podido enviar lo que has escrito')

    posting.mockImplementation(async () => typedWrite())
    lastTerminal().onDataHandler?.('ls -la')

    await waitFor(() => expect(screen.queryByText('No se ha podido enviar lo que has escrito')).not.toBeInTheDocument())
  })

  it('a write outcome for a session no longer shown does not paint under the session now shown', async () => {
    const OTHER_SESSION = { id: 'b2', name: 'bash' }
    let resolvePost: (response: Response) => void = () => undefined
    const posting = vi.fn(() => new Promise<Response>((resolve) => { resolvePost = resolve }))
    vi.stubGlobal('fetch', posting)

    const { rerender } = render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)
    lastTerminal().onDataHandler?.('ls -la')
    await waitFor(() => expect(posting).toHaveBeenCalled())

    rerender(<SessionTerminal session={OTHER_SESSION} onGone={NOOP_ON_GONE} />)
    resolvePost(refusedWrite())
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText('No se ha podido enviar lo que has escrito')).not.toBeInTheDocument()
  })

  it('a stream that recovers after a blip repaints and clears the error banner', async () => {
    render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)

    FakeEventSource.last().receive('{"bytes":"scrollback"}')
    FakeEventSource.last().dropConnection()
    await screen.findByText('No se puede leer esta sesión')

    FakeEventSource.last().open()
    FakeEventSource.last().receive('{"bytes":"fresh"}')

    await waitFor(() => expect(screen.queryByText('No se puede leer esta sesión')).not.toBeInTheDocument())
    expect(lastTerminal().written).toEqual(['fresh'])
  })
})
