import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { SpecFreezePanel } from './SpecFreezePanel'

const renderPanel = () => render(<SpecFreezePanel target={SpecFreezeMother.TARGET} />)

const FREEZE_BUTTON = { name: 'Congelar el spec' }

describe('SpecFreezePanel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps reading the checkout with no session held, offers no freeze and says what is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SpecFreezeMother.draftReadyWithoutSession().body, { status: 200 })))

    render(<SpecFreezePanel target={null} />)

    expect(await screen.findByRole('button', FREEZE_BUTTON)).toBeDisabled()
    expect(screen.getByText('No hay ninguna sesión coordinadora abierta: ábrela para actuar en esta puerta.')).toBeInTheDocument()
  })

  it('refuses the freeze while a clarification marker remains and shows the line the backend gave', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SpecFreezeMother.draftWithMarker().body, { status: 200 })))

    renderPanel()

    expect(
      await screen.findByText('Marcador de clarificación sin resolver, línea 42: [NEEDS CLARIFICATION: which button?]'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', FREEZE_BUTTON)).toBeDisabled()
  })

  it('a frozen decision that does not say where it comes from is listed with its own copy, its line and its raw line', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SpecFreezeMother.draftWithSourcelessDecision().body, { status: 200 })))

    renderPanel()

    expect(
      await screen.findByText(
        `Decisión congelada sin procedencia, línea ${SpecFreezeMother.PROVENANCE_FINDING.line}: ${SpecFreezeMother.PROVENANCE_FINDING.detail}`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', FREEZE_BUTTON)).toBeDisabled()
  })

  it('lets the freeze go once no finding remains, saying the spec is ready and naming its file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SpecFreezeMother.draftReady().body, { status: 200 })))

    renderPanel()

    expect(await screen.findByRole('button', FREEZE_BUTTON)).toBeEnabled()
    expect(screen.getByText('El spec está listo para congelar')).toBeInTheDocument()
    expect(screen.getByText(SpecFreezeMother.SPEC)).toBeInTheDocument()
  })

  it('a blocked spec names its file and how many findings stand between it and the freeze', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SpecFreezeMother.draftWithMarker().body, { status: 200 })))

    renderPanel()

    expect(await screen.findByText('La vara todavía no deja congelar')).toBeInTheDocument()
    expect(screen.getByText(`${SpecFreezeMother.SPEC} · 2 hallazgos por resolver`)).toBeInTheDocument()
    expect(screen.queryByText('El spec está listo para congelar')).not.toBeInTheDocument()
  })

  it('a single finding is counted in the singular', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SpecFreezeMother.draftWithoutScope().body, { status: 200 })))

    renderPanel()

    expect(await screen.findByText(`${SpecFreezeMother.SPEC} · 1 hallazgo por resolver`)).toBeInTheDocument()
  })

  it('a spec with no hypothesis shows that finding and keeps the button disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SpecFreezeMother.draftWithMarker().body, { status: 200 })))

    renderPanel()

    expect(await screen.findByText('El spec no tiene sección «## Hipótesis»')).toBeInTheDocument()
    expect(screen.getByRole('button', FREEZE_BUTTON)).toBeDisabled()
  })

  it('a milestone context with no scope line shows that finding and keeps the button disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SpecFreezeMother.draftWithoutScope().body, { status: 200 })))

    renderPanel()

    expect(await screen.findByText('El contexto del milestone no declara «Alcance:», la línea que lee el gate de alcance en cada issue')).toBeInTheDocument()
    expect(screen.getByRole('button', FREEZE_BUTTON)).toBeDisabled()
  })

  it('pressing it sends the key and then says the spec lives in a pull request the person has to merge', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(SpecFreezeMother.draftReady().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(SpecFreezeMother.frozen().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', FREEZE_BUTTON)

    await user.click(screen.getByRole('button', FREEZE_BUTTON))

    expect(fetching).toHaveBeenNthCalledWith(2, '/spec-freeze', {
      method: 'POST',
      headers: {
        'x-gate-key': SpecFreezeMother.KEY,
        'x-coordinating-target': SpecFreezeMother.TARGET,
      },
    })
    expect(await screen.findByText(`Spec congelado el ${SpecFreezeMother.ON}.`)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: `Pull request #${SpecFreezeMother.PULL_REQUEST.number}` }),
    ).toHaveAttribute('href', SpecFreezeMother.PULL_REQUEST.url)
    expect(
      screen.getByText('El spec ya vive en este pull request: mergéalo para continuar al groom.'),
    ).toBeInTheDocument()
  })

  it('without a key the button stays disabled and says where the gate opens from', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SpecFreezeMother.draftWithoutKey().body, { status: 200 })))

    renderPanel()

    expect(await screen.findByRole('button', FREEZE_BUTTON)).toBeDisabled()
    expect(
      screen.getByText('Esta puerta solo se abre desde la página que sirve el backend.'),
    ).toBeInTheDocument()
  })

  it('a refused freeze is shown with the detail the backend gave', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(SpecFreezeMother.draftReady().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(SpecFreezeMother.notFromThePage().body, { status: 403 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', FREEZE_BUTTON)

    await user.click(screen.getByRole('button', FREEZE_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent('Esta acción solo se puede realizar desde la página que sirve el backend.')
  })

  it('there is nothing to show while the checkout has no execution spec', async () => {
    const reading = vi.fn(async () => new Response(SpecFreezeMother.noSpec().body, { status: 200 }))
    vi.stubGlobal('fetch', reading)

    const { container } = renderPanel()

    await waitFor(() => expect(reading).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('a read the backend refused says why instead of showing nothing', async () => {
    const refused = SpecFreezeMother.refusedRead()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(refused.body, { status: refused.status })))

    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent('No se ha podido interpretar el spec del epic.')
  })

  it('a spec frozen by hand with no date still says so instead of blanking the cabin', async () => {
    const undated = SpecFreezeMother.frozenUndated()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(undated.body, { status: undated.status })))

    renderPanel()

    expect(await screen.findByText(/Spec congelado, sin fecha/)).toBeInTheDocument()
    expect(screen.getByText(/mergéalo para continuar al groom/)).toBeInTheDocument()
  })

  it('the button is disabled while the press is in flight and says it is freezing', async () => {
    let answer: (response: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => { answer = resolve })
    const ready = SpecFreezeMother.draftReady()
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST' ? await pending : new Response(ready.body, { status: 200 })))

    renderPanel()
    const button = await screen.findByRole('button', { name: 'Congelar el spec' })
    await userEvent.click(button)

    const freezing = await screen.findByRole('button', { name: 'Congelando el spec' })
    expect(freezing).toBeDisabled()
    answer(new Response(SpecFreezeMother.frozen().body, { status: 200 }))
  })

  it('a double click sends one press and not two', async () => {
    const ready = SpecFreezeMother.draftReady()
    const fetching = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(SpecFreezeMother.frozen().body, { status: 200 })
        : new Response(ready.body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)

    renderPanel()
    const button = await screen.findByRole('button', { name: 'Congelar el spec' })
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(screen.getByText(/mergéalo para continuar al groom/)).toBeInTheDocument())
    const presses = fetching.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(presses).toHaveLength(1)
  })

  it('operation busy disables freeze and guards its handler', async () => {
    const fetching = vi.fn(async () => new Response(SpecFreezeMother.draftReady().body))
    vi.stubGlobal('fetch', fetching)

    render(<SpecFreezePanel target={SpecFreezeMother.TARGET} operationBusy />)

    expect(await screen.findByRole('button', { name: 'Congelar el spec' })).toBeDisabled()
    expect(fetching).toHaveBeenCalledTimes(1)
  })
})
