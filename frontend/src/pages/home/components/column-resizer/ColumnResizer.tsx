import { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement, useRef } from 'react'
import './ColumnResizer.css'

const STEP_PX = 16
const COLUMNS_SELECTOR = '.home__columns'
const RESIZING_CLASS = 'home__columns--resizing'
const DRAGGING_CLASS = 'column-resizer--dragging'

type ColumnResizerProps = {
  value: number | null
  min: number
  max: number
  onChange: (width: number | null) => void
  label: string
  disabled?: boolean
}

const clamp = (width: number, min: number, max: number): number => Math.min(Math.max(width, min), max)

const ColumnResizer = ({ value, min, max, onChange, label, disabled = false }: ColumnResizerProps): ReactElement => {
  const draggingPointerId = useRef<number | null>(null)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return
    draggingPointerId.current = event.pointerId
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.currentTarget.classList.add(DRAGGING_CLASS)
    event.currentTarget.closest(COLUMNS_SELECTOR)?.classList.add(RESIZING_CLASS)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingPointerId.current !== event.pointerId) return
    const columns = event.currentTarget.closest(COLUMNS_SELECTOR)
    if (columns === null) return
    onChange(clamp(columns.getBoundingClientRect().right - event.clientX, min, max))
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingPointerId.current !== event.pointerId) return
    draggingPointerId.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    event.currentTarget.classList.remove(DRAGGING_CLASS)
    event.currentTarget.closest(COLUMNS_SELECTOR)?.classList.remove(RESIZING_CLASS)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const current = value ?? max
    if (event.key === 'ArrowLeft') onChange(clamp(current + STEP_PX, min, max))
    else if (event.key === 'ArrowRight') onChange(clamp(current - STEP_PX, min, max))
    else if (event.key === 'Home') onChange(min)
    else if (event.key === 'End') onChange(max)
    else if (event.key === 'Enter') onChange(null)
    else return
    event.preventDefault()
  }

  return (
    <div
      className="column-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value ?? max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        if (disabled) return
        onChange(null)
      }}
    />
  )
}

export { ColumnResizer }
export type { ColumnResizerProps }
