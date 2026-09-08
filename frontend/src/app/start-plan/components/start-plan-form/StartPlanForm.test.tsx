import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StartPlanForm } from 'app/start-plan/components/start-plan-form'

const renderForm = () => render(
  <StartPlanForm
    isLocked={false}
    onInteraction={vi.fn()}
    onStarted={vi.fn()}
    onBackendUnreachable={vi.fn()}
  />,
)

describe('StartPlanForm', () => {
  it('shows specific field errors only after a field has been blurred', async () => {
    const user = userEvent.setup()
    renderForm()
    const ticket = screen.getByLabelText('Clave del ticket')

    await user.type(ticket, 'abc')
    expect(ticket).not.toHaveAttribute('aria-invalid', 'true')
    await user.tab()

    expect(ticket).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Usa la forma ABC-123')).toBeInTheDocument()

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
})
