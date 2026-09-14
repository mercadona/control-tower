import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { SpecFreezePanel } from './SpecFreezePanel'

const FREEZE_BUTTON = { name: 'Congelar el spec' }

describe('SpecFreezePanel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refuses the freeze while a clarification marker remains and shows the line the backend gave', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SpecFreezeMother.draftWithMarker().body, { status: 200 })))

    render(<SpecFreezePanel />)

    expect(
      await screen.findByText('Marcador de clarificación sin resolver, línea 42: [NEEDS CLARIFICATION: which button?]'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', FREEZE_BUTTON)).toBeDisabled()
  })

  it('lets the freeze go once no finding remains', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SpecFreezeMother.draftReady().body, { status: 200 })))

    render(<SpecFreezePanel />)

    expect(await screen.findByRole('button', FREEZE_BUTTON)).toBeEnabled()
  })

  it('a spec with no hypothesis shows that finding and keeps the button disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SpecFreezeMother.draftWithMarker().body, { status: 200 })))

    render(<SpecFreezePanel />)

    expect(await screen.findByText('El spec no tiene sección «## Hipótesis»')).toBeInTheDocument()
    expect(screen.getByRole('button', FREEZE_BUTTON)).toBeDisabled()
  })

  it('pressing it sends the key and then says the groom is waiting for that pull request to merge', async () => {
    const fetching = vi
      .fn()
      .mockResolvedValueOnce(new Response(SpecFreezeMother.draftReady().body, { status: 200 }))
      .mockResolvedValueOnce(new Response(SpecFreezeMother.frozen().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    render(<SpecFreezePanel />)
    await screen.findByRole('button', FREEZE_BUTTON)

    await user.click(screen.getByRole('button', FREEZE_BUTTON))

    expect(fetching).toHaveBeenNthCalledWith(2, '/spec-freeze', {
      method: 'POST',
      headers: { 'x-gate-key': SpecFreezeMother.KEY },
    })
    expect(await screen.findByText(`Spec congelado el ${SpecFreezeMother.ON}.`)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: `Pull request #${SpecFreezeMother.PULL_REQUEST.number}` }),
    ).toHaveAttribute('href', SpecFreezeMother.PULL_REQUEST.url)
    expect(screen.getByText('El groom espera al merge de este pull request.')).toBeInTheDocument()
  })

  it('without a key the button stays disabled and says where the gate opens from', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SpecFreezeMother.draftWithoutKey().body, { status: 200 })))

    render(<SpecFreezePanel />)

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
    render(<SpecFreezePanel />)
    await screen.findByRole('button', FREEZE_BUTTON)

    await user.click(screen.getByRole('button', FREEZE_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent(SpecFreezeMother.NOT_FROM_THE_PAGE_DETAIL)
  })

  it('there is nothing to show while the checkout has no execution spec', async () => {
    const reading = vi.fn(async () => new Response(SpecFreezeMother.noSpec().body, { status: 200 }))
    vi.stubGlobal('fetch', reading)

    const { container } = render(<SpecFreezePanel />)

    await waitFor(() => expect(reading).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
