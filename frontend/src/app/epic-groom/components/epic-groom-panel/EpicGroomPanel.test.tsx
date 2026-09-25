import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { LiveAsk, OpenedCoordinatingSession } from 'app/coordinating-session/CoordinatingSession.types'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { EpicGroomClient } from 'app/epic-groom/client'
import { EpicGroomPanel } from './EpicGroomPanel'

const GROOM_BUTTON = { name: 'Ejecutar el groom' }
const PROMOTE_BUTTON = { name: 'Autorizar el trabajo' }
const SESSION_BUTTON = { name: 'Revisar el slicing con la sesión' }
const PUBLISH_BUTTON = { name: 'Publicar el nuevo slicing' }

const renderPanel = (
  onSessionOpened: (opened: OpenedCoordinatingSession) => void = vi.fn(),
  { openingBlocked = false, operationBusy = false, liveAsk = null as LiveAsk | null, dispatched = 0 } = {},
) =>
  render(<EpicGroomPanel
    target={EpicGroomMother.TARGET}
    openingBlocked={openingBlocked}
    operationBusy={operationBusy}
    liveAsk={liveAsk}
    dispatched={dispatched}
    openSession={async (key, target) => {
      const outcome = await EpicGroomClient.openSession(key, target)
      if (outcome.kind === 'opened') onSessionOpened(outcome.opened)
      return outcome
    }}
  />)

