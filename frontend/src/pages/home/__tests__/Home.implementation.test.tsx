import { act, screen, waitFor, within } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'
import { MilestoneProgressMother } from '__scenarios__/MilestoneProgressMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
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
  activePlans?: () => Answer
  recoverPlan?: () => Answer
  cleanupPlan?: () => Answer
  reopen?: () => Answer
  close?: () => Answer
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
    activePlans = HeadlessPlanMother.empty,
    recoverPlan,
    cleanupPlan,
    reopen,
    close,
  }: Backend = {}) {
    const fetching = vi.fn(async (input: string | URL | Request) => {
      const path = String(input)
      const respond = (answer: Answer) => new Response(answer.body, { status: answer.status })
      if (path === '/coordinating-session') return respond(session())
      if (path === '/coordinating-session/reopen' && reopen !== undefined) return respond(reopen())
      if (path === '/coordinating-session/close' && close !== undefined) return respond(close())
      if (path === '/external-tools') return respond(ExternalToolsMother.allReady())
      if (path === '/spec-freeze') return respond(specFreeze())
      if (path === '/epic-groom') return respond(epicGroom())
      if (path === '/milestone-progress') return respond(milestone())
      if (path === '/active-plans') return respond(activePlans())
      if (path === '/recover-plan' && recoverPlan !== undefined) return respond(recoverPlan())
      if (path === '/cleanup-plan' && cleanupPlan !== undefined) return respond(cleanupPlan())
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

  it('a running line expands into its tasks, the judge finding, the last tool and the last message', async () => {
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([
        MilestoneProgressMother.running(592, {
          tasks: [
            { number: 1, name: 'Read the wire shape', status: 'done', ruling: null, findings: null },
            { number: 2, name: 'Write the client', status: 'running', ruling: null, findings: null },
            { number: 3, name: 'Write the tests', status: 'pending', ruling: null, findings: null },
            { number: 4, name: 'Wire the route', status: 'stopped', ruling: null, findings: 'the boundary case failed' },
          ],
        }),
      ]),
    })

    const { user } = openHome()
    await user.click(await screen.findByRole('button', { name: 'Ver tareas' }))

    expect(screen.getByText('Hecha')).toBeInTheDocument()
    expect(screen.getByText('Lo que encontró el juez: the boundary case failed')).toBeInTheDocument()
    expect(screen.getByText(/Última herramienta: Edit · src\/a\.ts/)).toBeInTheDocument()
    expect(screen.getByText(/Último mensaje: «ready»/)).toBeInTheDocument()
  })

  it('a line starts closed and closes again', async () => {
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.running(592)]),
    })

    const { user } = openHome()

    const toggle = await screen.findByRole('button', { name: 'Ver tareas' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Ocultar tareas' })).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('button', { name: 'Ocultar tareas' }))
    expect(screen.getByRole('button', { name: 'Ver tareas' })).toHaveAttribute('aria-expanded', 'false')
  })

  it.each([
    ['veto', MilestoneProgressMother.vetoed(592), 'El juez cerró este slice', 'Hablar con la sesión'],
    ['partial', MilestoneProgressMother.partial(592), 'Implementación terminada; publicación sin confirmar', 'Hablar con la sesión'],
    ['unreadable', MilestoneProgressMother.unreadable(592), 'No se puede leer el trabajo de este slice', 'Hablar con la sesión'],
    ['uncertain', MilestoneProgressMother.uncertain(592, 'observe'), 'No se puede confirmar el estado', 'Recuperar trabajo'],
  ])('a slice that needs the person shows what happened and exactly one action: %s', async (_kind, line, title, action) => {
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([line]),
    })

    openHome()

    expect(await screen.findByText(title)).toBeInTheDocument()
    const board = screen.getByRole('region', { name: 'Issues del milestone' })
    expect(within(board).getByRole('button', { name: action })).toBeInTheDocument()
    expect(within(board).getAllByRole('button')).toHaveLength(1)
  })

  it('the red-baseline notice shows only when some baseline was red', async () => {
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.running(592, { baseline_red: true })]),
    })
    const { unmount } = openHome()

    expect(await screen.findByText('El repositorio ya estaba en rojo antes de empezar.')).toBeInTheDocument()

    unmount()

    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.running(592)]),
    })
    openHome()

    expect(await screen.findByRole('region', { name: 'Issues del milestone' })).toBeInTheDocument()
    expect(screen.queryByText('El repositorio ya estaba en rojo antes de empezar.')).not.toBeInTheDocument()
  })

  it('the recovery button recovers the plan with its agent', async () => {
    const fetching = ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.uncertain(592, 'continue')]),
      activePlans: () => HeadlessPlanMother.uncertainAmong(592, 'continue'),
      recoverPlan: () => ({ status: 202, body: JSON.stringify({ agent: HeadlessPlanMother.agentFor(592) }) }),
    })

    const { user } = openHome()
    await user.click(await screen.findByRole('button', { name: 'Recuperar trabajo' }))

    await waitFor(() => expect(fetching).toHaveBeenCalledWith('/recover-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: StartPlanMother.REPO, issue: 592, agent: HeadlessPlanMother.agentFor(592) }),
    }))
  })

  it('Hablar con la sesión opens the terminal in a panel over the list', async () => {
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.running(592)]),
    })

    const { user } = openHome()
    await user.click(await screen.findByRole('button', { name: 'Hablar con la sesión' }))

    const dialog = screen.getByRole('dialog', { name: 'Sesión coordinadora' })
    expect(within(dialog).getByRole('region', { name: CoordinatingSessionMother.SESSION.name })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Issues del milestone' })).toBeInTheDocument()
  })

  it('Volver a la lista closes the panel', async () => {
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.running(592)]),
    })

    const { user } = openHome()
    await user.click(await screen.findByRole('button', { name: 'Hablar con la sesión' }))
    await user.click(screen.getByRole('button', { name: 'Volver a la lista' }))

    expect(screen.queryByRole('dialog', { name: 'Sesión coordinadora' })).not.toBeInTheDocument()
  })

  it.each([
    ['brainstorming', SpecFreezeMother.none, EpicGroomMother.none, 'Reábrela para seguir; conserva lo que ya se habló.'],
    ['spec-freeze', SpecFreezeMother.draftReady, EpicGroomMother.draft, 'Reábrela para seguir; conserva lo que ya se habló.'],
    ['groom', SpecFreezeMother.frozen, EpicGroomMother.groomable, 'Reábrela para seguir; conserva lo que ya se habló.'],
    [
      'implementation',
      SpecFreezeMother.frozen,
      EpicGroomMother.authorised,
      'Los slices siguen en marcha. Reábrela para volver a hablar con ellos; conserva lo que ya se habló.',
    ],
  ])('an ended session shows Reabrir la sesión with the copy of its step: %s', async (_step, specFreeze, epicGroom, description) => {
    ImplementationBackend.with({
      session: CoordinatingSessionMother.ended,
      specFreeze,
      epicGroom,
    })

    openHome()

    expect(await screen.findByText(description)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reabrir la sesión' })).toBeInTheDocument()
  })

  it('Reabrir la sesión posts the held target', async () => {
    const fetching = ImplementationBackend.with({
      session: CoordinatingSessionMother.ended,
      specFreeze: SpecFreezeMother.none,
      epicGroom: EpicGroomMother.none,
      reopen: () => CoordinatingSessionMother.opened(),
    })

    const { user } = openHome()
    await user.click(await screen.findByRole('button', { name: 'Reabrir la sesión' }))

    await waitFor(() => expect(fetching).toHaveBeenCalledWith('/coordinating-session/reopen', {
      method: 'POST',
      headers: { 'x-coordinating-target': CoordinatingSessionMother.TARGET },
    }))
  })

  it('every issue delivered shows Milestone completado and Cerrar la sesión y volver al inicio', async () => {
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([
        MilestoneProgressMother.delivered(590),
        MilestoneProgressMother.delivered(591),
      ]),
    })

    openHome()

    expect(await screen.findByRole('heading', { name: 'Milestone completado' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar la sesión y volver al inicio' })).toBeInTheDocument()
  })

  it('one issue not delivered keeps the list', async () => {
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([
        MilestoneProgressMother.delivered(590),
        MilestoneProgressMother.running(591),
      ]),
    })

    openHome()
    await screen.findByRole('region', { name: 'Issues del milestone' })

    expect(screen.queryByRole('heading', { name: 'Milestone completado' })).not.toBeInTheDocument()
  })

  it('Cerrar la sesión y volver al inicio gives the start form back', async () => {
    let closed = false
    ImplementationBackend.with({
      session: () => (closed ? CoordinatingSessionMother.none() : CoordinatingSessionMother.working()),
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.delivered(592)]),
      close: () => {
        closed = true
        return {
          status: 200,
          body: JSON.stringify({
            status: 'closed', conversation: CoordinatingSessionMother.CONVERSATION, target: CoordinatingSessionMother.TARGET,
          }),
        }
      },
    })

    const { user } = openHome()
    await user.click(await screen.findByRole('button', { name: 'Cerrar la sesión y volver al inicio' }))

    expect(await screen.findByLabelText('Ticket')).toBeInTheDocument()
  })
})
