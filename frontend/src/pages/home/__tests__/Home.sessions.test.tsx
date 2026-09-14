import { screen, waitFor } from '@testing-library/react'
import { Terminal } from '@xterm/xterm'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { FakeEventSource } from './FakeEventSource'
import { openHome } from './helpers'

type Answer = { status: number; body: string }
type FakeTerminal = { onDataHandler: ((text: string) => void) | null; written: string[] }

const NO_ACTIVE_PLANS: Answer = { status: 200, body: '{"plans":[]}' }
const SESSION_ID = 'a1'
const IMPLEMENTING_ACTIVE_PLAN: Answer = {
  status: 200,
  body: JSON.stringify({
    plans: [{
      phase: 'implementing',
      request: { id: StartPlanMother.TICKET, repo: StartPlanMother.REPO, path: StartPlanMother.PATH },
      plan: {
        id: StartPlanMother.TICKET,
        repo: StartPlanMother.REPO,
        issue: StartPlanMother.ISSUE,
        agent: StartPlanMother.AGENT,
        branch: StartPlanMother.BRANCH,
        worktree: StartPlanMother.WORKTREE,
      },
    }],
  }),
}
const EXTERNAL_TOOLS_READY: Answer = {
  status: 200,
  body: '{"ready":true,"tools":[{"tool":"gh","installed":true,"session":"ready","fix":null}],"metricsDelivery":{"enabled":false,"variable":"CT_HARVEST_BQ_TABLE","destination":null}}',
}
const SESSIONS: Answer = SessionsMother.oneSession()
const TYPED: Answer = { status: 202, body: `{"status":"typed","id":"${SESSION_ID}"}` }
const NO_COORDINATING_SESSION: Answer = CoordinatingSessionMother.none()
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
    static instances: MockTerminal[] = []
    onDataHandler: ((text: string) => void) | null = null
    written: string[] = []

    constructor() {
      MockTerminal.instances.push(this)
    }

    open() {}
    write(data: string) { this.written.push(data) }
    reset() { this.written = [] }
    onData(handler: (text: string) => void) { this.onDataHandler = handler }
    dispose() {}
  }

  return { Terminal: MockTerminal }
})

const lastTerminal = (): FakeTerminal => {
  const instances = (Terminal as unknown as { instances: FakeTerminal[] }).instances
  const instance = instances.at(-1)
  if (instance === undefined) throw new Error('no terminal was created')

  return instance
}

const stubFetch = (activePlans: Answer, coordinatingSession: Answer = NO_COORDINATING_SESSION) => {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === '/active-plans') return responseFor(activePlans)
    if (url === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
    if (url === '/sessions') return responseFor(SESSIONS)
    if (url === `/sessions/${SESSION_ID}/input`) return responseFor(TYPED)
    if (url === '/coordinating-session' && init === undefined) return responseFor(coordinatingSession)
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
    stubFetch(NO_ACTIVE_PLANS)

    openHome()

    expect(screen.getByRole('region', { name: 'Sesiones en marcha' })).toBeInTheDocument()
  })

  it('keeps the coordinating session reachable while a slice is implemented', async () => {
    const fetching = stubFetch(IMPLEMENTING_ACTIVE_PLAN)
    openHome()

    await screen.findByText('Agente asignado')
    expect(screen.getByRole('region', { name: 'Terminal de la sesión' })).toBeInTheDocument()

    lastTerminal().onDataHandler?.('ls -la')

    await waitFor(() =>
      expect(fetching).toHaveBeenCalledWith(`/sessions/${SESSION_ID}/input`, expect.objectContaining({ method: 'POST' })),
    )
  })

  it('replays what was already said when the page reloads', async () => {
    stubFetch(NO_ACTIVE_PLANS)
    const { unmount } = openHome()
    await screen.findByRole('region', { name: 'Terminal de la sesión' })
    FakeEventSource.last().receive('{"bytes":"scrollback"}')
    expect(lastTerminal().written).toEqual(['scrollback'])
    unmount()

    stubFetch(NO_ACTIVE_PLANS)
    openHome()
    await screen.findByRole('region', { name: 'Terminal de la sesión' })
    FakeEventSource.last().receive('{"bytes":"scrollback"}')
    expect(lastTerminal().written).toEqual(['scrollback'])
  })

  it("shows the coordinating session's live question", async () => {
    stubFetch(NO_ACTIVE_PLANS, CoordinatingSessionMother.waiting())

    openHome()

    expect(await screen.findByText((text) => text.includes(CoordinatingSessionMother.QUESTION))).toBeInTheDocument()
  })
})
