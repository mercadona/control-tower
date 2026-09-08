import { useEffect, useState } from 'react'
import { ImplementProgressClient } from 'app/implement-progress/client'
import { ImplementationProgressState, ImplementationStep, ImplementProgressOutcome } from 'app/implement-progress/ImplementProgress.types'

type ImplementProgress =
  | { phase: 'connecting' }
  | { phase: 'waiting' }
  | ({ phase: 'progress' } & ImplementationProgressState)
  | { phase: 'failed'; error: string }
  | { phase: 'unreachable' }

const CONNECTING: ImplementProgress = { phase: 'connecting' }
const POLL_INTERVAL_MS = 3000
const AWAITING_REVIEWER_POLL_INTERVAL_MS = 15000

const DELIVERY_STEPS: readonly ImplementationStep[] = [ImplementationStep.DELIVERED, ImplementationStep.IN_REVIEW, ImplementationStep.FIXING]

const toProgress = (outcome: ImplementProgressOutcome): ImplementProgress => {
  if (outcome.kind === 'read') return { phase: 'progress', ...outcome.state }
  if (outcome.kind === 'not-read') return { phase: 'waiting' }
  if (outcome.kind === 'refused') return { phase: 'failed', error: outcome.error }
  return { phase: 'unreachable' }
}

const isAwaitingReviewer = (progress: ImplementProgress): boolean =>
  progress.phase === 'progress' && DELIVERY_STEPS.includes(progress.step)

const isFinal = (progress: ImplementProgress): boolean => progress.phase === 'failed'

const useImplementProgress = (issue: number, root: string, repo: string): ImplementProgress => {
  const [progress, setProgress] = useState<ImplementProgress>(CONNECTING)

  useEffect(() => {
    setProgress(CONNECTING)
    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      const outcome = await ImplementProgressClient.get({ issue, root, repo })
      if (cancelled) return

      const next = toProgress(outcome)
      setProgress(next)
      if (!isFinal(next)) timer = window.setTimeout(poll, isAwaitingReviewer(next) ? AWAITING_REVIEWER_POLL_INTERVAL_MS : POLL_INTERVAL_MS)
    }

    timer = window.setTimeout(poll, 0)

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [issue, root, repo])

  return progress
}

export { useImplementProgress }
export type { ImplementProgress }
