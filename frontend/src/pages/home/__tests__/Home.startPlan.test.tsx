import { cleanup, screen, waitFor } from '@testing-library/react'
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
  pressStart,
  typePath,
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
    expect(screen.getByLabelText(/Ruta local/)).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeEnabled()
  })

  it('should translate the refusal when the path is not a git clone of a GitHub repository', async () => {
    backendAnswering(StartPlanMother.notACheckout())
    const { user } = openHome()

    await openBrainstorming(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('La ruta local no es un clon de git de un repositorio de GitHub.')
  })

  it('should say the backend is unreachable when the network fails', async () => {
    openFailsToReachBackend()
    const { user } = openHome()

    await openBrainstorming(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
  })

  it('keeps the ticket value and re-enables the form after a failed open, with the notice still shown', async () => {
    openFailsToReachBackend()
    const { user } = openHome()

    await openBrainstorming(user)
    await screen.findByRole('alert')

    expect(screen.getByLabelText('Ticket')).toHaveValue(StartPlanMother.TICKET)
    await waitFor(() => expect(screen.getByLabelText('Ticket')).toBeEnabled())
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
  })

  it('should keep the start button disabled until the ticket key is well formed', async () => {
    backendAnswering(CoordinatingSessionMother.opened())
    const { user } = openHome()
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
    await typePath(user, StartPlanMother.PATH)
    await pressStart(user)

    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))
    const [, init] = fetching.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.body).toBe(StartPlanMother.REQUEST_BODY_ISSUE_URL)
  })

  it('should keep the start button disabled until the local path is well formed', async () => {
    backendAnswering(CoordinatingSessionMother.opened())
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)

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

    await typePath(user, '/Users/pedro//code')

    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
  })

  it('should prevent a duplicate open while a request is in flight', async () => {
    const backend = backendPending()
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typePath(user, StartPlanMother.PATH)

    await user.dblClick(screen.getByRole('button', { name: 'Arrancar brainstorming' }))

    expect(backend.fetching.mock.calls.filter(([input, init]) => input === '/coordinating-session' && (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Abriendo el brainstorming/ })).toBeDisabled()
    await backend.answerWith(CoordinatingSessionMother.opened())
  })

  it('should keep the start button disabled without a ticket', async () => {
    backendAnswering(CoordinatingSessionMother.opened())
    const { user } = openHome()
    await typePath(user, StartPlanMother.PATH)

    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
  })

})
