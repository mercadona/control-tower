import { render, screen, within } from '@testing-library/react'
import { ImplementHistoryMother } from '__scenarios__/ImplementHistoryMother'
import { ImplementHistory } from './ImplementHistory'

const answerWith = (answer: { status: number; body: string }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))
}

const renderHistory = () => render(<ImplementHistory issue={ImplementHistoryMother.ISSUE} root={ImplementHistoryMother.ROOT} repo={ImplementHistoryMother.REPO} />)

describe('ImplementHistory', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should show the heading', async () => {
    answerWith(ImplementHistoryMother.empty())

    renderHistory()

    expect(await screen.findByRole('heading', { name: 'Pasos completados' })).toBeInTheDocument()
  })

  it('should render a single status line when no step has finished yet', async () => {
    answerWith(ImplementHistoryMother.empty())

    renderHistory()

    expect(await screen.findByText('Todavía no ha terminado ningún paso')).toHaveAttribute('role', 'status')
  })

  it('should render one row per finished step, in file order', async () => {
    answerWith(ImplementHistoryMother.fullRun())

    renderHistory()

    const list = await screen.findByRole('list', { name: 'Pasos completados' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(11)
    expect(rows[0]).toHaveTextContent('Implementando')
    expect(rows[1]).toHaveTextContent('Revisando controles')
    expect(rows[10]).toHaveTextContent('Evaluando el slice')
  })

  it('should show the task number, the outcome label and the duration rounded to whole seconds', async () => {
    answerWith(ImplementHistoryMother.fullRun())

    renderHistory()

    const list = await screen.findByRole('list', { name: 'Pasos completados' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Tarea 1')
    expect(rows[0]).toHaveTextContent('Hecho')
    expect(rows[1]).toHaveTextContent('Fallido')
    expect(rows[3]).toHaveTextContent('12 s')
  })

  it('should not show a task number for a slice-wide row', async () => {
    answerWith(ImplementHistoryMother.fullRun())

    renderHistory()

    const list = await screen.findByRole('list', { name: 'Pasos completados' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows[8]).not.toHaveTextContent('Tarea')
    expect(rows[8]).toHaveTextContent('Al día')
  })

  it('should show an unrecognised outcome as the raw value', async () => {
    answerWith({ status: 200, body: '{"steps":[{"step":"implement","task":1,"task_name":null,"tasks_total":1,"attempt":1,"outcome":"discarded","written_at":null,"duration_ms":null,"summary":null}]}' })

    renderHistory()

    const row = (await screen.findAllByRole('listitem'))[0]
    expect(row).toHaveTextContent('discarded')
  })

  it('should render a summary behind a disclosure', async () => {
    answerWith(ImplementHistoryMother.oneTask())

    renderHistory()

    await screen.findAllByRole('listitem')
    const disclosure = screen.getByText('Resumen')
    expect(disclosure.closest('details')).not.toBeNull()
    expect(disclosure.closest('details')).toHaveTextContent(/Renamed/)
  })

  it('should not render a disclosure for a row without a summary', async () => {
    answerWith(ImplementHistoryMother.fullRun())

    renderHistory()

    const list = await screen.findByRole('list', { name: 'Pasos completados' })
    const rows = within(list).getAllByRole('listitem')
    expect(within(rows[1]).queryByText('Resumen')).toBeNull()
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
