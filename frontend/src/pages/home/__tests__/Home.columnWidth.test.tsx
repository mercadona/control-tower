import { fireEvent, screen, waitFor } from '@testing-library/react'
import { openHome } from './helpers'

const STORAGE_KEY = 'ct.sessions-column-width'
const LABEL = 'Ancho del panel de sesiones'

const pointerEvent = (type: string, init: { clientX?: number; pointerId?: number }) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, init)
  return event
}

const mockColumnsWidth = (width: number) =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width, right: width } as DOMRect)

describe('Home · sessions column width', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('the separator sits between the work area and the right column', async () => {
    mockColumnsWidth(1200)
    openHome()

    await screen.findByRole('navigation', { name: 'Navegación principal' })
    const separator = screen.getByRole('separator', { name: LABEL })

    expect(separator.nextElementSibling).toHaveClass('home__side')
  })

  it('a stored width is restored and applied as the inline custom property', async () => {
    mockColumnsWidth(1200)
    localStorage.setItem(STORAGE_KEY, '500')

    openHome()

    await screen.findByRole('navigation', { name: 'Navegación principal' })
    const columns = document.querySelector('.home__columns') as HTMLElement
    await waitFor(() => expect(columns.style.getPropertyValue('--home-sessions-width')).toBe('500px'))
  })

  it('dragging the handle stores the new width', async () => {
    mockColumnsWidth(1200)
    openHome()

    await screen.findByRole('navigation', { name: 'Navegación principal' })
    const separator = screen.getByRole('separator', { name: LABEL })

    fireEvent(separator, pointerEvent('pointerdown', { pointerId: 1, clientX: 800 }))
    fireEvent(separator, pointerEvent('pointermove', { pointerId: 1, clientX: 800 }))

    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('400'))
    const columns = document.querySelector('.home__columns') as HTMLElement
    expect(columns.style.getPropertyValue('--home-sessions-width')).toBe('400px')
  })

  it('a reset removes the inline width and the stored value', async () => {
    mockColumnsWidth(1200)
    localStorage.setItem(STORAGE_KEY, '500')
    openHome()

    await screen.findByRole('navigation', { name: 'Navegación principal' })
    const separator = screen.getByRole('separator', { name: LABEL })
    fireEvent.keyDown(separator, { key: 'Enter' })

    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeNull())
    const columns = document.querySelector('.home__columns') as HTMLElement
    expect(columns.style.getPropertyValue('--home-sessions-width')).toBe('')
  })
})
