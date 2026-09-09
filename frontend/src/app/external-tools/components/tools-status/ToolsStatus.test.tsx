import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToolsStatus } from 'app/external-tools/components/tools-status'

const ready = { ready: true, tools: [{ tool: 'gh', installed: true, session: 'ready', fix: null }] }
const attention = { ready: false, tools: [
  { tool: 'gh', installed: true, session: 'missing', fix: 'gh auth login' },
  { tool: 'bq', installed: false, session: 'missing', fix: 'instala bq' },
] }

describe('ToolsStatus', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('surveys on mount and shows ready tools', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(ready))))
    render(<ToolsStatus />)
    expect(await screen.findByText('Herramientas listas')).toBeInTheDocument()
  })

  it('lists every attention detail and retries', async () => {
    const fetching = vi.fn(async () => new Response(JSON.stringify(attention)))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    render(<ToolsStatus />)
    await screen.findByText('Herramientas necesitan atención')
    await user.click(screen.getByRole('button', { name: 'Ver detalles' }))
    expect(screen.getByRole('list')).toHaveTextContent('gh: necesita iniciar sesión')
    expect(screen.getByRole('list')).toHaveTextContent('bq: no está instalada')
    await user.click(screen.getByRole('button', { name: 'Reintentar comprobación' }))
    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(2))
  })

  it('dismisses details with Escape, returns focus, and closes outside the panel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(ready))))
    const user = userEvent.setup()
    render(
      <>
        <ToolsStatus />
        <button type="button">Fuera del panel</button>
      </>,
    )
    await screen.findByText('Herramientas listas')
    const trigger = screen.getByRole('button', { name: 'Ver detalles' })

    trigger.focus()
    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('list')).toHaveTextContent('gh: sesión lista')

    await user.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(trigger)

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Fuera del panel' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows unavailable when the initial survey cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))
    render(<ToolsStatus />)

    expect(await screen.findByText('No se pudo comprobar las herramientas')).toBeInTheDocument()
  })

  it('does not update after unmounting a late survey', async () => {
    let resolve: (value: Response) => void = () => undefined
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done })))
    const { unmount } = render(<ToolsStatus />)
    unmount()
    resolve(new Response(JSON.stringify(ready)))
    await Promise.resolve()
  })
})
