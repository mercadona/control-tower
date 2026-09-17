import { RefObject, useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'ct.session-terminal-height'
const DEFAULT_HEIGHT = 320
const MIN_HEIGHT = 160
const TIMELINE_MIN_RESERVE = 160

type SessionTerminalHeight = {
  value: number
  min: number
  max: number
  setValue: (height: number | null) => void
}

const readStoredHeight = (): number | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

const writeStoredHeight = (height: number | null) => {
  try {
    if (height === null) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, String(height))
  } catch {
    return
  }
}

const clampHeight = (height: number, max: number): number => Math.min(Math.max(height, MIN_HEIGHT), max)

const maxFor = (panelHeight: number): number => Math.max(MIN_HEIGHT, panelHeight - TIMELINE_MIN_RESERVE)

const useSessionTerminalHeight = (panelRef: RefObject<HTMLElement | null>): SessionTerminalHeight => {
  const [max, setMax] = useState<number | null>(null)
  const [storedHeight, setStoredHeight] = useState<number | null>(readStoredHeight)

  useEffect(() => {
    const panel = panelRef.current
    if (panel === null) return

    const updateMax = () => setMax(maxFor(panel.getBoundingClientRect().height))
    updateMax()

    const observer = new ResizeObserver(updateMax)
    observer.observe(panel)
    window.addEventListener('resize', updateMax)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateMax)
    }
  }, [panelRef])

  const setValue = useCallback((height: number | null) => {
    setStoredHeight(height)
    writeStoredHeight(height)
  }, [])

  const requested = storedHeight ?? DEFAULT_HEIGHT
  const value = max === null ? requested : clampHeight(requested, max)

  return { value, min: MIN_HEIGHT, max: max ?? requested, setValue }
}

export { useSessionTerminalHeight }
export const SESSION_TERMINAL_HEIGHT_KEY = STORAGE_KEY
