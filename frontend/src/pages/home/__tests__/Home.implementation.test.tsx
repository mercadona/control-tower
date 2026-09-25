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
  milestone?: () => Answer | Promise<Answer>
  activePlans?: () => Answer
  recoverPlan?: () => Answer
  cleanupPlan?: () => Answer
  reopen?: () => Answer
  close?: () => Answer
  promote?: () => Answer
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
    promote,
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
      if (path === '/epic-promotion' && promote !== undefined) return respond(promote())
      if (path === '/milestone-progress') return respond(await milestone())
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
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

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

  it('an initial connection failure explains the unknown session state and recovers automatically', async () => {
    vi.useFakeTimers()
    let reachable = false
    ImplementationBackend.with({
      session: () => {
        if (!reachable) throw new TypeError('network unavailable')
        return CoordinatingSessionMother.none()
      },
    })
    openHome()
    await settle()

    expect(screen.getByText('Sin conexión con el backend')).toBeInTheDocument()
    expect(screen.getByText('No se ha podido confirmar si hay una sesión en marcha. Espera a que se restablezca la conexión.')).toBeInTheDocument()
    expect(screen.queryByText('Ya hay una conversación coordinadora en marcha. Termínala antes de abrir otra.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Ticket')).toBeDisabled()

    reachable = true
    await act(async () => vi.advanceTimersByTimeAsync(2000))

    expect(screen.getByLabelText('Ticket')).toBeEnabled()
    expect(screen.queryByText('Sin conexión con el backend')).not.toBeInTheDocument()
  })

  it('authorisation advances an ended session to implementation', async () => {
    vi.useFakeTimers()
    let authorised = false
    ImplementationBackend.with({
      session: CoordinatingSessionMother.ended,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: () => authorised ? EpicGroomMother.authorised() : EpicGroomMother.groomed(),
      promote: () => {
        authorised = true
        return EpicGroomMother.promoted()
      },
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.pending(592)]),
    })
    openHome()
    await settle()

    await act(async () => screen.getByRole('button', { name: 'Autorizar el trabajo' }).click())
    await act(async () => vi.advanceTimersByTimeAsync(10000))
    await settle()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Implementación')
    expect(screen.getByRole('region', { name: 'Issues del milestone' })).toBeInTheDocument()
  })

  it.each([false, true])('a milestone-only failure is visible and clears after recovery, with a previous read: %s', async (previousRead) => {
    vi.useFakeTimers()
    let reachable = previousRead
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => reachable
        ? MilestoneProgressMother.answer([MilestoneProgressMother.pending(592)])
        : { status: 400, body: '{"code":"milestone-progress-not-read","detail":"GitHub could not be read"}' },
    })
    openHome()
    await settle()
    reachable = false
    await act(async () => vi.advanceTimersByTimeAsync(3000))

    expect(screen.getByText('No se ha podido actualizar el milestone')).toBeInTheDocument()
    expect(screen.queryByText('Sin conexión con el backend')).not.toBeInTheDocument()
    if (previousRead) expect(screen.getByText('Slice #592')).toBeInTheDocument()

    reachable = true
    await act(async () => vi.advanceTimersByTimeAsync(3000))

    expect(screen.queryByText('No se ha podido actualizar el milestone')).not.toBeInTheDocument()
    expect(screen.getByText('Slice #592')).toBeInTheDocument()
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

  it('an outage retains the last milestone under one connection notice and resumes updating', async () => {
    vi.useFakeTimers()
    let reachable = true
    let delivered = false
    ImplementationBackend.with({
      session: () => {
        if (!reachable) throw new TypeError('network unavailable')
        return CoordinatingSessionMother.working()
      },
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => {
        if (!reachable) throw new TypeError('network unavailable')
        return MilestoneProgressMother.answer([
          delivered ? MilestoneProgressMother.delivered(592) : MilestoneProgressMother.running(592),
        ])
      },
    })
    openHome()
    await settle()
    expect(screen.getByText('0 de 1 entregadas')).toBeInTheDocument()

    reachable = false
    await act(async () => vi.advanceTimersByTimeAsync(6000))

    expect(screen.getByText('0 de 1 entregadas')).toBeInTheDocument()
    expect(screen.getAllByText('Sin conexión con el backend')).toHaveLength(1)
    expect(screen.queryByText('No se ha podido actualizar el milestone')).not.toBeInTheDocument()

    reachable = true
    delivered = true
    await act(async () => vi.advanceTimersByTimeAsync(6000))

    expect(screen.getByRole('heading', { name: 'Milestone completado' })).toBeInTheDocument()
    expect(screen.queryByText('Sin conexión con el backend')).not.toBeInTheDocument()
  })

  it('a replacement session cannot display the previous target milestone even if that read arrives again', async () => {
    vi.useFakeTimers()
    let target = CoordinatingSessionMother.TARGET
    const forTarget = (answer: Answer): Answer => ({
      ...answer,
      body: JSON.stringify({ ...JSON.parse(answer.body), target }),
    })
    ImplementationBackend.with({
      session: () => forTarget(CoordinatingSessionMother.working()),
      specFreeze: () => forTarget(SpecFreezeMother.frozen()),
      epicGroom: () => forTarget(EpicGroomMother.authorised()),
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.running(592)]),
    })
    openHome()
    await settle()
    expect(screen.getByText('0 de 1 entregadas')).toBeInTheDocument()

    target = '78373982-8dcb-4ccc-9840-c8935d98058d'
    await act(async () => vi.advanceTimersByTimeAsync(6000))
    await settle()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Implementación')
    expect(screen.queryByText('0 de 1 entregadas')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Issues del milestone' })).not.toBeInTheDocument()
  })

  it('a delayed old milestone cannot overwrite a replacement session reading', async () => {
    vi.useFakeTimers()
    let target = CoordinatingSessionMother.TARGET
    let delayOldRead = false
    let releaseOldRead!: (answer: Answer) => void
    let releaseNewRead!: (answer: Answer) => void
    const oldRead = new Promise<Answer>((resolve) => { releaseOldRead = resolve })
    const newRead = new Promise<Answer>((resolve) => { releaseNewRead = resolve })
    const forTarget = (answer: Answer): Answer => ({
      ...answer,
      body: JSON.stringify({ ...JSON.parse(answer.body), target }),
    })
    ImplementationBackend.with({
      session: () => forTarget(CoordinatingSessionMother.working()),
      specFreeze: () => forTarget(SpecFreezeMother.frozen()),
      epicGroom: () => forTarget(EpicGroomMother.authorised()),
      milestone: () => {
        if (target !== CoordinatingSessionMother.TARGET) return newRead
        return delayOldRead ? oldRead : MilestoneProgressMother.answer([MilestoneProgressMother.running(592)])
      },
    })
    openHome()
    await settle()
    expect(screen.getByText('Slice #592')).toBeInTheDocument()

    delayOldRead = true
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    target = '78373982-8dcb-4ccc-9840-c8935d98058d'
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    await settle()
    expect(screen.queryByText('Slice #592')).not.toBeInTheDocument()

    await act(async () => releaseNewRead(forTarget(MilestoneProgressMother.answer([MilestoneProgressMother.running(700)]))))
    expect(screen.getByText('Slice #700')).toBeInTheDocument()

    await act(async () => releaseOldRead(MilestoneProgressMother.answer([MilestoneProgressMother.running(592)])))

    expect(screen.getByText('Slice #700')).toBeInTheDocument()
    expect(screen.queryByText('Slice #592')).not.toBeInTheDocument()
  })

  it('a running line expands into its tasks, the judge ruling, the last tool and the last message', async () => {
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([
        MilestoneProgressMother.running(592, {
          tasks: [
            { number: 1, name: 'Read the wire shape', status: 'done', ruling: 'passed', findings: null },
            { number: 2, name: 'Write the client', status: 'running', ruling: null, findings: null },
            { number: 3, name: 'Write the tests', status: 'pending', ruling: null, findings: null },
            { number: 4, name: 'Wire the route', status: 'pending', ruling: null, findings: null },
          ],
        }),
      ]),
    })

    const { user } = openHome()
    await user.click(await screen.findByRole('button', { name: 'Ver tareas' }))

    expect(screen.getByText('Hecha')).toBeInTheDocument()
    expect(screen.getByText('Dictamen del juez: passed')).toBeInTheDocument()
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
    const actions = within(board).getAllByRole('button').filter((button) => !button.hasAttribute('aria-expanded'))
    expect(actions).toHaveLength(1)
  })

  it.each(['in-review', 'fixing'])('a running issue links its pull request while %s', async (step) => {
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([
        MilestoneProgressMother.running(592, {
          step,
          pull_request: { number: 611, url: 'https://github.com/owner/name/pull/611' },
        }),
      ]),
    })

    openHome()

    expect(await screen.findByRole('link', { name: 'Pull request #611' })).toHaveAttribute(
      'href', 'https://github.com/owner/name/pull/611',
    )
  })

  it('a task with an unknown total never prints null', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T09:01:05.000Z'))
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.running(592, { total_tasks: null })]),
    })

    openHome()
    await settle()

    expect(screen.getByText('Implementando · Tarea 2 · 01:05')).toBeInTheDocument()
    vi.useRealTimers()
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

  it('an unavailable recovery read does not claim the work has disappeared', async () => {
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.uncertain(592, 'continue')]),
      activePlans: () => { throw new TypeError('network unavailable') },
    })

    const { user } = openHome()
    await user.click(await screen.findByRole('button', { name: 'Recuperar trabajo' }))

    expect(await screen.findByText('No se ha podido consultar el trabajo. Reintenta cuando vuelva la conexión.')).toBeInTheDocument()
    expect(screen.queryByText('El backend ya no informa de este trabajo.')).not.toBeInTheDocument()
  })

  it('inspection refreshes the milestone without sending a recovery mutation', async () => {
    let inspected = false
    const fetching = ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([
        inspected ? MilestoneProgressMother.running(592) : MilestoneProgressMother.uncertain(592, 'inspect'),
      ]),
      activePlans: () => HeadlessPlanMother.uncertainAmong(592, 'inspect'),
      recoverPlan: () => ({ status: 202, body: JSON.stringify({ agent: HeadlessPlanMother.agentFor(592) }) }),
    })
    const { user } = openHome()
    const inspect = await screen.findByRole('button', { name: 'Reintentar recuperación' })
    inspected = true

    await user.click(inspect)

    expect(await screen.findByRole('button', { name: 'Ver tareas' })).toBeInTheDocument()
    expect(fetching.mock.calls.some(([path]) => String(path) === '/recover-plan')).toBe(false)
  })

  it.each(['continue', 'inspect'] as const)('a stale cleanup action never mutates a plan now requiring %s', async (action) => {
    const fetching = ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.uncertain(592, 'cleanup')]),
      activePlans: () => HeadlessPlanMother.uncertainAmong(592, action),
      cleanupPlan: () => ({ status: 200, body: JSON.stringify({ agent: HeadlessPlanMother.agentFor(592) }) }),
    })
    const { user } = openHome()

    await user.click(await screen.findByRole('button', { name: 'Limpiar arranque fallido' }))

    expect(await screen.findByText('El estado del trabajo ha cambiado. Revisa la acción actual antes de continuar.')).toBeInTheDocument()
    expect(fetching.mock.calls.some(([path]) => ['/recover-plan', '/cleanup-plan'].includes(String(path)))).toBe(false)
  })

  it.each(['continue', 'cleanup'] as const)('a lost %s response explains the uncertainty', async (action) => {
    ImplementationBackend.with({
      session: CoordinatingSessionMother.working,
      specFreeze: SpecFreezeMother.frozen,
      epicGroom: EpicGroomMother.authorised,
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.uncertain(592, action)]),
      activePlans: () => HeadlessPlanMother.uncertainAmong(592, action),
      recoverPlan: () => { throw new TypeError('network unavailable') },
      cleanupPlan: () => { throw new TypeError('network unavailable') },
    })
    const { user } = openHome()

    await user.click(await screen.findByRole('button', { name: action === 'cleanup' ? 'Limpiar arranque fallido' : 'Recuperar trabajo' }))

    expect(await screen.findByText('No se ha podido confirmar la operación. Estamos consultando su estado; compruébalo antes de reintentar.')).toBeInTheDocument()
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
      milestone: () => MilestoneProgressMother.answer([MilestoneProgressMother.running(592)]),
    })

    openHome()

    expect(await screen.findByText(description)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reabrir la sesión' })).toBeInTheDocument()
    if (_step === 'implementation') expect(await screen.findByRole('region', { name: 'Issues del milestone' })).toBeInTheDocument()
  })

  it('an unreachable reopen explains that the session could not be confirmed', async () => {
    ImplementationBackend.with({
      session: CoordinatingSessionMother.ended,
      reopen: () => { throw new TypeError('network unavailable') },
    })

    const { user } = openHome()
    await user.click(await screen.findByRole('button', { name: 'Reabrir la sesión' }))

    expect(await screen.findByText('No se ha podido confirmar la reapertura. Comprueba la conexión antes de reintentar.')).toBeInTheDocument()
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
    expect(screen.getByText('Las 2 issues están entregadas y mergeadas')).toBeInTheDocument()
    expect(screen.getByText(`${CoordinatingSessionMother.STORY} está terminado.`)).toBeInTheDocument()
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
