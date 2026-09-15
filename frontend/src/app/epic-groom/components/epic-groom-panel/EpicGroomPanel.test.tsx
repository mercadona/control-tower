import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { EpicGroomPanel } from './EpicGroomPanel'

const GROOM_BUTTON = { name: 'Ejecutar el groom' }
const PROMOTE_BUTTON = { name: 'Autorizar el trabajo' }

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

  it('a listing that could not be exhausted shows why and offers nothing to press', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EpicGroomMother.issuesUncertain().body, { status: 200 })))

    render(<EpicGroomPanel />)

    expect(await screen.findByRole('alert')).toHaveTextContent(EpicGroomMother.ISSUES_UNCERTAIN_REASON)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
