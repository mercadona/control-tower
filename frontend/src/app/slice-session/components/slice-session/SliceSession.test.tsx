import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SliceSessionMother } from '__scenarios__/SliceSessionMother'
import { SliceSession } from './SliceSession'

type Answer = { status: number; body: string }

const FIELD_LABEL = 'Pedir un cambio a esta conversación'
const SEND_LABEL = 'Enviar'

const stubFetch = ({ progress, then = progress, message }: { progress: Answer, then?: Answer, message?: Answer }) => {
  const posted = vi.fn()
  let reads = 0
  const fetching = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/implement-progress/')) {
      const answer = reads === 0 ? progress : then
      reads += 1
      return new Response(answer.body, { status: answer.status })
    }
    if (url === `/slices/${SliceSessionMother.ISSUE}/message` && init?.method === 'POST') {
      posted(JSON.parse(String(init.body)))
      if (message === undefined) throw new Error('no message answer scripted')
      return new Response(message.body, { status: message.status })
    }
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)

  return { posted }
}

const renderSession = () => render(
  <SliceSession
    issue={SliceSessionMother.ISSUE}
    root={SliceSessionMother.ROOT}
    repo={SliceSessionMother.REPO}
    agent={SliceSessionMother.AGENT}
  />
)

describe('SliceSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('a slice whose pull request is open offers the field and delivers the typed message to its conversation', async () => {
    const { posted } = stubFetch({ progress: SliceSessionMother.inReview(), message: SliceSessionMother.delivered() })
    const user = userEvent.setup()
    renderSession()

    const field = await screen.findByLabelText(FIELD_LABEL)
    await user.type(field, SliceSessionMother.TEXT)
    await user.click(screen.getByRole('button', { name: SEND_LABEL }))

    expect(await screen.findByText('Cambio entregado a la conversación del slice')).toBeInTheDocument()
    expect(posted).toHaveBeenCalledWith({
      repo: SliceSessionMother.REPO, agent: SliceSessionMother.AGENT, text: SliceSessionMother.TEXT,
    })
    expect(field).toHaveValue('')
  })

  it('an empty message reaches no endpoint', async () => {
    const { posted } = stubFetch({ progress: SliceSessionMother.inReview() })
    renderSession()

    await screen.findByLabelText(FIELD_LABEL)

    expect(screen.getByRole('button', { name: SEND_LABEL })).toBeDisabled()
    expect(posted).not.toHaveBeenCalled()
  })

  it('a refused delivery keeps the text and shows the reason', async () => {
    stubFetch({ progress: SliceSessionMother.inReview(), message: SliceSessionMother.refused() })
    const user = userEvent.setup()
    renderSession()

    const field = await screen.findByLabelText(FIELD_LABEL)
    await user.type(field, SliceSessionMother.TEXT)
    await user.click(screen.getByRole('button', { name: SEND_LABEL }))

    expect(await screen.findByRole('alert')).toHaveTextContent(SliceSessionMother.NOT_DELIVERED_DETAIL)
    expect(field).toHaveValue(SliceSessionMother.TEXT)
  })

  it('an unreachable backend says so instead of claiming delivery', async () => {
    const progress = SliceSessionMother.inReview()
    const fetching = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/implement-progress/')) return new Response(progress.body, { status: progress.status })
      if (url === `/slices/${SliceSessionMother.ISSUE}/message` && init?.method === 'POST') {
        throw new TypeError('Failed to fetch')
      }
      throw new Error(`unexpected fetch to ${url}`)
    })
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()
    renderSession()

    const field = await screen.findByLabelText(FIELD_LABEL)
    await user.type(field, SliceSessionMother.TEXT)
    await user.click(screen.getByRole('button', { name: SEND_LABEL }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
    expect(field).toHaveValue(SliceSessionMother.TEXT)
  })

  it('a slice that is still implementing offers no field, because its conversation would refuse the message', async () => {
    stubFetch({ progress: SliceSessionMother.progress() })
    renderSession()

    expect(await screen.findByText(/Tarea 3 de 7/)).toBeInTheDocument()
    expect(screen.queryByLabelText(FIELD_LABEL)).toBeNull()
    expect(screen.queryByRole('button', { name: SEND_LABEL })).toBeNull()
  })

  it('the field appears when the pull request opens under a slice that was implementing', async () => {
    vi.useFakeTimers()
    stubFetch({ progress: SliceSessionMother.progress(), then: SliceSessionMother.inReview() })
    renderSession()

    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(screen.queryByLabelText(FIELD_LABEL)).toBeNull()

    await act(async () => vi.advanceTimersByTimeAsync(3000))

    expect(screen.getByLabelText(FIELD_LABEL)).toBeInTheDocument()
  })
})
