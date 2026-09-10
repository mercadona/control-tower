import { render, screen } from '@testing-library/react'
import { Button } from 'system-ui/button'

describe('Button', () => {
  it('should default to a plain button so a form is not submitted by accident', () => {
    render(<Button>Guardar</Button>)

    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveAttribute('type', 'button')
  })

  it('should wear the class of its variant and its size', () => {
    render(
      <Button variant="danger" size="mobile">
        Borrar
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Borrar' })
    expect(button).toHaveClass('button--danger')
    expect(button).toHaveClass('button--mobile')
  })

  it('should keep the label in the footnote type style the system prescribes', () => {
    render(<Button>Guardar</Button>)

    expect(screen.getByText('Guardar')).toHaveClass('lg-footnote-medium')
  })

  it('should hide a decorative icon from the reader and keep it beside the label', () => {
    render(<Button iconStart={<svg data-testid="glyph" />}>Guardar</Button>)

    const button = screen.getByRole('button', { name: 'Guardar' })
    expect(button).not.toHaveClass('button--icon-only')
    expect(screen.getByTestId('glyph').parentElement).toHaveAttribute('aria-hidden', 'true')
  })

  it('should turn square with no label, and take its name from the aria-label instead', () => {
    render(<Button iconStart={<svg data-testid="glyph" />} aria-label="Contraer el panel" />)

    const button = screen.getByRole('button', { name: 'Contraer el panel' })
    expect(button).toHaveClass('button--icon-only')
    expect(button).toHaveClass('button--desktop')
    expect(button.querySelector('.button__label')).toBeNull()
  })
})
