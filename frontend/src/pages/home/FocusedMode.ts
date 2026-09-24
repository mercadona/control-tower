import { ActivePlan } from 'app/active-plans/ActivePlan.types'
import { CoordinatingSessionRead } from 'app/coordinating-session/useCoordinatingSession'
import { OpenedCoordinatingSession } from 'app/coordinating-session/CoordinatingSession.types'
import { EpicGroomRead } from 'app/epic-groom/useEpicGroom'
import { LiveSession } from 'app/sessions/Sessions.types'

type LiveRead = Extract<CoordinatingSessionRead, { kind: 'live' }>

type FocusedModeOf =
  | { kind: 'focused'; live: LiveRead; terminal: LiveSession }
  | { kind: 'today' }

export class FocusedMode {
  static readonly #TODAY: FocusedModeOf = { kind: 'today' }

  static of({ read, opened, planHeld, activePlans, epicGroom }: {
    read: CoordinatingSessionRead
    opened: OpenedCoordinatingSession | null
    planHeld: boolean
    activePlans: readonly ActivePlan[]
    epicGroom: EpicGroomRead
  }): FocusedModeOf {
    if (read.phase !== 'read' || read.kind !== 'live' || opened === null || planHeld) return FocusedMode.#TODAY
    if (activePlans.some((plan) => FocusedMode.claims(epicGroom, plan))) return FocusedMode.#TODAY

    return { kind: 'focused', live: read, terminal: opened.session }
  }

  static claims(epicGroom: EpicGroomRead, plan: ActivePlan): boolean {
    return FocusedMode.#issuesOfTheStory(epicGroom).includes(plan.plan.issue.url)
  }

  static #issuesOfTheStory(epicGroom: EpicGroomRead): readonly string[] {
    if (epicGroom.phase === 'connecting') return []
    switch (epicGroom.kind) {
      case 'partially-groomed':
      case 'groomed':
      case 'authorised':
        return epicGroom.issues.map((issue) => issue.url)
      case 'none':
      case 'no-spec':
      case 'draft':
      case 'awaiting-publication':
      case 'resliced':
      case 'issues-uncertain':
      case 'groomable':
      case 'refused':
      case 'unavailable':
        return []
    }
  }
}
