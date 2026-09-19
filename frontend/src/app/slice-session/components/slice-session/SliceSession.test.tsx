import { render, screen } from '@testing-library/react'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { SliceSessionMother } from '__scenarios__/SliceSessionMother'
import { SliceSession } from './SliceSession'

type Answer = { status: number; body: string }

const FIELD_LABEL = 'Pedir un cambio a esta conversación'
const SEND_LABEL = 'Enviar'

const stubFetch = (progress: Answer) => {
  const fetching = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/implement-progress/')) return new Response(progress.body, { status: progress.status })
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)

  return fetching
}

const renderSession = (issue = SliceSessionMother.ISSUE) => render(
  <SliceSession issue={issue} root={SliceSessionMother.ROOT} repo={SliceSessionMother.REPO} />
)

const carriesNoField = () => {
  expect(screen.queryByLabelText(FIELD_LABEL)).toBeNull()
  expect(screen.queryByRole('button', { name: SEND_LABEL })).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
}

describe('SliceSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a slice that is implementing shows its progress and offers no message field', async () => {
    stubFetch(SliceSessionMother.progress())
    renderSession()

    expect(await screen.findByText(/Tarea 3 de 7/)).toBeInTheDocument()
    carriesNoField()
  })

  it('a slice whose pull request is open offers no message field either, because the boss carries the change', async () => {
    stubFetch(SliceSessionMother.inReview())
    renderSession()

    expect(await screen.findByText('En revisión')).toBeInTheDocument()
    carriesNoField()
  })

  it('a slice fixing what its review asked offers no message field', async () => {
    stubFetch(ImplementProgressMother.fixing())
    renderSession()

    expect(await screen.findByText('Corrigiendo lo pedido en la revisión')).toBeInTheDocument()
    carriesNoField()
  })

  it('a slice whose pull request is open still shows the link to it', async () => {
    stubFetch(SliceSessionMother.inReview())
    renderSession()

    expect(await screen.findByRole('link', { name: /#31/ })).toBeInTheDocument()
  })

  it('the panel asks the backend for progress and for nothing else', async () => {
    const fetching = stubFetch(SliceSessionMother.inReview())
    renderSession()

    await screen.findByText('En revisión')

    expect(fetching.mock.calls.every(([input]) => String(input).startsWith('/implement-progress/'))).toBe(true)
  })

  it('two slices side by side each carry their own title', async () => {
    stubFetch(SliceSessionMother.progress())
    render(
      <>
        <SliceSession issue={7} root={SliceSessionMother.ROOT} repo={SliceSessionMother.REPO} />
        <SliceSession issue={8} root={SliceSessionMother.ROOT} repo={SliceSessionMother.REPO} />
      </>
    )

    expect(await screen.findByRole('region', { name: 'Slice #7' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Slice #8' })).toBeInTheDocument()
    carriesNoField()
  })
})
