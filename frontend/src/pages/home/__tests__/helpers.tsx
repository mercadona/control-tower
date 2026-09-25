import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { Home } from 'pages/home/Home'
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

const openHome = () => {
  const user = userEvent.setup()
  FakeEventSource.install()
  const { unmount } = render(<StrictMode><Home /></StrictMode>)

  return { user, unmount }
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

const typePath = async (user: User, path: string) => {
  await user.type(await editable(/Ruta local/), path)
}

const pressStart = async (user: User) => {
  await user.click(screen.getByRole('button', { name: 'Arrancar brainstorming' }))
}

const openBrainstorming = async (user: User) => {
  await typeTicket(user, StartPlanMother.TICKET)
  await typePath(user, StartPlanMother.PATH)
  await pressStart(user)
}

export {
  UnscriptedWork,
  backendAnswering,
  backendPending,
  openHome,
  typeTicket,
  typePath,
  pressStart,
  openBrainstorming,
}
