import { screen } from '@testing-library/react'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { openHome } from './helpers'

const EXTERNAL_TOOLS_READY = { status: 200, body: '{"ready":true,"tools":[{"tool":"gh","installed":true,"session":"ready","fix":null}]}' }
const NO_SESSIONS = SessionsMother.noSessions()
const MESSAGE_TEXT = 'Cambia el nombre del export'
const DELIVERED = { status: 202, body: '{"status":"delivered"}' }

const responseFor = (answer: { status: number; body: string }) => new Response(answer.body, { status: answer.status })

const stubFetch = (posted: (body: unknown) => void, progress = ImplementProgressMother.inReview()) => {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
    if (url === '/sessions') return responseFor(NO_SESSIONS)
    if (url === '/active-plans') return responseFor(HeadlessPlanMother.implementing())
    if (url.startsWith('/implement-progress/')) return responseFor(progress)
    if (url === `/slices/${StartPlanMother.ISSUE.number}/message` && init?.method === 'POST') {
      posted(JSON.parse(String(init.body)))
      return responseFor(DELIVERED)
    }
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)

  return fetching
}

describe('Home · slice session', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('the implementation stage renders the slice panel with the recorded conversation', async () => {
    const posted = vi.fn()
    stubFetch(posted)
    const { user } = openHome()

    expect(
      await screen.findByRole('heading', { name: `Slice #${StartPlanMother.ISSUE.number}`, level: 2 }),
    ).toBeInTheDocument()
    const field = await screen.findByLabelText('Pedir un cambio a esta conversación')
    await user.type(field, MESSAGE_TEXT)
    await user.click(screen.getByRole('button', { name: 'Enviar' }))

    await screen.findByText('Cambio entregado a la conversación del slice')
    expect(posted).toHaveBeenCalledWith({ repo: StartPlanMother.REPO, agent: StartPlanMother.AGENT, text: MESSAGE_TEXT })
  })

  it('the coordinating session drawer stays visible while the slice panel shows', async () => {
    stubFetch(vi.fn())

    openHome()

    await screen.findByLabelText('Pedir un cambio a esta conversación')
    expect(screen.getByRole('heading', { name: 'Sesión coordinadora', level: 2 })).toBeInTheDocument()
  })

  it('the adopted workflow\'s panel offers the field while its slice is implementing', async () => {
    stubFetch(vi.fn(), ImplementProgressMother.progress())

    openHome()

    expect(await screen.findByText(/Tarea 3 de 7/)).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: `Slice #${StartPlanMother.ISSUE.number}`, level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Pedir un cambio a esta conversación')).toBeInTheDocument()
  })
})
