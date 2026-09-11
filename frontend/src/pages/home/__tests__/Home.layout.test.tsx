import { screen } from '@testing-library/react'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { openHome, startPlan, streamFrame } from './helpers'

type Answer = { status: number; body: string }

const IMPLEMENT_BUTTON = { name: 'Implementar plan' }
const NO_ACTIVE_PLANS: Answer = { status: 200, body: '{"plans":[]}' }
const EXTERNAL_TOOLS_READY: Answer = {
  status: 200,
  body: JSON.stringify({
    ready: true,
    tools: [{ tool: 'gh', installed: true, session: 'ready', fix: null }],
    metricsDelivery: { enabled: false, variable: 'CT_HARVEST_BQ_TABLE', destination: null },
  }),
}
const IMPLEMENTING: Answer = { status: 202, body: '{"status":"implementing","agent":"workspace:4","issue":7}' }
const NO_IMPLEMENTATION_PROGRESS_YET: Answer = {
  status: 400,
  body: '{"code":"implementation-progress-not-read","detail":"not read yet"}',
}
const NO_IMPLEMENTATION_HISTORY_YET: Answer = {
  status: 400,
  body: '{"code":"implementation-history-not-read","detail":"not read yet"}',
}

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status })

const stubBackend = (startPlanAnswer: Answer) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
      if (url === '/active-plans') return responseFor(NO_ACTIVE_PLANS)
      if (url === '/start-plan') return responseFor(startPlanAnswer)
      if (url === '/implement-plan') return responseFor(IMPLEMENTING)
      if (url.startsWith('/implement-progress/')) return responseFor(NO_IMPLEMENTATION_PROGRESS_YET)
      if (url.startsWith('/implement-history/')) return responseFor(NO_IMPLEMENTATION_HISTORY_YET)
      throw new Error(`unexpected fetch to ${url}`)
    }),
  )
}

const startImplementation = async (user: ReturnType<typeof openHome>['user']) => {
  await startPlan(user)
  await screen.findByRole('status')
  await streamFrame(PlanEventsMother.ready())
  await user.click(screen.getByRole('button', IMPLEMENT_BUTTON))
  await screen.findByText('Agente asignado')
}

describe('Home · layout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps only the work area at first paint, and adds the right column once an implementation starts', async () => {
    stubBackend(StartPlanMother.started())
    const { user } = openHome()

    await screen.findByRole('navigation', { name: 'Navegación principal' })
    const columns = document.querySelector('.home__columns')
    expect(columns).not.toBeNull()
    expect(columns?.children).toHaveLength(1)
    expect(columns?.firstElementChild?.tagName).toBe('MAIN')
    expect(screen.queryByRole('complementary', { name: 'Progreso de la implementación' })).not.toBeInTheDocument()

    await startImplementation(user)

    expect(columns?.lastElementChild).toBe(screen.getByRole('complementary', { name: 'Progreso de la implementación' }))
    expect(document.querySelector('.top-bar')?.closest('.home__columns')).toBeNull()
  })

  it('keeps the baseline notice of a started plan inside the work area beside the right column', async () => {
    stubBackend(StartPlanMother.startedOnARedRepository())
    const { user } = openHome()

    await startPlan(user)

    const notice = await screen.findByText('El repositorio ya estaba en rojo antes de empezar')
    expect(notice).toBeVisible()
    expect(notice.closest('main')).not.toBeNull()
    const columns = notice.closest('.home__columns')
    expect(columns).not.toBeNull()

    await screen.findByText('Plan arrancado')
    await streamFrame(PlanEventsMother.ready())
    await user.click(screen.getByRole('button', IMPLEMENT_BUTTON))
    await screen.findByText('Agente asignado')

    expect(screen.getByRole('complementary', { name: 'Progreso de la implementación' }).closest('.home__columns'))
      .toBe(columns)
  })

  it('never turns the right column into a dialog: it is a sibling of main once implementation starts', async () => {
    stubBackend(StartPlanMother.started())
    const { user } = openHome()

    await startImplementation(user)

    const side = await screen.findByRole('complementary', { name: 'Progreso de la implementación' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(side.previousElementSibling?.tagName).toBe('MAIN')
  })
})
