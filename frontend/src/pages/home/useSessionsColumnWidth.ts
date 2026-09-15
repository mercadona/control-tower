import { RefObject, useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'ct.sessions-column-width'
const MIN_WIDTH = 360
const CONTENT_MIN_WIDTH = 600

type SessionsColumnWidth = {
  value: number | null
  min: number
  max: number
  setValue: (width: number | null) => void
}

const readStoredWidth = (): number | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

const writeStoredWidth = (width: number | null) => {
  try {
    if (width === null) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, String(width))
  } catch {
    return
  }
}

const clampWidth = (width: number, max: number): number => Math.min(Math.max(width, MIN_WIDTH), max)

const maxFor = (columnsWidth: number): number => Math.max(MIN_WIDTH, columnsWidth - CONTENT_MIN_WIDTH)

const useSessionsColumnWidth = (columnsRef: RefObject<HTMLElement | null>): SessionsColumnWidth => {
  const [max, setMax] = useState(MIN_WIDTH)
  const [storedValue, setStoredValue] = useState<number | null>(readStoredWidth)

  useEffect(() => {
    const columns = columnsRef.current
    if (columns === null) return

    const updateMax = () => setMax(maxFor(columns.getBoundingClientRect().width))
    updateMax()

    const observer = new ResizeObserver(updateMax)
    observer.observe(columns)
    window.addEventListener('resize', updateMax)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateMax)
    }
  }, [columnsRef])

  const setValue = useCallback((width: number | null) => {
    setStoredValue(width)
    writeStoredWidth(width)
  }, [])

  const value = storedValue === null ? null : clampWidth(storedValue, max)

  return { value, min: MIN_WIDTH, max, setValue }
}

export { useSessionsColumnWidth }
export const SESSIONS_COLUMN_WIDTH_KEY = STORAGE_KEY
