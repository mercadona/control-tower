import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { NavHeader } from 'system-ui/nav-header'

const NAV_HEADER_CSS = readFileSync(join(__dirname, '../nav-header/NavHeader.css'), 'utf8')

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

  it('should keep the toggle in the document when collapsed, with its aria-label and aria-expanded', () => {
    render(<NavHeader productName="Control Tower" logo={<span>logo</span>} collapsed onToggle={() => undefined} />)

    const toggle = screen.getByRole('button', { name: 'Expandir el menú' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('logo')).toBeInTheDocument()
  })

  it('should carry the collapsed modifier class the CSS keys on', () => {
    const { container } = render(
      <NavHeader productName="Control Tower" logo={<span>logo</span>} collapsed onToggle={() => undefined} />,
    )

    expect(container.firstElementChild).toHaveClass('nav-header--collapsed')
  })

  it('should call onToggle when the toggle is clicked while collapsed', () => {
    const onToggle = vi.fn()
    render(<NavHeader productName="Control Tower" logo={<span>logo</span>} collapsed onToggle={onToggle} />)

    fireEvent.click(screen.getByRole('button', { name: 'Expandir el menú' }))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('should keep the collapsed layout rules in NavHeader.css', () => {
    expect(NAV_HEADER_CSS).toMatch(/\.nav-header\s*{[^}]*position:\s*relative;/)
    expect(NAV_HEADER_CSS).toContain(
      '.nav-header--collapsed .nav-header__toggle { position: absolute; top: 50%; left: 4px; transform: translateY(-50%); opacity: 0; }',
    )
    expect(NAV_HEADER_CSS).toContain(
      '.nav-header--collapsed:has(.nav-header__toggle):hover .nav-header__toggle,\n.nav-header--collapsed .nav-header__toggle:focus-visible {\n  opacity: 1;\n}',
    )
    expect(NAV_HEADER_CSS).toContain(
      '.nav-header--collapsed:has(.nav-header__toggle):hover .nav-header__logo,\n.nav-header--collapsed:has(.nav-header__toggle:focus-visible) .nav-header__logo {\n  visibility: hidden;\n}',
    )
  })
})
