import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { openHome, openRestored } from './helpers'

type Answer = { status: number; body: string }

const NO_ACTIVE_PLANS = { status: 200, body: '{"plans":[]}' }
const NO_SESSIONS = SessionsMother.noSessions()

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status })

const stubFetch = (externalTools: Answer) => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === '/external-tools') return responseFor(externalTools)
    if (url === '/active-plans') return responseFor(NO_ACTIVE_PLANS)
    if (url === '/sessions') return responseFor(NO_SESSIONS)
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)
  return fetching
}

const READY_ONLY = { status: 200, body: JSON.stringify({ ready: true, tools: [{ tool: 'gh', installed: true, session: 'ready', fix: null }], metricsDelivery: { enabled: false, variable: 'CT_HARVEST_BQ_TABLE', destination: null } }) }

const MIXED_SESSIONS = {
  status: 200,
  body: JSON.stringify({
    ready: false,
    tools: [
      { tool: 'gh', installed: true, session: 'ready', fix: null },
      { tool: 'bq', installed: true, session: 'missing', fix: 'gcloud auth login' },
      { tool: 'claude', installed: true, session: 'unknown', fix: 'claude, then /login' },
    ],
    metricsDelivery: { enabled: false, variable: 'CT_HARVEST_BQ_TABLE', destination: null },
  }),
}

const METRICS_ENABLED = {
  status: 200,
  body: JSON.stringify({
    ready: true,
    tools: [{ tool: 'gh', installed: true, session: 'ready', fix: null }],
    metricsDelivery: { enabled: true, variable: 'CT_HARVEST_BQ_TABLE', destination: 'proj:dataset.table' },
  }),
}

describe('Home · navigation shell', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('groups the tools under Herramientas with a danger tag on missing, a neutral tag on unknown, and none on a ready tool', async () => {
    stubFetch(MIXED_SESSIONS)
    openHome()

    const tools = await screen.findByRole('list', { name: 'Herramientas' })
    expect(within(tools).getByText('gh')).toBeInTheDocument()
    expect(within(tools).getByText('bq')).toBeInTheDocument()
    expect(within(tools).getByText('claude')).toBeInTheDocument()
    expect(within(tools).getByText('falta')).toBeInTheDocument()
    expect(within(tools).getByText('sin confirmar')).toBeInTheDocument()
    expect(within(tools).getByText(/claude, then \/login/)).toBeInTheDocument()
    expect(tools.querySelector('.tools-navbar__icon--ready')).toBeInTheDocument()
    expect(tools.querySelector('.tools-navbar__icon--missing')).toBeInTheDocument()
    expect(tools.querySelector('.tools-navbar__icon--informative')).toBeInTheDocument()
  })

  it('renders the metrics delivery as one MenuItem of a Métricas section with an on/off notifier', async () => {
    stubFetch(METRICS_ENABLED)
    openHome()

    const metrics = await screen.findByRole('list', { name: 'Métricas' })
    expect(within(metrics).getByText('Entrega a BigQuery')).toBeInTheDocument()
    expect(within(metrics).getByText('on')).toBeInTheDocument()
    expect(within(metrics).getByText(/proj:dataset\.table/)).toBeInTheDocument()
  })

  it('surveys the tools again when Reintentar comprobación is pressed', async () => {
    const fetching = stubFetch(READY_ONLY)
    const { user } = openHome()
    await screen.findByRole('list', { name: 'Herramientas' })
    const callsBefore = fetching.mock.calls.filter(([url]) => String(url) === '/external-tools').length

    await user.click(screen.getByRole('button', { name: 'Reintentar comprobación' }))

    await waitFor(() => {
      const callsAfter = fetching.mock.calls.filter(([url]) => String(url) === '/external-tools').length
      expect(callsAfter).toBeGreaterThan(callsBefore)
    })
  })

  it('collapses the rail on toggle click, flips aria-expanded both ways and persists the choice', async () => {
    stubFetch(READY_ONLY)
    const { user } = openHome()
    const collapseToggle = await screen.findByRole('button', { name: 'Colapsar el menú' })
    expect(collapseToggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(collapseToggle)

    const expandToggle = screen.getByRole('button', { name: 'Expandir el menú' })
    expect(expandToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toHaveClass('navbar--collapsed')
    expect(window.localStorage.getItem('control-tower.navbar-collapsed')).toBe('true')
  })

  it('leaves the logo to the navbar and shows no second one in the top bar', async () => {
    stubFetch(READY_ONLY)
    openHome()

    await screen.findByRole('list', { name: 'Herramientas' })
    const topBar = document.querySelector('.top-bar') as HTMLElement
    expect(within(topBar).queryByText('CT')).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toHaveTextContent('CT')
  })

  it('shows the product name before a workflow starts and the repo, issue and stage trail once one is running', async () => {
    stubFetch(READY_ONLY)
    const { unmount } = openHome()
    await screen.findByRole('list', { name: 'Herramientas' })
    const topBar = () => document.querySelector('.top-bar') as HTMLElement
    expect(within(topBar()).getByText('Control Tower')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Ruta de navegación' })).not.toBeInTheDocument()
    unmount()

    openRestored({ phase: 'ready' })

    const trail = await screen.findByRole('navigation', { name: 'Ruta de navegación' })
    expect(within(trail).getByText(StartPlanMother.REPO)).toBeInTheDocument()
    expect(within(trail).getByText(`#${StartPlanMother.ISSUE.number}`)).toBeInTheDocument()
    expect(within(trail).getByText('Revisar plan')).toBeInTheDocument()
    expect(within(topBar()).queryByText('Control Tower')).not.toBeInTheDocument()
  })

  it('shows no right column before an implementation runs, and the panel plus Arrancar otro plan only once it does', async () => {
    stubFetch(READY_ONLY)
    const { unmount } = openHome()

    expect(screen.queryByRole('complementary', { name: 'Progreso de la implementación' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arrancar otro plan' })).not.toBeInTheDocument()
    unmount()

    openRestored({ phase: 'implementing' })
    await screen.findByText('Implementación iniciada automáticamente')
    fireEvent.click(screen.getByRole('button', { name: 'Desplegar el panel' }))

    const side = await screen.findByRole('complementary', { name: 'Progreso de la implementación' })
    expect(side).toBeInTheDocument()
    const topBar = document.querySelector('.top-bar')
    expect(topBar).not.toBeNull()
    expect(within(topBar as HTMLElement).getByRole('button', { name: 'Arrancar otro plan' })).toBeInTheDocument()
  })
})
