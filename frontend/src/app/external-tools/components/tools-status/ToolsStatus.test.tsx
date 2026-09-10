import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToolsStatus } from 'app/external-tools/components/tools-status'

const DESTINATION = 'fixture-project:fixture_dataset.fixture_table'
const DELIVERY_DISABLED = { enabled: false, variable: 'CT_HARVEST_BQ_TABLE', destination: null }
const DELIVERY_ENABLED = { enabled: true, variable: 'CT_HARVEST_BQ_TABLE', destination: DESTINATION }

const GH_READY = { tool: 'gh', installed: true, session: 'ready', fix: null }
const BQ_READY = { tool: 'bq', installed: true, session: 'ready', fix: null }
const BQ_MISSING = { tool: 'bq', installed: true, session: 'missing', fix: 'gcloud auth login' }
const BQ_NOT_INSTALLED = { tool: 'bq', installed: false, session: 'missing', fix: 'instala bq' }

const ready = { ready: true, tools: [GH_READY], metricsDelivery: DELIVERY_DISABLED }
const attention = {
  ready: false,
  tools: [{ tool: 'gh', installed: true, session: 'missing', fix: 'gh auth login' }, BQ_NOT_INSTALLED],
  metricsDelivery: DELIVERY_DISABLED,
}
const deliveryDisabled = { ready: true, tools: [GH_READY, BQ_NOT_INSTALLED], metricsDelivery: DELIVERY_DISABLED }
const deliveryActive = { ready: true, tools: [GH_READY, BQ_READY], metricsDelivery: DELIVERY_ENABLED }
const deliveryBlocked = { ready: false, tools: [GH_READY, BQ_MISSING], metricsDelivery: DELIVERY_ENABLED }

const answering = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body)))

const panel = () => screen.getByRole('complementary', { name: 'Herramientas' })

const toggleNamed = (name: string) => screen.getByRole('button', { name })

const expanded = async (body: unknown) => {
  vi.stubGlobal('fetch', answering(body))
  const user = userEvent.setup()
  render(<ToolsStatus />)
  await waitFor(() => expect(screen.getByRole('button', { name: /Desplegar/ })).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /Desplegar/ }))

  return { user, metrics: screen.getByRole('region', { name: 'Entrega de métricas' }) }
}

