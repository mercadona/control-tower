import { useEffect, useState } from 'react'
import { PlanEventsClient } from 'app/plan-events/client'

type PlanProgress =
  | { phase: 'connecting' }
  | { phase: 'writing' }
  | { phase: 'ready' }
  | { phase: 'failed'; code: string; detail: string }
  | { phase: 'refused' }
  | { phase: 'unreachable' }

const CONNECTING: PlanProgress = { phase: 'connecting' }

const usePlanProgress = (issue: number, repo: string, enabled = true): PlanProgress => {
  const [progress, setProgress] = useState<PlanProgress>(CONNECTING)

  useEffect(() => {
    if (!enabled) return
    setProgress(CONNECTING)
    let close: (() => void) | undefined
    const connection = window.setTimeout(() => {
      close = PlanEventsClient.watch(issue, repo, {
        onState: (state) => setProgress({ phase: state }),
        onFailure: (failure) => setProgress({ phase: 'failed', code: failure.code, detail: failure.detail }),
        onRefused: () => setProgress({ phase: 'refused' }),
        onUnreachable: () => setProgress({ phase: 'unreachable' }),
      }).close
    })

    return () => {
      window.clearTimeout(connection)
      close?.()
    }
  }, [enabled, issue, repo])

  return progress
}

export { usePlanProgress }
export type { PlanProgress }
