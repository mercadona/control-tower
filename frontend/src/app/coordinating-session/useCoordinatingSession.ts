import { useCallback, useEffect, useRef, useState } from 'react'
import { CoordinatingSessionClient } from 'app/coordinating-session/client'
import {
  CloseOutcome, CoordinatingSessionOutcome, LiveAsk, LiveSessionRef, OpenedCoordinatingSession, OpenOutcome,
} from 'app/coordinating-session/CoordinatingSession.types'
import { GroomSessionOutcome } from 'app/epic-groom/EpicGroom.types'
import { EpicGroomClient } from 'app/epic-groom/client'
import { productError } from 'app/product-error'
import { StartPlanSubmission } from 'app/start-plan/StartPlan.types'

type CoordinatingSessionRead =
  | { phase: 'connecting' }
  | ({ phase: 'read' } & CoordinatingSessionOutcome)

type HeldOutcome = Extract<CoordinatingSessionOutcome, { kind: 'live' | 'ended' | 'unresumable' }>
type HeldSnapshot = { outcome: HeldOutcome; terminal: LiveSessionRef | null }
type OpeningState = 'idle' | 'pending' | 'uncertain' | 'reconciling'
type PendingClose = { target: string; conversation: string; sessionId: string | null }
type BackendConnection = 'reachable' | 'unreachable'

const CONNECTING: CoordinatingSessionRead = { phase: 'connecting' }
const POLL_INTERVAL_MS = 2000
const askStateOf = (held: HeldSnapshot | null): LiveAsk | null => {
  if (held === null || held.outcome.kind !== 'live') return null
  const reported = held.outcome.timeline.at(-1)?.kind ?? null
  if (reported === 'waiting-for-permission') return 'awaiting-permission'
  if (held.outcome.attention.status === 'working') return 'working'

  return reported === 'completed' ? 'ready' : 'turn-not-finished'
}

const BLOCKED_OPENING: OpenOutcome = {
  kind: 'refused',
  code: 'coordinating-session-opening',
  error: 'No se puede abrir otra sesión coordinadora mientras la actual siga ocupada.',
}

type CoordinatingLifecycle = {
  read: CoordinatingSessionRead
  connection: BackendConnection
  occupied: boolean
  blocksOpening: boolean
  operationBusy: boolean
  target: string | null
  liveAsk: LiveAsk | null
  opened: OpenedCoordinatingSession | null
  closeError: string | null
  closing: boolean
  closedSessionIds: readonly string[]
  open: (submission: StartPlanSubmission) => Promise<OpenOutcome>
  openGroom: (key: string, target: string) => Promise<GroomSessionOutcome>
  close: () => Promise<CloseOutcome | null>
}

