import { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ColumnResizer } from './ColumnResizer'

const LABEL = 'Ancho del panel de sesiones'

const pointerEvent = (type: string, init: { clientX?: number; pointerId?: number }) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, init)
  return event
}

const renderInColumns = (props: Partial<ComponentProps<typeof ColumnResizer>> = {}) => {
  const onChange = vi.fn()
  const { container } = render(
    <div className="home__columns">
      <main />
      <ColumnResizer value={500} min={360} max={680} onChange={onChange} label={LABEL} {...props} />
      <div className="home__side" />
    </div>,
  )
  return { onChange, container }
}

const mockColumnsRightEdge = (container: HTMLElement, right: number) =>
  vi.spyOn(container.querySelector('.home__columns') as HTMLElement, 'getBoundingClientRect')
    .mockReturnValue({ right } as DOMRect)

describe('ColumnResizer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders as a vertical separator with the accessible label and current bounds', () => {
    renderInColumns({ value: 500, min: 360, max: 680 })

    const separator = screen.getByRole('separator', { name: LABEL })
    expect(separator).toHaveAttribute('aria-orientation', 'vertical')
    expect(separator).toHaveAttribute('aria-valuemin', '360')
    expect(separator).toHaveAttribute('aria-valuemax', '680')
    expect(separator).toHaveAttribute('aria-valuenow', '500')
  })

  it('with no chosen width the accessible value falls back to the maximum', () => {
    renderInColumns({ value: null, min: 360, max: 680 })

    expect(screen.getByRole('separator', { name: LABEL })).toHaveAttribute('aria-valuenow', '680')
  })

  it('dragging the handle posts the width computed from the columns right edge', () => {
    const { onChange, container } = renderInColumns({ value: 500, min: 360, max: 680 })
    mockColumnsRightEdge(container, 1200)
    const separator = screen.getByRole('separator', { name: LABEL })

    fireEvent(separator, pointerEvent('pointerdown', { pointerId: 1, clientX: 800 }))
    fireEvent(separator, pointerEvent('pointermove', { pointerId: 1, clientX: 800 }))

    expect(onChange).toHaveBeenCalledWith(400)
  })

  it('clamps a drag past the minimum to the minimum', () => {
    const { onChange, container } = renderInColumns({ value: 500, min: 360, max: 680 })
    mockColumnsRightEdge(container, 1200)
    const separator = screen.getByRole('separator', { name: LABEL })

    fireEvent(separator, pointerEvent('pointerdown', { pointerId: 1, clientX: 800 }))
    fireEvent(separator, pointerEvent('pointermove', { pointerId: 1, clientX: 999 }))

    expect(onChange).toHaveBeenCalledWith(360)
  })

  it('clamps a drag past the maximum to the maximum', () => {
    const { onChange, container } = renderInColumns({ value: 500, min: 360, max: 680 })
    mockColumnsRightEdge(container, 1200)
    const separator = screen.getByRole('separator', { name: LABEL })

    fireEvent(separator, pointerEvent('pointerdown', { pointerId: 1, clientX: 800 }))
    fireEvent(separator, pointerEvent('pointermove', { pointerId: 1, clientX: 100 }))

    expect(onChange).toHaveBeenCalledWith(680)
  })

  it('ignores a pointermove from a pointer that never pressed down on the handle', () => {
    const { onChange, container } = renderInColumns({ value: 500 })
    mockColumnsRightEdge(container, 1200)
    const separator = screen.getByRole('separator', { name: LABEL })

    fireEvent(separator, pointerEvent('pointermove', { pointerId: 1, clientX: 800 }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('a pointerup ends the drag, so a later pointermove changes nothing', () => {
    const { onChange, container } = renderInColumns({ value: 500 })
    mockColumnsRightEdge(container, 1200)
    const separator = screen.getByRole('separator', { name: LABEL })

    fireEvent(separator, pointerEvent('pointerdown', { pointerId: 1, clientX: 800 }))
    fireEvent(separator, pointerEvent('pointerup', { pointerId: 1, clientX: 800 }))
    onChange.mockClear()
    fireEvent(separator, pointerEvent('pointermove', { pointerId: 1, clientX: 700 }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('ArrowLeft widens the column by 16px', () => {
    const { onChange } = renderInColumns({ value: 500, min: 360, max: 680 })

    fireEvent.keyDown(screen.getByRole('separator', { name: LABEL }), { key: 'ArrowLeft' })

    expect(onChange).toHaveBeenCalledWith(516)
  })

  it('ArrowRight narrows the column by 16px', () => {
    const { onChange } = renderInColumns({ value: 500, min: 360, max: 680 })

    fireEvent.keyDown(screen.getByRole('separator', { name: LABEL }), { key: 'ArrowRight' })

    expect(onChange).toHaveBeenCalledWith(484)
  })

  it('Home sets the minimum width', () => {
    const { onChange } = renderInColumns({ value: 500, min: 360, max: 680 })

    fireEvent.keyDown(screen.getByRole('separator', { name: LABEL }), { key: 'Home' })

    expect(onChange).toHaveBeenCalledWith(360)
  })

  it('End sets the maximum width', () => {
    const { onChange } = renderInColumns({ value: 500, min: 360, max: 680 })

    fireEvent.keyDown(screen.getByRole('separator', { name: LABEL }), { key: 'End' })

    expect(onChange).toHaveBeenCalledWith(680)
  })

  it('Enter resets to the default width', () => {
    const { onChange } = renderInColumns({ value: 500 })

    fireEvent.keyDown(screen.getByRole('separator', { name: LABEL }), { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('a double click resets to the default width', () => {
    const { onChange } = renderInColumns({ value: 500 })

    fireEvent.doubleClick(screen.getByRole('separator', { name: LABEL }))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('an unrelated key is ignored', () => {
    const { onChange } = renderInColumns({ value: 500 })

    fireEvent.keyDown(screen.getByRole('separator', { name: LABEL }), { key: 'Tab' })

    expect(onChange).not.toHaveBeenCalled()
  })
})
