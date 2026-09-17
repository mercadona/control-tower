import { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement, useRef } from 'react'
import './RowResizer.css'

const STEP_PX = 16
const PANEL_SELECTOR = '.home__session-panel'
const RESIZING_CLASS = 'home__session-panel--resizing'
const DRAGGING_CLASS = 'row-resizer--dragging'

type RowResizerProps = {
  value: number
  min: number
  max: number
  onChange: (height: number | null) => void
  label: string
}

const clamp = (height: number, min: number, max: number): number => Math.min(Math.max(height, min), max)

const RowResizer = ({ value, min, max, onChange, label }: RowResizerProps): ReactElement => {
  const draggingPointerId = useRef<number | null>(null)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingPointerId.current = event.pointerId
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.currentTarget.classList.add(DRAGGING_CLASS)
    event.currentTarget.closest(PANEL_SELECTOR)?.classList.add(RESIZING_CLASS)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingPointerId.current !== event.pointerId) return
    const panel = event.currentTarget.closest(PANEL_SELECTOR)
    if (panel === null) return
    onChange(clamp(event.clientY - panel.getBoundingClientRect().top, min, max))
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingPointerId.current !== event.pointerId) return
    draggingPointerId.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    event.currentTarget.classList.remove(DRAGGING_CLASS)
    event.currentTarget.closest(PANEL_SELECTOR)?.classList.remove(RESIZING_CLASS)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') onChange(clamp(value - STEP_PX, min, max))
    else if (event.key === 'ArrowDown') onChange(clamp(value + STEP_PX, min, max))
    else if (event.key === 'Home') onChange(min)
    else if (event.key === 'End') onChange(max)
    else if (event.key === 'Enter') onChange(null)
    else return
    event.preventDefault()
  }

  return (
    <div
      className="row-resizer"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(null)}
    />
  )
}

export { RowResizer }
export type { RowResizerProps }
