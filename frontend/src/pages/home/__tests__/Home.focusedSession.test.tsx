import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { FakeEventSource } from './FakeEventSource'
import { FakeFitAddon, FakeTerminal } from './FakeXterm'
import { openHome } from './helpers'

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

type Answer = { status: number; body: string }
type Backend = {
  session?: () => Answer
  specFreeze?: Answer
  epicGroom?: Answer
  activePlans?: Answer
}

const NO_ACTIVE_PLANS: Answer = { status: 200, body: '{"plans":[]}' }
const INCONCLUSIVE_PLANS: Answer = {
  status: 400,
  body: '{"code":"active-plans-recovery-inconclusive","detail":"cmux could not be asked"}',
}

class Plans {
  static planning(issue: { number: number; url: string }): Answer {
    return {
      status: 200,
      body: JSON.stringify({
        plans: [{
          phase: 'planning',
          request: { id: StartPlanMother.TICKET, repo: StartPlanMother.REPO, path: StartPlanMother.PATH },
          plan: {
            id: StartPlanMother.TICKET, repo: StartPlanMother.REPO, issue, agent: StartPlanMother.AGENT,
            branch: StartPlanMother.BRANCH, worktree: StartPlanMother.WORKTREE,
          },
        }],
      }),
    }
  }

  static ofAnotherStory(): Answer {
    return Plans.planning(StartPlanMother.ISSUE)
  }

  static ofThisStory(): Answer {
    return Plans.planning({ number: EpicGroomMother.READY_GATE.number, url: EpicGroomMother.READY_GATE.url })
  }
}

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status })

const backendWith = ({
  session = CoordinatingSessionMother.working,
  specFreeze = SpecFreezeMother.none(),
  epicGroom = EpicGroomMother.none(),
  activePlans = NO_ACTIVE_PLANS,
}: Backend = {}) => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    if (input === '/coordinating-session') return responseFor(session())
    if (input === '/external-tools') return responseFor(ExternalToolsMother.allReady())
    if (input === '/sessions') return responseFor(SessionsMother.noSessions())
    if (input === '/active-plans') return responseFor(activePlans)
    if (input === '/spec-freeze') return responseFor(specFreeze)
    if (input === '/epic-groom') return responseFor(epicGroom)
    return responseFor({ status: 404, body: '{"code":"not-found","detail":"not found"}' })
  })
  vi.stubGlobal('fetch', fetching)

  return fetching
}

const focusedHeading = async () => {
  await screen.findByRole('navigation', { name: 'Pasos de la sesión' })

  return screen.getByRole('heading', { level: 1 })
}

