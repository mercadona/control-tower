import { screen } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { openHome } from './helpers'

type Answer = { status: number; body: string }

class ImplementationBackend {
  static with({ session = CoordinatingSessionMother.none }: { session?: () => Answer } = {}) {
    const fetching = vi.fn(async (input: string | URL | Request) => {
      const path = String(input)
      const respond = (answer: Answer) => new Response(answer.body, { status: answer.status })
      if (path === '/coordinating-session') return respond(session())
      if (path === '/external-tools') return respond(ExternalToolsMother.allReady())
      if (path === '/spec-freeze') return respond(SpecFreezeMother.none())
      if (path === '/epic-groom') return respond(EpicGroomMother.none())
      throw new Error(`nobody scripted ${path}`)
    })
    vi.stubGlobal('fetch', fetching)

    return fetching
  }
}

describe('Home is the start form with no session held, and the focused view for every held session', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('with no session held the page shows only the start form', async () => {
    ImplementationBackend.with()

    openHome()

    expect(await screen.findByLabelText('Ticket')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Pasos de la sesión' })).not.toBeInTheDocument()
  })

  it('an ended session keeps the page in the focused view', async () => {
    ImplementationBackend.with({ session: CoordinatingSessionMother.ended })

    openHome()

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Brainstorming')
  })
})