describe('ToolsStatus', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is a persistent complementary column that starts folded to its rail', async () => {
    vi.stubGlobal('fetch', answering(ready))
    render(<ToolsStatus />)

    await waitFor(() => expect(toggleNamed('Desplegar el panel de herramientas: listas')).toBeInTheDocument())
    const drawer = panel()
    expect(drawer.tagName).toBe('ASIDE')
    expect(drawer).toHaveClass('drawer--collapsed')
    expect(drawer).not.toHaveAttribute('aria-modal')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('carries the survey summary in the toggle while folded, so the rail is not mute', async () => {
    vi.stubGlobal('fetch', answering(attention))
    render(<ToolsStatus />)

    await waitFor(() =>
      expect(toggleNamed('Desplegar el panel de herramientas: necesitan atención')).toBeInTheDocument())
  })

  it('unfolds on the toggle and shows the dot, the summary and every tool detail', async () => {
    vi.stubGlobal('fetch', answering(attention))
    const user = userEvent.setup()
    render(<ToolsStatus />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Desplegar/ })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Desplegar/ }))

    const toggle = toggleNamed('Contraer el panel de herramientas: necesitan atención')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls')
    expect(panel()).not.toHaveClass('drawer--collapsed')
    expect(screen.getByText('Necesitan atención')).toBeVisible()
    expect(panel().querySelector('.tools-status__dot--attention')).toBeInTheDocument()
    expect(screen.getByRole('list')).toHaveTextContent('gh: necesita iniciar sesión')
    expect(screen.getByRole('list')).toHaveTextContent('bq: no está instalada')
  })

  it('folds back on the same toggle without unmounting the column', async () => {
    vi.stubGlobal('fetch', answering(ready))
    const user = userEvent.setup()
    render(<ToolsStatus />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Desplegar/ })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Desplegar/ }))
    await user.click(screen.getByRole('button', { name: /Contraer/ }))

    expect(panel()).toHaveClass('drawer--collapsed')
    expect(toggleNamed('Desplegar el panel de herramientas: listas')).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps its region name while folded even though the body is hidden', async () => {
    vi.stubGlobal('fetch', answering(ready))
    render(<ToolsStatus />)

    await waitFor(() => expect(screen.getByRole('button', { name: /Desplegar/ })).toBeInTheDocument())
    const body = document.getElementById(
      screen.getByRole('button', { name: /Desplegar/ }).getAttribute('aria-controls') ?? '',
    )
    expect(panel()).toBeInTheDocument()
    expect(body).toHaveAttribute('hidden')
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reintentar comprobación' })).toBeNull()
  })

  it('retries the survey from inside the body', async () => {
    const fetching = answering(attention)
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    render(<ToolsStatus />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Desplegar/ })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Desplegar/ }))

    await user.click(screen.getByRole('button', { name: 'Reintentar comprobación' }))

    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(2))
  })

  it('shows unavailable when the initial survey cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))
    render(<ToolsStatus />)

    await waitFor(() =>
      expect(toggleNamed('Desplegar el panel de herramientas: no se pudo comprobar')).toBeInTheDocument())
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

describe('ToolsStatus — the metrics delivery section', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('says the variable is unset, what is lost and that the backend has to be restarted', async () => {
    const { metrics } = await expanded(deliveryDisabled)

    expect(metrics).toHaveTextContent('CT_HARVEST_BQ_TABLE')
    expect(metrics).toHaveTextContent('no está configurada')
    expect(metrics).toHaveTextContent('Los planes siguen funcionando')
    expect(metrics).toHaveTextContent('no se enviarán a BigQuery')
    expect(metrics).toHaveTextContent('no aparecerán en las comparativas de herramientas')
    expect(metrics).toHaveTextContent('CT_HARVEST_BQ_TABLE=proyecto:dataset.tabla make run-backend')
    expect(metrics).toHaveTextContent('hay que reiniciar el backend')
  })

  it('does not present an unneeded bq as a general blocking error while delivery is disabled', async () => {
    await expanded(deliveryDisabled)

    expect(toggleNamed('Contraer el panel de herramientas: listas')).toBeInTheDocument()
    expect(screen.getByRole('list')).toHaveTextContent(
      'bq: no está instalada · opcional: solo hace falta si activas la entrega de métricas',
    )
    expect(screen.getByRole('list')).not.toHaveTextContent('instala bq')
  })

  it('says delivery is active, names the destination table and says slices upload themselves', async () => {
    const { metrics } = await expanded(deliveryActive)

    expect(metrics).toHaveTextContent('Entrega activa')
    expect(metrics).toHaveTextContent('se suben automáticamente')
    expect(metrics).toHaveTextContent(DESTINATION)
    expect(metrics).not.toHaveTextContent('no está configurada')
  })

  it('says metrics cannot be delivered, reuses the bq fix and explains the retry and the kept worktree', async () => {
    const { metrics } = await expanded(deliveryBlocked)

    expect(toggleNamed('Contraer el panel de herramientas: necesitan atención')).toBeInTheDocument()
    expect(metrics).toHaveTextContent('No se pueden entregar las métricas')
    expect(metrics).toHaveTextContent('necesita iniciar sesión')
    expect(metrics).toHaveTextContent('gcloud auth login')
    expect(metrics).toHaveTextContent(DESTINATION)
    expect(metrics).toHaveTextContent('se reintenta en cada barrido')
    expect(metrics).toHaveTextContent('el worktree del slice se conserva')
  })

  it('asserts no configuration value while the survey is still in flight', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)))
    const user = userEvent.setup()
    render(<ToolsStatus />)
    await user.click(screen.getByRole('button', { name: 'Desplegar el panel de herramientas: comprobando' }))

    const metrics = screen.getByRole('region', { name: 'Entrega de métricas' })

    expect(metrics).toHaveTextContent('Consultando la configuración de entrega de métricas')
    expect(metrics).not.toHaveTextContent('no está configurada')
    expect(metrics).not.toHaveTextContent('Entrega activa')
  })

  it('says the configuration could not be read when the backend is unavailable, and still retries', async () => {
    const fetching = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    render(<ToolsStatus />)
    await waitFor(() => expect(screen.getByRole('button', { name: /no se pudo comprobar/ })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Desplegar/ }))

    const metrics = screen.getByRole('region', { name: 'Entrega de métricas' })

    expect(metrics).toHaveTextContent('no se ha podido leer si la entrega de métricas está configurada')
    expect(metrics).not.toHaveTextContent('no está configurada, así que')
    await user.click(screen.getByRole('button', { name: 'Reintentar comprobación' }))
    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(2))
  })

  it('reads the configuration again on a retry and shows what changed', async () => {
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(deliveryDisabled)))
      .mockResolvedValueOnce(new Response(JSON.stringify(deliveryActive)))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    render(<ToolsStatus />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Desplegar/ })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Desplegar/ }))
    expect(screen.getByRole('region', { name: 'Entrega de métricas' })).toHaveTextContent('no está configurada')

    await user.click(screen.getByRole('button', { name: 'Reintentar comprobación' }))

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Entrega de métricas' })).toHaveTextContent(DESTINATION))
  })

  it('reads a malformed metrics delivery as unavailable instead of claiming it is disabled', async () => {
    vi.stubGlobal('fetch', answering({
      ready: true,
      tools: [GH_READY],
      metricsDelivery: { enabled: true, variable: 'CT_HARVEST_BQ_TABLE', destination: null },
    }))
    const user = userEvent.setup()
    render(<ToolsStatus />)
    await waitFor(() => expect(screen.getByRole('button', { name: /no se pudo comprobar/ })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Desplegar/ }))

    const metrics = screen.getByRole('region', { name: 'Entrega de métricas' })

    expect(metrics).toHaveTextContent('no se ha podido leer si la entrega de métricas está configurada')
  })
})
