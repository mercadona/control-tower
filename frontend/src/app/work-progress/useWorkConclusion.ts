import { useEffect, useState } from 'react'
import { WorkProgressClient } from './client'
import { WorkPolling } from './useWorkProgress'
import type { WorkConclusion, WorkIdentity, WorkProgressOutcome } from './WorkProgress.types'

const CHECKING: WorkConclusion = { kind: 'checking' }

class WorkConclusionReading {
  static after(previous: WorkConclusion, outcome: WorkProgressOutcome): WorkConclusion {
    if (outcome.kind === 'not-found') return { kind: 'not-found' }
    if (outcome.kind === 'unavailable') return previous
    const progress = outcome.snapshot.progress
    if (progress.phase !== 'finished') return CHECKING
    return { kind: 'finished', pullRequest: progress.pullRequest }
  }
}

export const useWorkConclusion = (identity: WorkIdentity | null): WorkConclusion => {
  const repo = identity?.repo
  const issue = identity?.issue
  const agent = identity?.agent
  const key = identity === null ? null : `${repo}:${issue}:${agent}`
  const [observed, setObserved] = useState<{ key: string | null; conclusion: WorkConclusion }>({ key: null, conclusion: CHECKING })

  useEffect(() => {
    if (repo === undefined || issue === undefined || agent === undefined) return
    const controller = new AbortController()
    let timer: number | undefined
    let previous: WorkConclusion = CHECKING
    setObserved({ key, conclusion: CHECKING })

    const poll = async () => {
      const outcome = await WorkProgressClient.get({ repo, issue, agent }, controller.signal, WorkPolling.READ_TIMEOUT_MS)
      if (controller.signal.aborted) return
      previous = WorkConclusionReading.after(previous, outcome)
      setObserved({ key, conclusion: previous })
      if (previous.kind === 'finished') return
      timer = window.setTimeout(poll, WorkPolling.INTERVAL_MS)
    }

    timer = window.setTimeout(poll, 0)
    return () => {
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [repo, issue, agent, key])

  return observed.key === key ? observed.conclusion : CHECKING
}
