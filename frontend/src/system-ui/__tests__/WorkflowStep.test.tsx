import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowStep } from 'system-ui/workflow-step'

describe('WorkflowStep', () => {
  it('should expose a parent-expanded step header as an expanded button that controls its content', () => {
    render(
      <WorkflowStep status="active" title="Preparar el plan" isExpanded onExpandedChange={() => undefined}>
        El agente prepara el plan
      </WorkflowStep>,
    )

    const header = screen.getByRole('button', { name: /Preparar el plan/ })
    const content = screen.getByRole('region', { name: 'Preparar el plan' })

    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(header).toHaveAttribute('aria-controls', content.id)
    expect(content.closest('.workflow-step__content-wrap')).toHaveAttribute('aria-hidden', 'false')
  })

  it('should ask its parent to reopen and collapse a completed step', async () => {
    const user = userEvent.setup()
    const onExpandedChange = vi.fn()

    const { rerender } = render(
      <WorkflowStep status="completed" title="Plan preparado" isExpanded={false} onExpandedChange={onExpandedChange}>
        El plan está listo para implementar
      </WorkflowStep>,
    )

    const header = screen.getByRole('button', { name: /Plan preparado/ })
    const content = document.getElementById(header.getAttribute('aria-controls') ?? '')

    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(content).not.toBeNull()
    expect(content?.closest('.workflow-step__content-wrap')).toHaveAttribute('aria-hidden', 'true')

    await user.click(header)
    expect(onExpandedChange).toHaveBeenCalledWith(true)

    rerender(
      <WorkflowStep status="completed" title="Plan preparado" isExpanded onExpandedChange={onExpandedChange}>
        El plan está listo para implementar
      </WorkflowStep>,
    )
    onExpandedChange.mockClear()
    await user.click(header)
    expect(onExpandedChange).toHaveBeenCalledWith(false)
  })

  it('should render a non-collapsible step as a static header with no button and no chevron', () => {
    const { container } = render(
      <WorkflowStep status="active" title="Plan preparado" canCollapse={false}>
        El plan está listo para implementar
      </WorkflowStep>,
    )

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Plan preparado' })).toBeInTheDocument()
    expect(container.querySelector('.workflow-step__chevron')).toBeNull()
    expect(screen.getByText('Activo')).toBeInTheDocument()
  })

  it('should render a non-collapsible step content as expanded and reachable', () => {
    render(
      <WorkflowStep status="active" title="Plan preparado" canCollapse={false}>
        El plan está listo para implementar
      </WorkflowStep>,
    )

    const content = screen.getByRole('region', { name: 'Plan preparado' })

    expect(content.closest('.workflow-step__content-wrap')).toHaveAttribute('aria-hidden', 'false')
  })

  it('should render the static header title at the caller supplied heading level', () => {
    render(
      <WorkflowStep status="active" title="Solicitud" level={1} canCollapse={false}>
        Contenido
      </WorkflowStep>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Solicitud' })).toBeInTheDocument()
  })

  it.each(['completed', 'active', 'pending'] as const)('should expose the %s state in its class', (status) => {
    const { container } = render(
      <WorkflowStep status={status} title="Paso" isExpanded={false} onExpandedChange={() => undefined}>
        Contenido
      </WorkflowStep>,
    )

    expect(container.firstChild).toHaveClass(`workflow-step--${status}`)
  })

  it('should use a caller supplied content identifier', () => {
    render(
      <WorkflowStep status="pending" title="Implementar" contentId="implementation-step" isExpanded={false} onExpandedChange={() => undefined}>
        Esperando la implementación
      </WorkflowStep>,
    )

    const header = screen.getByRole('button', { name: /Implementar/ })

    expect(header).toHaveAttribute('aria-controls', 'implementation-step')
    expect(document.getElementById('implementation-step')?.closest('.workflow-step__content-wrap')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })

  it('should keep a pending step collapsed and unavailable', () => {
    render(
      <WorkflowStep status="pending" title="Implementar" isExpanded={false} onExpandedChange={() => undefined}>
        Esperando la implementación
      </WorkflowStep>,
    )

    const header = screen.getByRole('button', { name: /Implementar/ })
    expect(header).toBeDisabled()
    expect(header).toHaveAttribute('aria-expanded', 'false')
  })
})
