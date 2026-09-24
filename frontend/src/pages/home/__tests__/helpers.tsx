import { StrictMode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { WorkProgressMother } from '__scenarios__/WorkProgressMother'
import { ActivePlan } from 'app/active-plans/ActivePlan.types'
import { Home } from 'pages/home/Home'
import { StartedPlan, StartPlanRequest } from 'app/start-plan/StartPlan.types'
import { WorkflowSnapshot, WorkflowSnapshotStorage } from 'app/workflow-snapshot/storage'
import { FakeEventSource } from './FakeEventSource'

type Answer = { status: number; body: string }
type User = ReturnType<typeof userEvent.setup>

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const NO_ACTIVE_PLANS = { status: 200, body: '{"plans":[]}' }
const NO_SESSIONS = SessionsMother.noSessions()
const EXTERNAL_TOOLS_READY = ExternalToolsMother.allReady()
const NO_COORDINATING_SESSION = CoordinatingSessionMother.none()
const NO_SPEC_FREEZE = SpecFreezeMother.none()
const NO_EPIC_GROOM = EpicGroomMother.none()
const NO_IMPLEMENTATION_HISTORY_YET = {
  status: 400,
  body: '{"code":"implementation-history-not-read","detail":"the worktree is not there yet"}',
}

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status, headers: JSON_HEADERS })

const isImplementHistoryPath = (input: string | URL | Request) => String(input).startsWith('/implement-history/')
const isCoordinatingSessionRead = (input: string | URL | Request, init?: RequestInit) =>
  input === '/coordinating-session' && init === undefined

const backendAnswering = (answer: Answer) => {
  const fetching = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => responseFor(answer))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (input === '/active-plans') return responseFor(NO_ACTIVE_PLANS)
      if (input === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
      if (input === '/sessions') return responseFor(NO_SESSIONS)
      if (isCoordinatingSessionRead(input, init)) return responseFor(NO_COORDINATING_SESSION)
      if (isImplementHistoryPath(input)) return responseFor(NO_IMPLEMENTATION_HISTORY_YET)
      if (input === '/spec-freeze') return responseFor(NO_SPEC_FREEZE)
      if (input === '/epic-groom') return responseFor(NO_EPIC_GROOM)
      return fetching(input, init)
    }),
  )

  return fetching
}

class UnscriptedWork {
  static readonly asked: string[] = []

  static answer(input: string): Answer {
    UnscriptedWork.asked.push(input)
    throw new Error(`nobody scripted what became of ${input}`)
  }
}

beforeEach(() => {
  UnscriptedWork.asked.splice(0)
})

afterEach(() => {
  expect(UnscriptedWork.asked.splice(0)).toEqual([])
})

const backendRecovering = (
  answer: Answer,
  progress: (active: ActivePlan) => Answer = WorkProgressMother.fromActive,
  concluded: (input: string) => Answer = UnscriptedWork.answer,
) => {
  const fetching = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => responseFor(answer))
  const progressRequests = vi.fn((active: ActivePlan, _init?: RequestInit) => responseFor(progress(active)))
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    if (input === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
    if (input === '/sessions') return responseFor(NO_SESSIONS)
    if (isCoordinatingSessionRead(input, init)) return responseFor(NO_COORDINATING_SESSION)
    if (isImplementHistoryPath(input)) return responseFor(NO_IMPLEMENTATION_HISTORY_YET)
    if (input === '/spec-freeze') return responseFor(NO_SPEC_FREEZE)
    if (input === '/epic-groom') return responseFor(NO_EPIC_GROOM)
    if (String(input).startsWith('/work-progress/')) {
      const url = new URL(String(input), 'http://localhost')
      const issue = Number(url.pathname.split('/')[2])
      const plans: ActivePlan[] = JSON.parse(answer.body).plans ?? []
      const active = plans.find((plan) => plan.plan.issue.number === issue && plan.plan.repo === url.searchParams.get('repo'))
      if (active === undefined) return responseFor(concluded(String(input)))
      return progressRequests(active, init)
    }
    return init === undefined ? fetching(input) : fetching(input, init)
  })

  return Object.assign(fetching, { progressRequests })
}

