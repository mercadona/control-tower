import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { FakeEventSource } from './FakeEventSource'
import { FakeFitAddon, FakeTerminal } from './FakeXterm'
import {
  backendAnswering,
  backendPending,
  openBrainstorming,
  openHome,
  openRestored,
  pressStart,
  typePath,
  typeRepository,
  typeTicket,
} from './helpers'

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

const openFailsToReachBackend = () => {
  const fetching = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
    throw new TypeError('Failed to fetch')
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (input === '/active-plans') return new Response('{"plans":[]}', { status: 200 })
      if (input === '/external-tools') return new Response(ExternalToolsMother.allReady().body, { status: 200 })
      if (input === '/sessions') return new Response(SessionsMother.noSessions().body, { status: 200 })
      if (input === '/coordinating-session' && init === undefined) return new Response(CoordinatingSessionMother.none().body, { status: 200 })
      return fetching(input, init)
    }),
  )

  return fetching
}

describe('Home · opens the brainstorming', () => {
  beforeEach(() => {
    FakeTerminal.install()
    FakeFitAddon.install()
    FakeEventSource.install()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the request as the current first stage', () => {
    openHome()

    expect(screen.getByRole('heading', { name: 'Solicitud' })).toBeInTheDocument()
    const current = screen.getByRole('navigation', { name: 'Flujo del plan' }).querySelector('[aria-current="step"]')
    expect(current).toHaveTextContent('1')
    expect(current).toHaveTextContent('Solicitud')
    expect(current).toHaveTextContent('En curso')
  })

  it('should send exactly the payload the backend contract declares', async () => {
    const fetching = backendAnswering(CoordinatingSessionMother.opened())
    const { user } = openHome()

    await openBrainstorming(user)

    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))
    const [url, init] = fetching.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/coordinating-session')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init.body).toBe(StartPlanMother.REQUEST_BODY)
  })

  it('should translate a known backend refusal for the user', async () => {
    backendAnswering(CoordinatingSessionMother.alreadyLive())
    const { user } = openHome()

    await openBrainstorming(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya hay una sesión coordinadora en marcha.')
  })

  it('should keep the form unlocked after a backend refusal', async () => {
    backendAnswering(CoordinatingSessionMother.alreadyLive())
    const { user } = openHome()

    await openBrainstorming(user)

    await screen.findByRole('alert')
    expect(screen.getByLabelText('Ticket')).toBeEnabled()
    expect(screen.getByLabelText(/Repositorio/)).toBeEnabled()
    expect(screen.getByLabelText(/Ruta local/)).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeEnabled()
  })

  it('should translate the refusal when the path is not a checkout of the repository', async () => {
    backendAnswering(StartPlanMother.notACheckout())
    const { user } = openHome()

    await openBrainstorming(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('La ruta local no corresponde al repositorio indicado.')
  })

  it('should say the backend is unreachable when the network fails', async () => {
    openFailsToReachBackend()
    const { user } = openHome()

    await openBrainstorming(user)

    const recovery = await waitFor(() => {
      const found = document.querySelector('.home__recovery')
      if (found === null) throw new Error('the recovery banner has not appeared yet')
      return found as HTMLElement
    })
    expect(within(recovery).getByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
  })

  it('releases an uncertain opening after the backend authoritatively confirms idle', async () => {
    openFailsToReachBackend()
    const { user } = openHome()

    await openBrainstorming(user)
    await waitFor(() => expect(document.querySelector('.home__recovery')).not.toBeNull())

    expect(screen.getByLabelText('Ticket')).toHaveValue(StartPlanMother.TICKET)
    await waitFor(() => expect(screen.getByLabelText('Ticket')).toBeEnabled())
    expect(document.querySelector('.home__recovery')).not.toBeNull()
  })

  it('should keep the start button disabled until the ticket key is well formed', async () => {
    backendAnswering(CoordinatingSessionMother.opened())
    const { user } = openHome()
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)

    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
    await typeTicket(user, 'abc-1')
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Ticket'))
    await typeTicket(user, 'MO_SHOP-42')
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeEnabled()
    await user.clear(screen.getByLabelText('Ticket'))
    await typeTicket(user, 'https://github.com/owner/name/issues/1x')
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Ticket'))
    await typeTicket(user, 'https://github.com/owner/name/issues/0')
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Ticket'))
    await typeTicket(user, 'https://github.com/owner/../issues/1')
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Ticket'))
    await typeTicket(user, StartPlanMother.ISSUE_URL)
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeEnabled()
  })

  it('should send a github issue url verbatim as the ticket', async () => {
    const fetching = backendAnswering(CoordinatingSessionMother.opened())
    const { user } = openHome()

    await typeTicket(user, StartPlanMother.ISSUE_URL)
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)
    await pressStart(user)

    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))
    const [, init] = fetching.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.body).toBe(StartPlanMother.REQUEST_BODY_ISSUE_URL)
  })

  it('should keep the start button disabled until the repository is well formed', async () => {
    backendAnswering(CoordinatingSessionMother.opened())
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typePath(user, StartPlanMother.PATH)

    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
    await typeRepository(user, 'name')
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
    await user.clear(screen.getByLabelText(/Repositorio/))
    await typeRepository(user, 'owner/name')
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeEnabled()
  })

  it('should keep the start button disabled until the local path is well formed', async () => {
    backendAnswering(CoordinatingSessionMother.opened())
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)

    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
    await typePath(user, '   ')
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
    await user.clear(screen.getByLabelText(/Ruta local/))
    await typePath(user, StartPlanMother.PATH)
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeEnabled()
  })

  it('should send the local path without the spaces the user left around it', async () => {
    const fetching = backendAnswering(CoordinatingSessionMother.opened())
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, `  ${StartPlanMother.PATH}  `)

    await pressStart(user)

    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))
    const [, init] = fetching.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.body).toBe(StartPlanMother.REQUEST_BODY)
  })

  it('should send the local path without the trailing slash the shell adds', async () => {
    const fetching = backendAnswering(CoordinatingSessionMother.opened())
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, `${StartPlanMother.PATH}/`)

    await pressStart(user)

    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))
    const [, init] = fetching.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.body).toBe(StartPlanMother.REQUEST_BODY)
  })

  it('should keep the start button disabled when the path holds an empty segment', async () => {
    backendAnswering(CoordinatingSessionMother.opened())
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)

    await typePath(user, '/Users/pedro//code')

    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
  })

  it('should show the branch and the worktree of the plan being reviewed', async () => {
    openRestored({ phase: 'planning' })

    await screen.findByRole('status')
    expect(screen.getByLabelText('Progreso del plan')).toHaveTextContent(StartPlanMother.BRANCH)
    expect(screen.getByLabelText('Progreso del plan')).toHaveTextContent(StartPlanMother.WORKTREE)
  })

  it('should show a compact read-only request summary when the completed request reopens', async () => {
    const { user } = openRestored({ phase: 'planning' })

    await screen.findByRole('status')
    await user.click(screen.getByRole('button', { name: /Solicitud Completado/ }))
    expect(screen.getByText('Ticket').parentElement).toHaveTextContent(StartPlanMother.TICKET)
    expect(screen.getByText('Repositorio').parentElement).toHaveTextContent(StartPlanMother.REPO)
    expect(screen.getByText('Ruta local').parentElement).toHaveTextContent(StartPlanMother.PATH)
  })

  it('should prevent duplicate plan starts once a workflow exists', async () => {
    openRestored({ phase: 'planning' })

    await screen.findByRole('status')
    expect(screen.queryByRole('button', { name: 'Arrancar brainstorming' })).toBeNull()
    expect(screen.getByRole('button', { name: /Solicitud Completado/ })).toBeEnabled()
  })

  it('should prevent a duplicate open while a request is in flight', async () => {
    const backend = backendPending()
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)

    await user.dblClick(screen.getByRole('button', { name: 'Arrancar brainstorming' }))

    expect(backend.fetching.mock.calls.filter(([input, init]) => input === '/coordinating-session' && (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Abriendo el brainstorming/ })).toBeDisabled()
    await backend.answerWith(CoordinatingSessionMother.opened())
  })

  it('should keep the start button disabled without a ticket', async () => {
    backendAnswering(CoordinatingSessionMother.opened())
    const { user } = openHome()
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)

    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
  })

})
