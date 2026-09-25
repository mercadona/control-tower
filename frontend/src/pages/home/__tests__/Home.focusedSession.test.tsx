import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { FakeEventSource } from './FakeEventSource'
import { FakeFitAddon, FakeTerminal } from './FakeXterm'
import { openHome } from './helpers'

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

type Answer = { status: number; body: string }
type Answering = Answer | (() => Answer)
type Backend = {
  session?: Answering
  specFreeze?: Answering
  epicGroom?: Answering
  close?: Answering
}

class Closing {
  static confirmed(): Answer {
    return {
      status: 200,
      body: JSON.stringify({
        status: 'closed', conversation: CoordinatingSessionMother.CONVERSATION, target: CoordinatingSessionMother.TARGET,
      }),
    }
  }

  static refused(): Answer {
    return { status: 400, body: '{"code":"session-not-terminated","detail":"still running"}' }
  }
}

class FocusedBackend {
  static #now(answering: Answering): Answer {
    return typeof answering === 'function' ? answering() : answering
  }

  static #responseFor(answer: Answer): Response {
    return new Response(answer.body, { status: answer.status })
  }

  static with({
    session = CoordinatingSessionMother.working,
    specFreeze = SpecFreezeMother.none(),
    epicGroom = EpicGroomMother.none(),
    close,
  }: Backend = {}) {
    const fetching = vi.fn(async (input: string | URL | Request) => {
      const path = String(input)
      const answer = (answering: Answering) => FocusedBackend.#responseFor(FocusedBackend.#now(answering))
      if (path === '/coordinating-session') return answer(session)
      if (path === '/coordinating-session/close' && close !== undefined) return answer(close)
      if (path === '/external-tools') return answer(ExternalToolsMother.allReady())
      if (path === '/spec-freeze') return answer(specFreeze)
      if (path === '/epic-groom') return answer(epicGroom)
      throw new Error(`nobody scripted ${path}`)
    })
    vi.stubGlobal('fetch', fetching)

    return fetching
  }
}

class FocusedPage {
  static async heading(): Promise<HTMLElement> {
    await screen.findByRole('navigation', { name: 'Pasos de la sesión' })

    return screen.getByRole('heading', { level: 1 })
  }

  static isFocused(): boolean {
    return screen.queryByRole('navigation', { name: 'Pasos de la sesión' }) !== null
  }
}

