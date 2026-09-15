import { useRef, useState } from 'react'
import { EpicGroomClient } from 'app/epic-groom/client'
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
  groom: (planFingerprint: string) => Promise<void>
  promote: () => Promise<void>
  openSession: () => Promise<void>
  publishReslicing: () => Promise<void>
}

const NOTHING: Pressed = 'none'

const useGatePresses = (gateKey: string | null): GatePresses => {
  const [pressed, setPressed] = useState<Pressed>(NOTHING)
  const [acted, setActed] = useState<EpicGroomActed | null>(null)
  const [refusal, setRefusal] = useState<EpicGroomAskRefusal | null>(null)
  const [session, setSession] = useState<GroomSessionOutcome | null>(null)
  const [reslicing, setReslicing] = useState<ReslicingOutcome | null>(null)
  const pressing = useRef<Pressed>(NOTHING)

  const held = (what: Pressed): boolean => {
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

  const asked = async (what: Pressed, answer: (key: string) => Promise<void>): Promise<void> => {
    if (!held(what)) return
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
    groom: (planFingerprint: string) => asked(
      'groom', async (key) => settle(await EpicGroomClient.groom(key, planFingerprint))
    ),
    promote: () => asked('promote', async (key) => settle(await EpicGroomClient.promote(key))),
    openSession: () => asked('session', async (key) => setSession(await EpicGroomClient.openSession(key))),
    publishReslicing: () => asked(
      'reslicing', async (key) => setReslicing(await EpicGroomClient.publishReslicing(key))
    ),
  }
}

export { useGatePresses }
