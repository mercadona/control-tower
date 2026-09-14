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
  opened: { conversation: CoordinatingSessionMother.CONVERSATION, session: CoordinatingSessionMother.SESSION },
}

const REFUSAL_ERROR = CoordinatingSessionMother.ONE_REPOSITORY_ONLY_DETAIL
const REFUSED = { kind: 'refused' as const, code: 'one-repository-only', error: REFUSAL_ERROR }
const UNREACHABLE = { kind: 'backend-unreachable' as const }

const submitButton = () => screen.getByRole('button', { name: 'Arrancar brainstorming' })

const renderForm = () => {
  const onOpened = vi.fn()
  const onUnreachable = vi.fn()
  render(<StartPlanForm isLocked={false} onInteraction={vi.fn()} onOpened={onOpened} onUnreachable={onUnreachable} />)
  return { onOpened, onUnreachable }
}

const typeTicket = (user: ReturnType<typeof userEvent.setup>, value: string) => user.type(screen.getByLabelText('Ticket'), value)
const typeUserComment = (user: ReturnType<typeof userEvent.setup>, value: string) =>
  user.type(screen.getByLabelText('Qué quieres planificar'), value)
const typeRepository = (user: ReturnType<typeof userEvent.setup>, value: string) => user.type(screen.getByLabelText(/Repositorio/), value)
const typePath = (user: ReturnType<typeof userEvent.setup>, value: string) => user.type(screen.getByLabelText(/Ruta local/), value)

describe('StartPlanForm', () => {
  beforeEach(() => vi.mocked(CoordinatingSessionClient.open).mockReset())

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

    const repository = screen.getByLabelText(/Repositorio/)
    await user.click(repository)
    await user.tab()
    expect(repository).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Indica un repositorio válido, como owner/name')).toBeInTheDocument()

    const path = screen.getByLabelText(/Ruta local/)
    await user.type(path, 'relative/path')
    await user.tab()
    expect(path).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Indica una ruta absoluta válida, como /Users/tu-usuario/code/name')).toBeInTheDocument()
  })

  it('marks a cleared required field invalid after blur without changing its label semantics', async () => {
    const user = userEvent.setup()
    renderForm()
    const repository = screen.getByLabelText(/Repositorio/)

    await user.type(repository, 'owner/name')
    await user.clear(repository)
    await user.tab()

    expect(repository).toHaveAccessibleName('Repositorio')
    expect(repository).toHaveAttribute('aria-invalid', 'true')
  })

  it('opens the brainstorming with the ticket and the comment', async () => {
    vi.mocked(CoordinatingSessionClient.open).mockResolvedValue(OPENED)
    const user = userEvent.setup()
    const { onOpened } = renderForm()

    await typeTicket(user, StartPlanMother.TICKET)
    await typeUserComment(user, StartPlanMother.COMMENT)
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)
    await user.click(submitButton())

    await waitFor(() =>
      expect(CoordinatingSessionClient.open).toHaveBeenCalledWith({
        id: StartPlanMother.TICKET,
        userComment: StartPlanMother.COMMENT,
        repo: StartPlanMother.REPO,
        path: StartPlanMother.PATH,
      }),
    )
    expect(onOpened).toHaveBeenCalledWith(OPENED.opened, {
      id: StartPlanMother.TICKET,
      userComment: StartPlanMother.COMMENT,
      repo: StartPlanMother.REPO,
      path: StartPlanMother.PATH,
    })
  })

  it('opens the brainstorming with free text alone', async () => {
    vi.mocked(CoordinatingSessionClient.open).mockResolvedValue(OPENED)
    const user = userEvent.setup()
    const { onOpened } = renderForm()

    await typeUserComment(user, StartPlanMother.COMMENT)
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)
    await user.click(submitButton())

    await waitFor(() =>
      expect(CoordinatingSessionClient.open).toHaveBeenCalledWith({
        id: null,
        userComment: StartPlanMother.COMMENT,
        repo: StartPlanMother.REPO,
        path: StartPlanMother.PATH,
      }),
    )
    expect(onOpened).toHaveBeenCalledWith(OPENED.opened, {
      id: null,
      userComment: StartPlanMother.COMMENT,
      repo: StartPlanMother.REPO,
      path: StartPlanMother.PATH,
    })
  })

  it('opens nothing while the repository or the path is missing', async () => {
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
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)
    await user.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(REFUSAL_ERROR)
    expect(screen.getByLabelText('Ticket')).toHaveValue(StartPlanMother.TICKET)
    expect(screen.getByLabelText(/Repositorio/)).toHaveValue(StartPlanMother.REPO)
    expect(screen.getByLabelText(/Ruta local/)).toHaveValue(StartPlanMother.PATH)
  })

  it('warns when the backend does not answer', async () => {
    vi.mocked(CoordinatingSessionClient.open).mockResolvedValue(UNREACHABLE)
    const user = userEvent.setup()
    const { onOpened, onUnreachable } = renderForm()

    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)
    await user.click(submitButton())

    await waitFor(() =>
      expect(onUnreachable).toHaveBeenCalledWith({
        id: StartPlanMother.TICKET,
        userComment: null,
        repo: StartPlanMother.REPO,
        path: StartPlanMother.PATH,
      }),
    )
    expect(onOpened).not.toHaveBeenCalled()
  })
})
