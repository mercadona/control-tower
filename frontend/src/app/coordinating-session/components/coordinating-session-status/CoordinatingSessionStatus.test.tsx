import { render, screen } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { CoordinatingSessionStatus } from './CoordinatingSessionStatus'

const answerWith = (answer: { status: number; body: string }) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))

describe('CoordinatingSessionStatus', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows that the session is working', async () => {
    answerWith(CoordinatingSessionMother.working())

    render(<CoordinatingSessionStatus />)

    expect(await screen.findByText('Trabajando')).toBeInTheDocument()
  })

  it('shows the live question while the session is waiting', async () => {
    answerWith(CoordinatingSessionMother.waiting())

    render(<CoordinatingSessionStatus />)

    expect(await screen.findByText(CoordinatingSessionMother.QUESTION, { exact: false })).toBeInTheDocument()
  })

  it('warns that the conversation could not be recovered', async () => {
    answerWith(CoordinatingSessionMother.unresumable())

    render(<CoordinatingSessionStatus />)

    const said = await screen.findByRole('alert')
    expect(said).toHaveTextContent('No se ha podido recuperar la conversación coordinadora')
    expect(said).toHaveTextContent('Claude Code ya no guarda esta conversación. No se ha abierto otra en su lugar.')
  })
})
