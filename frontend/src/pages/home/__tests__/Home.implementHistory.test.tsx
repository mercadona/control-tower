import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'
import { ImplementHistoryMother } from '__scenarios__/ImplementHistoryMother'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { WorkProgressMother } from '__scenarios__/WorkProgressMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { openHome } from './helpers'

const EXTERNAL_TOOLS_READY = { status: 200, body: '{"ready":true,"tools":[{"tool":"gh","installed":true,"session":"ready","fix":null}]}' }
const NO_SESSIONS = SessionsMother.noSessions()

const responseFor = (answer: { status: number; body: string }) => new Response(answer.body, { status: answer.status })

const stubFetchByPath = (byPath: (url: string) => { status: number; body: string }) => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    if (input === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
    if (input === '/sessions') return responseFor(NO_SESSIONS)
    return responseFor(byPath(String(input)))
  })
  vi.stubGlobal('fetch', fetching)

  return fetching
}

const planImplementing = async (historyAnswer: () => { status: number; body: string }) => {
  const fetching = stubFetchByPath((url) => {
    if (url === '/active-plans') return HeadlessPlanMother.implementing()
    if (url.startsWith('/work-progress/')) return WorkProgressMother.implementing(ImplementProgressMother.notRead())
    if (url.startsWith('/implement-history/')) return historyAnswer()
    throw new Error(`unexpected fetch to ${url}`)
  })

  openHome()
  await screen.findByText('Implementación iniciada automáticamente')
  fireEvent.click(screen.getByRole('button', { name: 'Desplegar el panel' }))

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

  it('should render three summary tiles for tasks, attempts and tokens', async () => {
    await planImplementing(ImplementHistoryMother.fullRun)

    expect(await screen.findByText('2 de 2')).toBeInTheDocument()
    expect(screen.getByText('17,6 M')).toBeInTheDocument()
  })

  it('should group rows by task into one accordion per task, with null-task rows in a closing section', async () => {
    await planImplementing(ImplementHistoryMother.fullRun)

    expect(await screen.findByRole('button', { name: /Tarea 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tarea 2/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Cierre del slice' })).toBeInTheDocument()
  })

  it('should show the step label and the judge ruling once its task is expanded', async () => {
    await planImplementing(ImplementHistoryMother.oneTask)

    const button = await screen.findByRole('button', { name: /Tarea 1/ })
    const region = screen.getByRole('region', { name: /Tarea 1/ })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(within(region).getByText('Implementar')).toBeInTheDocument()
  })

  it('should show a row summary collapsed behind a Qué hizo el agente disclosure', async () => {
    await planImplementing(ImplementHistoryMother.oneTask)

    const disclosure = await screen.findByText('Qué hizo el agente')
    expect(disclosure.closest('details')).not.toBeNull()
  })

  it('should render an error banner with the detail for a refusal other than not-read', async () => {
    await planImplementing(ImplementHistoryMother.refusedMalformedRepo)

    expect(await within(screen.getByLabelText('Recorrido por tarea')).findByRole('alert')).toHaveTextContent(ImplementHistoryMother.MALFORMED_REPO_DETAIL)
  })

  it('should say the backend is unreachable when the shape is not recognised', async () => {
    await planImplementing(() => ({ status: 200, body: '{"unexpected":true}' }))

    expect(await screen.findByText('No se pudo contactar con el backend')).toHaveAttribute('role', 'status')
  })
})
