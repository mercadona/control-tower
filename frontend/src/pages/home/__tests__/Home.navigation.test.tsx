import { screen, waitFor, within } from '@testing-library/react'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { openHome, startPlan, streamFrame } from './helpers'

type Answer = { status: number; body: string }

const IMPLEMENT_BUTTON = { name: 'Implementar plan' }
const NO_ACTIVE_PLANS = { status: 200, body: '{"plans":[]}' }
const IMPLEMENTING = { status: 202, body: '{"status":"implementing","agent":"workspace:4","issue":7}' }
const NO_IMPLEMENTATION_HISTORY_YET = { status: 400, body: '{"code":"implementation-history-not-read","detail":"not read yet"}' }

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status })

const stubFetch = (externalTools: Answer) => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === '/external-tools') return responseFor(externalTools)
    if (url === '/active-plans') return responseFor(NO_ACTIVE_PLANS)
    if (url === '/start-plan') return responseFor(StartPlanMother.started())
    if (url === '/implement-plan') return responseFor(IMPLEMENTING)
    if (url.startsWith('/implement-progress/')) return responseFor(ImplementProgressMother.notRead())
    if (url.startsWith('/implement-history/')) return responseFor(NO_IMPLEMENTATION_HISTORY_YET)
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

  it('groups the tools under Herramientas with the session tag on the two attention states and none for a ready tool', async () => {
    stubFetch(MIXED_SESSIONS)
    openHome()

    const tools = await screen.findByRole('list', { name: 'Herramientas' })
    expect(within(tools).getByText('gh')).toBeInTheDocument()
    expect(within(tools).getByText('bq')).toBeInTheDocument()
    expect(within(tools).getByText('claude')).toBeInTheDocument()
    expect(within(tools).getByText('falta')).toBeInTheDocument()
    expect(within(tools).getByText('login')).toBeInTheDocument()
    expect(tools.querySelector('.tools-navbar__icon--ready')).toBeInTheDocument()
    expect(tools.querySelector('.tools-navbar__icon--missing')).toBeInTheDocument()
    expect(tools.querySelector('.tools-navbar__icon--unknown')).toBeInTheDocument()
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
    const { user } = openHome()
    await screen.findByRole('list', { name: 'Herramientas' })
    const topBar = () => document.querySelector('.top-bar') as HTMLElement
    expect(within(topBar()).getByText('Control Tower')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Ruta de navegación' })).not.toBeInTheDocument()

    await startPlan(user)

    const trail = await screen.findByRole('navigation', { name: 'Ruta de navegación' })
    expect(within(trail).getByText(StartPlanMother.REPO)).toBeInTheDocument()
    expect(within(trail).getByText(`#${StartPlanMother.ISSUE.number}`)).toBeInTheDocument()
    expect(within(trail).getByText('Revisar plan')).toBeInTheDocument()
    expect(within(topBar()).queryByText('Control Tower')).not.toBeInTheDocument()
  })

  it('shows a status line in the right column before an implementation runs, and Arrancar otro plan only once it does', async () => {
    stubFetch(READY_ONLY)
    const { user } = openHome()

    const side = await screen.findByRole('complementary', { name: 'Progreso de la implementación' })
    expect(within(side).getByText('No hay ninguna implementación en curso')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arrancar otro plan' })).not.toBeInTheDocument()

    await startPlan(user)
    await screen.findByRole('status')
    await streamFrame(PlanEventsMother.ready())
    await user.click(screen.getByRole('button', IMPLEMENT_BUTTON))
    await screen.findByText('Agente asignado')

    const topBar = document.querySelector('.top-bar')
    expect(topBar).not.toBeNull()
    expect(within(topBar as HTMLElement).getByRole('button', { name: 'Arrancar otro plan' })).toBeInTheDocument()
    expect(within(side).queryByText('No hay ninguna implementación en curso')).not.toBeInTheDocument()
  })
})
