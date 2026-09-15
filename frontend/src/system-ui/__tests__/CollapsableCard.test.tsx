import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollapsableCard } from 'system-ui/collapsable-card'

describe('CollapsableCard', () => {
  it('should expose an uncontrolled card as a heading with a chevron button that reveals its content', async () => {
    const user = userEvent.setup()
    render(
      <CollapsableCard heading="Puerta 1">
        Detalle de la puerta
      </CollapsableCard>,
    )

    const heading = screen.getByRole('heading', { name: 'Puerta 1' })
    const toggle = screen.getByRole('button', { name: 'Expandir' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: 'Puerta 1' })).not.toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Colapsar' })).toHaveAttribute('aria-controls')
    const content = screen.getByRole('region', { name: 'Puerta 1' })
    expect(content).toHaveTextContent('Detalle de la puerta')
    expect(heading.id).toBe(content.getAttribute('aria-labelledby'))
  })

  it('should let a caller control its expanded state instead of governing its own', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <CollapsableCard heading="Puerta 2" expanded={false} onToggle={onToggle}>
        Detalle
      </CollapsableCard>,
    )

    await user.click(screen.getByRole('button', { name: 'Expandir' }))

    expect(onToggle).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'Expandir' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('should keep a hidden card out of the accessibility tree while its content stays mounted', () => {
    render(
      <CollapsableCard heading="Puerta oculta" hidden>
        Detalle
      </CollapsableCard>,
    )

    expect(screen.queryByRole('heading', { name: 'Puerta oculta' })).not.toBeInTheDocument()
  })

  it('should clamp a collapsed subtitle and show it in full once expanded', async () => {
    const user = userEvent.setup()
    render(
      <CollapsableCard heading="Puerta 1" subtitle="Completada el 2026-09-14 · Pull request #341">
        Detalle
      </CollapsableCard>,
    )

    expect(screen.getByText('Completada el 2026-09-14 · Pull request #341')).toHaveClass(
      'collapsable-card__subtitle--clamped',
    )

    await user.click(screen.getByRole('button', { name: 'Expandir' }))

    expect(screen.getByText('Completada el 2026-09-14 · Pull request #341')).not.toHaveClass(
      'collapsable-card__subtitle--clamped',
    )
  })
})
