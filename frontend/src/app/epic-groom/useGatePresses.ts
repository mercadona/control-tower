import { useRef, useState } from 'react'
import { EpicGroomClient } from 'app/epic-groom/client'
import { OpenedCoordinatingSession } from 'app/coordinating-session/CoordinatingSession.types'
import { EpicGroomAskOutcome, GroomSessionOutcome, ReslicingOutcome } from 'app/epic-groom/EpicGroom.types'

type Pressed = 'none' | 'groom' | 'promote' | 'session' | 'reslicing'
type EpicGroomActed = Extract<EpicGroomAskOutcome, { kind: 'acted' }>
type EpicGroomAskRefusal = Exclude<EpicGroomAskOutcome, { kind: 'acted' }>

type GatePresses = {
  pressed: Pressed
  acted: EpicGroomActed | null
  refusal: EpicGroomAskRefusal | null
  session: GroomSessionOutcome | null
  reslicing: ReslicingOutcome | null
  groom: (gateKey: string | null, planFingerprint: string) => Promise<void>
  promote: (gateKey: string | null) => Promise<void>
  openSession: (gateKey: string | null) => Promise<void>
  publishReslicing: (gateKey: string | null) => Promise<void>
}

const NOTHING: Pressed = 'none'

const useGatePresses = (onSessionOpened: (opened: OpenedCoordinatingSession) => void): GatePresses => {
  const [pressed, setPressed] = useState<Pressed>(NOTHING)
  const [acted, setActed] = useState<EpicGroomActed | null>(null)
  const [refusal, setRefusal] = useState<EpicGroomAskRefusal | null>(null)
  const [session, setSession] = useState<GroomSessionOutcome | null>(null)
  const [reslicing, setReslicing] = useState<ReslicingOutcome | null>(null)
  const pressing = useRef<Pressed>(NOTHING)

  const held = (what: Pressed, gateKey: string | null): boolean => {
    if (gateKey === null || pressing.current !== NOTHING) return false
    pressing.current = what
    setPressed(what)

    return true
  }

  const released = (): void => {
    pressing.current = NOTHING
    setPressed(NOTHING)
  }

  const settle = (answered: EpicGroomAskOutcome): void => {
    if (answered.kind === 'acted') {
      setActed(answered)
      setRefusal(null)
      return
    }
    setRefusal(answered)
  }

  const asked = async (
    what: Pressed, gateKey: string | null, answer: (key: string) => Promise<void>
  ): Promise<void> => {
    if (!held(what, gateKey)) return
    try {
      await answer(gateKey!)
    } finally {
      released()
    }
  }

  return {
    pressed,
    acted,
    refusal,
    session,
    reslicing,
    groom: (gateKey: string | null, planFingerprint: string) => asked(
      'groom', gateKey, async (key) => settle(await EpicGroomClient.groom(key, planFingerprint))
    ),
    promote: (gateKey: string | null) => asked(
      'promote', gateKey, async (key) => settle(await EpicGroomClient.promote(key))
    ),
    openSession: (gateKey: string | null) => asked('session', gateKey, async (key) => {
      const answered = await EpicGroomClient.openSession(key)
      setSession(answered)
      if (answered.kind === 'opened') onSessionOpened(answered.opened)
    }),
    publishReslicing: (gateKey: string | null) => asked(
      'reslicing', gateKey, async (key) => setReslicing(await EpicGroomClient.publishReslicing(key))
    ),
  }
}

export { useGatePresses }
