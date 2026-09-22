import { render, screen } from '@testing-library/react'
import { PlanningProgressMother } from '__scenarios__/PlanningProgressMother'
import { PlanningProgress } from './PlanningProgress'

const answerWith = (answer: { status: number; body: string }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))
}

const renderProgress = () => render(<PlanningProgress issue={PlanningProgressMother.ISSUE} repo={PlanningProgressMother.REPO} />)

describe('PlanningProgress', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should show the running time, the tool calls, the last tool and the last text of a run in progress', async () => {
    answerWith(PlanningProgressMother.running())

    renderProgress()

    expect(await screen.findByText('06:12 · 41 llamadas a herramientas')).toBeInTheDocument()
    expect(screen.getByText('Última herramienta: Read — plugin/conventions/testing.md')).toBeInTheDocument()
    expect(screen.getByText('Último mensaje: «Ahora escribo el plan»')).toBeInTheDocument()
  })

  it('should say the agent is working while running, not the waiting message it starts from', async () => {
    answerWith(PlanningProgressMother.running())

    renderProgress()

    expect(await screen.findByText('El agente está trabajando')).toHaveAttribute('role', 'status')
    expect(screen.queryByText('Comprobando lo que hace el agente…')).toBeNull()
  })

  it('should show minutes past sixty instead of wrapping the clock back to zero', async () => {
    answerWith({
      status: 200,
      body: '{"state":"running","running_ms":4500000,"tool_calls":1,"last_tool":null,"last_text":null}',
    })

    renderProgress()

    expect(await screen.findByText('75:00 · 1 llamadas a herramientas')).toBeInTheDocument()
  })

  it('should show the last tool without a dash when it has no argument', async () => {
    answerWith({
      status: 200,
      body: '{"state":"running","running_ms":1000,"tool_calls":1,"last_tool":{"name":"Bash","argument":null},"last_text":null}',
    })

    renderProgress()

    const lastTool = await screen.findByText('Última herramienta: Bash')
    expect(lastTool).not.toHaveTextContent('—')
  })

  it('should show no last tool and no last text before either has been seen', async () => {
    answerWith(PlanningProgressMother.runningBeforeTheFirstToolCall())

    renderProgress()

    await screen.findByText('00:01 · 0 llamadas a herramientas')
    expect(screen.queryByText(/^Última herramienta:/)).toBeNull()
    expect(screen.queryByText(/^Último mensaje:/)).toBeNull()
  })

  it('should say the agent has finished once the state is finished', async () => {
    answerWith(PlanningProgressMother.finished())

    renderProgress()

    expect(await screen.findByText('El agente ha terminado')).toHaveAttribute('role', 'status')
    expect(screen.getByText('10:14 · 57 llamadas a herramientas')).toBeInTheDocument()
  })

  it('should show a connecting state before the first answer arrives', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

    renderProgress()

    expect(screen.getByText('Comprobando lo que hace el agente…')).toHaveAttribute('role', 'status')
  })

  it('should show the waiting message, not an error, while the conversation has no recorded planning call yet', async () => {
    answerWith(PlanningProgressMother.notRead())

    renderProgress()

    expect(await screen.findByText('Comprobando lo que hace el agente…')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('should show this process not watching the issue as a quiet status, not an error', async () => {
    answerWith(PlanningProgressMother.notWatched())

    renderProgress()

    expect(await screen.findByText('Sin seguimiento del agente en este backend')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('should show a real refusal as an error with the backend text', async () => {
    answerWith(PlanningProgressMother.malformedRepo())

    renderProgress()

    expect(await screen.findByRole('alert')).toHaveTextContent(PlanningProgressMother.MALFORMED_REPO_DETAIL)
  })

  it('should say the backend is unreachable when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    renderProgress()

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
  })
})
