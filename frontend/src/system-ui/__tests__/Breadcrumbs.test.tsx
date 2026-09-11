import { render, screen, within } from '@testing-library/react'
import { Breadcrumbs } from 'system-ui/breadcrumbs'

describe('Breadcrumbs', () => {
  it('should render every level and mark the last one as the current page', () => {
    render(<Breadcrumbs items={[{ label: 'owner/name' }, { label: '#7' }, { label: 'Revisar plan' }]} />)

    const trail = screen.getByRole('navigation', { name: 'Ruta de navegación' })
    expect(within(trail).getByText('owner/name')).toBeInTheDocument()
    expect(within(trail).getByText('#7')).toBeInTheDocument()
    expect(within(trail).getByText('Revisar plan')).toHaveAttribute('aria-current', 'page')
  })
})
