import { render, screen, within } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { CoordinatingSessionStatus } from './CoordinatingSessionStatus'

describe('CoordinatingSessionStatus', () => {
  it('shows that the session is working', () => {
    render(<CoordinatingSessionStatus read={CoordinatingSessionMother.workingRead()} />)

    expect(within(screen.getByRole('list')).getByText('Trabajando')).toBeInTheDocument()
  })

  it('shows the live question while the session is waiting', () => {
    render(<CoordinatingSessionStatus read={CoordinatingSessionMother.waitingRead()} />)

    expect(
      within(screen.getByRole('list')).getByText(CoordinatingSessionMother.QUESTION, { exact: false })
    ).toBeInTheDocument()
  })

  it('limits the live announcement to the current event instead of repeating the whole history', () => {
    render(<CoordinatingSessionStatus read={CoordinatingSessionMother.waitingRead()} />)

    const announced = screen.getByRole('status')
    expect(announced).toHaveTextContent(`Esperando permiso: ${CoordinatingSessionMother.QUESTION}`)
    expect(announced).not.toHaveTextContent('Sesión coordinadora iniciada')
    expect(announced).not.toHaveTextContent('Trabajando')
  })

  it('shows the session events in chronological order, with only the last one current', () => {
    render(<CoordinatingSessionStatus read={CoordinatingSessionMother.waitingRead()} />)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Sesión coordinadora iniciada')
    expect(items[1]).toHaveTextContent('Trabajando')
    expect(items[2]).toHaveTextContent('Esperando permiso')
    expect(items[0]).toHaveClass('timeline__item--past')
    expect(items[2]).toHaveClass('timeline__item--current')
  })

  it('collapses consecutive events of the same kind into one item counted', () => {
    render(<CoordinatingSessionStatus read={CoordinatingSessionMother.repeatedWaitingRead()} />)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[2]).toHaveTextContent('Esperando permiso ×3')
  })

  it('shows the range of a collapsed run and the last event detail', () => {
    render(<CoordinatingSessionStatus read={CoordinatingSessionMother.repeatedWaitingRead()} />)

    const items = screen.getAllByRole('listitem')
    expect(items[2]).toHaveTextContent('–')
    expect(items[2]).toHaveTextContent('can I delete the stale branch?')
    expect(items[2]).not.toHaveTextContent('the button should read Arrancar brainstorming, right?')
  })

  it('keeps a single event with its plain label and one timestamp', () => {
    render(<CoordinatingSessionStatus read={CoordinatingSessionMother.waitingRead()} />)

    const items = screen.getAllByRole('listitem')
    expect(items[2]).toHaveTextContent('Esperando permiso')
    expect(items[2]).not.toHaveTextContent('×')
    expect(items[2]).not.toHaveTextContent('–')
  })

  it('warns that the conversation could not be recovered, keeping the events already known', () => {
    render(<CoordinatingSessionStatus read={CoordinatingSessionMother.unresumableRead()} />)

    const said = screen.getByRole('alert')
    expect(said).toHaveTextContent('No se ha podido recuperar la conversación coordinadora')
    expect(said).toHaveTextContent('Claude Code ya no guarda esta conversación. No se ha abierto otra en su lugar.')
    expect(screen.getAllByRole('listitem')).not.toHaveLength(0)
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
