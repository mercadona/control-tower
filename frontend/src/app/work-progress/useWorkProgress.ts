import { useEffect, useMemo, useRef, useState } from 'react'
import { WorkProgressClient } from './client'
import type { WorkIdentity, WorkProgress, WorkProgressRead } from './WorkProgress.types'

const CONNECTING: WorkProgressRead = { kind: 'connecting' }
const POLL_INTERVAL_MS = 3000
const REVIEW_INTERVAL_MS = 15000
const READ_TIMEOUT_MS = 10000

class WorkPolling {
  static paused(read: WorkProgressRead): WorkProgressRead {
    return read.kind === 'read'
      ? { kind: 'stale', snapshot: read.snapshot, detail: 'El inventario del trabajo no está confirmado.' }
      : read
  }

  static next(read: WorkProgressRead): number {
    if (read.kind !== 'read' || read.snapshot.progress.phase !== 'implementing') return POLL_INTERVAL_MS
    const execution = read.snapshot.progress.execution
    if (execution.kind !== 'available') return POLL_INTERVAL_MS
    return ['delivered', 'in-review', 'fixing'].includes(execution.value.step) ? REVIEW_INTERVAL_MS : POLL_INTERVAL_MS
  }
}

export const useWorkProgress = (identity: WorkIdentity | null, enabled = true, phase: WorkProgress['phase'] | null = null): WorkProgressRead => {
  const repo = identity?.repo
  const issue = identity?.issue
  const agent = identity?.agent
  const key = identity === null ? null : `${repo}:${issue}:${agent}`
  const [observed, setObserved] = useState<{ key: string | null; read: WorkProgressRead }>({ key: null, read: CONNECTING })
  const observedRef = useRef(observed)
  observedRef.current = observed

  useEffect(() => {
    if (repo === undefined || issue === undefined || agent === undefined) return
    if (!enabled) {
      setObserved((previous) => previous.key === key && previous.read.kind === 'read'
        ? { key, read: WorkPolling.paused(previous.read) }
        : previous)
      return
    }
    const controller = new AbortController()
    let timer: number | undefined
    let previous = observedRef.current.key === key ? observedRef.current.read : CONNECTING
    if (observedRef.current.key !== key) setObserved({ key, read: CONNECTING })

    const poll = async () => {
      const outcome = await WorkProgressClient.get({ repo, issue, agent }, controller.signal, READ_TIMEOUT_MS)
      if (controller.signal.aborted) return
      previous = outcome.kind === 'read'
        ? outcome
        : previous.kind === 'read' || previous.kind === 'stale'
          ? { kind: 'stale', snapshot: previous.snapshot, detail: outcome.detail }
          : outcome
      setObserved({ key, read: previous })
      timer = window.setTimeout(poll, WorkPolling.next(previous))
    }

    timer = window.setTimeout(poll, 0)
    return () => {
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [repo, issue, agent, key, enabled, phase])

  return useMemo(() => observed.key !== key ? CONNECTING : enabled ? observed.read : WorkPolling.paused(observed.read), [observed, key, enabled])
}
