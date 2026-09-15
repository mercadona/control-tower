import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { EpicGroomPanel } from './EpicGroomPanel'

const GROOM_BUTTON = { name: 'Ejecutar el groom' }
const PROMOTE_BUTTON = { name: 'Autorizar el trabajo' }
const SESSION_BUTTON = { name: 'Revisar el slicing con la sesión' }
const PUBLISH_BUTTON = { name: 'Publicar el nuevo slicing' }

describe('EpicGroomPanel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows what the groom will create before anything is created', async () => {
    const reading = vi.fn(async () => new Response(EpicGroomMother.groomable().body, { status: 200 }))
    vi.stubGlobal('fetch', reading)

    render(<EpicGroomPanel />)

    expect(await screen.findByText(EpicGroomMother.MILESTONE)).toBeInTheDocument()
    expect(screen.getByText('2 issues')).toBeInTheDocument()
    expect(screen.getByText('#1 · The intermediate gate retires')).toBeInTheDocument()
    expect(screen.getByText(EpicGroomMother.GATE_ISSUE.labels.join(', '))).toBeInTheDocument()
    expect(screen.getByText('#2 · The session channel')).toBeInTheDocument()
    expect(screen.getByText(EpicGroomMother.CHANNEL_ISSUE.labels.join(', '))).toBeInTheDocument()
    expect(reading).toHaveBeenCalledTimes(1)
  })

  it('shows the repository of a row that does not land in the home repository, and only of that row', async () => {
    const reading = vi.fn(async () => new Response(EpicGroomMother.groomableAcrossRepositories().body, { status: 200 }))
    vi.stubGlobal('fetch', reading)

    render(<EpicGroomPanel />)

    expect(await screen.findByText('#1 · The intermediate gate retires')).toBeInTheDocument()
    expect(
      screen.getByText(`#3 · The pulse of the other repository · ${EpicGroomMother.OTHER_REPO}`)
    ).toBeInTheDocument()
  })

  it('pressing the groom sends the key and then shows the issues it created', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomable().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomedByThePress().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    render(<EpicGroomPanel />)
    await screen.findByRole('button', GROOM_BUTTON)

    await user.click(screen.getByRole('button', GROOM_BUTTON))

    expect(fetching).toHaveBeenNthCalledWith(2, '/epic-groom', {
      method: 'POST',
      headers: { 'x-gate-key': EpicGroomMother.KEY, 'x-plan-fingerprint': EpicGroomMother.PLAN_FINGERPRINT },
    })
    expect(await screen.findByText('#348 · The intermediate gate retires')).toBeInTheDocument()
    expect(screen.getByText('#349 · The session channel')).toBeInTheDocument()
    expect(screen.getByRole('button', PROMOTE_BUTTON)).toBeInTheDocument()
  })

  it('the way into the conversation carries the gate key and says where the session can be talked to', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomable().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomSessionOpened().body, { status: 202 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    render(<EpicGroomPanel />)
    await screen.findByRole('button', SESSION_BUTTON)

    await user.click(screen.getByRole('button', SESSION_BUTTON))

    expect(fetching).toHaveBeenNthCalledWith(2, '/groom-session', {
      method: 'POST',
      headers: { 'x-gate-key': EpicGroomMother.KEY },
    })
    expect(
      await screen.findByText('Sesión del groom abierta: habla con ella en el panel de sesiones.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', GROOM_BUTTON)).toBeEnabled()
  })

  it('a refused opening is shown with the words the program printed and leaves the dry run on screen', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomable().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.notFromThePage().body, { status: 403 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    render(<EpicGroomPanel />)
    await screen.findByRole('button', SESSION_BUTTON)

    await user.click(screen.getByRole('button', SESSION_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent(EpicGroomMother.NOT_FROM_THE_PAGE_DETAIL)
    expect(screen.getByText('#1 · The intermediate gate retires')).toBeInTheDocument()
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
    render(<EpicGroomPanel />)
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

    render(<EpicGroomPanel />)

    expect(await screen.findByText('#348 · The intermediate gate retires')).toBeInTheDocument()
    expect(fetching).toHaveBeenNthCalledWith(2, '/epic-groom', {
      method: 'POST',
      headers: { 'x-gate-key': EpicGroomMother.KEY, 'x-plan-fingerprint': EpicGroomMother.PLAN_FINGERPRINT },
    })
    expect(screen.getByRole('button', PROMOTE_BUTTON)).toBeInTheDocument()
  })

  it('a groomable milestone nobody re-sliced waits for the person to press', async () => {
    const fetching = vi.fn(async () => new Response(EpicGroomMother.groomable().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)

    render(<EpicGroomPanel />)

    expect(await screen.findByRole('button', GROOM_BUTTON)).toBeEnabled()
    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))
    expect(fetching).not.toHaveBeenCalledWith('/epic-groom', expect.anything())
  })

  it('the automatic press happens once, however many times the page renders after it', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomableAfterReslicing().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomedByThePress().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)

    render(<EpicGroomPanel />)
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

    render(<EpicGroomPanel />)

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

    render(<EpicGroomPanel />)

    expect(await screen.findByRole('button', PROMOTE_BUTTON)).toBeInTheDocument()
    expect(screen.getByText('#348 · The intermediate gate retires')).toBeInTheDocument()
    expect(screen.getByText('#349 · The session channel')).toBeInTheDocument()
    expect(screen.getAllByText('backlog')).toHaveLength(2)
  })

  it('a partially groomed epic shows how many of how many issues exist and offers only the groom, not the promotion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.partiallyGroomed().body, { status: 200 })))

    render(<EpicGroomPanel />)

    expect(await screen.findByText(EpicGroomMother.MILESTONE)).toBeInTheDocument()
    expect(screen.getByText('1 de 2 issues creadas')).toBeInTheDocument()
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
    render(<EpicGroomPanel />)
    await screen.findByRole('button', GROOM_BUTTON)

    await user.click(screen.getByRole('button', GROOM_BUTTON))

    expect(fetching).toHaveBeenNthCalledWith(2, '/epic-groom', {
      method: 'POST',
      headers: { 'x-gate-key': EpicGroomMother.KEY, 'x-plan-fingerprint': EpicGroomMother.PLAN_FINGERPRINT },
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
    render(<EpicGroomPanel />)
    await screen.findByRole('button', PROMOTE_BUTTON)

    await user.click(screen.getByRole('button', PROMOTE_BUTTON))

    expect(fetching).toHaveBeenNthCalledWith(2, '/epic-promotion', {
      method: 'POST',
      headers: { 'x-gate-key': EpicGroomMother.KEY },
    })
    expect(
      await screen.findByText('Trabajo autorizado: el loop ya puede despachar el primer slice.'),
    ).toBeInTheDocument()
  })

  it('a promotion refused after a successful groom keeps the groomed issues on screen', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomable().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomedByThePress().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.notFromThePage().body, { status: 403 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    render(<EpicGroomPanel />)
    await screen.findByRole('button', GROOM_BUTTON)

    await user.click(screen.getByRole('button', GROOM_BUTTON))
    await screen.findByRole('button', PROMOTE_BUTTON)
    await user.click(screen.getByRole('button', PROMOTE_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent(EpicGroomMother.NOT_FROM_THE_PAGE_DETAIL)
    expect(screen.getByText('#348 · The intermediate gate retires')).toBeInTheDocument()
    expect(screen.getByText('#349 · The session channel')).toBeInTheDocument()
    expect(screen.getByRole('button', PROMOTE_BUTTON)).toBeInTheDocument()
    expect(screen.queryByRole('button', GROOM_BUTTON)).not.toBeInTheDocument()
  })

  it('a press whose answer body is not JSON re-enables the button and says the backend could not be reached', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomable().body, { status: 200 }))
      .mockResolvedValueOnce(new Response('<html><body>Bad Gateway</body></html>', { status: 502 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    render(<EpicGroomPanel />)
    await screen.findByRole('button', GROOM_BUTTON)

    await user.click(screen.getByRole('button', GROOM_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
    expect(screen.getByRole('button', GROOM_BUTTON)).toBeEnabled()
  })

  it('a refused groom is shown with the words the program printed', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomable().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.notFromThePage().body, { status: 403 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    render(<EpicGroomPanel />)
    await screen.findByRole('button', GROOM_BUTTON)

    await user.click(screen.getByRole('button', GROOM_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent(EpicGroomMother.NOT_FROM_THE_PAGE_DETAIL)
  })

  it('a plan that changed since the preview is shown in the same banner as any other refusal', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(EpicGroomMother.groomable().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(EpicGroomMother.planChanged().body, { status: 409 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    render(<EpicGroomPanel />)
    await screen.findByRole('button', GROOM_BUTTON)

    await user.click(screen.getByRole('button', GROOM_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent(EpicGroomMother.PLAN_CHANGED_DETAIL)
  })

  it('without a key the buttons stay disabled and it says where the gate opens from', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(EpicGroomMother.groomableWithoutKey().body, { status: 200 })),
    )

    render(<EpicGroomPanel />)

    expect(await screen.findByRole('button', GROOM_BUTTON)).toBeDisabled()
    expect(
      screen.getByText('Esta puerta solo se abre desde la página que sirve el backend.'),
    ).toBeInTheDocument()
  })

  it('there is nothing to show while gate 1 has not been pressed', async () => {
    const reading = vi.fn(async () => new Response(EpicGroomMother.draft().body, { status: 200 }))
    vi.stubGlobal('fetch', reading)

    const { container } = render(<EpicGroomPanel />)

    await waitFor(() => expect(reading).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('while it waits for the pull request to merge it says so, and links the one it waits for', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.awaitingPublication().body, { status: 200 })))

    render(<EpicGroomPanel />)

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

    render(<EpicGroomPanel />)

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

    render(<EpicGroomPanel />)

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
    render(<EpicGroomPanel />)
    await screen.findByRole('button', PUBLISH_BUTTON)

    await user.click(screen.getByRole('button', PUBLISH_BUTTON))

    expect(fetching).toHaveBeenNthCalledWith(2, '/spec-reslicing', {
      method: 'POST',
      headers: { 'x-gate-key': EpicGroomMother.KEY },
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
    render(<EpicGroomPanel />)
    await screen.findByRole('button', PUBLISH_BUTTON)

    await user.click(screen.getByRole('button', PUBLISH_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent(EpicGroomMother.NOT_FROM_THE_PAGE_DETAIL)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('a resliced spec with no key keeps the publication disabled and says where the gate opens from', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(EpicGroomMother.reslicedWithoutKey().body, { status: 200 })),
    )

    render(<EpicGroomPanel />)

    expect(await screen.findByRole('button', PUBLISH_BUTTON)).toBeDisabled()
    expect(
      screen.getByText('Esta puerta solo se abre desde la página que sirve el backend.'),
    ).toBeInTheDocument()
  })

  it('a listing that could not be exhausted shows why and offers nothing to press', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.issuesUncertain().body, { status: 200 })))

    render(<EpicGroomPanel />)

    expect(await screen.findByRole('alert')).toHaveTextContent(EpicGroomMother.ISSUES_UNCERTAIN_REASON)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
