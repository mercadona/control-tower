import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Navbar } from 'system-ui/navbar'

describe('Navbar', () => {
  it('should expose itself as a navigation landmark with the given accessible name', () => {
    render(
      <Navbar aria-label="Main navigation" header={<span>header</span>}>
        <span>sections</span>
      </Navbar>,
    )

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
  })

  it('should widen to 280px by default and shrink to 72px when collapsed', () => {
    const { rerender } = render(
      <Navbar aria-label="nav" header={<span>header</span>}>
        <span>sections</span>
      </Navbar>,
    )
    expect(screen.getByRole('navigation')).not.toHaveClass('navbar--collapsed')

    rerender(
      <Navbar aria-label="nav" collapsed header={<span>header</span>}>
        <span>sections</span>
      </Navbar>,
    )
    expect(screen.getByRole('navigation')).toHaveClass('navbar--collapsed')
  })

  it('should make the whole footer row the control when onFooterClick is given', async () => {
    const onFooterClick = vi.fn()
    const user = userEvent.setup()
    render(
      <Navbar aria-label="nav" header={<span>header</span>} footer="Retry" footerLabel="Retry" onFooterClick={onFooterClick}>
        <span>sections</span>
      </Navbar>,
    )

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(onFooterClick).toHaveBeenCalledTimes(1)
  })

  it('should disable the footer control when told to', () => {
    render(
      <Navbar aria-label="nav" header={<span>header</span>} footer="Retry" footerLabel="Retry" onFooterClick={() => undefined} footerDisabled>
        <span>sections</span>
      </Navbar>,
    )

    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
  })
})
