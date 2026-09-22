import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { FakeEventSource } from './FakeEventSource'
import { FakeFitAddon, FakeTerminal } from './FakeXterm'
import { openHome } from './helpers'

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

type Answer = { status: number; body: string }

const NO_ACTIVE_PLANS: Answer = { status: 200, body: '{"plans":[]}' }
const ALREADY_LIVE_HELP = 'Ya hay una conversación coordinadora en marcha. Termínala antes de abrir otra.'

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status })

const backendHolding = (coordinatingSession: Answer, closeAnswer?: Answer | (() => Answer)) => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    if (input === '/coordinating-session') return responseFor(coordinatingSession)
    if (input === '/coordinating-session/close' && closeAnswer !== undefined) {
      return responseFor(typeof closeAnswer === 'function' ? closeAnswer() : closeAnswer)
    }
    if (input === '/external-tools') return responseFor(ExternalToolsMother.allReady())
    if (input === '/sessions') return responseFor(SessionsMother.noSessions())
    if (input === '/active-plans') return responseFor(NO_ACTIVE_PLANS)
    if (input === '/spec-freeze') return responseFor(SpecFreezeMother.none())
    if (input === '/epic-groom') return responseFor(EpicGroomMother.none())
    throw new Error(`unexpected fetch to ${String(input)}`)
  })
  vi.stubGlobal('fetch', fetching)

  return fetching
}

const readsOfTheCoordinatingSession = (fetching: ReturnType<typeof backendHolding>) =>
  fetching.mock.calls.filter(([input]) => input === '/coordinating-session')

