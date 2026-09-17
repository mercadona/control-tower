import { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { RowResizer } from './RowResizer'

const LABEL = 'Alto de la terminal'

const pointerEvent = (type: string, init: { clientY?: number; pointerId?: number }) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, init)
  return event
}

const renderInPanel = (props: Partial<ComponentProps<typeof RowResizer>> = {}) => {
  const onChange = vi.fn()
  const { container } = render(
    <div className="home__session-panel">
      <div />
      <RowResizer value={320} min={160} max={480} onChange={onChange} label={LABEL} {...props} />
      <div />
    </div>,
  )
  return { onChange, container }
}

const mockPanelTopEdge = (container: HTMLElement, top: number) =>
  vi.spyOn(container.querySelector('.home__session-panel') as HTMLElement, 'getBoundingClientRect')
    .mockReturnValue({ top } as DOMRect)

describe('RowResizer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders as a horizontal separator with the accessible label and current bounds', () => {
    renderInPanel({ value: 320, min: 160, max: 480 })

    const separator = screen.getByRole('separator', { name: LABEL })
    expect(separator).toHaveAttribute('aria-orientation', 'horizontal')
    expect(separator).toHaveAttribute('aria-valuemin', '160')
    expect(separator).toHaveAttribute('aria-valuemax', '480')
    expect(separator).toHaveAttribute('aria-valuenow', '320')
  })

  it('dragging the handle posts the height measured from the panel top edge', () => {
    const { onChange, container } = renderInPanel({ value: 320, min: 160, max: 480 })
    mockPanelTopEdge(container, 100)
    const separator = screen.getByRole('separator', { name: LABEL })

    fireEvent(separator, pointerEvent('pointerdown', { pointerId: 1, clientY: 500 }))
    fireEvent(separator, pointerEvent('pointermove', { pointerId: 1, clientY: 500 }))

    expect(onChange).toHaveBeenCalledWith(400)
  })

  it('clamps a drag past the minimum to the minimum', () => {
    const { onChange, container } = renderInPanel({ value: 320, min: 160, max: 480 })
    mockPanelTopEdge(container, 100)
    const separator = screen.getByRole('separator', { name: LABEL })

    fireEvent(separator, pointerEvent('pointerdown', { pointerId: 1, clientY: 500 }))
    fireEvent(separator, pointerEvent('pointermove', { pointerId: 1, clientY: 150 }))

    expect(onChange).toHaveBeenCalledWith(160)
  })

  it('clamps a drag past the maximum to the maximum', () => {
    const { onChange, container } = renderInPanel({ value: 320, min: 160, max: 480 })
    mockPanelTopEdge(container, 100)
    const separator = screen.getByRole('separator', { name: LABEL })

    fireEvent(separator, pointerEvent('pointerdown', { pointerId: 1, clientY: 500 }))
    fireEvent(separator, pointerEvent('pointermove', { pointerId: 1, clientY: 900 }))

    expect(onChange).toHaveBeenCalledWith(480)
  })

  it('ignores a pointermove from a pointer that never pressed down on the handle', () => {
    const { onChange, container } = renderInPanel({ value: 320 })
    mockPanelTopEdge(container, 100)
    const separator = screen.getByRole('separator', { name: LABEL })

    fireEvent(separator, pointerEvent('pointermove', { pointerId: 1, clientY: 500 }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('a pointerup ends the drag, so a later pointermove changes nothing', () => {
    const { onChange, container } = renderInPanel({ value: 320 })
    mockPanelTopEdge(container, 100)
    const separator = screen.getByRole('separator', { name: LABEL })

    fireEvent(separator, pointerEvent('pointerdown', { pointerId: 1, clientY: 500 }))
    fireEvent(separator, pointerEvent('pointerup', { pointerId: 1, clientY: 500 }))
    onChange.mockClear()
    fireEvent(separator, pointerEvent('pointermove', { pointerId: 1, clientY: 700 }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('ArrowUp decreases the height by 16px', () => {
    const { onChange } = renderInPanel({ value: 320, min: 160, max: 480 })

    fireEvent.keyDown(screen.getByRole('separator', { name: LABEL }), { key: 'ArrowUp' })

    expect(onChange).toHaveBeenCalledWith(304)
  })

  it('ArrowDown increases the height by 16px', () => {
    const { onChange } = renderInPanel({ value: 320, min: 160, max: 480 })

    fireEvent.keyDown(screen.getByRole('separator', { name: LABEL }), { key: 'ArrowDown' })

    expect(onChange).toHaveBeenCalledWith(336)
  })

  it('Home sets the minimum height', () => {
    const { onChange } = renderInPanel({ value: 320, min: 160, max: 480 })

    fireEvent.keyDown(screen.getByRole('separator', { name: LABEL }), { key: 'Home' })

    expect(onChange).toHaveBeenCalledWith(160)
  })

  it('End sets the maximum height', () => {
    const { onChange } = renderInPanel({ value: 320, min: 160, max: 480 })

    fireEvent.keyDown(screen.getByRole('separator', { name: LABEL }), { key: 'End' })

    expect(onChange).toHaveBeenCalledWith(480)
  })

  it('Enter resets to the default height', () => {
    const { onChange } = renderInPanel({ value: 320 })

    fireEvent.keyDown(screen.getByRole('separator', { name: LABEL }), { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('a double click resets to the default height', () => {
    const { onChange } = renderInPanel({ value: 320 })

    fireEvent.doubleClick(screen.getByRole('separator', { name: LABEL }))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('an unrelated key is ignored', () => {
    const { onChange } = renderInPanel({ value: 320 })

    fireEvent.keyDown(screen.getByRole('separator', { name: LABEL }), { key: 'Tab' })

    expect(onChange).not.toHaveBeenCalled()
  })
})
