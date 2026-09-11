import { render, screen } from '@testing-library/react'
import { MenuItem } from 'system-ui/menu-item'

describe('MenuItem', () => {
  it('should show the label and the detail as separate text when expanded', () => {
    render(<MenuItem label="gh" detail="sesión lista" />)

    expect(screen.getByText('gh')).toBeInTheDocument()
    expect(screen.getByText('sesión lista')).toBeInTheDocument()
  })

  it('should render as a static row when neither href nor onClick is given', () => {
    render(<MenuItem label="gh" detail="sesión lista" />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('should render as a button when onClick is given', () => {
    render(<MenuItem label="gh" onClick={() => undefined} />)

    expect(screen.getByRole('button', { name: 'gh' })).toBeInTheDocument()
  })

  it('should hide the label and detail behind the collapsed row, carrying both in its accessible name', () => {
    render(<MenuItem label="gh" detail="sesión lista" collapsed />)

    expect(screen.queryByText('gh')).not.toBeInTheDocument()
    expect(screen.queryByText('sesión lista')).not.toBeInTheDocument()
    expect(screen.getByLabelText('gh — sesión lista')).toBeInTheDocument()
  })

  it('should render the notifier only when expanded', () => {
    const { rerender } = render(<MenuItem label="gh" notifier={<span>falta</span>} />)
    expect(screen.getByText('falta')).toBeInTheDocument()

    rerender(<MenuItem label="gh" notifier={<span>falta</span>} collapsed />)
    expect(screen.queryByText('falta')).not.toBeInTheDocument()
  })
})
