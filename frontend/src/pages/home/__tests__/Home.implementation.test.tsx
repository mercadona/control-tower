import { act, screen, within } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { MilestoneProgressMother } from '__scenarios__/MilestoneProgressMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { FakeEventSource } from './FakeEventSource'
import { FakeFitAddon, FakeTerminal } from './FakeXterm'
import { openHome } from './helpers'

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

type Answer = { status: number; body: string }
type Backend = {
  session?: () => Answer
  specFreeze?: () => Answer
  epicGroom?: () => Answer
  milestone?: () => Answer
}

const settle = async () => {
  for (let round = 0; round < 10; round += 1) await act(async () => vi.advanceTimersByTimeAsync(0))
}

class ImplementationBackend {
  static with({
    session = CoordinatingSessionMother.none,
    specFreeze = SpecFreezeMother.none,
    epicGroom = EpicGroomMother.none,
    milestone = MilestoneProgressMother.none,
  }: Backend = {}) {
    const fetching = vi.fn(async (input: string | URL | Request) => {
      const path = String(input)
      const respond = (answer: Answer) => new Response(answer.body, { status: answer.status })
      if (path === '/coordinating-session') return respond(session())
      if (path === '/external-tools') return respond(ExternalToolsMother.allReady())
      if (path === '/spec-freeze') return respond(specFreeze())
      if (path === '/epic-groom') return respond(epicGroom())
      if (path === '/milestone-progress') return respond(milestone())
      throw new Error(`nobody scripted ${path}`)
    })
    vi.stubGlobal('fetch', fetching)

    return fetching
  }
}

describe('Home is the start form with no session held, and the focused view for every held session', () => {
  beforeEach(() => {
    FakeTerminal.install()
    FakeFitAddon.install()
    FakeEventSource.install()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('with no session held the page shows only the start form', async () => {
    ImplementationBackend.with()

    openHome()

    expect(await screen.findByLabelText('Ticket')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Pasos de la sesión' })).not.toBeInTheDocument()
  })

  it('an ended session keeps the page in the focused view', async () => {
    ImplementationBackend.with({ session: CoordinatingSessionMother.ended })

    openHome()

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Brainstorming')
  })

  it('a running line shows its step, Tarea X de Y and a time in step that ticks', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T09:01:05.000Z'))
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.running(592)]),
    })

    openHome()
    await settle()

    expect(screen.getByText('Implementando · Tarea 2 de 4 · 01:05')).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTimeAsync(1000))

    expect(screen.getByText('Implementando · Tarea 2 de 4 · 01:06')).toBeInTheDocument()

    vi.useRealTimers()
  })

  it('lists pending, running and delivered issues under Issues del milestone', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T09:05:00.000Z'))
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([
        MilestoneProgressMother.pending(591),
        MilestoneProgressMother.running(592),
        MilestoneProgressMother.delivered(590),
      ]),
    })

    openHome()
    await settle()

    const board = screen.getByRole('region', { name: 'Issues del milestone' })
    expect(within(board).getByText('1 de 3 entregadas')).toBeInTheDocument()
    expect(within(board).getByText('Pendiente')).toBeInTheDocument()
    expect(within(board).getByText('Implementando · Tarea 2 de 4 · 05:00')).toBeInTheDocument()
    expect(within(board).getByText('Entregada')).toBeInTheDocument()
    expect(within(board).getByRole('link', { name: 'Pull request #1490' })).toHaveAttribute(
      'href', 'https://github.com/owner/name/pull/1490',
    )

    vi.useRealTimers()
  })

  it('the milestone is read again after 15 seconds while an issue is in review', async () => {
    vi.useFakeTimers()
    const fetching = ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.running(592, { step: 'in-review' })]),
    })
    const readsOfMilestone = () => fetching.mock.calls.filter(([input]) => String(input) === '/milestone-progress').length

    openHome()
    await settle()
    const afterFirstRead = readsOfMilestone()
    expect(afterFirstRead).toBeGreaterThan(0)

    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(readsOfMilestone()).toBe(afterFirstRead)

    await act(async () => vi.advanceTimersByTimeAsync(12000))
    expect(readsOfMilestone()).toBe(afterFirstRead + 1)

    vi.useRealTimers()
  })
})
