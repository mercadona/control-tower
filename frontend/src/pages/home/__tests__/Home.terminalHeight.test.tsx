import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { ExternalToolsMother } from '__scenarios__/ExternalToolsMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { FakeEventSource } from './FakeEventSource'
import { FakeFitAddon, FakeTerminal } from './FakeXterm'
import { openHome } from './helpers'

type Answer = { status: number; body: string }

const NO_ACTIVE_PLANS: Answer = { status: 200, body: '{"plans":[]}' }
vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

const EXTERNAL_TOOLS_READY: Answer = ExternalToolsMother.allReady()
const NO_COORDINATING_SESSION: Answer = CoordinatingSessionMother.none()
const ONE_SESSION: Answer = SessionsMother.oneSession()
const COLLAPSE_KEY = 'ct.sessions-column-collapsed'
const STORAGE_KEY = 'ct.session-terminal-height'
const LABEL = 'Alto de la terminal'

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status })

const pointerEvent = (type: string, init: { clientY?: number; pointerId?: number }) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, init)
  return event
}

const mockPanelHeight = (height: number, top = 0) =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height, top } as DOMRect)

const stubFetch = () => {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === '/active-plans') return responseFor(NO_ACTIVE_PLANS)
    if (url === '/external-tools') return responseFor(EXTERNAL_TOOLS_READY)
    if (url === '/sessions') return responseFor(ONE_SESSION)
    if (url === '/coordinating-session') return responseFor(NO_COORDINATING_SESSION)
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', fetching)
  return fetching
}

const openExpandedOnceTheTerminalStreamIsOpen = async () => {
  const opened = openHome()
  await waitFor(() => expect(FakeEventSource.opened.length).toBeGreaterThan(0))

  return opened
}

describe('Home · session terminal height', () => {
  beforeEach(() => {
    localStorage.setItem(COLLAPSE_KEY, 'false')
    FakeTerminal.install()
    FakeFitAddon.install()
    FakeEventSource.install()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the terminal pane before the timeline pane inside the drawer', async () => {
    stubFetch()
    await openExpandedOnceTheTerminalStreamIsOpen()

    await screen.findByRole('tab', { name: 'zsh' })
    const panel = document.querySelector('.home__session-panel') as HTMLElement
    expect(panel.children[0]).toHaveClass('home__terminal-pane')
    expect(panel.children[2]).toHaveClass('home__timeline-pane')
  })

  it('a stored height comes back as the inline custom property', async () => {
    localStorage.setItem(STORAGE_KEY, '400')
    stubFetch()
    mockPanelHeight(800)
    await openExpandedOnceTheTerminalStreamIsOpen()

    await screen.findByRole('tab', { name: 'zsh' })
    const pane = document.querySelector('.home__terminal-pane') as HTMLElement
    await waitFor(() => expect(pane.style.getPropertyValue('--home-terminal-height')).toBe('400px'))
  })

  it('dragging the handle stores the new height', async () => {
    stubFetch()
    mockPanelHeight(800, 100)
    await openExpandedOnceTheTerminalStreamIsOpen()

    await screen.findByRole('tab', { name: 'zsh' })
    const separator = screen.getByRole('separator', { name: LABEL })

    fireEvent(separator, pointerEvent('pointerdown', { pointerId: 1, clientY: 500 }))
    fireEvent(separator, pointerEvent('pointermove', { pointerId: 1, clientY: 500 }))

    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('400'))
    const pane = document.querySelector('.home__terminal-pane') as HTMLElement
    expect(pane.style.getPropertyValue('--home-terminal-height')).toBe('400px')
  })

  it('a reset clears the stored value and returns to the default height', async () => {
    localStorage.setItem(STORAGE_KEY, '400')
    stubFetch()
    mockPanelHeight(800)
    await openExpandedOnceTheTerminalStreamIsOpen()

    await screen.findByRole('tab', { name: 'zsh' })
    const separator = screen.getByRole('separator', { name: LABEL })
    fireEvent.keyDown(separator, { key: 'Enter' })

    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeNull())
    const pane = document.querySelector('.home__terminal-pane') as HTMLElement
    expect(pane.style.getPropertyValue('--home-terminal-height')).toBe('320px')
  })

  it('the maximum leaves the timeline pane its reserve', async () => {
    stubFetch()
    mockPanelHeight(500)
    await openExpandedOnceTheTerminalStreamIsOpen()

    await screen.findByRole('tab', { name: 'zsh' })
    await waitFor(() => expect(screen.getByRole('separator', { name: LABEL })).toHaveAttribute('aria-valuemax', '340'))
  })
})
