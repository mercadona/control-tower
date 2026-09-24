import { act, screen, waitFor, within } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'
import { ImplementHistoryMother } from '__scenarios__/ImplementHistoryMother'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { PlanningProgressMother } from '__scenarios__/PlanningProgressMother'
import { WorkProgressMother } from '__scenarios__/WorkProgressMother'
import type { ActivePlan } from 'app/active-plans/ActivePlan.types'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { WorkflowSnapshotStorage } from 'app/workflow-snapshot/storage'
import { FakeEventSource } from './FakeEventSource'
import { openHome, pressStart, selectSliceDetail, typePath, typeTicket } from './helpers'

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

const unscriptedConclusions: number[] = []

const WORK_PROGRESS = /^\/work-progress\/(\d+)/
const IMPLEMENT_HISTORY = /^\/implement-history\/(\d+)/

const backendWith = ({
  activePlans,
  progress = () => ImplementProgressMother.inReview(),
  planningProgress = () => PlanningProgressMother.running(),
  history = () => ImplementHistoryMother.empty(),
  concluded = (issue) => {
    unscriptedConclusions.push(issue)
    throw new Error(`nobody scripted what became of slice #${issue}`)
  },
}: {
  activePlans: () => Answer
  progress?: (issue: number) => Answer
  planningProgress?: (issue: number) => Answer
  history?: (issue: number) => Answer
  concluded?: (issue: number) => Answer
}) => {
  let known: ActivePlan[] = []
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === '/active-plans') {
      const answer = activePlans()
      if (answer.status === 200) known = JSON.parse(answer.body).plans
      return responseFor(answer)
    }
    if (url === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
    if (url === '/sessions') return responseFor(NO_SESSIONS)
    if (url === '/coordinating-session' && init === undefined) return responseFor(NO_COORDINATING_SESSION)
    if (url === '/coordinating-session') return responseFor(OPENED_COORDINATING_SESSION)
    if (url === '/spec-freeze') return responseFor(NO_SPEC_FREEZE)
    if (url === '/epic-groom') return responseFor(NO_EPIC_GROOM)
    const asProgress = WORK_PROGRESS.exec(url)
    if (asProgress !== null) {
      const issue = Number(asProgress[1])
      const repo = new URL(url, 'http://localhost').searchParams.get('repo')
      const active = known.find((entry) => entry.plan.issue.number === issue && entry.plan.repo === repo)
      if (active === undefined) return responseFor(concluded(issue))
      return responseFor(WorkProgressMother.fromActive(active, progress(issue), planningProgress(issue)))
    }
    const asHistory = IMPLEMENT_HISTORY.exec(url)
    if (asHistory !== null) return responseFor(history(Number(asHistory[1])))
    if (url === '/recover-plan' && init?.method === 'POST') return new Response('{"agent":"conversation-of-8"}', { status: 202 })
    if (url === '/cleanup-plan' && init?.method === 'POST') return new Response('{}', { status: 200 })
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)

  return { fetching }
}

const finishedSlice = (issue: number, pullRequest: { number: number; url: string } | null = WorkProgressMother.PULL_REQUEST) =>
  WorkProgressMother.finished({ issue, agent: HeadlessPlanMother.agentFor(issue), pullRequest })

const panelOf = async (issue: number) => within(await screen.findByRole('region', { name: `Slice #${issue}` }))