const backendPending = () => {
  let answerWith: (answer: Answer) => void = () => undefined
  const pending = new Promise<Response>((resolve) => {
    answerWith = (answer) => resolve(responseFor(answer))
  })
  const fetching = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (input === '/active-plans') return responseFor(NO_ACTIVE_PLANS)
      if (input === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
      if (input === '/sessions') return responseFor(NO_SESSIONS)
      if (isCoordinatingSessionRead(input, init)) return responseFor(NO_COORDINATING_SESSION)
      if (isImplementHistoryPath(input)) return responseFor(NO_IMPLEMENTATION_HISTORY_YET)
      if (input === '/spec-freeze') return responseFor(NO_SPEC_FREEZE)
      if (input === '/epic-groom') return responseFor(NO_EPIC_GROOM)
      return pending
    })
  vi.stubGlobal('fetch', fetching)

  return {
    answerWith: async (answer: Answer) => act(async () => answerWith(answer)),
    fetching,
  }
}

const backendUnreachable = () => {
  const fetching = vi.fn(async () => {
    throw new TypeError('Failed to fetch')
  })
  vi.stubGlobal(
    'fetch',
    fetching,
  )

  return fetching
}

const openHome = () => {
  const user = userEvent.setup()
  FakeEventSource.install()
  const { unmount } = render(<StrictMode><Home /></StrictMode>)

  return { user, unmount }
}

const selectSliceDetail = async (user: User, issue: number) => {
  const slice = await screen.findByRole('region', { name: `Slice #${issue}` })
  await user.click(within(slice).getByRole('button', { name: 'Ver detalle' }))
}

const editable = async (label: string | RegExp) => {
  let field!: HTMLElement
  await waitFor(() => {
    field = screen.getByLabelText(label)
    expect(field).toBeEnabled()
  })
  return field
}

const typeTicket = async (user: User, ticket: string) => {
  await user.type(await editable('Ticket'), ticket)
}

const typeRepository = async (user: User, repository: string) => {
  await user.type(await editable(/Repositorio/), repository)
}

const typePath = async (user: User, path: string) => {
  await user.type(await editable(/Ruta local/), path)
}

const pressStart = async (user: User) => {
  await user.click(screen.getByRole('button', { name: 'Arrancar brainstorming' }))
}

const openBrainstorming = async (user: User) => {
  await typeTicket(user, StartPlanMother.TICKET)
  await typeRepository(user, StartPlanMother.REPO)
  await typePath(user, StartPlanMother.PATH)
  await pressStart(user)
}

const DEFAULT_RESTORED_REQUEST: StartPlanRequest = {
  id: StartPlanMother.TICKET,
  repo: StartPlanMother.REPO,
  path: StartPlanMother.PATH,
}

const DEFAULT_RESTORED_PLAN: StartedPlan = {
  id: StartPlanMother.TICKET,
  repo: StartPlanMother.REPO,
  issue: StartPlanMother.ISSUE,
  agent: StartPlanMother.AGENT,
  branch: StartPlanMother.BRANCH,
  worktree: StartPlanMother.WORKTREE,
}

type RestoredWorkflow = {
  phase: WorkflowSnapshot['phase'] | 'ready'
  request?: StartPlanRequest
  plan?: Partial<StartedPlan>
}

const activePlanFor = (workflow: WorkflowSnapshot): ActivePlan => ({
  phase: workflow.phase === 'implementing' ? 'implementing' : 'planning',
  request: workflow.request,
  plan: workflow.plan,
})

const openRestored = ({ phase, request = DEFAULT_RESTORED_REQUEST, plan = {} }: RestoredWorkflow) => {
  const workflow: WorkflowSnapshot = { phase: phase === 'ready' ? 'planning' : phase, request, plan: { ...DEFAULT_RESTORED_PLAN, ...plan } }
  WorkflowSnapshotStorage.save(workflow)
  const fetching = backendRecovering({ status: 200, body: JSON.stringify({ plans: [activePlanFor(workflow)] }) })
  const opened = openHome()

  return { ...opened, fetching, workflow }
}

export {
  UnscriptedWork,
  backendAnswering,
  backendRecovering,
  backendPending,
  backendUnreachable,
  openHome,
  selectSliceDetail,
  typeTicket,
  typeRepository,
  typePath,
  pressStart,
  openBrainstorming,
  openRestored,
}
