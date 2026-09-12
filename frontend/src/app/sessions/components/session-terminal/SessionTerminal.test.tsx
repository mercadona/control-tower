import { render, screen } from '@testing-library/react'
import { Terminal } from '@xterm/xterm'
import { FakeEventSource } from 'pages/home/__tests__/FakeEventSource'
import { SessionTerminal } from 'app/sessions/components/session-terminal/SessionTerminal'

const SESSION = { id: 'a1', name: 'zsh' }

type FakeTerminal = {
  written: string[]
  disposed: boolean
  onDataHandler: ((text: string) => void) | null
}

vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    static instances: MockTerminal[] = []
    written: string[] = []
    disposed = false
    onDataHandler: ((text: string) => void) | null = null

    constructor() {
      MockTerminal.instances.push(this)
    }

    open() {}

    write(data: string) {
      this.written.push(data)
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
    render(<SessionTerminal session={SESSION} />)

    FakeEventSource.last().receive('{"bytes":"hola"}')

    expect(lastTerminal().written).toEqual(['hola'])
  })

  it('what the person types is sent to that session', () => {
    const posting = vi.fn(async () => new Response(JSON.stringify({ status: 'typed', id: SESSION.id }), { status: 202 }))
    vi.stubGlobal('fetch', posting)

    render(<SessionTerminal session={SESSION} />)
    lastTerminal().onDataHandler?.('ls -la')

    expect(posting).toHaveBeenCalledWith(`/sessions/${SESSION.id}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'ls -la' }),
    })
  })

  it('unmounting closes the subscription and disposes the terminal', () => {
    const { unmount } = render(<SessionTerminal session={SESSION} />)
    const terminal = lastTerminal()

    unmount()

    expect(FakeEventSource.last().closes).toBe(1)
    expect(terminal.disposed).toBe(true)
  })

  it('an unreachable stream says so instead of staying mute', async () => {
    render(<SessionTerminal session={SESSION} />)

    FakeEventSource.last().dropConnection()

    expect(await screen.findByText('No se puede leer esta sesión')).toBeInTheDocument()
  })

  it('a session the backend no longer holds is said to be gone', async () => {
    render(<SessionTerminal session={SESSION} />)

    FakeEventSource.last().refuseBeforeOpen()

    expect(await screen.findByText('Esta sesión ya no existe')).toBeInTheDocument()
  })
})
