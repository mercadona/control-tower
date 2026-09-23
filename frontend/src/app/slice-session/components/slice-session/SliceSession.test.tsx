import { render, screen } from '@testing-library/react'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { PlanningProgressMother } from '__scenarios__/PlanningProgressMother'
import { SliceSessionMother } from '__scenarios__/SliceSessionMother'
import { SliceSession } from './SliceSession'
import type { SliceRecovery } from './SliceSession'

type Answer = { status: number; body: string }

const FIELD_LABEL = 'Pedir un cambio a esta conversación'
const SEND_LABEL = 'Enviar'

const stubFetch = (progress: Answer) => {
  const fetching = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/implement-progress/')) return new Response(progress.body, { status: progress.status })
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)

  return fetching
}

const stubPlanningFetch = (progress: Answer) => {
  const fetching = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/planning-progress/')) return new Response(progress.body, { status: progress.status })
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)

  return fetching
}

const renderSession = (issue = SliceSessionMother.ISSUE) => render(
  <SliceSession issue={issue} root={SliceSessionMother.ROOT} repo={SliceSessionMother.REPO} phase="implementing" />
)

const vetoed = (over: Partial<SliceRecovery> = {}): SliceRecovery => ({
  diagnostic: 'ct-step refused: the run is blocked-judge with outcome failed (exit 1)',
  action: 'inspect',
  pending: false,
  failure: null,
  onAct: () => {},
  onRetry: () => {},
  refusal: {
    state: 'blocked-judge',
    outcome: 'failed',
    exit: 1,
    task: 2,
    findings: '- [high] src/pago.ts:41: el importe se redondea antes del descuento',
    verdict: '.agent/run-7/task-2-verdict-3.json',
  },
  ...over,
})

const carriesNoField = () => {
  expect(screen.queryByLabelText(FIELD_LABEL)).toBeNull()
  expect(screen.queryByRole('button', { name: SEND_LABEL })).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
}

