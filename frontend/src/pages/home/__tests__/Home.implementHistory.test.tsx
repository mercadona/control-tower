import { screen, waitFor, within } from '@testing-library/react'
import { ImplementHistoryMother } from '__scenarios__/ImplementHistoryMother'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { openHome, startPlan, streamFrame } from './helpers'

const IMPLEMENT_BUTTON = { name: 'Implementar plan' }
const NO_ACTIVE_PLANS = { status: 200, body: '{"plans":[]}' }
const EXTERNAL_TOOLS_READY = { status: 200, body: '{"ready":true,"tools":[{"tool":"gh","installed":true,"session":"ready","fix":null}]}' }
const IMPLEMENTING = { status: 202, body: '{"status":"implementing","agent":"workspace:4","issue":7}' }

const responseFor = (answer: { status: number; body: string }) => new Response(answer.body, { status: answer.status })

const stubFetchByPath = (byPath: (url: string) => { status: number; body: string }) => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    if (input === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
    return responseFor(byPath(String(input)))
  })
  vi.stubGlobal('fetch', fetching)

  return fetching
}

const planImplementing = async (historyAnswer: () => { status: number; body: string }) => {
  const fetching = stubFetchByPath((url) => {
    if (url === '/active-plans') return NO_ACTIVE_PLANS
    if (url === '/start-plan') return StartPlanMother.started()
    if (url === '/implement-plan') return IMPLEMENTING
    if (url.startsWith('/implement-progress/')) return ImplementProgressMother.notRead()
    if (url.startsWith('/implement-history/')) return historyAnswer()
    throw new Error(`unexpected fetch to ${url}`)
  })

  const { user } = openHome()
  await startPlan(user)
  await screen.findByRole('status')
  await streamFrame(PlanEventsMother.ready())
  await user.click(screen.getByRole('button', IMPLEMENT_BUTTON))
  await screen.findByText('Agente asignado')

  return fetching
}

describe('Home · implement history', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should poll history with the same issue, root and repo as progress', async () => {
    const fetching = await planImplementing(ImplementHistoryMother.empty)

    await waitFor(() =>
      expect(fetching).toHaveBeenCalledWith(
        `/implement-history/${StartPlanMother.ISSUE.number}?root=${encodeURIComponent(StartPlanMother.PATH)}&repo=${encodeURIComponent(StartPlanMother.REPO)}`,
      ),
    )
  })

  it('should render a single status line saying no step has finished yet', async () => {
    await planImplementing(ImplementHistoryMother.empty)

    expect(await screen.findByText('Todavía no ha terminado ningún paso')).toHaveAttribute('role', 'status')
  })

  it('should render one row per finished step, in file order', async () => {
    await planImplementing(ImplementHistoryMother.fullRun)

    const list = await screen.findByRole('list', { name: 'Pasos completados' })
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(11))
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Implementando')
    expect(rows[10]).toHaveTextContent('Evaluando el slice')
  })

  it('should show the step label, the task number, the outcome label and the duration of a row', async () => {
    await planImplementing(ImplementHistoryMother.oneTask)

    const list = await screen.findByRole('list', { name: 'Pasos completados' })
    const [row] = within(list).getAllByRole('listitem')
    expect(row).toHaveTextContent('Implementando')
    expect(row).toHaveTextContent('Tarea 1')
    expect(row).toHaveTextContent('Hecho')
  })

  it('should show a row summary collapsed behind a disclosure', async () => {
    await planImplementing(ImplementHistoryMother.oneTask)

    const list = await screen.findByRole('list', { name: 'Pasos completados' })
    const disclosure = within(list).getByText('Resumen')
    expect(disclosure.closest('details')).not.toBeNull()
  })

  it('should render an error banner with the detail for a refusal other than not-read', async () => {
    await planImplementing(ImplementHistoryMother.refusedMalformedRepo)

    expect(await screen.findByRole('alert')).toHaveTextContent(ImplementHistoryMother.MALFORMED_REPO_DETAIL)
  })

  it('should say the backend is unreachable when the shape is not recognised', async () => {
    await planImplementing(() => ({ status: 200, body: '{"unexpected":true}' }))

    expect(await screen.findByText('No se pudo contactar con el backend')).toHaveAttribute('role', 'status')
  })
})
