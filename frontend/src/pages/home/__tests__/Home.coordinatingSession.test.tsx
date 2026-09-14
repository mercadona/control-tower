import { screen } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { openHome } from './helpers'

type Answer = { status: number; body: string }

const NO_ACTIVE_PLANS: Answer = { status: 200, body: '{"plans":[]}' }
const ALREADY_LIVE_HELP = 'Ya hay una conversación coordinadora en marcha. Termínala antes de abrir otra.'

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status })

const backendHolding = (coordinatingSession: Answer) => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    if (input === '/coordinating-session') return responseFor(coordinatingSession)
    if (input === '/external-tools') return responseFor(ExternalToolsMother.allReady())
    if (input === '/sessions') return responseFor(SessionsMother.noSessions())
    return responseFor(NO_ACTIVE_PLANS)
  })
  vi.stubGlobal('fetch', fetching)

  return fetching
}

const readsOfTheCoordinatingSession = (fetching: ReturnType<typeof backendHolding>) =>
  fetching.mock.calls.filter(([input]) => input === '/coordinating-session')

describe('Home and the coordinating session', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refuses to open a second brainstorming while one is live', async () => {
    backendHolding(CoordinatingSessionMother.working())

    openHome()

    expect(await screen.findByText(ALREADY_LIVE_HELP)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
  })

  it('lets the brainstorming be opened while nothing is held', async () => {
    backendHolding(CoordinatingSessionMother.none())

    openHome()

    expect(await screen.findByRole('button', { name: 'Arrancar brainstorming' })).toBeInTheDocument()
    expect(screen.queryByText(ALREADY_LIVE_HELP)).not.toBeInTheDocument()
  })

  it('reads the coordinating session through a single poller', async () => {
    const fetching = backendHolding(CoordinatingSessionMother.working())

    openHome()
    await screen.findByText(ALREADY_LIVE_HELP)

    expect(readsOfTheCoordinatingSession(fetching)).toHaveLength(1)
  })
})
