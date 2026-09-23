import { useEffect, useState } from 'react'
import { PlanningProgressClient } from 'app/planning-progress/client'
import { PlanningActivity, PlanningActivityState, PlanningProgressOutcome } from 'app/planning-progress/PlanningProgress.types'

type PlanningProgressRead =
  | { phase: 'connecting' }
  | { phase: 'waiting' }
  | ({ phase: 'activity' } & PlanningActivity)
  | { phase: 'not-watched' }
  | { phase: 'failed'; error: string }
  | { phase: 'unreachable' }

const CONNECTING: PlanningProgressRead = { phase: 'connecting' }
const POLL_INTERVAL_MS = 3000

const toProgress = (outcome: PlanningProgressOutcome): PlanningProgressRead => {
  if (outcome.kind === 'read') return { phase: 'activity', ...outcome.activity }
  if (outcome.kind === 'not-read') return { phase: 'waiting' }
  if (outcome.kind === 'not-watched') return { phase: 'not-watched' }
  if (outcome.kind === 'refused') return { phase: 'failed', error: outcome.error }
  return { phase: 'unreachable' }
}

const isFinal = (progress: PlanningProgressRead): boolean =>
  progress.phase === 'not-watched' ||
  progress.phase === 'failed' ||
  progress.phase === 'unreachable' ||
  (progress.phase === 'activity' && progress.state === PlanningActivityState.FINISHED)

const usePlanningProgress = (issue: number, repo: string): PlanningProgressRead => {
  const [progress, setProgress] = useState<PlanningProgressRead>(CONNECTING)

  useEffect(() => {
    setProgress(CONNECTING)
    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      const outcome = await PlanningProgressClient.get({ issue, repo })
      if (cancelled) return

      const next = toProgress(outcome)
      setProgress(next)
      if (!isFinal(next)) timer = window.setTimeout(poll, POLL_INTERVAL_MS)
    }

    timer = window.setTimeout(poll, 0)

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [issue, repo])

  return progress
}

export { usePlanningProgress }
export type { PlanningProgressRead }
