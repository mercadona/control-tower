import { render, screen } from '@testing-library/react'
import { NavHeader } from 'system-ui/nav-header'

describe('NavHeader', () => {
  it('should show the product name beside the logo when expanded', () => {
    render(<NavHeader productName="Control Tower" logo={<span>logo</span>} />)

    expect(screen.getByText('Control Tower')).toBeInTheDocument()
  })

  it('should hide the product name when collapsed', () => {
    render(<NavHeader productName="Control Tower" logo={<span>logo</span>} collapsed />)

    expect(screen.queryByText('Control Tower')).not.toBeInTheDocument()
  })

  it('should expose the toggle with aria-expanded matching the expanded state', () => {
    const { rerender } = render(
      <NavHeader productName="Control Tower" logo={<span>logo</span>} onToggle={() => undefined} />,
    )
    expect(screen.getByRole('button', { name: 'Colapsar el menú' })).toHaveAttribute('aria-expanded', 'true')

    rerender(
      <NavHeader productName="Control Tower" logo={<span>logo</span>} collapsed onToggle={() => undefined} />,
    )
    expect(screen.getByRole('button', { name: 'Expandir el menú' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('should render no toggle at all when onToggle is not given', () => {
    render(<NavHeader productName="Control Tower" logo={<span>logo</span>} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
