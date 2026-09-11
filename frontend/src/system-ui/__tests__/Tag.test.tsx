import { render, screen } from '@testing-library/react'
import { Tag } from 'system-ui/tag'

describe('Tag', () => {
  it('should default to the neutral variant', () => {
    render(<Tag>Neutral</Tag>)

    expect(screen.getByText('Neutral')).toHaveClass('tag--neutral')
  })

  it('should wear the class of the variant it is given', () => {
    render(<Tag variant="danger">Danger</Tag>)

    expect(screen.getByText('Danger')).toHaveClass('tag--danger')
  })

  it('should keep its label in the uppercase caption style the system prescribes', () => {
    render(<Tag variant="success">Success</Tag>)

    expect(screen.getByText('Success')).toHaveClass('lg-caption1-medium-upp')
  })
})
