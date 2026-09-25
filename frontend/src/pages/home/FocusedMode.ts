import { CoordinatingSessionRead } from 'app/coordinating-session/useCoordinatingSession'
import { OpenedCoordinatingSession } from 'app/coordinating-session/CoordinatingSession.types'
import { LiveSession } from 'app/sessions/Sessions.types'

type HeldRead = Extract<CoordinatingSessionRead, { kind: 'live' | 'ended' | 'unresumable' }>

type FocusedModeOf =
  | { kind: 'focused'; held: HeldRead; terminal: LiveSession | null }
  | { kind: 'start' }

export class FocusedMode {
  static readonly #START: FocusedModeOf = { kind: 'start' }

  static of({ read, opened }: {
    read: CoordinatingSessionRead
    opened: OpenedCoordinatingSession | null
  }): FocusedModeOf {
    if (read.phase !== 'read') return FocusedMode.#START
    if (read.kind !== 'live' && read.kind !== 'ended' && read.kind !== 'unresumable') return FocusedMode.#START

    return { kind: 'focused', held: read, terminal: read.kind === 'live' ? opened?.session ?? null : null }
  }
}

export type { FocusedModeOf, HeldRead }