describe('Home · the slices in flight', () => {
  beforeEach(() => {
    unscriptedConclusions.splice(0)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    expect(unscriptedConclusions.splice(0)).toEqual([])
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
    expect(await screen.findByText('Implementación iniciada automáticamente')).toBeInTheDocument()
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

  it('two planning slices each use their own unified progress query', async () => {
    const { fetching } = backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlightPlanning(7, 8) })
    openHome()

    const first = await panelOf(7)
    expect(await first.findByText('El agente está trabajando')).toBeInTheDocument()
    const second = await panelOf(8)
    expect(await second.findByText('El agente está trabajando')).toBeInTheDocument()

    await waitFor(() => expect(fetching.mock.calls.some(([input]) => String(input).startsWith('/work-progress/7'))).toBe(true))
    await waitFor(() => expect(fetching.mock.calls.some(([input]) => String(input).startsWith('/work-progress/8'))).toBe(true))
    expect(fetching.mock.calls.some(([input]) => String(input).startsWith('/implement-progress/'))).toBe(false)
  })

  it('an implementing slice uses the same progress endpoint as a planning slice', async () => {
    const { fetching } = backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(7) })
    openHome()

    await screen.findByRole('heading', { name: 'Slice #7', level: 2 })

    await waitFor(() => expect(fetching.mock.calls.some(([input]) => String(input).startsWith('/work-progress/7'))).toBe(true))
    expect(fetching.mock.calls.some(([input]) => String(input).startsWith('/planning-progress/'))).toBe(false)
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

  it('a slice the judge closed shows the closure the payload carries, and the others are untouched', async () => {
    backendWith({ activePlans: () => HeadlessPlanMother.vetoedByTheJudge(8, 7) })
    openHome()

    const vetoed = await panelOf(8)
    expect(await vetoed.findByText('El juez cerró este slice')).toBeInTheDocument()
    expect(vetoed.getByText(HeadlessPlanMother.JUDGE_FINDINGS)).toBeInTheDocument()
    expect(vetoed.getByText(HeadlessPlanMother.verdictOf(8))).toBeInTheDocument()

    const untouched = await panelOf(7)
    expect(untouched.queryByText('El juez cerró este slice')).toBeNull()
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
    await act(async () => vi.advanceTimersByTimeAsync(3000))
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
    await act(async () => vi.advanceTimersByTimeAsync(1))
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
    expect(await screen.findByText('Implementación iniciada automáticamente')).toBeInTheDocument()
  })

  it('should select another slice with its history and return to the previous slice', async () => {
    localStorage.setItem('ct.sessions-column-collapsed', 'false')
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    const { fetching } = backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8),
      progress: (issue) => issue === 7 ? ImplementProgressMother.delivered() : ImplementProgressMother.progress(),
      history: (issue) => issue === 7 ? ImplementHistoryMother.fullRun() : ImplementHistoryMother.empty(),
    })
    const { user } = openHome()
    expect(await screen.findByText('Cierre del slice')).toBeInTheDocument()

    await selectSliceDetail(user, 8)

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
    expect(screen.getByText('Implementación iniciada automáticamente').closest('[role="status"]')).toHaveTextContent(HeadlessPlanMother.agentFor(8))
    expect(await (await panelOf(8)).findByText('Tarea 3 de 7')).toBeInTheDocument()
    expect(await screen.findByText('Todavía no ha terminado ningún paso')).toBeInTheDocument()
    expect(screen.queryByText('Cierre del slice')).toBeNull()
    expect(fetching).toHaveBeenCalledWith(
      `/implement-history/8?root=${encodeURIComponent(StartPlanMother.PATH)}&repo=${encodeURIComponent(StartPlanMother.REPO)}`,
    )
    expect(WorkflowSnapshotStorage.load()?.plan.issue.number).toBe(8)
    expect(screen.getAllByRole('heading', { name: 'Slice #8' })).toHaveLength(1)
    expect((await panelOf(8)).queryByRole('button', { name: 'Ver detalle' })).toBeNull()

    await selectSliceDetail(user, 7)

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#7')).toBeInTheDocument()
    expect(await screen.findByText('Cierre del slice')).toBeInTheDocument()
    expect((await panelOf(8)).getByRole('button', { name: 'Ver detalle' })).toBeInTheDocument()
  })

  it('should restore a manual selection made when several slices were initially active', async () => {
    backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8) })
    const { user, unmount } = openHome()

    await selectSliceDetail(user, 8)
    unmount()
    openHome()

    expect(await screen.findByText(HeadlessPlanMother.agentFor(8))).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
    expect((await panelOf(7)).getByRole('button', { name: 'Ver detalle' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Slice #8' })).toHaveLength(1)
  })

  it('should keep the manual selection and poll only its history on subsequent updates', async () => {
    localStorage.setItem('ct.sessions-column-collapsed', 'false')
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    const { fetching } = backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8) })
    const { user } = openHome()
    await screen.findByText('Todavía no ha terminado ningún paso')

    fetching.mockClear()
    await selectSliceDetail(user, 8)
    await waitFor(() => {
      const historyCalls = fetching.mock.calls.filter(([input]) => IMPLEMENT_HISTORY.test(String(input)))
      expect(historyCalls.length).toBeGreaterThan(1)
    }, { timeout: 4000 })

    expect(fetching).toHaveBeenCalledWith('/active-plans')
    const historyCalls = fetching.mock.calls.filter(([input]) => IMPLEMENT_HISTORY.test(String(input)))
    expect(historyCalls.length).toBeGreaterThan(1)
    expect(historyCalls.every(([input]) => String(input).startsWith('/implement-history/8?'))).toBe(true)
    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Slice #8' })).toHaveLength(1)
    expect(within(screen.getByRole('region', { name: 'Slice #7' })).getByRole('button', { name: 'Ver detalle' })).toBeInTheDocument()
  })

  it.skip('known gap: a planning slice counts as an ambiguous candidate and blocks the handoff to the sole running implementing slice', async () => {
    vi.useFakeTimers()
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    let selectedProgress = ImplementProgressMother.progress()
    const { fetching } = backendWith({
      activePlans: () => HeadlessPlanMother.planningAmong(9, 7, 8),
      progress: (issue) => issue === 7 ? selectedProgress : ImplementProgressMother.progress(),
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    selectedProgress = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
    expect(fetching.mock.calls.some(([input]) => String(input).startsWith('/implement-progress/9'))).toBe(false)
  })

  it('should advance to the sole running slice when the selected slice enters review directly', async () => {
    localStorage.setItem('ct.sessions-column-collapsed', 'false')
    vi.useFakeTimers()
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    let selectedProgress = ImplementProgressMother.progress()
    const { fetching } = backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8),
      progress: (issue) => issue === 7 ? selectedProgress : ImplementProgressMother.progress(),
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    selectedProgress = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
    expect(screen.getByText('Implementación iniciada automáticamente').closest('[role="status"]')).toHaveTextContent(HeadlessPlanMother.agentFor(8))
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(fetching).toHaveBeenCalledWith(
      `/implement-history/8?root=${encodeURIComponent(StartPlanMother.PATH)}&repo=${encodeURIComponent(StartPlanMother.REPO)}`,
    )
    expect(WorkflowSnapshotStorage.load()?.plan.issue.number).toBe(8)
    expect(within(screen.getByRole('region', { name: 'Slice #7' })).getByRole('button', { name: 'Ver detalle' })).toBeInTheDocument()
  })

  it('retains stale progress for display but waits for a fresh candidate before handing off review', async () => {
    vi.useFakeTimers()
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    let selected = ImplementProgressMother.progress()
    let candidateUnavailable = false
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8),
      progress: (issue) => {
        if (issue === 8 && candidateUnavailable) throw new TypeError('offline')
        return issue === 7 ? selected : ImplementProgressMother.progress()
      },
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(within(screen.getByRole('region', { name: 'Slice #8' })).getByText('Tarea 3 de 7')).toBeVisible()
    candidateUnavailable = true
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    const candidate = within(screen.getByRole('region', { name: 'Slice #8' }))
    expect(candidate.getByText('Tarea 3 de 7')).toBeVisible()
    expect(candidate.getByRole('alert')).toHaveTextContent('Mostramos la última lectura')
    selected = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#7')).toBeInTheDocument()
    candidateUnavailable = false
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
  })

  it.each([
    ['delivered', ImplementProgressMother.delivered()],
    ['publishing', ImplementProgressMother.publishing()],
  ])('should not advance when implementation is %s without entering review', async (_state, progress) => {
    vi.useFakeTimers()
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    let selectedProgress = ImplementProgressMother.progress()
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8),
      progress: (issue) => issue === 7 ? selectedProgress : ImplementProgressMother.progress(),
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    selectedProgress = progress
    await act(async () => vi.advanceTimersByTimeAsync(30000))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#7')).toBeInTheDocument()
    expect(WorkflowSnapshotStorage.load()?.plan.issue.number).toBe(7)
  })

  it('should wait for the next running slice to appear after entering review', async () => {
    vi.useFakeTimers()
    let inFlight = [7]
    let selectedProgress = ImplementProgressMother.progress()
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(...inFlight),
      progress: (issue) => issue === 7 ? selectedProgress : ImplementProgressMother.progress(),
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    selectedProgress = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#7')).toBeInTheDocument()

    inFlight = [7, 8]
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
  })

  it.each([
    ['running', ImplementProgressMother.progress()],
    ['unreadable', ImplementProgressMother.notRead()],
  ])('should not choose between a running slice and another %s slice', async (_state, otherProgress) => {
    vi.useFakeTimers()
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    let selectedProgress = ImplementProgressMother.progress()
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8, 9),
      progress: (issue) => issue === 7 ? selectedProgress : issue === 8 ? ImplementProgressMother.progress() : otherProgress,
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    selectedProgress = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(6000))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#7')).toBeInTheDocument()
  })

  it.each([
    ['delivered', ImplementProgressMother.delivered()],
    ['in review', ImplementProgressMother.inReview()],
  ])('should keep a slice already %s selected on restoration', async (_state, selectedProgress) => {
    vi.useFakeTimers()
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8),
      progress: (issue) => issue === 7 ? selectedProgress : ImplementProgressMother.progress(),
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(30000))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#7')).toBeInTheDocument()
  })

  it('should let the user return to the slice in review after automatic advancement', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    let selectedProgress = ImplementProgressMother.progress()
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8),
      progress: (issue) => issue === 7 ? selectedProgress : ImplementProgressMother.progress(),
    })
    const { user } = openHome()
    await (await panelOf(7)).findByText('Tarea 3 de 7')

    selectedProgress = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
    await selectSliceDetail(user, 7)
    await act(async () => vi.advanceTimersByTimeAsync(30000))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#7')).toBeInTheDocument()
  })

  it('should cancel a pending handoff when the user selects another slice in review', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    let inFlight = [7, 8]
    let selectedProgress = ImplementProgressMother.progress()
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(...inFlight),
      progress: (issue) => issue === 7 ? selectedProgress : issue === 8 ? ImplementProgressMother.inReview() : ImplementProgressMother.progress(),
    })
    const { user } = openHome()
    await (await panelOf(7)).findByText('Tarea 3 de 7')

    selectedProgress = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    await selectSliceDetail(user, 8)
    inFlight = [7, 8, 9]
    await act(async () => vi.advanceTimersByTimeAsync(30000))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
  })

  it.each([
    ['delivered', ImplementProgressMother.delivered()],
    ['fixing', ImplementProgressMother.fixing()],
  ])('should wait for a running slice when %s is followed by review', async (_state, progress) => {
    vi.useFakeTimers()
    let inFlight = [7]
    let selectedProgress = ImplementProgressMother.progress()
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(...inFlight),
      progress: (issue) => issue === 7 ? selectedProgress : ImplementProgressMother.progress(),
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    selectedProgress = progress
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    selectedProgress = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(15000))
    inFlight = [7, 8]
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
  })

  it('should cancel a pending handoff when the selected slice returns to fixing', async () => {
    vi.useFakeTimers()
    let inFlight = [7]
    let selectedProgress = ImplementProgressMother.progress()
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(...inFlight),
      progress: (issue) => issue === 7 ? selectedProgress : ImplementProgressMother.progress(),
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    selectedProgress = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(within(screen.getByLabelText('Implementación', { selector: 'section' })).getByText('En revisión')).toBeInTheDocument()
    selectedProgress = ImplementProgressMother.fixing()
    await act(async () => vi.advanceTimersByTimeAsync(15000))
    expect(within(screen.getByLabelText('Implementación', { selector: 'section' })).getByText('Corrigiendo lo pedido en la revisión')).toBeInTheDocument()
    inFlight = [7, 8]
    await act(async () => vi.advanceTimersByTimeAsync(30000))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#7')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Slice #8' })).getByText('Tarea 3 de 7')).toBeInTheDocument()
  })

  it.each([
    ['another repository', StartPlanMother.ANOTHER_REPO, StartPlanMother.PATH],
    ['another checkout', StartPlanMother.REPO, StartPlanMother.NON_CANONICAL_ROOT],
  ])('should not advance to a slice in %s', async (_location, repo, root) => {
    vi.useFakeTimers()
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    let selectedProgress = ImplementProgressMother.progress()
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesAcrossCheckouts(repo, root),
      progress: (issue) => issue === 7 ? selectedProgress : ImplementProgressMother.progress(),
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    selectedProgress = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(6000))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#7')).toBeInTheDocument()
  })

  it('should not disregard an uncertain slice even when its progress still reads delivered', async () => {
    vi.useFakeTimers()
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    let selectedProgress = ImplementProgressMother.progress()
    backendWith({
      activePlans: () => HeadlessPlanMother.uncertainAmong(9, 'inspect', 7, 8),
      progress: (issue) => issue === 7 ? selectedProgress : issue === 8 ? ImplementProgressMother.progress() : ImplementProgressMother.delivered(),
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    selectedProgress = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(6000))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#7')).toBeInTheDocument()
  })

  it('should wait for active plans to become readable before advancing', async () => {
    vi.useFakeTimers()
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    let activePlans = () => HeadlessPlanMother.slicesInFlight(7, 8)
    let selectedProgress = ImplementProgressMother.progress()
    backendWith({
      activePlans: () => activePlans(),
      progress: (issue) => issue === 7 ? selectedProgress : ImplementProgressMother.progress(),
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    activePlans = backendFallsOver
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    selectedProgress = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#7')).toBeInTheDocument()

    activePlans = () => HeadlessPlanMother.slicesInFlight(7, 8)
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
  })

  it('should follow three sequential slices when slices in review leave the active plans', async () => {
    vi.useFakeTimers()
    let inFlight = [7]
    let firstProgress = ImplementProgressMother.progress()
    let secondProgress = ImplementProgressMother.progress()
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(...inFlight),
      concluded: (issue) => finishedSlice(issue),
      progress: (issue) => issue === 7 ? firstProgress : issue === 8 ? secondProgress : ImplementProgressMother.progress(),
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    firstProgress = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    inFlight = []
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    inFlight = [8]
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()

    secondProgress = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    inFlight = [9]
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#9')).toBeInTheDocument()
    expect(WorkflowSnapshotStorage.load()?.plan.issue.number).toBe(9)
  })

  it('should require fresh progress when a candidate disappears and reappears', async () => {
    vi.useFakeTimers()
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    let inFlight = [7, 8]
    let selectedProgress = ImplementProgressMother.progress()
    let candidateProgress = ImplementProgressMother.progress()
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(...inFlight),
      progress: (issue) => issue === 7 ? selectedProgress : candidateProgress,
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    inFlight = [7]
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(screen.queryByRole('region', { name: 'Slice #8' })).toBeNull()
    selectedProgress = ImplementProgressMother.inReview()
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    candidateProgress = ImplementProgressMother.notRead()
    inFlight = [7, 8]
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#7')).toBeInTheDocument()

    candidateProgress = ImplementProgressMother.progress()
    await act(async () => vi.advanceTimersByTimeAsync(3000))

    expect(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByText('#8')).toBeInTheDocument()
  })

  it('a saved workflow the backend no longer reports leaves the other slices standing', async () => {
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(9))
    backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8), concluded: () => WorkProgressMother.notFound() })
    openHome()

    expect(await screen.findByRole('alert')).toHaveTextContent('El plan guardado ya no está activo')
    expect(screen.getByRole('alert')).toHaveTextContent('El backend ya no tiene constancia de este plan. Descarta el estado para volver a empezar.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('cmux')
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

  it('should announce the delivered slice and the one still running in its checkout instead of warning', async () => {
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(8),
      concluded: () => finishedSlice(7),
    })
    openHome()

    const announcement = await screen.findByRole('status', { name: 'Slice #7 entregado' })
    expect(announcement).toHaveTextContent('En marcha: #8.')
    expect(screen.getByRole('link', { name: '#998' })).toHaveAttribute('href', WorkProgressMother.PULL_REQUEST.url)
    expect(screen.queryByText('El plan guardado ya no está activo')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Slice #8', level: 2 })).toBeInTheDocument()
  })

  it('should announce the last delivered slice and clear it when closed', async () => {
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    backendWith({
      activePlans: () => HeadlessPlanMother.empty(),
      concluded: () => finishedSlice(7, null),
    })
    const { user } = openHome()

    const announcement = await screen.findByRole('status', { name: 'Slice #7 entregado' })
    expect(announcement).toHaveTextContent('No hay más slices en marcha en este repositorio.')
    expect(screen.getByText('El slice seleccionado ha terminado.')).toBeInTheDocument()
    expect(screen.queryAllByRole('link').filter((link) => link.getAttribute('href')?.includes('/pull/'))).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Cerrar' }))

    expect(WorkflowSnapshotStorage.load()).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Solicitud', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Slice #7 entregado' })).toBeNull()
  })

  it('should name every slice still running in its checkout and none of another checkout', async () => {
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlightWithOneElsewhere('/elsewhere/clone', 10, 8, 9),
      concluded: () => finishedSlice(7),
    })
    openHome()

    expect(await screen.findByRole('status', { name: 'Slice #7 entregado' })).toHaveTextContent('En marcha: #8, #9.')
  })

  it('should turn the warning into the announcement once the backend records the harvest', async () => {
    vi.useFakeTimers()
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    let harvested = false
    backendWith({
      activePlans: () => HeadlessPlanMother.empty(),
      concluded: () => harvested ? finishedSlice(7) : WorkProgressMother.notFound(),
    })
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole('alert')).toHaveTextContent('El plan guardado ya no está activo')

    harvested = true
    await act(async () => vi.advanceTimersByTimeAsync(3000))

    expect(screen.getByRole('status', { name: 'Slice #7 entregado' })).toBeInTheDocument()
    expect(screen.queryByText('El plan guardado ya no está activo')).toBeNull()
  })

  it('should not announce a delivery the backend reports for another conversation of the same issue', async () => {
    vi.useFakeTimers()
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    const { fetching } = backendWith({
      activePlans: () => HeadlessPlanMother.empty(),
      concluded: () => WorkProgressMother.finished({ issue: 7, agent: 'another-conversation' }),
    })
    const asked = () => fetching.mock.calls.filter(([input]) => String(input).startsWith('/work-progress/7?')).length
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(3000))

    expect(asked()).toBe(2)
    expect(screen.getByText('Comprobando que el plan sigue activo')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Slice #7 entregado' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
