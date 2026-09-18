import { act, screen, waitFor, within } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { SliceSessionMother } from '__scenarios__/SliceSessionMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { WorkflowSnapshotStorage } from 'app/workflow-snapshot/storage'
import { FakeEventSource } from './FakeEventSource'
import { openHome, pressStart, typePath, typeRepository, typeTicket } from './helpers'

type Answer = { status: number; body: string }

const MESSAGE_TEXT = 'Cambia el nombre del export'
const MESSAGE_FIELD = 'Pedir un cambio a esta conversación'
const SEND = 'Enviar'
const DELIVERED_COPY = 'Cambio entregado a la conversación del slice'
const SLICE_MESSAGE = /^\/slices\/(\d+)\/message$/

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

const backendWith = ({ activePlans, message, progress = () => ImplementProgressMother.inReview() }: {
  activePlans: () => Answer
  message?: (issue: number) => Answer
  progress?: (issue: number) => Answer
}) => {
  const posted = vi.fn()
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
    if (url.startsWith('/implement-history/')) return responseFor(ImplementProgressMother.notRead())
    const asMessage = SLICE_MESSAGE.exec(url)
    if (asMessage !== null && init?.method === 'POST') {
      const issue = Number(asMessage[1])
      posted(issue, JSON.parse(String(init.body)))
      return responseFor(message === undefined ? SliceSessionMother.delivered() : message(issue))
    }
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)

  return { posted, fetching }
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

  it('the panel of a slice still implementing offers no field, while the one whose pull request is open does', async () => {
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8),
      progress: (issue) => (issue === 7 ? ImplementProgressMother.progress() : ImplementProgressMother.inReview()),
    })
    openHome()

    const implementing = await panelOf(7)
    expect(await implementing.findByText(/Tarea 3 de 7/)).toBeInTheDocument()
    expect(implementing.queryByLabelText(MESSAGE_FIELD)).toBeNull()
    const inReview = await panelOf(8)
    expect(await inReview.findByLabelText(MESSAGE_FIELD)).toBeInTheDocument()
  })

  it('delivers a message to the conversation of the panel it was typed in and to no other', async () => {
    const { posted } = backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8) })
    const { user } = openHome()

    const panel = await panelOf(8)
    await user.type(await panel.findByLabelText(MESSAGE_FIELD), MESSAGE_TEXT)
    await user.click(panel.getByRole('button', { name: SEND }))

    expect(await panel.findByText(DELIVERED_COPY)).toBeInTheDocument()
    expect(posted).toHaveBeenCalledTimes(1)
    expect(posted).toHaveBeenCalledWith(8, {
      repo: StartPlanMother.REPO, agent: HeadlessPlanMother.agentFor(8), text: MESSAGE_TEXT,
    })
  })

  it('shows a refusal in the panel that asked and leaves the others untouched', async () => {
    backendWith({
      activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8),
      message: () => SliceSessionMother.refused(),
    })
    const { user } = openHome()

    const refused = await panelOf(7)
    await user.type(await refused.findByLabelText(MESSAGE_FIELD), MESSAGE_TEXT)
    await user.click(refused.getByRole('button', { name: SEND }))

    expect(await refused.findByRole('alert')).toHaveTextContent(SliceSessionMother.NOT_DELIVERED_DETAIL)
    const untouched = await panelOf(8)
    expect(untouched.queryByRole('alert')).toBeNull()
    expect(untouched.getByLabelText(MESSAGE_FIELD)).toHaveValue('')
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
    expect(screen.getAllByLabelText(MESSAGE_FIELD)).toHaveLength(2)
  })

  it('a saved workflow does not hide the other slices the backend reports', async () => {
    WorkflowSnapshotStorage.save(HeadlessPlanMother.workflowOfSlice(7))
    backendWith({ activePlans: () => HeadlessPlanMother.slicesInFlight(7, 8) })
    openHome()

    expect(await screen.findByRole('heading', { name: 'Slice #8', level: 2 })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Slice #7', level: 2 })).toHaveLength(1)
    expect(screen.getByText('Implementación iniciada automáticamente')).toBeInTheDocument()
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
