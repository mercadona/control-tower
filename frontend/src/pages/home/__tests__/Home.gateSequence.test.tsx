import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { openHome } from './helpers'

type Answer = { status: number; body: string }

const GATE_1_HEADING = 'Puerta 1 · Congelación del spec'
const GATE_2_HEADING = 'Puerta 2 · El groom y la autorización'
const GROOM_BUTTON = { name: 'Ejecutar el groom' }
const NO_ACTIVE_PLANS: Answer = { status: 200, body: '{"plans":[]}' }
const IMPLEMENTATION_PROGRESS_NOT_READ: Answer = {
  status: 400,
  body: '{"code":"implementation-progress-not-read","detail":"the worktree is not there yet"}',
}
const IMPLEMENTATION_HISTORY_NOT_READ: Answer = {
  status: 400,
  body: '{"code":"implementation-history-not-read","detail":"the worktree is not there yet"}',
}

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status })

const gateToggle = (heading: string) => {
  const card = screen.getByRole('heading', { name: heading }).closest('.collapsable-card')
  if (card === null) throw new Error(`no card found for heading ${heading}`)
  return within(card as HTMLElement).getByRole('button', { name: /^(Expandir|Colapsar)$/ })
}

const stubGates = (specFreeze: Answer, epicGroom: Answer) => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    const path = String(input)
    if (path === '/spec-freeze') return responseFor(specFreeze)
    if (path === '/epic-groom') return responseFor(epicGroom)
    if (path === '/active-plans') return responseFor(NO_ACTIVE_PLANS)
    if (path === '/external-tools') return responseFor(ExternalToolsMother.allReady())
    if (path === '/sessions') return responseFor(SessionsMother.noSessions())
    if (path === '/coordinating-session') return responseFor(CoordinatingSessionMother.none())
    if (path.startsWith('/implement-progress/')) return responseFor(IMPLEMENTATION_PROGRESS_NOT_READ)
    if (path.startsWith('/implement-history/')) return responseFor(IMPLEMENTATION_HISTORY_NOT_READ)
    throw new Error(`unexpected fetch to ${path}`)
  })
  vi.stubGlobal('fetch', fetching)
  return fetching
}

describe('Home and the gate sequence', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders a frozen gate 1 collapsed and a groomable gate 2 expanded', async () => {
    stubGates(SpecFreezeMother.frozen(), EpicGroomMother.groomable())
    openHome()

    await screen.findByRole('heading', { name: GATE_1_HEADING })
    const gate1Toggle = gateToggle(GATE_1_HEADING)
    expect(gate1Toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(`Completada el ${SpecFreezeMother.ON} · Pull request #${SpecFreezeMother.PULL_REQUEST.number}`))
      .toBeInTheDocument()

    const gate2Toggle = gateToggle(GATE_2_HEADING)
    expect(gate2Toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('button', GROOM_BUTTON)).toBeEnabled()
  })

  it('opening gate 1 reveals its date and pull request without collapsing or disabling gate 2', async () => {
    const user = userEvent.setup()
    stubGates(SpecFreezeMother.frozen(), EpicGroomMother.groomable())
    openHome()
    await screen.findByRole('button', GROOM_BUTTON)

    await user.click(gateToggle(GATE_1_HEADING))

    expect(screen.getByText(`Spec congelado el ${SpecFreezeMother.ON}.`)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: `Pull request #${SpecFreezeMother.PULL_REQUEST.number}` }))
      .toHaveAttribute('href', SpecFreezeMother.PULL_REQUEST.url)
    expect(screen.getByRole('button', GROOM_BUTTON)).toBeEnabled()
    expect(gateToggle(GATE_2_HEADING)).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not claim gate 2 is actionable while publication is still awaiting the merge', async () => {
    stubGates(SpecFreezeMother.frozen(), EpicGroomMother.awaitingPublication())
    openHome()

    await screen.findByText('El groom espera al merge de este pull request.')
    expect(screen.queryByRole('heading', { name: GATE_2_HEADING })).not.toBeInTheDocument()
  })

  it('collapses an authorised gate 2 by default and lets it be reopened', async () => {
    const user = userEvent.setup()
    stubGates(SpecFreezeMother.frozen(), EpicGroomMother.authorised())
    openHome()

    await screen.findByRole('heading', { name: GATE_2_HEADING })
    const gate2Toggle = gateToggle(GATE_2_HEADING)
    expect(gate2Toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: GATE_2_HEADING })).not.toBeInTheDocument()

    await user.click(gate2Toggle)

    expect(gate2Toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Trabajo autorizado: el loop ya puede despachar el primer slice.')).toBeInTheDocument()
  })

  it('exposes disclosure aria attributes wired to the content region and supports keyboard activation', async () => {
    const user = userEvent.setup()
    stubGates(SpecFreezeMother.draftReady(), EpicGroomMother.none())
    openHome()
    await screen.findByRole('heading', { name: GATE_1_HEADING })

    const toggle = gateToggle(GATE_1_HEADING)
    const contentId = toggle.getAttribute('aria-controls')
    expect(contentId).not.toBeNull()
    const content = document.getElementById(contentId ?? '')
    expect(content).toHaveAttribute('role', 'region')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    toggle.focus()
    await user.keyboard('{Enter}')

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('starts blocked and error gate states expanded by default', async () => {
    stubGates(SpecFreezeMother.none(), EpicGroomMother.issuesUncertain())
    openHome()

    await screen.findByRole('heading', { name: GATE_2_HEADING })
    expect(gateToggle(GATE_2_HEADING)).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('alert')).toHaveTextContent(EpicGroomMother.ISSUES_UNCERTAIN_REASON)
  })

  it('reaches gate 2 primary action without gate 1 detail taking up the layout', async () => {
    stubGates(SpecFreezeMother.frozen(), EpicGroomMother.groomable())
    openHome()

    const gate1Heading = await screen.findByRole('heading', { name: GATE_1_HEADING })
    const gate1Card = gate1Heading.closest('.collapsable-card')
    expect(gate1Card?.querySelector('.collapsable-card__content-wrap')).not.toHaveClass(
      'collapsable-card__content-wrap--open',
    )
    expect(await screen.findByRole('button', GROOM_BUTTON)).toBeEnabled()
  })
})
