import { useEffect, useRef, useState } from 'react'
import { ImplementHistoryClient } from 'app/implement-history/client'
import { ImplementationHistoryEntry, ImplementHistoryOutcome } from 'app/implement-history/ImplementHistory.types'

type ImplementHistory =
  | { phase: 'connecting' }
  | { phase: 'read'; entries: ImplementationHistoryEntry[] }
  | { phase: 'refused'; error: string }
  | { phase: 'unreachable' }

const CONNECTING: ImplementHistory = { phase: 'connecting' }
const POLL_INTERVAL_MS = 3000

const toHistory = (outcome: ImplementHistoryOutcome, previous: ImplementHistory): ImplementHistory => {
  if (outcome.kind === 'read') return { phase: 'read', entries: outcome.entries }
  if (outcome.kind === 'not-read') return previous.phase === 'read' ? previous : { phase: 'read', entries: [] }
  if (outcome.kind === 'refused') return { phase: 'refused', error: outcome.error }
  return { phase: 'unreachable' }
}

const useImplementHistory = (issue: number, root: string, repo: string): ImplementHistory => {
  const [history, setHistory] = useState<ImplementHistory>(CONNECTING)
  const historyRef = useRef(history)
  historyRef.current = history

  useEffect(() => {
    setHistory(CONNECTING)
    historyRef.current = CONNECTING
    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      const outcome = await ImplementHistoryClient.get({ issue, root, repo })
      if (cancelled) return

      const next = toHistory(outcome, historyRef.current)
      historyRef.current = next
      setHistory(next)
      timer = window.setTimeout(poll, POLL_INTERVAL_MS)
    }

    timer = window.setTimeout(poll, 0)

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [issue, root, repo])

  return history
}

export { useImplementHistory }
export type { ImplementHistory }
