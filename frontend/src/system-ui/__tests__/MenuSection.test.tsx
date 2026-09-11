import { render, screen } from '@testing-library/react'
import { MenuSection } from 'system-ui/menu-section'

describe('MenuSection', () => {
  it('should render its title and expose the items as a named list', () => {
    render(
      <MenuSection title="Herramientas">
        <li>gh</li>
      </MenuSection>,
    )

    expect(screen.getByText('Herramientas')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Herramientas' })).toBeInTheDocument()
  })

  it('should replace the visible title with a rule when collapsed, keeping the accessible name', () => {
    render(
      <MenuSection title="Herramientas" collapsed>
        <li>gh</li>
      </MenuSection>,
    )

    expect(screen.queryByText('Herramientas')).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Herramientas' })).toBeInTheDocument()
  })
})
