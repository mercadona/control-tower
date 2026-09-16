import { fireEvent, render, screen } from '@testing-library/react'
import { Drawer } from 'system-ui/drawer'

describe('Drawer', () => {
  it('should start from defaultCollapsed', () => {
    render(<Drawer title="Sessions" defaultCollapsed>
      <p>content</p>
    </Drawer>)

    expect(screen.getByRole('button', { name: 'Desplegar el panel' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('should default to open when defaultCollapsed is not given', () => {
    render(<Drawer title="Sessions">
      <p>content</p>
    </Drawer>)

    expect(screen.getByRole('button', { name: 'Contraer el panel' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('should report the new state through onToggle when the toggle is clicked', () => {
    const onToggle = vi.fn()
    render(<Drawer title="Sessions" onToggle={onToggle}>
      <p>content</p>
    </Drawer>)

    fireEvent.click(screen.getByRole('button', { name: 'Contraer el panel' }))

    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('should let a controlled collapsed win over its internal state', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<Drawer title="Sessions" collapsed={false} onToggle={onToggle}>
      <p>content</p>
    </Drawer>)

    fireEvent.click(screen.getByRole('button', { name: 'Contraer el panel' }))

    expect(onToggle).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'Contraer el panel' })).toHaveAttribute('aria-expanded', 'true')

    rerender(<Drawer title="Sessions" collapsed onToggle={onToggle}>
      <p>content</p>
    </Drawer>)

    expect(screen.getByRole('button', { name: 'Desplegar el panel' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('should carry hidden on the content when collapsed', () => {
    render(<Drawer title="Sessions" defaultCollapsed>
      <p>content</p>
    </Drawer>)

    expect(screen.getByText('content')).not.toBeVisible()
  })

  it('should keep the title in the accessibility tree when collapsed', () => {
    render(<Drawer title="Sessions" defaultCollapsed>
      <p>content</p>
    </Drawer>)

    expect(screen.getByRole('complementary', { name: 'Sessions' })).toBeInTheDocument()
  })

  it("should follow the toggle's name and aria-expanded with the state", () => {
    render(<Drawer title="Sessions">
      <p>content</p>
    </Drawer>)

    const toggle = screen.getByRole('button', { name: 'Contraer el panel' })
    fireEvent.click(toggle)

    expect(screen.getByRole('button', { name: 'Desplegar el panel' })).toHaveAttribute('aria-expanded', 'false')
  })
})
