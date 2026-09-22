import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'
import { ImplementHistoryMother } from '__scenarios__/ImplementHistoryMother'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { WorkflowSnapshotStorage } from 'app/workflow-snapshot/storage'
import { FakeEventSource } from './FakeEventSource'
import { openHome, pressStart, typePath, typeRepository, typeTicket } from './helpers'

type Answer = { status: number; body: string }

const MESSAGE_FIELD = 'Pedir un cambio a esta conversación'
const SEND = 'Enviar'

const EXTERNAL_TOOLS_READY = ExternalToolsMother.allReady()
const NO_SESSIONS = SessionsMother.noSessions()
const NO_COORDINATING_SESSION = CoordinatingSessionMother.none()
const OPENED_COORDINATING_SESSION = CoordinatingSessionMother.opened()
const NO_SPEC_FREEZE = SpecFreezeMother.none()
const NO_EPIC_GROOM = EpicGroomMother.none()

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status })

const backendFallsOver = () => {
  throw new TypeError('Failed to fetch')
}

const IMPLEMENT_PROGRESS = /^\/implement-progress\/(\d+)/
const IMPLEMENT_HISTORY = /^\/implement-history\/(\d+)/

const backendWith = ({ activePlans, progress = () => ImplementProgressMother.inReview(), history = () => ImplementHistoryMother.empty() }: {
  activePlans: () => Answer
  progress?: (issue: number) => Answer
  history?: (issue: number) => Answer
}) => {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === '/active-plans') return responseFor(activePlans())
    if (url === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
    if (url === '/sessions') return responseFor(NO_SESSIONS)
    if (url === '/coordinating-session' && init === undefined) return responseFor(NO_COORDINATING_SESSION)
    if (url === '/coordinating-session') return responseFor(OPENED_COORDINATING_SESSION)
    if (url === '/spec-freeze') return responseFor(NO_SPEC_FREEZE)
    if (url === '/epic-groom') return responseFor(NO_EPIC_GROOM)
    const asProgress = IMPLEMENT_PROGRESS.exec(url)
    if (asProgress !== null) return responseFor(progress(Number(asProgress[1])))
    const asHistory = IMPLEMENT_HISTORY.exec(url)
    if (asHistory !== null) return responseFor(history(Number(asHistory[1])))
    if (url === '/recover-plan' && init?.method === 'POST') return new Response('{"agent":"conversation-of-8"}', { status: 202 })
    if (url === '/cleanup-plan' && init?.method === 'POST') return new Response('{}', { status: 200 })
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)

  return { fetching }
}

const panelOf = async (issue: number) => within(await screen.findByRole('region', { name: `Slice #${issue}` }))