describe('Home and the coordinating session', () => {
  beforeEach(() => {
    FakeTerminal.install()
    FakeFitAddon.install()
    FakeEventSource.install()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('refuses to open a second brainstorming while one is live', async () => {
    backendHolding(CoordinatingSessionMother.working())

    openHome()

    expect(await screen.findByText(ALREADY_LIVE_HELP)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
  })

  it('lets the brainstorming be opened while nothing is held', async () => {
    backendHolding(CoordinatingSessionMother.none())

    openHome()

    await vi.waitFor(() => expect(screen.getByLabelText('Ticket')).toBeEnabled())
    expect(screen.queryByText(ALREADY_LIVE_HELP)).not.toBeInTheDocument()
  })

  it('keeps an ended conversation visible while permitting replacement and offers explicit closure', async () => {
    backendHolding(CoordinatingSessionMother.ended())

    openHome()
    await screen.findByRole('button', { name: 'Cerrar sesión' })

    expect(await screen.findByRole('alert')).toHaveTextContent('La conversación coordinadora ha terminado')
    expect(screen.queryByText(ALREADY_LIVE_HELP)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Ticket')).toBeEnabled()
  })

  it('reads the coordinating session through a single poller', async () => {
    const fetching = backendHolding(CoordinatingSessionMother.working())

    openHome()
    await screen.findByText(ALREADY_LIVE_HELP)

    expect(readsOfTheCoordinatingSession(fetching)).toHaveLength(1)
  })

  it('cancels the exact target and clears its presentation only after confirmation', async () => {
    const fetching = backendHolding(CoordinatingSessionMother.working(), {
      status: 200,
      body: JSON.stringify({
        status: 'closed',
        conversation: CoordinatingSessionMother.CONVERSATION,
        target: CoordinatingSessionMother.TARGET,
      }),
    })
    openHome()

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar la sesión' }))

    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Cancelar la sesión' })).not.toBeInTheDocument())
    expect(fetching).toHaveBeenCalledWith('/coordinating-session/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation: CoordinatingSessionMother.CONVERSATION,
        target: CoordinatingSessionMother.TARGET,
      }),
    })
  })

  it('keeps the terminal visible while durable cancellation is pending', async () => {
    let confirm: (response: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => { confirm = resolve })
    const fetching = backendHolding(CoordinatingSessionMother.working())
    fetching.mockImplementation((input: string | URL | Request) => {
      if (input === '/coordinating-session/close') return pending
      if (input === '/coordinating-session') return Promise.resolve(responseFor(CoordinatingSessionMother.working()))
      if (input === '/external-tools') return Promise.resolve(responseFor(ExternalToolsMother.allReady()))
      if (input === '/sessions') return Promise.resolve(responseFor(SessionsMother.oneSession()))
      if (input === '/active-plans') return Promise.resolve(responseFor(NO_ACTIVE_PLANS))
      if (input === '/spec-freeze') return Promise.resolve(responseFor(SpecFreezeMother.draftReady()))
      if (input === '/epic-groom') return Promise.resolve(responseFor(EpicGroomMother.groomable()))
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    openHome()

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar la sesión' }))

    expect(await screen.findByRole('button', { name: 'Cancelando…' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'brainstorming' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'zsh' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Congelar el spec' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ejecutar el groom' })).toBeDisabled()

    await act(async () => confirm(new Response(JSON.stringify({
      status: 'closed',
      conversation: CoordinatingSessionMother.CONVERSATION,
      target: CoordinatingSessionMother.TARGET,
    }))))
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Cancelando…' })).not.toBeInTheDocument())
  })

  it('keeps a failed cancellation visible for retry', async () => {
    let attempts = 0
    backendHolding(CoordinatingSessionMother.working(), () => {
      attempts += 1
      return attempts === 1
        ? {
            status: 400,
            body: JSON.stringify({ code: 'session-not-terminated', detail: 'the process is still running' }),
          }
        : {
            status: 200,
            body: JSON.stringify({
              status: 'closed',
              conversation: CoordinatingSessionMother.CONVERSATION,
              target: CoordinatingSessionMother.TARGET,
            }),
          }
    })
    openHome()

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar la sesión' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo inspeccionar o terminar la sesión. Vuelve a intentarlo; las sesiones nuevas seguirán bloqueadas hasta confirmar el cierre.'
    )
    expect(screen.getByRole('button', { name: 'Cancelar la sesión' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar la sesión' }))

    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Cancelar la sesión' })).not.toBeInTheDocument())
    expect(attempts).toBe(2)
  })

  it('closure retry guidance remains usable until confirmation clears only the old target', async () => {
    let attempts = 0
    const ended = CoordinatingSessionMother.ended()
    ended.body = JSON.stringify({
      ...JSON.parse(ended.body),
      operation: 'close-failed',
      closureError: {
        code: 'session-termination-permission-denied',
        detail: 'permission denied for the saved process group',
      },
    })
    backendHolding(ended, () => {
      attempts += 1
      return attempts === 1
        ? {
            status: 400,
            body: JSON.stringify({
              code: 'session-ownership-unverifiable',
              detail: 'the original identity is unavailable',
            }),
          }
        : {
            status: 200,
            body: JSON.stringify({
              status: 'closed',
              conversation: CoordinatingSessionMother.CONVERSATION,
              target: CoordinatingSessionMother.TARGET,
            }),
          }
    })
    openHome()

    expect(await screen.findByText(/El sistema no tiene permisos para verificar/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Cerrar sesión' })).toBeEnabled()
    expect(screen.getByLabelText('Ticket')).toBeDisabled()
    expect(screen.queryByRole('tab', { name: 'brainstorming' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(await screen.findByText(/No hay identidad original suficiente para terminar/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument())
    await vi.waitFor(() => expect(screen.getByLabelText('Ticket')).toBeEnabled())
    expect(attempts).toBe(2)
  })

  it('offers closure for an unresumable conversation without a terminal tab', async () => {
    backendHolding(CoordinatingSessionMother.unresumable())

    openHome()

    expect(await screen.findByRole('button', { name: 'Cerrar sesión' })).toBeEnabled()
    expect(screen.queryByRole('tab', { name: 'brainstorming' })).not.toBeInTheDocument()
  })

  it.each([
    ['ended', CoordinatingSessionMother.ended],
    ['unresumable', CoordinatingSessionMother.unresumable],
  ])('durably closes a held %s conversation', async (_kind, answer) => {
    backendHolding(answer(), {
      status: 200,
      body: JSON.stringify({
        status: 'closed',
        conversation: CoordinatingSessionMother.CONVERSATION,
        target: CoordinatingSessionMother.TARGET,
      }),
    })
    openHome()

    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }))

    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument())
    await vi.waitFor(() => expect(screen.getByLabelText('Ticket')).toBeEnabled())
  })

  it('preserves every request field while an externally discovered session is closed', async () => {
    vi.useFakeTimers()
    let reads = 0
    let closed = false
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (input === '/coordinating-session/close') {
        closed = true
        return new Response(JSON.stringify({
          status: 'closed',
          conversation: CoordinatingSessionMother.CONVERSATION,
          target: CoordinatingSessionMother.TARGET,
        }))
      }
      if (input === '/coordinating-session') {
        reads += 1
        return responseFor(closed || reads === 1 ? CoordinatingSessionMother.none() : CoordinatingSessionMother.working())
      }
      if (input === '/active-plans') return responseFor(NO_ACTIVE_PLANS)
      if (input === '/external-tools') return responseFor(ExternalToolsMother.allReady())
      if (input === '/sessions') return responseFor(SessionsMother.noSessions())
      if (input === '/spec-freeze') return responseFor(SpecFreezeMother.none())
      if (input === '/epic-groom') return responseFor(EpicGroomMother.none())
      throw new Error(`unexpected fetch to ${String(input)}`)
    }))
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByLabelText('Ticket')).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Ticket'), { target: { value: 'ABC-123' } })
    fireEvent.change(screen.getByLabelText('Qué quieres planificar'), { target: { value: 'Mantener esta idea' } })
    fireEvent.change(screen.getByLabelText(/Repositorio/), { target: { value: 'owner/name' } })
    fireEvent.change(screen.getByLabelText(/Ruta local/), { target: { value: '/repo' } })

    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(screen.getByRole('button', { name: 'Cancelar la sesión' })).toBeEnabled()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancelar la sesión' })))

    expect(screen.getByLabelText('Ticket')).toHaveValue('ABC-123')
    expect(screen.getByLabelText('Qué quieres planificar')).toHaveValue('Mantener esta idea')
    expect(screen.getByLabelText(/Repositorio/)).toHaveValue('owner/name')
    expect(screen.getByLabelText(/Ruta local/)).toHaveValue('/repo')
  })

  it('gate 2 offers no ask while the live conversation is working, and says what to wait for', async () => {
    const fetching = backendHolding(CoordinatingSessionMother.working())
    fetching.mockImplementation((input: string | URL | Request) => {
      if (input === '/coordinating-session') return Promise.resolve(responseFor(CoordinatingSessionMother.working()))
      if (input === '/external-tools') return Promise.resolve(responseFor(ExternalToolsMother.allReady()))
      if (input === '/sessions') return Promise.resolve(responseFor(SessionsMother.noSessions()))
      if (input === '/active-plans') return Promise.resolve(responseFor(NO_ACTIVE_PLANS))
      if (input === '/spec-freeze') return Promise.resolve(responseFor(SpecFreezeMother.frozen()))
      if (input === '/epic-groom') return Promise.resolve(responseFor(EpicGroomMother.groomable()))
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    openHome()

    expect(await screen.findByRole('button', { name: 'Revisar el slicing con la sesión' })).toBeDisabled()
    expect(screen.getByText(
      'La sesión está trabajando: espera a que termine el turno para pedirle que revise el slicing.',
    )).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ejecutar el groom' })).toBeEnabled()
  })

  it('gate 2 offers no ask while a permission prompt that carried no message is on screen', async () => {
    const fetching = backendHolding(CoordinatingSessionMother.awaitingPermissionWithNoMessage())
    fetching.mockImplementation((input: string | URL | Request) => {
      if (input === '/coordinating-session') {
        return Promise.resolve(responseFor(CoordinatingSessionMother.awaitingPermissionWithNoMessage()))
      }
      if (input === '/external-tools') return Promise.resolve(responseFor(ExternalToolsMother.allReady()))
      if (input === '/sessions') return Promise.resolve(responseFor(SessionsMother.noSessions()))
      if (input === '/active-plans') return Promise.resolve(responseFor(NO_ACTIVE_PLANS))
      if (input === '/spec-freeze') return Promise.resolve(responseFor(SpecFreezeMother.frozen()))
      if (input === '/epic-groom') return Promise.resolve(responseFor(EpicGroomMother.groomable()))
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    openHome()

    expect(await screen.findByRole('button', { name: 'Revisar el slicing con la sesión' })).toBeDisabled()
    expect(screen.getByText(
      'La sesión está esperando un permiso en su terminal: respóndelo y vuelve a intentarlo.',
    )).toBeInTheDocument()
  })

  it('gate 2 asks the live conversation that finished its turn, and claims only that the ask was sent', async () => {
    const fetching = backendHolding(CoordinatingSessionMother.completed())
    fetching.mockImplementation((input: string | URL | Request) => {
      if (input === '/coordinating-session') return Promise.resolve(responseFor(CoordinatingSessionMother.completed()))
      if (input === '/groom-session') return Promise.resolve(responseFor(EpicGroomMother.groomAskTyped()))
      if (input === '/external-tools') return Promise.resolve(responseFor(ExternalToolsMother.allReady()))
      if (input === '/sessions') return Promise.resolve(responseFor(SessionsMother.noSessions()))
      if (input === '/active-plans') return Promise.resolve(responseFor(NO_ACTIVE_PLANS))
      if (input === '/spec-freeze') return Promise.resolve(responseFor(SpecFreezeMother.frozen()))
      if (input === '/epic-groom') return Promise.resolve(responseFor(EpicGroomMother.groomable()))
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    openHome()
    const ask = await screen.findByRole('button', { name: 'Revisar el slicing con la sesión' })
    await vi.waitFor(() => expect(ask).toBeEnabled())

    fireEvent.click(ask)

    expect(await screen.findByText('Petición enviada a la sesión. Aún no se ha confirmado que la haya leído.'))
      .toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'brainstorming' })).toBeInTheDocument()
  })

  it('reads both gates of the checkout with no coordinating session held', async () => {
    const fetching = backendHolding(CoordinatingSessionMother.none())

    openHome()
    await screen.findByRole('button', { name: 'Arrancar brainstorming' })

    await vi.waitFor(() => {
      expect(fetching.mock.calls.some(([input]) => input === '/spec-freeze')).toBe(true)
      expect(fetching.mock.calls.some(([input]) => input === '/epic-groom')).toBe(true)
    })
  })
})
