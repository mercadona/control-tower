import { screen } from '@testing-library/react'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { openHome, startPlan, streamFrame } from './helpers'

type Answer = { status: number; body: string }

const NO_ACTIVE_PLANS: Answer = { status: 200, body: '{"plans":[]}' }
const EXTERNAL_TOOLS_READY: Answer = {
  status: 200,
  body: '{"ready":true,"tools":[{"tool":"gh","installed":true,"session":"ready","fix":null}],"metricsDelivery":{"enabled":false,"variable":"CT_HARVEST_BQ_TABLE","destination":null}}',
}
const SESSIONS: Answer = SessionsMother.oneSession()
const IMPLEMENTING: Answer = { status: 202, body: '{"status":"implementing","agent":"workspace:4","issue":7}' }
const NO_IMPLEMENTATION_RUN_YET: Answer = {
  status: 400,
  body: '{"code":"implementation-progress-not-read","detail":"the worktree is not there yet"}',
}
const NO_IMPLEMENTATION_HISTORY_YET: Answer = {
  status: 400,
  body: '{"code":"implementation-history-not-read","detail":"the worktree is not there yet"}',
}

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status })

vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    open() {}
    write() {}
    onData() {}
    dispose() {}
  }

  return { Terminal: MockTerminal }
})

const stubFetch = () => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === '/active-plans') return responseFor(NO_ACTIVE_PLANS)
    if (url === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
    if (url === '/sessions') return responseFor(SESSIONS)
    if (url === '/start-plan') return responseFor(StartPlanMother.started())
    if (url === '/implement-plan') return responseFor(IMPLEMENTING)
    if (url.startsWith('/implement-progress/')) return responseFor(NO_IMPLEMENTATION_RUN_YET)
    if (url.startsWith('/implement-history/')) return responseFor(NO_IMPLEMENTATION_HISTORY_YET)
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)
  return fetching
}

describe('Home · sessions panel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('the sessions panel is on the page before a plan is requested', () => {
    stubFetch()

    openHome()

    expect(screen.getByRole('region', { name: 'Sesiones en marcha' })).toBeInTheDocument()
  })

  it('the sessions panel is still on the page while an implementation runs', async () => {
    stubFetch()
    const { user } = openHome()

    await startPlan(user)
    await screen.findByRole('status')
    await streamFrame(PlanEventsMother.ready())
    await user.click(screen.getByRole('button', { name: 'Implementar plan' }))
    await screen.findByText('Agente asignado')

    expect(screen.getByRole('region', { name: 'Sesiones en marcha' })).toBeInTheDocument()
  })
})