describe('Home · the slices in flight', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('paints one panel per slice, titled with its issue, and asks nothing', async () => {
    backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8) })
    openHome()

    expect(await screen.findByRole('heading', { name: 'Slice #7', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Slice #8', level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Continuar plan/ })).toBeNull()
    expect(screen.queryByLabelText('Planes activos')).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('paints the panel of a single slice the way it already did', async () => {
    backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(7) })
    openHome()

    expect(await screen.findByRole('heading', { name: 'Slice #7', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Implementación iniciada automáticamente')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Implementación', level: 1 })).toBeInTheDocument()
  })

  it('asks for a request and paints no panel when nothing is in flight', async () => {
    backendWith({ activePlans: () => HeadlessPlanMother.empty() })
    openHome()

    expect(await screen.findByRole('heading', { name: 'Solicitud', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Slice #/ })).toBeNull()
  })

  it('no panel offers a field, whatever the state of its slice, and none reaches the message endpoint', async () => {
    const { fetching } = backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8),
      progress: (issue) => (issue === 7 ? ImplementProgressMother.progress() : ImplementProgressMother.inReview()),
    })
    openHome()

    const implementing = await panelOf(7)
    expect(await implementing.findByText(/Tarea 3 de 7/)).toBeInTheDocument()
    const inReview = await panelOf(8)
    expect(await inReview.findByText('En revisión')).toBeInTheDocument()

    expect(screen.queryAllByLabelText(MESSAGE_FIELD)).toEqual([])
    expect(screen.queryAllByRole('button', { name: SEND })).toEqual([])
    expect(fetching.mock.calls.some(([input]) => String(input).includes('/message'))).toBe(false)
  })

  it('an uncertain slice among several carries its recovery inside its own panel and leaves the others alone', async () => {
    backendWith({ activePlans: () => HeadlessPlanMother.uncertainAmong(8, 'continue', 7) })
    openHome()

    const uncertain = await panelOf(8)
    expect(await uncertain.findByRole('alert')).toHaveTextContent(HeadlessPlanMother.uncertainDiagnostic(8))
    expect(uncertain.getByRole('button', { name: 'Recuperar trabajo' })).toBeInTheDocument()

    const untouched = await panelOf(7)
    expect(untouched.queryByRole('alert')).toBeNull()
    expect(untouched.queryByRole('button', { name: 'Recuperar trabajo' })).toBeNull()
    expect(await untouched.findByText('En revisión')).toBeInTheDocument()
  })

  it('an uncertain slice whose start never launched offers the cleanup instead', async () => {
    backendWith({ activePlans: () => HeadlessPlanMother.uncertainAmong(8, 'cleanup', 7) })
    openHome()

    const uncertain = await panelOf(8)

    expect(await uncertain.findByRole('button', { name: 'Limpiar arranque fallido' })).toBeInTheDocument()
    expect(uncertain.queryByRole('button', { name: 'Recuperar trabajo' })).toBeNull()
  })

  it('recovering one uncertain slice asks for that slice and keeps every other panel standing', async () => {
    const { fetching } = backendWith({ activePlans: () => HeadlessPlanMother.uncertainAmong(8, 'continue', 7) })
    const { user } = openHome()

    const uncertain = await panelOf(8)
    await user.click(await uncertain.findByRole('button', { name: 'Recuperar trabajo' }))

    await waitFor(() => expect(
      fetching.mock.calls.some(([input]) => String(input) === '/recover-plan')
    ).toBe(true))
    const asked = fetching.mock.calls.find(([input]) => String(input) === '/recover-plan')
    expect(JSON.parse(String((asked?.[1] as RequestInit).body))).toEqual({
      repo: StartPlanMother.REPO, issue: 8, agent: HeadlessPlanMother.agentFor(8),
    })
    expect(await panelOf(7)).toBeTruthy()
  })

  it('a slice that stops being uncertain loses its recovery and shows its progress again', async () => {
    let answer = HeadlessPlanMother.uncertainAmong(8, 'continue', 7)
    vi.useFakeTimers()
    backendWith({ activePlans: () => answer })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(within(screen.getByRole('region', { name: 'Slice #8' })).getByRole('alert')).toBeInTheDocument()

    answer = HeadlessPlanMother.slicesInFlight(8, 7)
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    const settled = within(screen.getByRole('region', { name: 'Slice #8' }))
    expect(settled.queryByRole('alert')).toBeNull()
    expect(settled.queryByRole('button', { name: 'Recuperar trabajo' })).toBeNull()
  })

  it('drops the panel of a slice that left the active plans and keeps the rest', async () => {
    vi.useFakeTimers()
    let inFlight = [7, 8, 9]
    backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(...inFlight) })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole('heading', { name: 'Slice #8', level: 2 })).toBeInTheDocument()

    inFlight = [7, 9]
    await act(async () => vi.advanceTimersByTimeAsync(2000))

    expect(screen.queryByRole('heading', { name: 'Slice #8' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Slice #7', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Slice #9', level: 2 })).toBeInTheDocument()
  })

  it('keeps the panels standing while a new request opens its own conversation', async () => {
    const { fetching } = backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8) })
    const { user } = openHome()
    await screen.findByRole('heading', { name: 'Slice #7', level: 2 })

    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)
    await pressStart(user)

    await waitFor(() => expect(
      fetching.mock.calls.filter(([input, init]) => input === '/coordinating-session' && init !== undefined),
    ).toHaveLength(1))
    expect(screen.getByRole('heading', { name: 'Slice #7', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Slice #8', level: 2 })).toBeInTheDocument()
  })

  it('shows a slice that arrives after a single one was adopted, without repeating the adopted panel', async () => {
    vi.useFakeTimers()
    let inFlight = [7]
    backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(...inFlight) })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByText('Implementación iniciada automáticamente')).toBeInTheDocument()

    inFlight = [7, 8]
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(screen.getByRole('heading', { name: 'Slice #8', level: 2 })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Slice #7', level: 2 })).toHaveLength(1)
    expect(screen.queryAllByLabelText(MESSAGE_FIELD)).toEqual([])
  })

  it('a saved workflow does not hide the other slices the backend reports', async () => {
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8) })
    openHome()

    expect(await screen.findByRole('heading', { name: 'Slice #8', level: 2 })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Slice #7', level: 2 })).toHaveLength(1)
    expect(screen.getByText('Implementación iniciada automáticamente')).toBeInTheDocument()
  })

  it('selects another slice with its history and can return to the previous slice', async () => {
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    const { fetching } = backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8),
      progress: (issue) => issue === 7 ? ImplementProgressMother.delivered() : ImplementProgressMother.progress(),
      history: (issue) => issue === 7 ? ImplementHistoryMother.fullRun() : ImplementHistoryMother.empty(),
    })
    const { user } = openHome()
    expect(await screen.findByText('Cierre del slice')).toBeInTheDocument()

    await user.click((await panelOf(8)).getByRole('button', { name: 'Ver detalle' }))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Implementación', { selector: 'section' })).getByText(HeadlessPlanMother.agentFor(8))).toBeInTheDocument()
    expect(await (await panelOf(8)).findByText('Tarea 3 de 7')).toBeInTheDocument()
    expect(await screen.findByText('Todavía no ha terminado ningún paso')).toBeInTheDocument()
    expect(screen.queryByText('Cierre del slice')).toBeNull()
    expect(fetching).toHaveBeenCalledWith(
      `/implement-history/8?root=${encodeURIComponent(StartPlanMother.PATH)}&repo=${encodeURIComponent(StartPlanMother.REPO)}`,
    )
    expect(WorkflowSnapshotStorage.load()?.plan.issue.number).toBe(8)
    expect(screen.getAllByRole('heading', { name: 'Slice #8' })).toHaveLength(1)
    expect((await panelOf(8)).queryByRole('button', { name: 'Ver detalle' })).toBeNull()

    await user.click((await panelOf(7)).getByRole('button', { name: 'Ver detalle' }))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#7')).toBeInTheDocument()
    expect(await screen.findByText('Cierre del slice')).toBeInTheDocument()
    expect((await panelOf(8)).getByRole('button', { name: 'Ver detalle' })).toBeInTheDocument()
  })

  it('restores a manual selection made when several slices were initially active', async () => {
    backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8) })
    const { user, unmount } = openHome()

    await user.click((await panelOf(8)).getByRole('button', { name: 'Ver detalle' }))
    unmount()
    openHome()

    expect(await screen.findByText(HeadlessPlanMother.agentFor(8))).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
    expect((await panelOf(7)).getByRole('button', { name: 'Ver detalle' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Slice #8' })).toHaveLength(1)
  })

  it('keeps the manual selection and polls only its history on subsequent updates', async () => {
    vi.useFakeTimers()
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    const { fetching } = backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8) })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))

    fireEvent.click(within(screen.getByRole('region', { name: 'Slice #8' })).getByRole('button', { name: 'Ver detalle' }))
    fetching.mockClear()
    await act(async () => vi.advanceTimersByTimeAsync(6000))

    expect(fetching).toHaveBeenCalledWith('/active-plans')
    const historyCalls = fetching.mock.calls.filter(([input]) => IMPLEMENT_HISTORY.test(String(input)))
    expect(historyCalls.length).toBeGreaterThan(1)
    expect(historyCalls.every(([input]) => String(input).startsWith('/implement-history/8?'))).toBe(true)
    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Slice #8' })).toHaveLength(1)
    expect(within(screen.getByRole('region', { name: 'Slice #7' })).getByRole('button', { name: 'Ver detalle' })).toBeInTheDocument()
  })

  it('a saved workflow the backend no longer reports leaves the other slices standing', async () => {
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(9))
    backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8) })
    openHome()

    expect(await screen.findByRole('alert')).toHaveTextContent('El plan guardado ya no está activo')
    expect(screen.getByRole('heading', { name: 'Slice #7', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Slice #8', level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Slice #9' })).toBeNull()
  })

  it('discarding the adopted workflow keeps the panels of the slices still in flight', async () => {
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8, 9) })
    const { user } = openHome()
    await screen.findByRole('heading', { name: 'Slice #8', level: 2 })

    await user.click(screen.getByRole('button', { name: 'Arrancar otro plan' }))

    expect(screen.getByRole('heading', { name: 'Slice #8', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Slice #9', level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Slice #7' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Solicitud', level: 1 })).toBeInTheDocument()
  })

  it('a read the backend could not answer leaves the panels standing', async () => {
    vi.useFakeTimers()
    let answering: () => Answer = () => HeadlessPlanMother.slicesInFlight(7, 8)
    backendWith({ activePlans: () => answering() })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))

    answering = backendFallsOver
    await act(async () => vi.advanceTimersByTimeAsync(2000))

    expect(screen.getByRole('heading', { name: 'Slice #7', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Slice #8', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo comprobar el estado del plan')
  })

  it('the page stops warning it cannot check once a later read answers', async () => {
    vi.useFakeTimers()
    let answering: () => Answer = () => HeadlessPlanMother.slicesInFlight(7, 8)
    backendWith({ activePlans: () => answering() })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    answering = backendFallsOver
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo comprobar el estado del plan')

    answering = () => HeadlessPlanMother.slicesInFlight(7, 8)
    await act(async () => vi.advanceTimersByTimeAsync(2000))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('Ticket')).toBeEnabled()
  })
})
