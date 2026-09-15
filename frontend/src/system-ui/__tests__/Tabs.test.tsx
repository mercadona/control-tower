import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs } from 'system-ui/tabs'

const OPTIONS = [
  { value: 'summary', label: 'Summary' },
  { value: 'orders', label: 'Orders' },
  { value: 'incidents', label: 'Incidents' },
]

describe('Tabs', () => {
  it('should expose a tab list with one tab per option, each marked selected or not', () => {
    render(<Tabs options={OPTIONS} aria-label="Sections" />)

    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('Summary')
  })

  it('should keep a single roving tab stop on the active tab', () => {
    render(<Tabs options={OPTIONS} defaultValue="orders" />)

    const tabbable = screen.getAllByRole('tab').filter((tab) => tab.getAttribute('tabindex') === '0')

    expect(tabbable).toHaveLength(1)
    expect(tabbable[0]).toHaveAccessibleName('Orders')
  })

  it('should default to the first enabled option when no value is given', () => {
    const options = [
      { value: 'summary', label: 'Summary', disabled: true },
      { value: 'orders', label: 'Orders' },
      { value: 'incidents', label: 'Incidents' },
    ]
    render(<Tabs options={options} />)

    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('Orders')
  })

  it('should start on defaultValue and then move on its own while uncontrolled', async () => {
    const user = userEvent.setup()
    render(<Tabs options={OPTIONS} defaultValue="orders" />)

    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('Orders')

    await user.click(screen.getByRole('tab', { name: 'Incidents' }))

    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('Incidents')
  })

  it('should not move itself while controlled, and follow the value it is given instead', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<Tabs options={OPTIONS} value="summary" onChange={onChange} />)

    await user.click(screen.getByRole('tab', { name: 'Orders' }))

    expect(onChange).toHaveBeenCalledWith('orders')
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('Summary')

    rerender(<Tabs options={OPTIONS} value="orders" onChange={onChange} />)

    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('Orders')
  })

  it('should walk the tabs with the arrow keys, wrapping around at both ends', async () => {
    const user = userEvent.setup()
    render(<Tabs options={OPTIONS} />)

    await user.click(screen.getByRole('tab', { name: 'Summary' }))
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('Orders')

    await user.keyboard('{ArrowLeft}{ArrowLeft}')

    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('Incidents')
  })

  it('should jump to the first and last tab with Home and End', async () => {
    const user = userEvent.setup()
    render(<Tabs options={OPTIONS} />)

    await user.click(screen.getByRole('tab', { name: 'Summary' }))
    await user.keyboard('{End}')

    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('Incidents')

    await user.keyboard('{Home}')

    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('Summary')
  })

  it('should skip a disabled tab while walking with the arrow keys', async () => {
    const user = userEvent.setup()
    const options = [
      { value: 'summary', label: 'Summary' },
      { value: 'orders', label: 'Orders', disabled: true },
      { value: 'incidents', label: 'Incidents' },
    ]
    render(<Tabs options={options} />)

    await user.click(screen.getByRole('tab', { name: 'Summary' }))
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('Incidents')
  })

  it('should refuse to select a disabled tab by click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const options = [
      { value: 'summary', label: 'Summary' },
      { value: 'orders', label: 'Orders', disabled: true },
    ]
    render(<Tabs options={options} onChange={onChange} />)

    await user.click(screen.getByRole('tab', { name: 'Orders' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Orders' })).toBeDisabled()
  })

  it('should hide the decorative icon and keep the badge readable next to the label', () => {
    const options = [
      {
        value: 'incidents',
        label: 'Incidents',
        icon: <svg role="img" aria-label="Alert" />,
        badge: <span>3</span>,
      },
    ]
    render(<Tabs options={options} />)

    expect(screen.getByRole('img', { hidden: true })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('should forward an attribute it does not know to the tab list', () => {
    render(<Tabs options={OPTIONS} id="sections" data-testid="tabs" />)

    const tablist = screen.getByRole('tablist')

    expect(tablist).toHaveAttribute('id', 'sections')
    expect(tablist).toHaveAttribute('data-testid', 'tabs')
  })

  it('should keep the class name it is given', () => {
    render(<Tabs options={OPTIONS} className="my-tabs" />)

    expect(screen.getByRole('tablist')).toHaveClass('my-tabs')
  })
})
