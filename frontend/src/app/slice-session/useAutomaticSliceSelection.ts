import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivePlan } from 'app/active-plans/ActivePlan.types'
import { ImplementationStep } from 'app/implement-progress/ImplementProgress.types'
import { ImplementProgressRead } from 'app/implement-progress/ImplementProgress.types'
import { StartedPlan } from 'app/start-plan/StartPlan.types'
import { WorkflowSnapshot } from 'app/workflow-snapshot/storage'

interface AutomaticSliceSelectionOptions {
  workflow: WorkflowSnapshot | null
  plans: ActivePlan[]
  enabled: boolean
  onSelect: (slice: ActivePlan) => void
}

const identityOf = (plan: StartedPlan) => `${plan.repo}:${plan.issue.number}:${plan.agent}`

const isDeliveredOrInReview = (progress: ImplementProgressRead | undefined) =>
  progress?.phase === 'progress' && (
    progress.step === ImplementationStep.DELIVERED || progress.step === ImplementationStep.IN_REVIEW
  )

const useAutomaticSliceSelection = ({ workflow, plans, enabled, onSelect }: AutomaticSliceSelectionOptions) => {
  const [readings, setReadings] = useState<Record<string, ImplementProgressRead>>({})
  const previousRef = useRef<{ identity: string; step: ImplementationStep } | null>(null)
  const pendingRef = useRef<string | null>(null)

  const observe = useCallback((plan: StartedPlan, progress: ImplementProgressRead) => {
    const identity = identityOf(plan)
    setReadings((previous) => previous[identity] === progress ? previous : { ...previous, [identity]: progress })
  }, [])

  useEffect(() => {
    const activeIdentities = new Set(plans.map((active) => identityOf(active.plan)))
    setReadings((previous) => {
      const retained = Object.entries(previous).filter(([identity]) => activeIdentities.has(identity))
      return retained.length === Object.keys(previous).length ? previous : Object.fromEntries(retained)
    })
  }, [plans])

  useEffect(() => {
    if (workflow === null || workflow.phase !== 'implementing') {
      previousRef.current = null
      pendingRef.current = null
      return
    }

    const identity = identityOf(workflow.plan)
    const previous = previousRef.current
    if (previous?.identity !== identity) pendingRef.current = null
    const selectedProgress = readings[identity]
    if (selectedProgress?.phase === 'progress') {
      if (previous?.identity === identity && previous.step !== ImplementationStep.IN_REVIEW
        && selectedProgress.step === ImplementationStep.IN_REVIEW) pendingRef.current = identity
      if (!isDeliveredOrInReview(selectedProgress)) pendingRef.current = null
      previousRef.current = { identity, step: selectedProgress.step }
    }

    if (!enabled || pendingRef.current !== identity) return
    const candidates = plans.filter((active) =>
      identityOf(active.plan) !== identity &&
      active.plan.repo === workflow.plan.repo &&
      (active.plan.root ?? active.request.path) === (workflow.plan.root ?? workflow.request.path) &&
      !(active.phase === 'implementing' && isDeliveredOrInReview(readings[identityOf(active.plan)])),
    )
    if (candidates.length !== 1) return
    const next = candidates[0]
    if (next.phase !== 'implementing' || readings[identityOf(next.plan)]?.phase !== 'progress') return

    pendingRef.current = null
    onSelect(next)
  }, [workflow, plans, enabled, onSelect, readings])

  return observe
}

export { useAutomaticSliceSelection }