describe('Home while a coordinating session is live and no plan is in progress', () => {
  beforeEach(() => {
    FakeTerminal.install()
    FakeFitAddon.install()
    FakeEventSource.install()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows only the header of the step and the session, with nothing of the request view around it', async () => {
    FocusedBackend.with()

    openHome()

    expect(await FocusedPage.heading()).toHaveTextContent('Brainstorming')
    expect(screen.getByText(`${CoordinatingSessionMother.STORY} ·`, { exact: false })).toBeInTheDocument()
    expect(screen.getByText(CoordinatingSessionMother.REPO)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: CoordinatingSessionMother.SESSION.name })).toBeInTheDocument()
    expect(screen.queryByLabelText('Ticket')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Flujo del plan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Slices en vuelo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Etapas completadas' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Sesión coordinadora' })).not.toBeInTheDocument()
  })

  it.each([
    ['nothing written yet', SpecFreezeMother.none(), EpicGroomMother.none(), 'Brainstorming'],
    ['a draft spec', SpecFreezeMother.draftReady(), EpicGroomMother.draft(), 'Congelación del spec'],
    ['a frozen spec ready to groom', SpecFreezeMother.frozen(), EpicGroomMother.groomable(), 'Groom y autorización'],
    ['a frozen spec waiting for its merge', SpecFreezeMother.frozen(), EpicGroomMother.awaitingPublication(), 'Groom y autorización'],
    ['authorised work', SpecFreezeMother.frozen(), EpicGroomMother.authorised(), 'Implementación'],
  ])('names the step the gates are at, with %s', async (_, specFreeze, epicGroom, step) => {
    FocusedBackend.with({ specFreeze, epicGroom })

    openHome()

    await vi.waitFor(async () => expect(await FocusedPage.heading()).toHaveTextContent(step))
    const steps = screen.getByRole('navigation', { name: 'Pasos de la sesión' })
    expect(within(steps).getByText(step).closest('li')).toHaveAttribute('aria-current', 'step')
  })

  it('puts the freeze in a band above the session while the spec is a draft', async () => {
    FocusedBackend.with({ specFreeze: SpecFreezeMother.draftReady(), epicGroom: EpicGroomMother.draft() })

    openHome()

    const band = await screen.findByRole('region', { name: 'Puerta 1 · Congelación del spec' })
    expect(await within(band).findByRole('button', { name: 'Congelar el spec' })).toBeInTheDocument()
  })

  it('puts the groom in a band above the session while gate 2 asks for it', async () => {
    FocusedBackend.with({ specFreeze: SpecFreezeMother.frozen(), epicGroom: EpicGroomMother.groomable() })

    openHome()

    const band = await screen.findByRole('region', { name: 'Puerta 2 · El groom y la autorización' })
    expect(await within(band).findByRole('button', { name: 'Ejecutar el groom' })).toBeInTheDocument()
  })

  it('says which pull request to merge in the band while the frozen spec waits for its publication', async () => {
    FocusedBackend.with({ specFreeze: SpecFreezeMother.frozen(), epicGroom: EpicGroomMother.awaitingPublication() })

    openHome()

    const band = await screen.findByRole('region', { name: 'Puerta 2 · El groom y la autorización' })
    expect(await within(band).findByText('El spec congelado espera en un pull request: mergéalo para abrir el groom.'))
      .toBeInTheDocument()
    expect(within(band).getByRole('link', { name: `Pull request #${EpicGroomMother.PULL_REQUEST.number}` })).toHaveAttribute('href', EpicGroomMother.PULL_REQUEST.url)
    expect(within(band).queryByRole('button')).not.toBeInTheDocument()
  })

  it.each([
    ['no spec yet', SpecFreezeMother.noSpec(), EpicGroomMother.noSpec(), 'Brainstorming'],
    ['authorised work', SpecFreezeMother.frozen(), EpicGroomMother.authorised(), 'Implementación'],
  ])('shows no band when no gate asks for anything, with %s', async (_, specFreeze, epicGroom, step) => {
    FocusedBackend.with({ specFreeze, epicGroom })

    openHome()

    await vi.waitFor(async () => expect(await FocusedPage.heading()).toHaveTextContent(step))
    expect(screen.queryByRole('region', { name: /^Puerta/ })).not.toBeInTheDocument()
  })

  it('offers cancelling the session as a secondary action', async () => {
    FocusedBackend.with()

    openHome()

    const cancel = await screen.findByRole('button', { name: 'Cancelar la sesión' })
    expect(cancel).toHaveClass('button--secondary')
  })

  it('says once that the backend is unreachable when the session poll fails, and keeps the session in front', async () => {
    let reads = 0
    FocusedBackend.with({
      session: () => {
        reads += 1
        if (reads > 1) throw new TypeError('offline')
        return CoordinatingSessionMother.working()
      },
    })

    openHome()
    await FocusedPage.heading()

    await vi.waitFor(() => expect(screen.getAllByText('Sin conexión con el backend')).toHaveLength(1), { timeout: 4000 })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Brainstorming')
    expect(screen.queryByText('No se pudo comprobar el estado del plan')).not.toBeInTheDocument()
  })

  it('gives the request form back once the session is cancelled', async () => {
    let closed = false
    FocusedBackend.with({
      session: () => closed ? CoordinatingSessionMother.none() : CoordinatingSessionMother.working(),
      close: () => {
        closed = true
        return Closing.confirmed()
      },
    })

    openHome()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar la sesión' }))

    expect(await screen.findByLabelText('Ticket', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(FocusedPage.isFocused()).toBe(false)
  })

  it('says in the header why the session could not be cancelled, and keeps it in front', async () => {
    FocusedBackend.with({ close: Closing.refused() })

    openHome()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar la sesión' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo inspeccionar o terminar la sesión')
    expect(FocusedPage.isFocused()).toBe(true)
  })

})
