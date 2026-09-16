import { useCallback, useState } from 'react'

const STORAGE_KEY = 'ct.sessions-column-collapsed'

type SessionsColumnCollapse = {
  collapsed: boolean
  toggle: () => void
  open: () => void
}

const readStoredCollapsed = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

const writeStoredCollapsed = (collapsed: boolean) => {
  try {
    localStorage.setItem(STORAGE_KEY, String(collapsed))
  } catch {
    return
  }
}

const useSessionsColumnCollapse = (): SessionsColumnCollapse => {
  const [collapsed, setCollapsed] = useState<boolean>(readStoredCollapsed)

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current
      writeStoredCollapsed(next)
      return next
    })
  }, [])

  const open = useCallback(() => {
    setCollapsed((current) => {
      if (!current) return current
      writeStoredCollapsed(false)
      return false
    })
  }, [])

  return { collapsed, toggle, open }
}

export { useSessionsColumnCollapse }
export const SESSIONS_COLUMN_COLLAPSE_KEY = STORAGE_KEY