describe('SliceSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a slice that is implementing shows its progress and offers no message field', async () => {
    stubFetch(SliceSessionMother.progress())
    renderSession()

    expect(await screen.findByText(/Tarea 3 de 7/)).toBeInTheDocument()
    carriesNoField()
  })

  it('a slice whose pull request is open offers no message field either, because the boss carries the change', async () => {
    stubFetch(SliceSessionMother.inReview())
    renderSession()

    expect(await screen.findByText('En revisión')).toBeInTheDocument()
    carriesNoField()
  })

  it('a slice fixing what its review asked offers no message field', async () => {
    stubFetch(ImplementProgressMother.fixing())
    renderSession()

    expect(await screen.findByText('Corrigiendo lo pedido en la revisión')).toBeInTheDocument()
    carriesNoField()
  })

  it('a slice whose pull request is open still shows the link to it', async () => {
    stubFetch(SliceSessionMother.inReview())
    renderSession()

    expect(await screen.findByRole('link', { name: /#31/ })).toBeInTheDocument()
  })

  it('a slice that is planning shows planning activity instead of implementation progress', async () => {
    stubPlanningFetch(PlanningProgressMother.running())
    render(<SliceSession issue={SliceSessionMother.ISSUE} root={SliceSessionMother.ROOT} repo={SliceSessionMother.REPO} phase="planning" />)

    expect(await screen.findByText('El agente está trabajando')).toBeInTheDocument()
    carriesNoField()
  })

  it('a slice that is planning asks the backend for planning progress and for nothing else', async () => {
    const fetching = stubPlanningFetch(PlanningProgressMother.running())
    render(<SliceSession issue={SliceSessionMother.ISSUE} root={SliceSessionMother.ROOT} repo={SliceSessionMother.REPO} phase="planning" />)

    await screen.findByText('El agente está trabajando')

    expect(fetching.mock.calls.every(([input]) => String(input).startsWith('/planning-progress/'))).toBe(true)
  })

  it('the panel asks the backend for progress and for nothing else', async () => {
    const fetching = stubFetch(SliceSessionMother.inReview())
    renderSession()

    await screen.findByText('En revisión')

    expect(fetching.mock.calls.every(([input]) => String(input).startsWith('/implement-progress/'))).toBe(true)
  })

  it('a slice whose recovery can only be inspected offers the retry and no action', async () => {
    stubFetch(SliceSessionMother.progress())
    const onRetry = vi.fn()
    const onAct = vi.fn()
    render(
      <SliceSession
        issue={SliceSessionMother.ISSUE}
        root={SliceSessionMother.ROOT}
        repo={SliceSessionMother.REPO}
        phase="uncertain"
        recovery={{ diagnostic: 'el proceso ya no responde', action: 'inspect', pending: false, failure: null, onAct, onRetry }}
      />
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('el proceso ya no responde')
    expect(screen.getByRole('button', { name: 'Reintentar recuperación' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Recuperar trabajo' })).toBeNull()
    expect(onAct).not.toHaveBeenCalled()
  })

  it('a recovery that failed shows the reason in place of the diagnostic and keeps the button', async () => {
    stubFetch(SliceSessionMother.progress())
    const recovery: SliceRecovery = {
      diagnostic: 'el proceso ya no responde',
      action: 'continue',
      pending: true,
      failure: 'No se pudo contactar con el backend para ejecutar la recuperación.',
      onAct: vi.fn(),
      onRetry: vi.fn(),
    }
    render(
      <SliceSession issue={SliceSessionMother.ISSUE} root={SliceSessionMother.ROOT} repo={SliceSessionMother.REPO} phase="uncertain" recovery={recovery} />
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
    expect(screen.getByRole('button', { name: 'Recuperar trabajo' })).toBeDisabled()
  })

  it('two slices side by side each carry their own title', async () => {
    stubFetch(SliceSessionMother.progress())
    render(
      <>
        <SliceSession issue={7} root={SliceSessionMother.ROOT} repo={SliceSessionMother.REPO} phase="implementing" />
        <SliceSession issue={8} root={SliceSessionMother.ROOT} repo={SliceSessionMother.REPO} phase="implementing" />
      </>
    )

    expect(await screen.findByRole('region', { name: 'Slice #7' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Slice #8' })).toBeInTheDocument()
    carriesNoField()
  })

  it('a run the judge closed names the closure and shows what the judge found', async () => {
    stubFetch(SliceSessionMother.progress())
    render(
      <SliceSession
        issue={SliceSessionMother.ISSUE}
        root={SliceSessionMother.ROOT}
        repo={SliceSessionMother.REPO}
        phase="uncertain"
        recovery={vetoed()}
      />
    )

    expect(await screen.findByText('El juez cerró este slice')).toBeInTheDocument()
    expect(screen.getByText(/el importe se redondea antes del descuento/)).toBeInTheDocument()
    expect(screen.getByText('.agent/run-7/task-2-verdict-3.json')).toBeInTheDocument()
  })

  it('the card offers no way to decide, because the decision goes through the coordinating session', async () => {
    stubFetch(SliceSessionMother.progress())
    render(
      <SliceSession
        issue={SliceSessionMother.ISSUE}
        root={SliceSessionMother.ROOT}
        repo={SliceSessionMother.REPO}
        phase="uncertain"
        recovery={vetoed()}
      />
    )

    expect(await screen.findByRole('button', { name: 'Reintentar recuperación' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ronda/i })).toBeNull()
  })

  it('a veto with nothing major to show still names the closure', async () => {
    stubFetch(SliceSessionMother.progress())
    render(
      <SliceSession
        issue={SliceSessionMother.ISSUE}
        root={SliceSessionMother.ROOT}
        repo={SliceSessionMother.REPO}
        phase="uncertain"
        recovery={vetoed({ refusal: { state: 'blocked-judge', outcome: 'failed', exit: 1, task: 2, findings: null, verdict: null } })}
      />
    )

    expect(await screen.findByText('El juez cerró este slice')).toBeInTheDocument()
    expect(screen.queryByText(/^\.agent\//)).toBeNull()
  })

  it('a run that spent its discards is not a veto, because no reopen gets it out', async () => {
    stubFetch(SliceSessionMother.progress())
    render(
      <SliceSession
        issue={SliceSessionMother.ISSUE}
        root={SliceSessionMother.ROOT}
        repo={SliceSessionMother.REPO}
        phase="uncertain"
        recovery={vetoed({
          refusal: {
            state: 'blocked-judge', outcome: 'discarded', exit: 3, task: 2, findings: null, verdict: null,
          },
        })}
      />
    )

    expect(await screen.findByText('No se puede confirmar el estado de implementación')).toBeInTheDocument()
    expect(screen.queryByText('El juez cerró este slice')).toBeNull()
  })

  it('an uncertain slice with no closure is the card it always was', async () => {
    stubFetch(SliceSessionMother.progress())
    render(
      <SliceSession
        issue={SliceSessionMother.ISSUE}
        root={SliceSessionMother.ROOT}
        repo={SliceSessionMother.REPO}
        phase="uncertain"
        recovery={vetoed({ refusal: null })}
      />
    )

    expect(await screen.findByText('No se puede confirmar el estado de implementación')).toBeInTheDocument()
    expect(screen.queryByText('El juez cerró este slice')).toBeNull()
  })
})
