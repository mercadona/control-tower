import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImplementHistoryMother } from '__scenarios__/ImplementHistoryMother'
import { ImplementHistory } from './ImplementHistory'

const answerWith = (answer: { status: number; body: string }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))
}

const renderHistory = () => render(<ImplementHistory issue={ImplementHistoryMother.ISSUE} root={ImplementHistoryMother.ROOT} repo={ImplementHistoryMother.REPO} />)

const expandedRegionOf = async (taskButtonName: RegExp) => {
  const user = userEvent.setup()
  const button = await screen.findByRole('button', { name: taskButtonName })
  if (button.getAttribute('aria-expanded') === 'false') await user.click(button)
  return screen.getByRole('region', { name: taskButtonName })
}

describe('ImplementHistory', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should render a single status line when no step has finished yet', async () => {
    answerWith(ImplementHistoryMother.empty())

    renderHistory()

    expect(await screen.findByText('Todavía no ha terminado ningún paso')).toHaveAttribute('role', 'status')
  })

  it('should render three summary tiles for tasks, attempts and tokens', async () => {
    answerWith(ImplementHistoryMother.fullRun())

    renderHistory()

    expect(await screen.findByText('2 de 2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1 fallido(s)')).toBeInTheDocument()
    expect(screen.getByText('17,6 M')).toBeInTheDocument()
  })

  it('should group rows by task into one accordion per task, headed by the task number and name, with null-task rows in a closing section', async () => {
    answerWith(ImplementHistoryMother.fullRun())

    renderHistory()

    expect(await screen.findByRole('button', { name: /Tarea 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tarea 2/ })).toBeInTheDocument()
    const closing = screen.getByRole('region', { name: 'Cierre del slice' })
    expect(within(closing).getAllByRole('listitem')).toHaveLength(3)
  })

  it('should expand the task with no done judge by default and mark it en curso, leaving the completed task collapsed', async () => {
    answerWith(ImplementHistoryMother.fullRun())

    renderHistory()

    const taskOne = await screen.findByRole('button', { name: /Tarea 1/ })
    const taskTwo = screen.getByRole('button', { name: /Tarea 2/ })
    expect(taskOne).toHaveAttribute('aria-expanded', 'false')
    expect(taskTwo).toHaveAttribute('aria-expanded', 'false')
  })

  it('should render the attempts stepper with the step label, the duration and the judge ruling tag', async () => {
    answerWith(ImplementHistoryMother.fullRun())

    renderHistory()

    const region = await expandedRegionOf(/Tarea 1/)
    expect(within(region).getAllByText('Implementar').length).toBeGreaterThan(0)
    expect(within(region).getAllByText('Controles').length).toBeGreaterThan(0)
    expect(within(region).getByText('Juez')).toBeInTheDocument()
    expect(within(region).getByText('12,2 s')).toBeInTheDocument()
    expect(within(region).getByText('PASS')).toBeInTheDocument()
  })

  it('should render a danger note naming the attempt, the step and the time for a failed row', async () => {
    answerWith(ImplementHistoryMother.fullRun())

    renderHistory()

    const region = await expandedRegionOf(/Tarea 1/)
    expect(within(region).getByText(/Intento 1 · Controles fallidos a las \d{2}:\d{2}/)).toBeInTheDocument()
    expect(within(region).getByText(/tras 138 ms/)).toBeInTheDocument()
  })

  it('should render three facts for a task: attempts, judge findings and tokens in millions', async () => {
    answerWith(ImplementHistoryMother.fullRun())

    renderHistory()

    const region = await expandedRegionOf(/Tarea 1/)
    expect(within(region).getByText('Intentos')).toBeInTheDocument()
    expect(within(region).getByText('2')).toBeInTheDocument()
    expect(within(region).getByText('Hallazgos del juez')).toBeInTheDocument()
    expect(within(region).getByText('11,9 M')).toBeInTheDocument()
  })

  it('should render the last implement summary behind a Qué hizo el agente disclosure', async () => {
    answerWith(ImplementHistoryMother.oneTask())

    renderHistory()

    const disclosure = await screen.findByText('Qué hizo el agente')
    expect(disclosure.closest('details')).not.toBeNull()
    expect(disclosure.closest('details')).toHaveTextContent(/Renamed/)
  })

  it('should render a warning tag with the finding count when a judge row has findings', async () => {
    answerWith({
      status: 200,
      body: JSON.stringify({
        steps: [{
          step: 'judge', task: 1, task_name: 'a task', tasks_total: 1, attempt: 1, outcome: 'done',
          written_at: '2026-09-10T15:05:41.987Z', duration_ms: null, summary: null,
          ruling: 'PASS', findings_total: 2, tool_total_tokens: 100,
        }],
      }),
    })

    renderHistory()

    expect(await screen.findByText('2 hallazgo(s)')).toBeInTheDocument()
  })

  it('should render the closing section rows with their outcome tag', async () => {
    answerWith(ImplementHistoryMother.fullRun())

    renderHistory()

    await screen.findByRole('button', { name: /Tarea 1/ })
    const closing = screen.getByRole('region', { name: 'Cierre del slice' })
    expect(within(closing).getByText('Reconciliar con main')).toBeInTheDocument()
    expect(within(closing).getByText('al día')).toBeInTheDocument()
    expect(within(closing).getByText('Verificación global')).toBeInTheDocument()
    expect(within(closing).getByText('Juez del slice')).toBeInTheDocument()
    expect(within(closing).getAllByText('PASS').length).toBeGreaterThan(0)
  })

  it('should render an error banner with the backend detail for a refusal other than not-read', async () => {
    answerWith(ImplementHistoryMother.refusedMalformedRepo())

    renderHistory()

    expect(await screen.findByRole('alert')).toHaveTextContent(ImplementHistoryMother.MALFORMED_REPO_DETAIL)
  })

  it('should say the backend is unreachable as a status line, not an alert', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    renderHistory()

    expect(await screen.findByText('No se pudo contactar con el backend')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
