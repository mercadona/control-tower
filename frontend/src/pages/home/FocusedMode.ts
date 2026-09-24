import { ActivePlan } from 'app/active-plans/ActivePlan.types'
import { CoordinatingSessionRead } from 'app/coordinating-session/useCoordinatingSession'
import { OpenedCoordinatingSession } from 'app/coordinating-session/CoordinatingSession.types'
import { EpicGroomRead } from 'app/epic-groom/useEpicGroom'
import { LiveSession } from 'app/sessions/Sessions.types'

type LiveRead = Extract<CoordinatingSessionRead, { kind: 'live' }>

type FocusedModeOf =
  | { kind: 'focused'; live: LiveRead; terminal: LiveSession }
  | { kind: 'today' }

const TODAY: FocusedModeOf = { kind: 'today' }

const issuesOfTheStory = (epicGroom: EpicGroomRead): readonly string[] => {
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

const claims = (epicGroom: EpicGroomRead, plan: ActivePlan): boolean =>
  issuesOfTheStory(epicGroom).includes(plan.plan.issue.url)

const of = ({ read, opened, planHeld, adoptedUnasked, activePlans, epicGroom }: {
  read: CoordinatingSessionRead
  opened: OpenedCoordinatingSession | null
  planHeld: boolean
  adoptedUnasked: ActivePlan | null
  activePlans: readonly ActivePlan[]
  epicGroom: EpicGroomRead
}): FocusedModeOf => {
  if (read.phase !== 'read' || read.kind !== 'live' || opened === null) return TODAY
  const heldByThisStory = planHeld && (adoptedUnasked === null || claims(epicGroom, adoptedUnasked))
  if (heldByThisStory) return TODAY
  if (activePlans.some((plan) => claims(epicGroom, plan))) return TODAY

  return { kind: 'focused', live: read, terminal: opened.session }
}

export const FocusedMode = { of, claims }
export type { FocusedModeOf }
