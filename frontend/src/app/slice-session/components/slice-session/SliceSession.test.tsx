import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SliceSessionMother } from '__scenarios__/SliceSessionMother'
import { SliceSession } from './SliceSession'

type Answer = { status: number; body: string }

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

const renderSession = () => render(
  <SliceSession
    issue={SliceSessionMother.ISSUE}
    root={SliceSessionMother.ROOT}
    repo={SliceSessionMother.REPO}
    agent={SliceSessionMother.AGENT}
  />
)

describe('SliceSession', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows the step of the slice and delivers a typed message to its conversation', async () => {
    const { posted } = stubFetch({ progress: SliceSessionMother.progress(), message: SliceSessionMother.delivered() })
    const user = userEvent.setup()
    renderSession()

    expect(await screen.findByText(/Tarea 3 de 7/)).toBeInTheDocument()
    const field = screen.getByLabelText('Pedir un cambio a esta conversación')
    await user.type(field, SliceSessionMother.TEXT)
    await user.click(screen.getByRole('button', { name: 'Enviar' }))

    expect(await screen.findByText('Cambio entregado a la conversación del slice')).toBeInTheDocument()
    expect(posted).toHaveBeenCalledWith({
      repo: SliceSessionMother.REPO, agent: SliceSessionMother.AGENT, text: SliceSessionMother.TEXT,
    })
    expect(field).toHaveValue('')
  })

  it('an empty message reaches no endpoint', async () => {
    const { posted } = stubFetch({ progress: SliceSessionMother.progress() })
    renderSession()

    await screen.findByText(/Tarea 3 de 7/)

    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
    expect(posted).not.toHaveBeenCalled()
  })

  it('a refused delivery keeps the text and shows the reason', async () => {
    stubFetch({ progress: SliceSessionMother.progress(), message: SliceSessionMother.refused() })
    const user = userEvent.setup()
    renderSession()

    await screen.findByText(/Tarea 3 de 7/)
    const field = screen.getByLabelText('Pedir un cambio a esta conversación')
    await user.type(field, SliceSessionMother.TEXT)
    await user.click(screen.getByRole('button', { name: 'Enviar' }))

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
    renderSession()

    await screen.findByText(/Tarea 3 de 7/)
    const field = screen.getByLabelText('Pedir un cambio a esta conversación')
    await user.type(field, SliceSessionMother.TEXT)
    await user.click(screen.getByRole('button', { name: 'Enviar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
    expect(field).toHaveValue(SliceSessionMother.TEXT)
  })
})