const useCoordinatingSession = (): CoordinatingLifecycle => {
  const [read, setRead] = useState<CoordinatingSessionRead>(CONNECTING)
  const [connection, setConnection] = useState<BackendConnection>('reachable')
  const [held, setHeld] = useState<HeldSnapshot | null>(null)
  const [opening, setOpening] = useState<OpeningState>('idle')
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const explicitCloseErrorRef = useRef(false)
  const [closedSessionIds, setClosedSessionIds] = useState<readonly string[]>([])
  const mountedRef = useRef(false)
  const readRef = useRef<CoordinatingSessionRead>(CONNECTING)
  const heldRef = useRef<HeldSnapshot | null>(null)
  const openingRef = useRef<OpeningState>('idle')
  const closingRef = useRef(false)
  const mutationRef = useRef(false)
  const pendingCloseRef = useRef<PendingClose | null>(null)
  const generationRef = useRef(0)
  const inFlightRef = useRef<{ generation: number; promise: Promise<CoordinatingSessionOutcome> } | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const confirmedClosedTargetsRef = useRef(new Set<string>())

  const updateRead = useCallback((next: CoordinatingSessionRead) => {
    readRef.current = next
    setRead(next)
  }, [])

  const updateHeld = useCallback((next: HeldSnapshot | null) => {
    heldRef.current = next
    setHeld(next)
  }, [])

  const updateOpening = useCallback((next: OpeningState) => {
    openingRef.current = next
    setOpening(next)
  }, [])

  const updateClosing = useCallback((next: boolean) => {
    closingRef.current = next
    setClosing(next)
  }, [])

  const applyOutcome = useCallback((outcome: CoordinatingSessionOutcome) => {
    setConnection(outcome.kind === 'unavailable' ? 'unreachable' : 'reachable')
    if (outcome.kind === 'unavailable') {
      if (readRef.current.phase === 'connecting') updateRead({ phase: 'read', kind: 'unavailable' })
      return
    }
    if (outcome.kind === 'none') {
      updateRead({ phase: 'read', ...outcome })
      if (outcome.operation === 'idle') {
        const terminalId = heldRef.current?.terminal?.id
        if (terminalId !== undefined) {
          setClosedSessionIds((current) => current.includes(terminalId) ? current : [...current, terminalId])
        }
        updateHeld(null)
        explicitCloseErrorRef.current = false
        setCloseError(null)
        updateOpening('idle')
      }
      return
    }
    if (confirmedClosedTargetsRef.current.has(outcome.target)) return
    const previous = heldRef.current
    const terminal = outcome.kind === 'live'
      ? outcome.session
      : previous?.outcome.target === outcome.target ? previous.terminal : null
    const snapshot = { outcome, terminal }
    updateHeld(snapshot)
    updateRead({ phase: 'read', ...outcome })
    if (previous?.outcome.target !== outcome.target) explicitCloseErrorRef.current = false
    if (outcome.closureError !== null && !explicitCloseErrorRef.current) {
      setCloseError(productError(outcome.closureError.code, outcome.closureError.detail))
    } else if (previous?.outcome.target !== outcome.target) {
      setCloseError(null)
    }
    if (outcome.operation !== 'opening' && outcome.operation !== 'recovering') updateOpening('idle')
  }, [updateHeld, updateOpening, updateRead])

  const schedulePoll = useCallback(() => {
    if (!mountedRef.current || mutationRef.current || timerRef.current !== undefined) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined
      void readNowRef.current()
    }, POLL_INTERVAL_MS)
  }, [])

  const readNowRef = useRef<() => Promise<CoordinatingSessionOutcome>>(async () => ({ kind: 'unavailable' }))
  const readNow = useCallback((): Promise<CoordinatingSessionOutcome> => {
    if (!mountedRef.current) return Promise.resolve({ kind: 'unavailable' })
    const generation = generationRef.current
    const current = inFlightRef.current
    if (current !== null && current.generation === generation) return current.promise
    const promise = CoordinatingSessionClient.read().then((outcome) => {
      if (mountedRef.current && generation === generationRef.current) applyOutcome(outcome)
      return outcome
    }).finally(() => {
      if (inFlightRef.current?.promise === promise) inFlightRef.current = null
      schedulePoll()
    })
    inFlightRef.current = { generation, promise }
    return promise
  }, [applyOutcome, schedulePoll])
  readNowRef.current = readNow

  const beginMutation = useCallback(() => {
    mutationRef.current = true
    generationRef.current += 1
    inFlightRef.current = null
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    timerRef.current = undefined
  }, [])

  const reconcileAfterMutation = useCallback(() => {
    mutationRef.current = false
    void readNow()
  }, [readNow])

  useEffect(() => {
    mountedRef.current = true
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined
      void readNow()
    }, 0)
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      inFlightRef.current = null
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    }
  }, [readNow])

  const blocksOpeningNow = useCallback((): boolean => {
    const current = readRef.current
    if (mutationRef.current || openingRef.current !== 'idle' || closingRef.current) return true
    const held = heldRef.current
    if (held !== null) return held.outcome.kind === 'live' || held.outcome.operation !== 'idle'
    return current.phase !== 'read' || current.kind !== 'none' || current.operation !== 'idle'
  }, [])

  const askableNow = useCallback((): boolean => {
    if (mutationRef.current || openingRef.current !== 'idle' || closingRef.current) return false
    const held = heldRef.current

    return held?.outcome.kind === 'live' && held.outcome.operation === 'idle'
  }, [])

  const adopt = useCallback((opened: OpenedCoordinatingSession) => {
    const outcome: HeldOutcome = {
      kind: 'live',
      operation: 'idle',
      target: opened.target,
      conversation: opened.conversation,
      repo: opened.repo,
      story: opened.story,
      root: opened.root,
      session: opened.session,
      attention: { status: 'working', question: null },
      timeline: [],
      closureError: null,
    }
    updateHeld({ outcome, terminal: opened.session })
    updateRead({ phase: 'read', ...outcome })
    updateOpening('idle')
    explicitCloseErrorRef.current = false
    setCloseError(null)
  }, [updateHeld, updateOpening, updateRead])

  const runOpening = useCallback(async <T extends OpenOutcome | GroomSessionOutcome>(ask: () => Promise<T>): Promise<T> => {
    if (blocksOpeningNow()) return BLOCKED_OPENING as T
    beginMutation()
    updateOpening('pending')
    let outcome: T
    try {
      outcome = await ask()
      if (!mountedRef.current) return outcome
      if (outcome.kind === 'opened') adopt(outcome.opened)
      else updateOpening(outcome.kind === 'refused' ? 'reconciling' : 'uncertain')
      return outcome
    } catch {
      updateOpening('uncertain')
      return { kind: 'backend-unreachable' } as T
    } finally {
      reconcileAfterMutation()
    }
  }, [adopt, beginMutation, blocksOpeningNow, reconcileAfterMutation, updateOpening])

  const open = useCallback((submission: StartPlanSubmission) =>
    runOpening(() => CoordinatingSessionClient.open(submission)), [runOpening])

  const openGroom = useCallback((key: string, target: string) =>
    askableNow()
      ? EpicGroomClient.openSession(key, target)
      : runOpening(() => EpicGroomClient.openSession(key, target)), [askableNow, runOpening])

  const close = useCallback(async (): Promise<CloseOutcome | null> => {
    const snapshot = heldRef.current
    if (snapshot === null || mutationRef.current || closingRef.current) return null
    const pending: PendingClose = {
      target: snapshot.outcome.target,
      conversation: snapshot.outcome.conversation,
      sessionId: snapshot.terminal?.id ?? null,
    }
    pendingCloseRef.current = pending
    beginMutation()
    updateClosing(true)
    explicitCloseErrorRef.current = false
    setCloseError(null)
    let outcome: CloseOutcome
    try {
      outcome = await CoordinatingSessionClient.close(pending.conversation, pending.target)
      if (!mountedRef.current || pendingCloseRef.current !== pending) return outcome
      if (outcome.kind === 'closed' && outcome.target === pending.target && outcome.conversation === pending.conversation) {
        generationRef.current += 1
        inFlightRef.current = null
        confirmedClosedTargetsRef.current.add(pending.target)
        if (pending.sessionId !== null) {
          setClosedSessionIds((current) => current.includes(pending.sessionId!) ? current : [...current, pending.sessionId!])
        }
        if (heldRef.current?.outcome.target === pending.target) updateHeld(null)
        updateRead({ phase: 'read', kind: 'none', operation: 'idle' })
        explicitCloseErrorRef.current = false
        setCloseError(null)
      } else {
        const error = outcome.kind === 'refused'
          ? productError(outcome.code, outcome.error)
          : 'No se pudo confirmar el cierre de la sesión. Puedes volver a intentarlo.'
        explicitCloseErrorRef.current = true
        setCloseError(error)
      }
      return outcome
    } catch {
      outcome = { kind: 'backend-unreachable' }
      explicitCloseErrorRef.current = true
      setCloseError('No se pudo confirmar el cierre de la sesión. Puedes volver a intentarlo.')
      return outcome
    } finally {
      if (pendingCloseRef.current === pending) pendingCloseRef.current = null
      updateClosing(false)
      reconcileAfterMutation()
    }
  }, [beginMutation, reconcileAfterMutation, updateClosing, updateHeld, updateRead])

  const operation = held?.outcome.operation ?? (
    read.phase === 'read' && read.kind === 'none' ? read.operation : null
  )
  const heldBlocksOpening = held !== null && (held.outcome.kind === 'live' || held.outcome.operation !== 'idle')
  const idleWithoutHeld = held === null && read.phase === 'read' && read.kind === 'none' && read.operation === 'idle'
  const blocksOpening = opening !== 'idle' || closing || heldBlocksOpening || (held === null && !idleWithoutHeld)
  const operationBusy = opening !== 'idle' || closing || operation === 'recovering' || operation === 'opening' ||
    operation === 'closing'
  const opened = held?.outcome.kind === 'live' && held.terminal !== null
    ? {
        target: held.outcome.target,
        conversation: held.outcome.conversation,
        repo: held.outcome.repo,
        story: held.outcome.story,
        root: held.outcome.root,
        session: held.terminal,
      }
    : null

  return {
    read,
    connection,
    occupied: blocksOpening,
    blocksOpening,
    operationBusy,
    target: held?.outcome.target ?? null,
    liveAsk: askStateOf(held),
    opened,
    closeError,
    closing,
    closedSessionIds,
    open,
    openGroom,
    close,
  }
}

export { useCoordinatingSession }
export type { CoordinatingLifecycle, CoordinatingSessionRead }
