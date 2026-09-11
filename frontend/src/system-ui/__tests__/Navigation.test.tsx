import { render, screen } from '@testing-library/react'
import { Navigation } from 'system-ui/navigation'

describe('Navigation', () => {
  it('should lay out the navbar, the top bar and the content in that order', () => {
    render(
      <Navigation navbar={<span>navbar</span>} topBar={<span>top bar</span>}>
        <span>content</span>
      </Navigation>,
    )

    const shell = screen.getByText('navbar').parentElement
    expect(shell?.textContent).toBe('navbartop barcontent')
  })

  it('should render only the content when no navbar or top bar is given', () => {
    render(<Navigation>content only</Navigation>)

    expect(screen.getByText('content only')).toBeInTheDocument()
  })
})