describe('Home while a coordinating session is live and no plan is in progress', () => {
  beforeEach(() => {
    FakeTerminal.install()
    FakeFitAddon.install()
    FakeEventSource.install()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows only the header of the step and the session, with nothing of the request view around it', async () => {
    backendWith()

    openHome()

    expect(await focusedHeading()).toHaveTextContent('Brainstorming')
    expect(screen.getByText(`${CoordinatingSessionMother.STORY} ·`, { exact: false })).toBeInTheDocument()
    expect(screen.getByText(CoordinatingSessionMother.REPO)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: CoordinatingSessionMother.SESSION.name })).toBeInTheDocument()
    expect(screen.queryByLabelText('Ticket')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Flujo del plan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Slices en vuelo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Etapas completadas' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Sesión coordinadora' })).not.toBeInTheDocument()
  })

  it.each([
    ['nothing written yet', SpecFreezeMother.none(), EpicGroomMother.none(), 'Brainstorming'],
    ['a draft spec', SpecFreezeMother.draftReady(), EpicGroomMother.draft(), 'Congelación del spec'],
    ['a frozen spec ready to groom', SpecFreezeMother.frozen(), EpicGroomMother.groomable(), 'Groom y autorización'],
    ['a frozen spec waiting for its merge', SpecFreezeMother.frozen(), EpicGroomMother.awaitingPublication(), 'Groom y autorización'],
    ['authorised work', SpecFreezeMother.frozen(), EpicGroomMother.authorised(), 'Implementación'],
  ])('names the step the gates are at, with %s', async (_, specFreeze, epicGroom, step) => {
    backendWith({ specFreeze, epicGroom })

    openHome()

    await vi.waitFor(async () => expect(await focusedHeading()).toHaveTextContent(step))
    const steps = screen.getByRole('navigation', { name: 'Pasos de la sesión' })
    expect(within(steps).getByText(step).closest('li')).toHaveAttribute('aria-current', 'step')
  })

  it('puts the freeze in a band above the session while the spec is a draft', async () => {
    backendWith({ specFreeze: SpecFreezeMother.draftReady(), epicGroom: EpicGroomMother.draft() })

    openHome()

    const band = await screen.findByRole('region', { name: 'Puerta 1 · Congelación del spec' })
    expect(await within(band).findByRole('button', { name: 'Congelar el spec' })).toBeInTheDocument()
  })

  it('puts the groom in a band above the session while gate 2 asks for it', async () => {
    backendWith({ specFreeze: SpecFreezeMother.frozen(), epicGroom: EpicGroomMother.groomable() })

    openHome()

    const band = await screen.findByRole('region', { name: 'Puerta 2 · El groom y la autorización' })
    expect(await within(band).findByRole('button', { name: 'Ejecutar el groom' })).toBeInTheDocument()
  })

  it.each([
    ['no spec yet', SpecFreezeMother.noSpec(), EpicGroomMother.noSpec(), 'Brainstorming'],
    ['a spec waiting for its merge', SpecFreezeMother.frozen(), EpicGroomMother.awaitingPublication(), 'Groom y autorización'],
    ['authorised work', SpecFreezeMother.frozen(), EpicGroomMother.authorised(), 'Implementación'],
  ])('shows no band when no gate asks for anything, with %s', async (_, specFreeze, epicGroom, step) => {
    backendWith({ specFreeze, epicGroom })

    openHome()

    await vi.waitFor(async () => expect(await focusedHeading()).toHaveTextContent(step))
    expect(screen.queryByRole('region', { name: /^Puerta/ })).not.toBeInTheDocument()
  })

  it('offers cancelling the session as a secondary action', async () => {
    backendWith()

    openHome()

    const cancel = await screen.findByRole('button', { name: 'Cancelar la sesión' })
    expect(cancel).toHaveClass('button--secondary')
  })

  it('says once that the backend is unreachable when the session poll fails, and keeps the session in front', async () => {
    let reads = 0
    backendWith({
      session: () => {
        reads += 1
        if (reads > 1) throw new TypeError('offline')
        return CoordinatingSessionMother.working()
      },
    })

    openHome()
    await focusedHeading()

    await vi.waitFor(() => expect(screen.getAllByText('Sin conexión con el backend')).toHaveLength(1), { timeout: 4000 })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Brainstorming')
    expect(screen.queryByText('No se pudo comprobar el estado del plan')).not.toBeInTheDocument()
  })

  it('does not show what the inventory of other stories could not tell', async () => {
    backendWith({ activePlans: INCONCLUSIVE_PLANS })

    openHome()
    await focusedHeading()

    expect(screen.queryByText('No se puede saber qué hay en marcha')).not.toBeInTheDocument()
  })

  it('does not let a single plan of another story take the page over', async () => {
    const fetching = backendWith({ activePlans: Plans.ofAnotherStory() })

    openHome()
    await vi.waitFor(() => expect(fetching.mock.calls.some(([input]) => input === '/active-plans')).toBe(true))

    expect(await focusedHeading()).toHaveTextContent('Brainstorming')
    expect(screen.queryByRole('region', { name: 'Implementación' })).not.toBeInTheDocument()
  })

  it('gives today’s view back once the session ends', async () => {
    let ended = false
    backendWith({ session: () => ended ? CoordinatingSessionMother.ended() : CoordinatingSessionMother.working() })

    openHome()
    await focusedHeading()
    ended = true

    expect(await screen.findByText('La conversación coordinadora ha terminado', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Pasos de la sesión' })).not.toBeInTheDocument()
  })

  it('gives today’s view back once a plan of this story is in progress', async () => {
    const fetching = backendWith({
      specFreeze: SpecFreezeMother.frozen(),
      epicGroom: EpicGroomMother.authorised(),
      activePlans: Plans.ofThisStory(),
    })

    openHome()

    await vi.waitFor(() => expect(fetching.mock.calls.some(([input]) => input === '/epic-groom')).toBe(true))

    expect((await screen.findAllByRole('region', { name: 'Implementación' }, { timeout: 4000 })).length).toBeGreaterThan(0)
    expect(screen.queryByRole('navigation', { name: 'Pasos de la sesión' })).not.toBeInTheDocument()
  })

  it('cancels the session from the header', async () => {
    const fetching = backendWith()

    openHome()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar la sesión' }))

    await vi.waitFor(() => expect(fetching.mock.calls.some(([input]) => input === '/coordinating-session/close')).toBe(true))
  })
})