describe('EpicGroomPanel', () => {
  it('shows a dispatch preparation failure when returning to an already authorized milestone', async () => {
    const body = JSON.parse(EpicGroomMother.authorised().body)
    body.preparation = 'owner/repo at abc123: docker/docker-compose.local.yml publishes host ports.'
    body.key = EpicGroomMother.KEY
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
    renderPanel()
    expect(await screen.findByText(body.preparation)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Volver a comprobar' })).toBeEnabled()
    expect(screen.queryByText('Trabajo autorizado: el primer slice sale en el próximo barrido.')).not.toBeInTheDocument()
  })

  it('shows the preparation diagnostic and rechecks before authorizing after the fix', async () => {
    let attempts = 0
    const detail = 'owner/repo at abc123: Makefile forces a shared Compose project. Remove -p.'
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input) === '/epic-promotion') {
        attempts++
        return attempts === 1
          ? new Response(JSON.stringify({ code: 'repository-preparation-required', detail }), { status: 400 })
          : new Response(EpicGroomMother.promoted().body, { status: 200 })
      }
      return new Response(EpicGroomMother.groomed().body, { status: 200 })
    }))
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByRole('button', PROMOTE_BUTTON))
    expect(await screen.findByText('El repositorio necesita preparación antes de continuar')).toBeInTheDocument()
    expect(screen.getByText(detail)).toBeInTheDocument()
    expect(attempts).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Volver a comprobar y autorizar' }))
    expect(attempts).toBe(2)
    await waitFor(() => expect(screen.queryByText(detail)).not.toBeInTheDocument())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('asks the live conversation that finished its turn, and claims only that the ask was sent', async () => {
    const fetching = vi.fn(async (input: string | URL | Request) =>
      String(input) === '/groom-session'
        ? new Response(EpicGroomMother.groomAskTyped().body, { status: 202 })
        : new Response(EpicGroomMother.groomable().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel(vi.fn(), { openingBlocked: true, liveAsk: 'ready' })
    await screen.findByRole('button', SESSION_BUTTON)

    await user.click(screen.getByRole('button', SESSION_BUTTON))

    expect(fetching).toHaveBeenNthCalledWith(2, '/groom-session', {
      method: 'POST',
      headers: { 'x-gate-key': EpicGroomMother.KEY, 'x-coordinating-target': EpicGroomMother.TARGET },
    })
    expect(
      await screen.findByText('Petición enviada a la sesión. Aún no se ha confirmado que la haya leído.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('La sesión ha leído la petición: habla con ella en el panel de sesiones.'))
      .not.toBeInTheDocument()
    expect(screen.queryByText('Sesión del groom abierta: habla con ella en el panel de sesiones.'))
      .not.toBeInTheDocument()
  })

  it('says the session read the ask when its attention moves to working, and keeps saying it after the turn', async () => {
    const fetching = vi.fn(async (input: string | URL | Request) =>
      String(input) === '/groom-session'
        ? new Response(EpicGroomMother.groomAskTyped().body, { status: 202 })
        : new Response(EpicGroomMother.groomable().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    const shown = renderPanel(vi.fn(), { openingBlocked: true, liveAsk: 'ready' })
    await screen.findByRole('button', SESSION_BUTTON)
    await user.click(screen.getByRole('button', SESSION_BUTTON))
    await screen.findByText('Petición enviada a la sesión. Aún no se ha confirmado que la haya leído.')

    shown.rerender(<EpicGroomPanel
      target={EpicGroomMother.TARGET}
      openingBlocked
      operationBusy={false}
      liveAsk="working"
      openSession={async (key, target) => EpicGroomClient.openSession(key, target)}
    />)

    expect(await screen.findByText('La sesión ha leído la petición: habla con ella en el panel de sesiones.'))
      .toBeInTheDocument()

    shown.rerender(<EpicGroomPanel
      target={EpicGroomMother.TARGET}
      openingBlocked
      operationBusy={false}
      liveAsk="ready"
      openSession={async (key, target) => EpicGroomClient.openSession(key, target)}
    />)

    expect(screen.getByText('La sesión ha leído la petición: habla con ella en el panel de sesiones.'))
      .toBeInTheDocument()
  })

  it('offers no ask while the live conversation is working, and says what to wait for', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.groomable().body)))

    renderPanel(vi.fn(), { openingBlocked: true, liveAsk: 'working' })

    expect(await screen.findByRole('button', SESSION_BUTTON)).toBeDisabled()
    expect(screen.getByText(
      'La sesión está trabajando: espera a que termine el turno para pedirle que revise el slicing.',
    )).toBeInTheDocument()
  })

  it('offers no ask while nothing is known about the terminal of the live conversation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.groomable().body)))

    renderPanel(vi.fn(), { openingBlocked: true, liveAsk: 'turn-not-finished' })

    expect(await screen.findByRole('button', SESSION_BUTTON)).toBeDisabled()
    expect(screen.getByText(
      'No se sabe qué está mostrando la terminal de la sesión: espera a que termine un turno.',
    )).toBeInTheDocument()
  })

  it('offers no ask while the live conversation waits for a permission, and says what to answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.groomable().body)))

    renderPanel(vi.fn(), { openingBlocked: true, liveAsk: 'awaiting-permission' })

    expect(await screen.findByRole('button', SESSION_BUTTON)).toBeDisabled()
    expect(screen.getByText(
      'La sesión está esperando un permiso en su terminal: respóndelo y vuelve a intentarlo.',
    )).toBeInTheDocument()
  })

  it('keeps reading the checkout with no session held, offers no press and says what is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.groomableWithoutSession().body, { status: 200 })))

    render(<EpicGroomPanel target={null} liveAsk={null} openingBlocked operationBusy={false} openSession={vi.fn()} />)

    expect(await screen.findByText('Se van a crear estas issues')).toBeInTheDocument()
    expect(screen.getByText('The intermediate gate retires')).toBeInTheDocument()
    expect(screen.getByRole('button', GROOM_BUTTON)).toBeDisabled()
    expect(screen.getByRole('button', SESSION_BUTTON)).toBeDisabled()
    expect(screen.getByText('No hay ninguna sesión coordinadora abierta: ábrela para actuar en esta puerta.')).toBeInTheDocument()
  })

  it('shows what the groom will create before anything is created, by title only', async () => {
    const reading = vi.fn(async () => new Response(EpicGroomMother.groomable().body, { status: 200 }))
    vi.stubGlobal('fetch', reading)

    renderPanel()

    expect(await screen.findByText('Se van a crear estas issues')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'The intermediate gate retires',
      'The session channel',
    ])
    expect(screen.queryByText(EpicGroomMother.MILESTONE)).not.toBeInTheDocument()
    expect(reading).toHaveBeenCalledTimes(1)
  })

  it('shows the repository of a row that does not land in the home repository, and only of that row', async () => {
    const reading = vi.fn(async () => new Response(EpicGroomMother.groomableAcrossRepositories().body, { status: 200 }))
    vi.stubGlobal('fetch', reading)

    renderPanel()

    expect(await screen.findByText('The intermediate gate retires')).toBeInTheDocument()
    expect(
      screen.getByText(`The pulse of the other repository · ${EpicGroomMother.OTHER_REPO}`)
    ).toBeInTheDocument()
  })

  it('pressing the groom sends the key and then shows the issues it created', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomable().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomedByThePress().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', GROOM_BUTTON)

    await user.click(screen.getByRole('button', GROOM_BUTTON))

    expect(fetching).toHaveBeenNthCalledWith(2, '/epic-groom', {
      method: 'POST',
      headers: {
        'x-gate-key': EpicGroomMother.KEY,
        'x-plan-fingerprint': EpicGroomMother.PLAN_FINGERPRINT,
        'x-coordinating-target': EpicGroomMother.TARGET,
      },
    })
    expect(await screen.findByText('#348 · The intermediate gate retires')).toBeInTheDocument()
    expect(screen.getByText('#349 · The session channel')).toBeInTheDocument()
    expect(screen.getByRole('button', PROMOTE_BUTTON)).toBeInTheDocument()
  })

  it('while the groom runs, the way into the session is no longer offered', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Promise<Response>(() => {})
        : new Response(EpicGroomMother.groomable().body, { status: 200 })))
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', GROOM_BUTTON))

    expect(await screen.findByRole('button', { name: 'Ejecutando el groom' })).toBeDisabled()
    expect(screen.queryByRole('button', SESSION_BUTTON)).not.toBeInTheDocument()
  })

  it('the way into the conversation carries the gate key and says where the session can be talked to', async () => {
    const fetching = vi.fn(async (input: string | URL | Request) =>
      String(input) === '/groom-session'
        ? new Response(EpicGroomMother.groomSessionOpened().body, { status: 202 })
        : new Response(EpicGroomMother.groomable().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', SESSION_BUTTON)

    await user.click(screen.getByRole('button', SESSION_BUTTON))

    expect(fetching).toHaveBeenNthCalledWith(2, '/groom-session', {
      method: 'POST',
      headers: { 'x-gate-key': EpicGroomMother.KEY, 'x-coordinating-target': EpicGroomMother.TARGET },
    })
    expect(
      await screen.findByText('Sesión del groom abierta: habla con ella en el panel de sesiones.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', GROOM_BUTTON)).toBeEnabled()
  })

  it('the slicing the session changed reaches the panel without a reload', async () => {
    let slicing = EpicGroomMother.groomable()
    const fetching = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === '/groom-session') {
        slicing = EpicGroomMother.resliced()
        return new Response(EpicGroomMother.groomSessionOpened().body, { status: 202 })
      }
      return new Response(slicing.body, { status: slicing.status })
    })
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', SESSION_BUTTON)

    await user.click(screen.getByRole('button', SESSION_BUTTON))

    expect(await screen.findByRole('button', PUBLISH_BUTTON)).toBeInTheDocument()
    expect(screen.queryByRole('button', GROOM_BUTTON)).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'La sesión ha cambiado el slicing del spec. Publícalo en un pull request: al mergearlo se crearán las issues.',
      ),
    ).toBeInTheDocument()
  })

  it('the session the backend created reaches whoever listens, so the person can be sent to talk to it', async () => {
    const fetching = vi.fn(async (input: string | URL | Request) =>
      String(input) === '/groom-session'
        ? new Response(EpicGroomMother.groomSessionOpened().body, { status: 202 })
        : new Response(EpicGroomMother.groomable().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const listening = vi.fn()
    const user = userEvent.setup()
    renderPanel(listening)
    await screen.findByRole('button', SESSION_BUTTON)

    await user.click(screen.getByRole('button', SESSION_BUTTON))

    await vi.waitFor(() => expect(listening).toHaveBeenCalledWith({
      target: EpicGroomMother.GROOM_TARGET,
      conversation: EpicGroomMother.GROOM_CONVERSATION,
      repo: 'owner/name',
      story: 'STAFF-128',
      root: '/repo',
      session: EpicGroomMother.GROOM_SESSION,
    }))
    expect(listening).toHaveBeenCalledTimes(1)
  })

  it('live occupancy blocks only session opening while current-work groom stays eligible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.groomable().body)))

    renderPanel(vi.fn(), { openingBlocked: true })

    expect(await screen.findByRole('button', SESSION_BUTTON)).toBeDisabled()
    expect(screen.getByRole('button', GROOM_BUTTON)).toBeEnabled()
  })

  it.each(['working', 'awaiting-permission', 'turn-not-finished'] as const)(
    'a live session that is %s holds the groom back, because mid-turn it may still be editing the slicing',
    async (liveAsk) => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.groomable().body)))

      renderPanel(vi.fn(), { liveAsk })

      expect(await screen.findByRole('button', GROOM_BUTTON)).toBeDisabled()
    },
  )

  it('a live session waiting for the person leaves the groom pressable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.groomable().body)))

    renderPanel(vi.fn(), { liveAsk: 'ready' })

    expect(await screen.findByRole('button', GROOM_BUTTON)).toBeEnabled()
  })

  it('a session mid-turn holds the automatic groom after merged reslicing until its turn ends', async () => {
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomableAfterReslicing().body))
      .mockResolvedValue(new Response(EpicGroomMother.groomedByThePress().body))
    vi.stubGlobal('fetch', fetching)
    const shown = renderPanel(vi.fn(), { liveAsk: 'working' })
    await screen.findByText('El nuevo slicing se aprobó al mergear su pull request: las issues se crean sin pulsar nada.')
    expect(fetching).toHaveBeenCalledTimes(1)

    shown.rerender(<EpicGroomPanel
      target={EpicGroomMother.TARGET}
      liveAsk="ready"
      openingBlocked={false}
      operationBusy={false}
      openSession={async (key, target) => EpicGroomClient.openSession(key, target)}
    />)

    await waitFor(() => expect(fetching).toHaveBeenCalledWith('/epic-groom', expect.objectContaining({ method: 'POST' })))
  })

  it('operation busy disables every gate action', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.groomable().body)))

    renderPanel(vi.fn(), { operationBusy: true })

    expect(await screen.findByRole('button', SESSION_BUTTON)).toBeDisabled()
    expect(screen.getByRole('button', GROOM_BUTTON)).toBeDisabled()
  })

  it('operation busy does not consume the automatic groom after merged reslicing', async () => {
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomableAfterReslicing().body))
      .mockResolvedValue(new Response(EpicGroomMother.groomedByThePress().body))
    vi.stubGlobal('fetch', fetching)
    const listening = vi.fn()
    const shown = renderPanel(listening, { operationBusy: true })
    await screen.findByText('El nuevo slicing se aprobó al mergear su pull request: las issues se crean sin pulsar nada.')
    expect(fetching).toHaveBeenCalledTimes(1)

    shown.rerender(<EpicGroomPanel
      target={EpicGroomMother.TARGET}
      liveAsk={null}
      openingBlocked={false}
      operationBusy={false}
      openSession={async (key, target) => EpicGroomClient.openSession(key, target)}
    />)

    await waitFor(() => expect(fetching).toHaveBeenCalledWith('/epic-groom', expect.objectContaining({ method: 'POST' })))
  })

  it('a refused opening is shown with the words the program printed and nobody is sent anywhere', async () => {
    const fetching = vi.fn(async (input: string | URL | Request) =>
      String(input) === '/groom-session'
        ? new Response(EpicGroomMother.notFromThePage().body, { status: 403 })
        : new Response(EpicGroomMother.groomable().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const listening = vi.fn()
    const user = userEvent.setup()
    renderPanel(listening)
    await screen.findByRole('button', SESSION_BUTTON)

    await user.click(screen.getByRole('button', SESSION_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent('Esta acción solo se puede realizar desde la página que sirve el backend.')
    expect(listening).not.toHaveBeenCalled()
    expect(screen.getByText('The intermediate gate retires')).toBeInTheDocument()
    expect(
      screen.queryByText('Sesión del groom abierta: habla con ella en el panel de sesiones.'),
    ).not.toBeInTheDocument()
  })

  it('an opening the page cannot confirm says to look at the sessions panel instead of reporting a failure', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomable().body, { status: 200 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', SESSION_BUTTON)

    await user.click(screen.getByRole('button', SESSION_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se ha podido confirmar la apertura de la sesión')
    expect(screen.getByRole('alert')).toHaveTextContent('Mira el panel de sesiones: puede estar abierta.')
  })

  it('a groomable milestone whose re-slicing already merged creates the issues without anybody pressing', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomableAfterReslicing().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomedByThePress().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)

    renderPanel()

    expect(await screen.findByText('#348 · The intermediate gate retires')).toBeInTheDocument()
    expect(fetching).toHaveBeenNthCalledWith(2, '/epic-groom', {
      method: 'POST',
      headers: {
        'x-gate-key': EpicGroomMother.KEY,
        'x-plan-fingerprint': EpicGroomMother.PLAN_FINGERPRINT,
        'x-coordinating-target': EpicGroomMother.TARGET,
      },
    })
    expect(screen.getByRole('button', PROMOTE_BUTTON)).toBeInTheDocument()
  })

  it('a groomable milestone nobody re-sliced waits for the person to press', async () => {
    const fetching = vi.fn(async () => new Response(EpicGroomMother.groomable().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)

    renderPanel()

    expect(await screen.findByRole('button', GROOM_BUTTON)).toBeEnabled()
    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))
    expect(fetching).not.toHaveBeenCalledWith('/epic-groom', expect.anything())
  })

  it('offers the review of the slicing before the groom, in the order the work happens', async () => {
    const reading = vi.fn(async () => new Response(EpicGroomMother.groomable().body, { status: 200 }))
    vi.stubGlobal('fetch', reading)

    renderPanel()

    await screen.findByRole('button', GROOM_BUTTON)
    const gateButtons = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((name) => name === SESSION_BUTTON.name || name === GROOM_BUTTON.name)
    expect(gateButtons).toEqual([SESSION_BUTTON.name, GROOM_BUTTON.name])
  })

  it('the automatic press happens once, however many times the page renders after it', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomableAfterReslicing().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomedByThePress().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)

    renderPanel()
    await screen.findByRole('button', PROMOTE_BUTTON)

    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(2))
    expect(fetching).toHaveBeenCalledTimes(2)
  })

  it('the merged re-slicing is named on screen and linked, so the person sees what authorised the groom', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomableAfterReslicing().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.notFromThePage().body, { status: 403 }))
    vi.stubGlobal('fetch', fetching)

    renderPanel()

    expect(
      await screen.findByText(
        'El nuevo slicing se aprobó al mergear su pull request: las issues se crean sin pulsar nada.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pull request #363' })).toHaveAttribute(
      'href',
      EpicGroomMother.RESLICING_PULL_REQUEST.url,
    )
  })

  it('a groomed epic offers the authorisation and shows the rung each issue stands at', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.groomed().body, { status: 200 })))

    renderPanel()

    expect(await screen.findByRole('button', PROMOTE_BUTTON)).toBeInTheDocument()
    expect(screen.getByText('#348 · The intermediate gate retires')).toBeInTheDocument()
    expect(screen.getByText('#349 · The session channel')).toBeInTheDocument()
    expect(screen.getAllByText('backlog')).toHaveLength(2)
  })

  it('a partially groomed epic shows how many of how many issues exist and offers only the groom, not the promotion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.partiallyGroomed().body, { status: 200 })))

    renderPanel()

    expect(await screen.findByText('1 de 2 issues creadas')).toBeInTheDocument()
    expect(screen.getByText('#348 · The intermediate gate retires')).toBeInTheDocument()
    expect(screen.getByText('backlog')).toBeInTheDocument()
    expect(screen.getByText('Termina el groom antes de autorizar el trabajo.')).toBeInTheDocument()
    expect(screen.getByRole('button', GROOM_BUTTON)).toBeInTheDocument()
    expect(screen.queryByRole('button', PROMOTE_BUTTON)).not.toBeInTheDocument()
  })

  it('pressing the groom from a partially groomed epic sends the key and then shows what the finished groom created', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.partiallyGroomed().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomedByThePress().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', GROOM_BUTTON)

    await user.click(screen.getByRole('button', GROOM_BUTTON))

    expect(fetching).toHaveBeenNthCalledWith(2, '/epic-groom', {
      method: 'POST',
      headers: {
        'x-gate-key': EpicGroomMother.KEY,
        'x-plan-fingerprint': EpicGroomMother.PLAN_FINGERPRINT,
        'x-coordinating-target': EpicGroomMother.TARGET,
      },
    })
    expect(await screen.findByText('#349 · The session channel')).toBeInTheDocument()
    expect(screen.getByRole('button', PROMOTE_BUTTON)).toBeInTheDocument()
  })

  it('pressing the authorisation sends the key and says the work is authorised', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomed().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.promoted().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', PROMOTE_BUTTON)

    await user.click(screen.getByRole('button', PROMOTE_BUTTON))

    expect(fetching).toHaveBeenNthCalledWith(2, '/epic-promotion', {
      method: 'POST',
      headers: { 'x-gate-key': EpicGroomMother.KEY, 'x-coordinating-target': EpicGroomMother.TARGET },
    })
    expect(
      await screen.findByText('Trabajo autorizado: el primer slice sale en el próximo barrido.'),
    ).toBeInTheDocument()
  })

  it('an authorised gate with nothing dispatched yet says the first slice is still to come', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(EpicGroomMother.authorised().body, { status: 200 })))

    renderPanel(vi.fn(), { dispatched: 0 })

    expect(
      await screen.findByText('Trabajo autorizado: el primer slice sale en el próximo barrido.'),
    ).toBeInTheDocument()
  })

  it('an authorised gate counts what the loop already dispatched instead of promising it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(EpicGroomMother.authorised().body, { status: 200 })))

    renderPanel(vi.fn(), { dispatched: 2 })

    expect(await screen.findByText('Trabajo en marcha: 2 slices despachados.')).toBeInTheDocument()
    expect(
      screen.queryByText('Trabajo autorizado: el primer slice sale en el próximo barrido.'),
    ).not.toBeInTheDocument()
  })

  it('a single dispatched slice is counted in the singular', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(EpicGroomMother.authorised().body, { status: 200 })))

    renderPanel(vi.fn(), { dispatched: 1 })

    expect(await screen.findByText('Trabajo en marcha: 1 slice despachado.')).toBeInTheDocument()
  })

  it('a promotion refused after a successful groom keeps the groomed issues on screen', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomable().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomedByThePress().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.notFromThePage().body, { status: 403 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', GROOM_BUTTON)

    await user.click(screen.getByRole('button', GROOM_BUTTON))
    await screen.findByRole('button', PROMOTE_BUTTON)
    await user.click(screen.getByRole('button', PROMOTE_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent('Esta acción solo se puede realizar desde la página que sirve el backend.')
    expect(screen.getByText('#348 · The intermediate gate retires')).toBeInTheDocument()
    expect(screen.getByText('#349 · The session channel')).toBeInTheDocument()
    expect(screen.getByRole('button', PROMOTE_BUTTON)).toBeInTheDocument()
    expect(screen.queryByRole('button', GROOM_BUTTON)).not.toBeInTheDocument()
  })

  it('a press whose answer never arrives is confirmed by reading, and the issues it created reach the screen', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomable().body, { status: 200 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomed().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', GROOM_BUTTON)

    await user.click(screen.getByRole('button', GROOM_BUTTON))

    expect(await screen.findByText('#348 · The intermediate gate retires')).toBeInTheDocument()
    expect(screen.getByRole('button', PROMOTE_BUTTON)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a press the page cannot confirm says so as a warning instead of reporting a failure', async () => {
    const fetching = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response('<html><body>Bad Gateway</body></html>', { status: 502 })
        : new Response(EpicGroomMother.groomable().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', GROOM_BUTTON)

    await user.click(screen.getByRole('button', GROOM_BUTTON))

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('No se ha podido confirmar el groom')
    expect(banner).toHaveTextContent('Puede seguir en marcha: no lo vuelvas a pulsar.')
    expect(banner).not.toHaveTextContent('No se pudo contactar con el backend')
    expect(screen.getByRole('button', GROOM_BUTTON)).toBeEnabled()
  })

  it('a refused groom is shown with the words the program printed', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomable().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.notFromThePage().body, { status: 403 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', GROOM_BUTTON)

    await user.click(screen.getByRole('button', GROOM_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent('Esta acción solo se puede realizar desde la página que sirve el backend.')
  })

  it('a plan that changed since the preview is shown in the same banner as any other refusal', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomable().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.planChanged().body, { status: 409 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', GROOM_BUTTON)

    await user.click(screen.getByRole('button', GROOM_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent('El plan ha cambiado. Revisa la versión nueva antes de volver a intentarlo.')
  })

  it('without a key the buttons stay disabled and it says where the gate opens from', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(EpicGroomMother.groomableWithoutKey().body, { status: 200 })),
    )

    renderPanel()

    expect(await screen.findByRole('button', GROOM_BUTTON)).toBeDisabled()
    expect(
      screen.getByText('Esta puerta solo se abre desde la página que sirve el backend.'),
    ).toBeInTheDocument()
  })

  it('there is nothing to show while gate 1 has not been pressed', async () => {
    const reading = vi.fn(async () => new Response(EpicGroomMother.draft().body, { status: 200 }))
    vi.stubGlobal('fetch', reading)

    const { container } = renderPanel()

    await waitFor(() => expect(reading).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('while it waits for the pull request to merge it says so, and links the one it waits for', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.awaitingPublication().body, { status: 200 })))

    renderPanel()

    expect(
      await screen.findByText('El spec congelado espera en un pull request: mergéalo para abrir el groom.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pull request #341' })).toHaveAttribute(
      'href',
      EpicGroomMother.PULL_REQUEST.url,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('a wait with no pull request found asks for no merge, and says the spec is still unpublished', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(EpicGroomMother.awaitingPublicationWithNoPullRequest().body, { status: 200 })),
    )

    renderPanel()

    expect(
      await screen.findByText(
        'El spec congelado sigue sin publicar y no se ha encontrado ningún pull request abierto para su rama.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('El spec congelado espera en un pull request: mergéalo para abrir el groom.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('a resliced spec says the session changed the slicing and offers to publish it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.resliced().body, { status: 200 })))

    renderPanel()

    expect(
      await screen.findByText(
        'La sesión ha cambiado el slicing del spec. Publícalo en un pull request: al mergearlo se crearán las issues.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', PUBLISH_BUTTON)).toBeEnabled()
    expect(screen.queryByRole('button', GROOM_BUTTON)).not.toBeInTheDocument()
  })

  it('publishing the new slicing carries the gate key and links the pull request it opened', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.resliced().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.reslicingPublished().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', PUBLISH_BUTTON)

    await user.click(screen.getByRole('button', PUBLISH_BUTTON))

    expect(fetching).toHaveBeenNthCalledWith(2, '/spec-reslicing', {
      method: 'POST',
      headers: { 'x-gate-key': EpicGroomMother.KEY, 'x-coordinating-target': EpicGroomMother.TARGET },
    })
    expect(await screen.findByRole('link', { name: 'Pull request #363' })).toHaveAttribute(
      'href',
      EpicGroomMother.RESLICING_PULL_REQUEST.url,
    )
    expect(
      screen.getByText('El nuevo slicing viaja en este pull request: mergéalo y las issues se crearán solas.'),
    ).toBeInTheDocument()
  })

  it('a refused publication is shown with the words the program printed', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.resliced().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.notFromThePage().body, { status: 403 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', PUBLISH_BUTTON)

    await user.click(screen.getByRole('button', PUBLISH_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent('Esta acción solo se puede realizar desde la página que sirve el backend.')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('a resliced spec with no key keeps the publication disabled and says where the gate opens from', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(EpicGroomMother.reslicedWithoutKey().body, { status: 200 })),
    )

    renderPanel()

    expect(await screen.findByRole('button', PUBLISH_BUTTON)).toBeDisabled()
    expect(
      screen.getByText('Esta puerta solo se abre desde la página que sirve el backend.'),
    ).toBeInTheDocument()
  })

  it('a listing that could not be exhausted shows why and offers nothing to press', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.issuesUncertain().body, { status: 200 })))

    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent(EpicGroomMother.ISSUES_UNCERTAIN_REASON)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
