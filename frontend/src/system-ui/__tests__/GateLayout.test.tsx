import { render, screen } from '@testing-library/react'
import { GateLayout, GateLink, GateList, GateListItem, GateNotice } from 'system-ui/gate-layout'

describe('GateLayout', () => {
  it('should put the heading and its content in the body and the actions beside them', () => {
    render(
      <GateLayout heading="Heading" actions={<button type="button">Act</button>}>
        <GateNotice>Notice</GateNotice>
      </GateLayout>,
    )

    const body = screen.getByText('Heading').parentElement
    expect(body).toHaveClass('gate-layout__body')
    expect(body).toContainElement(screen.getByText('Notice'))
    expect(screen.getByRole('button', { name: 'Act' }).parentElement).toHaveClass('gate-layout__actions')
  })

  it('should leave out the actions column when there is nothing to press', () => {
    const { container } = render(<GateLayout heading="Heading" />)

    expect(container.querySelector('.gate-layout__actions')).toBeNull()
  })

  it('should list its items and link where it is told', () => {
    render(
      <GateList>
        <GateListItem>First</GateListItem>
        <GateListItem>
          <GateLink href="https://example.com/pull/1">Pull request #1</GateLink>
        </GateListItem>
      </GateList>,
    )

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['First', 'Pull request #1'])
    expect(screen.getByRole('link', { name: 'Pull request #1' })).toHaveAttribute('href', 'https://example.com/pull/1')
  })
})
