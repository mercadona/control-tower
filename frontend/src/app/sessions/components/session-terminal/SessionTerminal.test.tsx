import { render, screen, waitFor } from '@testing-library/react'
import { FakeEventSource } from 'pages/home/__tests__/FakeEventSource'
import { FakeFitAddon, FakeTerminal } from 'pages/home/__tests__/FakeXterm'
import { SessionTerminal } from 'app/sessions/components/session-terminal/SessionTerminal'

const SESSION = { id: 'a1', name: 'zsh' }

const NOOP_ON_GONE = () => undefined

let resizeObserverCallback: ResizeObserverCallback | null = null

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

const refusedWrite = () => new Response(JSON.stringify({ code: 'session-not-live', detail: 'no live session answers to that id' }), { status: 400 })

const typedWrite = () => new Response(JSON.stringify({ status: 'typed', id: SESSION.id }), { status: 202 })

const lastTerminal = (): FakeTerminal => FakeTerminal.last()

let resizeObserverDisconnected = false

class FakeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback
  }

  observe() {}
  unobserve() {}

  disconnect() {
    resizeObserverDisconnected = true
  }
}

describe('SessionTerminal', () => {
  beforeEach(() => {
    FakeEventSource.install()
    FakeTerminal.install()
    FakeFitAddon.install()
    resizeObserverCallback = null
    resizeObserverDisconnected = false
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

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

  it('a proposed size other than the default posts it to resize on mount', async () => {
    FakeFitAddon.nextProposedDimensions = { cols: 120, rows: 40 }
    const posting = vi.fn(async () => new Response(JSON.stringify({ status: 'resized', id: SESSION.id, cols: 120, rows: 40 }), { status: 202 }))
    vi.stubGlobal('fetch', posting)

    render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)

    await waitFor(() => expect(posting).toHaveBeenCalledWith(`/sessions/${SESSION.id}/resize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols: 120, rows: 40 }),
      signal: expect.any(AbortSignal),
    }))
  })

  it('an unchanged 80x24 posts nothing to resize', async () => {
    FakeFitAddon.nextProposedDimensions = { cols: 80, rows: 24 }
    const posting = vi.fn(async () => new Response('', { status: 202 }))
    vi.stubGlobal('fetch', posting)

    render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(posting).not.toHaveBeenCalled()
  })

  it('a 0x0 proposal from a not-yet-laid-out container posts nothing to resize', async () => {
    FakeFitAddon.nextProposedDimensions = { cols: 0, rows: 0 }
    const posting = vi.fn(async () => new Response('', { status: 202 }))
    vi.stubGlobal('fetch', posting)

    render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(posting).not.toHaveBeenCalled()
  })

  it('a resize observer callback under fake timers re-fits once after the debounce', async () => {
    vi.useFakeTimers()
    const posting = vi.fn(async () => new Response('', { status: 202 }))
    vi.stubGlobal('fetch', posting)

    render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)

    FakeFitAddon.nextProposedDimensions = { cols: 100, rows: 30 }
    resizeObserverCallback?.([], {} as ResizeObserver)
    resizeObserverCallback?.([], {} as ResizeObserver)

    await vi.advanceTimersByTimeAsync(100)

    expect(posting).toHaveBeenCalledTimes(1)
    expect(posting).toHaveBeenCalledWith(`/sessions/${SESSION.id}/resize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols: 100, rows: 30 }),
      signal: expect.any(AbortSignal),
    })
  })

  it('unmount disconnects the resize observer', () => {
    const { unmount } = render(<SessionTerminal session={SESSION} onGone={NOOP_ON_GONE} />)

    unmount()

    expect(resizeObserverDisconnected).toBe(true)
    expect(FakeFitAddon.last().disposed).toBe(true)
  })
})
