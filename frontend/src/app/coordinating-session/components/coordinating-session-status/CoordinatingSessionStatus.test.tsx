import { render, screen } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { CoordinatingSessionStatus } from './CoordinatingSessionStatus'

describe('CoordinatingSessionStatus', () => {
  it('shows that the session is working', () => {
    render(<CoordinatingSessionStatus read={CoordinatingSessionMother.workingRead()} />)

    expect(screen.getByText('Trabajando')).toBeInTheDocument()
  })

  it('shows the live question while the session is waiting', () => {
    render(<CoordinatingSessionStatus read={CoordinatingSessionMother.waitingRead()} />)

    expect(screen.getByText(CoordinatingSessionMother.QUESTION, { exact: false })).toBeInTheDocument()
  })

  it('warns that the conversation could not be recovered', () => {
    render(<CoordinatingSessionStatus read={CoordinatingSessionMother.unresumableRead()} />)

    const said = screen.getByRole('alert')
    expect(said).toHaveTextContent('No se ha podido recuperar la conversación coordinadora')
    expect(said).toHaveTextContent('Claude Code ya no guarda esta conversación. No se ha abierto otra en su lugar.')
  })

  it('warns that the conversation has ended', () => {
    render(<CoordinatingSessionStatus read={CoordinatingSessionMother.endedRead()} />)

    const said = screen.getByRole('alert')
    expect(said).toHaveTextContent('La conversación coordinadora ha terminado')
    expect(said).toHaveTextContent('Su terminal se ha cerrado. No se ha abierto otra en su lugar.')
  })

  it('says nothing while no conversation is held', () => {
    const { container } = render(<CoordinatingSessionStatus read={CoordinatingSessionMother.nothingRead()} />)

    expect(container).toBeEmptyDOMElement()
  })
})
