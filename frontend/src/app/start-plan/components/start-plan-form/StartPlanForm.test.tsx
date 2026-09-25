import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { CoordinatingSessionClient } from 'app/coordinating-session/client'
import { StartPlanForm } from 'app/start-plan/components/start-plan-form'

vi.mock('app/coordinating-session/client', () => ({
  CoordinatingSessionClient: { open: vi.fn() },
}))

const OPENED = {
  kind: 'opened' as const,
  opened: {
    target: CoordinatingSessionMother.TARGET,
    conversation: CoordinatingSessionMother.CONVERSATION,
    repo: CoordinatingSessionMother.REPO,
    story: CoordinatingSessionMother.STORY,
    root: CoordinatingSessionMother.ROOT,
    session: CoordinatingSessionMother.SESSION,
  },
}

const REFUSAL_ERROR = CoordinatingSessionMother.ALREADY_LIVE_DETAIL
const REFUSED = { kind: 'refused' as const, code: 'coordinating-session-already-live', error: REFUSAL_ERROR }
const UNREACHABLE = { kind: 'backend-unreachable' as const }

const submitButton = () => screen.getByRole('button', { name: 'Arrancar brainstorming' })

const renderForm = ({ isCoordinatingSessionLive = false } = {}) => {
  const onOpened = vi.fn()
  const onUnreachable = vi.fn()
  render(
    <StartPlanForm
      isLocked={false}
      isCoordinatingSessionLive={isCoordinatingSessionLive}
      openSession={CoordinatingSessionClient.open}
      onInteraction={vi.fn()}
      onOpened={onOpened}
      onUnreachable={onUnreachable}
    />,
  )
  return { onOpened, onUnreachable }
}

const typeTicket = (user: ReturnType<typeof userEvent.setup>, value: string) => user.type(screen.getByLabelText('Ticket'), value)
const typePath = (user: ReturnType<typeof userEvent.setup>, value: string) => user.type(screen.getByLabelText(/Ruta local/), value)

describe('StartPlanForm', () => {
  beforeEach(() => vi.mocked(CoordinatingSessionClient.open).mockReset())

  it('does not let a second brainstorming be opened while a coordinating conversation is live', async () => {
    const user = userEvent.setup()
    renderForm({ isCoordinatingSessionLive: true })

    await typeTicket(user, StartPlanMother.TICKET)
    await typePath(user, StartPlanMother.PATH)

    expect(submitButton()).toBeDisabled()
    expect(screen.getByText(
      'Ya hay una conversación coordinadora en marcha. Termínala antes de abrir otra.',
    )).toBeInTheDocument()
    expect(CoordinatingSessionClient.open).not.toHaveBeenCalled()
  })

  it('shows specific field errors only after a field has been blurred', async () => {
    const user = userEvent.setup()
    renderForm()
    const ticket = screen.getByLabelText('Ticket')

    await user.type(ticket, 'abc')
    expect(ticket).not.toHaveAttribute('aria-invalid', 'true')
    await user.tab()

    expect(ticket).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(
      'Usa una clave como ABC-123 o una URL como https://github.com/owner/name/issues/123',
    )).toBeInTheDocument()

    const path = screen.getByLabelText(/Ruta local/)
    await user.type(path, 'relative/path')
    await user.tab()
    expect(path).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Indica una ruta absoluta válida, como /Users/tu-usuario/code/name')).toBeInTheDocument()
  })

  it('marks a cleared required field invalid after blur without changing its label semantics', async () => {
    const user = userEvent.setup()
    renderForm()
    const path = screen.getByLabelText(/Ruta local/)

    await user.type(path, StartPlanMother.PATH)
    await user.clear(path)
    await user.tab()

    expect(path).toHaveAccessibleName('Ruta local')
    expect(path).toHaveAttribute('aria-invalid', 'true')
  })

  it('offers no repository field, because the backend derives it from the local path', () => {
    renderForm()

    expect(screen.queryByLabelText(/Repositorio/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
  })

  it('opens the brainstorming with only the ticket and the local path', async () => {
    vi.mocked(CoordinatingSessionClient.open).mockResolvedValue(OPENED)
    const user = userEvent.setup()
    const { onOpened } = renderForm()

    await typeTicket(user, StartPlanMother.TICKET)
    await typePath(user, StartPlanMother.PATH)
    await user.click(submitButton())

    await waitFor(() =>
      expect(CoordinatingSessionClient.open).toHaveBeenCalledWith({
        id: StartPlanMother.TICKET,
        path: StartPlanMother.PATH,
      }),
    )
    expect(onOpened).toHaveBeenCalledWith(OPENED.opened)
  })

  it('cannot open brainstorming without a ticket and offers no description field', async () => {
    const user = userEvent.setup()
    const { onOpened } = renderForm()

    await typePath(user, StartPlanMother.PATH)
    await user.click(submitButton())

    expect(submitButton()).toBeDisabled()
    expect(screen.queryByLabelText('Qué quieres planificar')).not.toBeInTheDocument()
    expect(CoordinatingSessionClient.open).not.toHaveBeenCalled()
    expect(onOpened).not.toHaveBeenCalled()
  })

  it('opens nothing while the path is missing', async () => {
    const user = userEvent.setup()
    const { onOpened, onUnreachable } = renderForm()

    await typeTicket(user, StartPlanMother.TICKET)
    expect(submitButton()).toBeDisabled()
    await user.click(submitButton())

    expect(CoordinatingSessionClient.open).not.toHaveBeenCalled()
    expect(onOpened).not.toHaveBeenCalled()
    expect(onUnreachable).not.toHaveBeenCalled()
  })

  it('shows the backend refusal without losing what was typed', async () => {
    vi.mocked(CoordinatingSessionClient.open).mockResolvedValue(REFUSED)
    const user = userEvent.setup()
    renderForm()

    await typeTicket(user, StartPlanMother.TICKET)
    await typePath(user, StartPlanMother.PATH)
    await user.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(REFUSAL_ERROR)
    expect(screen.getByLabelText('Ticket')).toHaveValue(StartPlanMother.TICKET)
    expect(screen.getByLabelText(/Ruta local/)).toHaveValue(StartPlanMother.PATH)
  })

  it('warns when the backend does not answer', async () => {
    vi.mocked(CoordinatingSessionClient.open).mockResolvedValue(UNREACHABLE)
    const user = userEvent.setup()
    const { onOpened, onUnreachable } = renderForm()

    await typeTicket(user, StartPlanMother.TICKET)
    await typePath(user, StartPlanMother.PATH)
    await user.click(submitButton())

    await waitFor(() =>
      expect(onUnreachable).toHaveBeenCalled(),
    )
    expect(onOpened).not.toHaveBeenCalled()
  })
})
