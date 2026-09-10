import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Drawer } from 'system-ui/drawer'

describe('Drawer', () => {
  it('is a complementary region named by its own title, with its body wired to the toggle', () => {
    render(
      <Drawer title="Detalle del pedido" subtitle="4821">
        <p>Doce paradas</p>
      </Drawer>,
    )

    const region = screen.getByRole('complementary', { name: 'Detalle del pedido' })
    const toggle = screen.getByRole('button', { name: 'Contraer el panel' })

    expect(region).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', screen.getByText('Doce paradas').parentElement?.id ?? '')
    expect(screen.getByText('Doce paradas')).toBeVisible()
    expect(screen.getByText('4821')).toBeVisible()
  })

  it('folds on its own and says which way the toggle goes', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <Drawer title="Detalle del pedido" onToggle={onToggle}>
        <p>Doce paradas</p>
      </Drawer>,
    )

    await user.click(screen.getByRole('button', { name: 'Contraer el panel' }))

    expect(onToggle).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'Desplegar el panel' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('starts folded when it is told to, and hides its body for real', () => {
    render(
      <Drawer title="Detalle" defaultCollapsed>
        <p>Doce paradas</p>
      </Drawer>,
    )

    expect(screen.getByRole('button', { name: 'Desplegar el panel' })).toBeInTheDocument()
    expect(screen.queryByText('Doce paradas')).not.toBeVisible()
  })

  it('keeps its title in the accessibility tree when folded so the rail is not anonymous', () => {
    render(<Drawer title="Detalle" subtitle="4821" defaultCollapsed />)

    expect(screen.getByRole('complementary', { name: 'Detalle' })).toBeInTheDocument()
    expect(screen.queryByText('4821')).not.toBeInTheDocument()
  })

  it('stays where it is governed from, and only announces the change', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<Drawer title="Detalle" collapsed onToggle={onToggle}>body</Drawer>)

    await user.click(screen.getByRole('button', { name: 'Desplegar el panel' }))

    expect(onToggle).toHaveBeenCalledWith(false)
    expect(screen.getByRole('button', { name: 'Desplegar el panel' })).toBeInTheDocument()
  })

  it('takes a toggle label of its own when the default does not fit', () => {
    render(<Drawer title="Detalle" toggleLabel="Ocultar el detalle" />)

    expect(screen.getByRole('button', { name: 'Ocultar el detalle' })).toBeInTheDocument()
  })

  it('holds the actions it is given, and leaves the region unnamed without a title', () => {
    render(
      <Drawer actions={<button type="button">Editar</button>}>
        <p>Doce paradas</p>
      </Drawer>,
    )

    expect(screen.getByRole('button', { name: 'Editar' })).toBeVisible()
    expect(screen.getByRole('complementary')).not.toHaveAttribute('aria-labelledby')
  })

  it('hides the actions while folded, because there is no header to hold them', () => {
    render(<Drawer title="Detalle" actions={<button type="button">Editar</button>} defaultCollapsed />)

    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
  })

  it('is not a dialog: it never traps the focus nor claims to be modal', () => {
    render(<Drawer title="Detalle">body</Drawer>)

    const region = screen.getByRole('complementary', { name: 'Detalle' })

    expect(region).not.toHaveAttribute('aria-modal')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(region.tagName).toBe('ASIDE')
  })

  it('folds to the rail by a class the stylesheet narrows, not by unmounting the column', async () => {
    const user = userEvent.setup()
    render(<Drawer title="Detalle">body</Drawer>)
    const region = screen.getByRole('complementary', { name: 'Detalle' })

    expect(region).not.toHaveClass('drawer--collapsed')

    await user.click(screen.getByRole('button', { name: 'Contraer el panel' }))

    expect(region).toHaveClass('drawer--collapsed')
    expect(region).toBeInTheDocument()
  })
})
