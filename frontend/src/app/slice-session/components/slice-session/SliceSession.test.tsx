import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { SliceSessionMother } from '__scenarios__/SliceSessionMother'
import type { SlicePhase } from 'app/slice-session/SliceSession.types'
import { SliceSession } from './SliceSession'

type Answer = { status: number; body: string }

const FIELD_LABEL = 'Pedir un cambio a esta conversación'
const SEND_LABEL = 'Enviar'
const WAITING_COPY = 'Esperando a que arranque la implementación…'
const PULL_REQUEST_LINK = '#31'

const stubFetch = ({ progress, message }: { progress: Answer, message?: Answer }) => {
  const posted = vi.fn()
  const fetching = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/implement-progress/')) return new Response(progress.body, { status: progress.status })
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

const sessionWith = (phase: SlicePhase) => (
  <SliceSession
    issue={SliceSessionMother.ISSUE}
    root={SliceSessionMother.ROOT}
    repo={SliceSessionMother.REPO}
    agent={SliceSessionMother.AGENT}
    phase={phase}
  />
)

const renderSession = (phase: SlicePhase) => render(sessionWith(phase))

describe('SliceSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('a slice that is implementing offers the field and delivers the typed change to its conversation', async () => {
    const { posted } = stubFetch({ progress: SliceSessionMother.progress(), message: SliceSessionMother.delivered() })
    const user = userEvent.setup()
    renderSession('implementing')

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
    const { posted } = stubFetch({ progress: SliceSessionMother.progress() })
    renderSession('implementing')

    await screen.findByLabelText(FIELD_LABEL)

    expect(screen.getByRole('button', { name: SEND_LABEL })).toBeDisabled()
    expect(posted).not.toHaveBeenCalled()
  })

  it('a refusal the panel could not foresee is shown with the text kept', async () => {
    stubFetch({ progress: ImplementProgressMother.fixing(), message: SliceSessionMother.refused() })
    const user = userEvent.setup()
    renderSession('implementing')

    const field = await screen.findByLabelText(FIELD_LABEL)
    await user.type(field, SliceSessionMother.TEXT)
    await user.click(screen.getByRole('button', { name: SEND_LABEL }))

    expect(await screen.findByRole('alert')).toHaveTextContent(SliceSessionMother.NOT_DELIVERED_DETAIL)
    expect(field).toHaveValue(SliceSessionMother.TEXT)
  })

  it('an unreachable backend says so instead of claiming delivery', async () => {
    const progress = SliceSessionMother.progress()
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
    renderSession('implementing')

    const field = await screen.findByLabelText(FIELD_LABEL)
    await user.type(field, SliceSessionMother.TEXT)
    await user.click(screen.getByRole('button', { name: SEND_LABEL }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
    expect(field).toHaveValue(SliceSessionMother.TEXT)
  })

  it("a slice in the planner's window offers no field, because the run is not there to hold the change", async () => {
    stubFetch({ progress: ImplementProgressMother.notRead() })
    renderSession('planning')

    expect(await screen.findByText(WAITING_COPY)).toBeInTheDocument()
    expect(screen.queryByLabelText(FIELD_LABEL)).toBeNull()
    expect(screen.queryByRole('button', { name: SEND_LABEL })).toBeNull()
  })

  it('an uncertain slice offers no field even though its pull request is open', async () => {
    stubFetch({ progress: SliceSessionMother.inReview() })
    renderSession('uncertain')

    expect(await screen.findByRole('link', { name: PULL_REQUEST_LINK })).toBeInTheDocument()
    expect(screen.queryByLabelText(FIELD_LABEL)).toBeNull()
    expect(screen.queryByRole('button', { name: SEND_LABEL })).toBeNull()
  })

  it('a slice that has delivered before its pull request exists offers the field', async () => {
    stubFetch({ progress: ImplementProgressMother.delivered() })
    renderSession('implementing')

    expect(await screen.findByText('Entregado')).toBeInTheDocument()
    expect(screen.getByLabelText(FIELD_LABEL)).toBeInTheDocument()
  })

  it("the field appears the moment a slice leaves the planner's window", async () => {
    stubFetch({ progress: ImplementProgressMother.notRead() })
    const { rerender } = renderSession('planning')

    expect(await screen.findByText(WAITING_COPY)).toBeInTheDocument()
    expect(screen.queryByLabelText(FIELD_LABEL)).toBeNull()

    rerender(sessionWith('implementing'))

    expect(screen.getByLabelText(FIELD_LABEL)).toBeInTheDocument()
  })
})
