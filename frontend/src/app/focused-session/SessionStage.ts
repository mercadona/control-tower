import { EpicGroomRead } from 'app/epic-groom/useEpicGroom'
import { SpecFreezeRead } from 'app/spec-freeze/useSpecFreeze'

type SessionStep = 'brainstorming' | 'spec-freeze' | 'groom' | 'implementation'
type GateBandKind = 'none' | 'spec-freeze' | 'epic-groom'
type SessionStageOf = { step: SessionStep; band: GateBandKind }

const STEPS: readonly SessionStep[] = ['brainstorming', 'spec-freeze', 'groom', 'implementation']

const LABEL: Readonly<Record<SessionStep, string>> = {
  brainstorming: 'Brainstorming',
  'spec-freeze': 'Congelación del spec',
  groom: 'Groom y autorización',
  implementation: 'Implementación',
}

type Gate2Standing = 'authorised' | 'grooming' | 'not-yet'

const gate2StandingOf = (epicGroom: EpicGroomRead): Gate2Standing => {
  if (epicGroom.phase === 'connecting') return 'not-yet'
  switch (epicGroom.kind) {
    case 'authorised':
      return 'authorised'
    case 'awaiting-publication':
    case 'resliced':
    case 'issues-uncertain':
    case 'groomable':
    case 'partially-groomed':
    case 'groomed':
      return 'grooming'
    case 'none':
    case 'no-spec':
    case 'draft':
    case 'refused':
    case 'unavailable':
      return 'not-yet'
  }
}

const stepBeforeGate2 = (specFreeze: SpecFreezeRead): SessionStep => {
  if (specFreeze.phase === 'connecting') return 'brainstorming'
  switch (specFreeze.kind) {
    case 'frozen':
      return 'groom'
    case 'draft':
    case 'refused':
      return 'spec-freeze'
    case 'none':
    case 'no-spec':
    case 'unavailable':
      return 'brainstorming'
  }
}

const gate2AsksSomething = (epicGroom: EpicGroomRead): boolean => {
  if (epicGroom.phase === 'connecting') return false
  switch (epicGroom.kind) {
    case 'resliced':
    case 'groomable':
    case 'partially-groomed':
    case 'groomed':
    case 'issues-uncertain':
    case 'refused':
      return true
    case 'authorised':
      return epicGroom.preparation !== undefined
    case 'none':
    case 'no-spec':
    case 'draft':
    case 'awaiting-publication':
    case 'unavailable':
      return false
  }
}

const gate1AsksSomething = (specFreeze: SpecFreezeRead): boolean =>
  specFreeze.phase === 'read' && (specFreeze.kind === 'draft' || specFreeze.kind === 'refused')

const bandFor = (step: SessionStep, specFreeze: SpecFreezeRead, epicGroom: EpicGroomRead): GateBandKind => {
  switch (step) {
    case 'brainstorming':
      return 'none'
    case 'spec-freeze':
      return gate1AsksSomething(specFreeze) ? 'spec-freeze' : 'none'
    case 'groom':
    case 'implementation':
      return gate2AsksSomething(epicGroom) ? 'epic-groom' : 'none'
  }
}

const of = (specFreeze: SpecFreezeRead, epicGroom: EpicGroomRead): SessionStageOf => {
  const standing = gate2StandingOf(epicGroom)
  const step: SessionStep = standing === 'authorised'
    ? 'implementation'
    : standing === 'grooming' ? 'groom' : stepBeforeGate2(specFreeze)

  return { step, band: bandFor(step, specFreeze, epicGroom) }
}

export const SessionStage = { STEPS, LABEL, of }
export type { GateBandKind, SessionStageOf, SessionStep }
