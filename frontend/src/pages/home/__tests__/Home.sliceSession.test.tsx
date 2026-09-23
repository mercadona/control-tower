import { screen } from '@testing-library/react'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { WorkProgressMother } from '__scenarios__/WorkProgressMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { openHome } from './helpers'

const EXTERNAL_TOOLS_READY = { status: 200, body: '{"ready":true,"tools":[{"tool":"gh","installed":true,"session":"ready","fix":null}]}' }
const NO_SESSIONS = SessionsMother.noSessions()

const responseFor = (answer: { status: number; body: string }) => new Response(answer.body, { status: answer.status })

const stubFetch = (progress = ImplementProgressMother.inReview()) => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
    if (url === '/sessions') return responseFor(NO_SESSIONS)
    if (url === '/active-plans') return responseFor(HeadlessPlanMother.implementing())
    if (url.startsWith('/work-progress/')) return responseFor(WorkProgressMother.implementing(progress))
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)

  return fetching
}

describe('Home · slice session', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('the implementation stage renders the slice panel and offers no field in it', async () => {
    const fetching = stubFetch()
    openHome()

    expect(
      await screen.findByRole('heading', { name: `Slice #${StartPlanMother.ISSUE.number}`, level: 2 }),
    ).toBeInTheDocument()
    expect(await screen.findByText('En revisión')).toBeInTheDocument()

    expect(screen.queryByLabelText('Pedir un cambio a esta conversación')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull()
    expect(fetching.mock.calls.some(([input]) => String(input).includes('/message'))).toBe(false)
  })

  it('the coordinating session drawer stays visible while the slice panel shows', async () => {
    stubFetch()

    openHome()

    await screen.findByRole('heading', { name: `Slice #${StartPlanMother.ISSUE.number}`, level: 2 })
    expect(screen.getByRole('heading', { name: 'Sesión coordinadora', level: 2 })).toBeInTheDocument()
  })

  it('the adopted workflow\'s panel offers no field while its slice is implementing', async () => {
    stubFetch(ImplementProgressMother.progress())

    openHome()

    expect(await screen.findByText(/Tarea 3 de 7/)).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: `Slice #${StartPlanMother.ISSUE.number}`, level: 2 }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Pedir un cambio a esta conversación')).toBeNull()
  })
})
