import { EpicGroomRead } from 'app/epic-groom/useEpicGroom'
import { SpecFreezeRead } from 'app/spec-freeze/useSpecFreeze'

type SessionStep = 'brainstorming' | 'spec-freeze' | 'groom' | 'implementation'
type GateBandKind = 'none' | 'spec-freeze' | 'epic-groom'
type SessionStageOf = { step: SessionStep; band: GateBandKind }
type Gate2Standing = 'authorised' | 'grooming' | 'not-yet'

export class SessionStage {
  static readonly STEPS: readonly SessionStep[] = ['brainstorming', 'spec-freeze', 'groom', 'implementation']

  static readonly LABEL: Readonly<Record<SessionStep, string>> = {
    brainstorming: 'Brainstorming',
    'spec-freeze': 'Congelación del spec',
    groom: 'Groom y autorización',
    implementation: 'Implementación',
  }

  static of(specFreeze: SpecFreezeRead, epicGroom: EpicGroomRead): SessionStageOf {
    const standing = SessionStage.#gate2StandingOf(epicGroom)
    const step: SessionStep = standing === 'authorised'
      ? 'implementation'
      : standing === 'grooming' ? 'groom' : SessionStage.#stepBeforeGate2(specFreeze)

    return { step, band: SessionStage.#bandFor(step, specFreeze, epicGroom) }
  }

  static #gate2StandingOf(epicGroom: EpicGroomRead): Gate2Standing {
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

  static #stepBeforeGate2(specFreeze: SpecFreezeRead): SessionStep {
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

  static #gate2AsksSomething(epicGroom: EpicGroomRead): boolean {
    if (epicGroom.phase === 'connecting') return false
    switch (epicGroom.kind) {
      case 'awaiting-publication':
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
      case 'unavailable':
        return false
    }
  }

  static #gate1AsksSomething(specFreeze: SpecFreezeRead): boolean {
    return specFreeze.phase === 'read' && (specFreeze.kind === 'draft' || specFreeze.kind === 'refused')
  }

  static #bandFor(step: SessionStep, specFreeze: SpecFreezeRead, epicGroom: EpicGroomRead): GateBandKind {
    switch (step) {
      case 'brainstorming':
        return 'none'
      case 'spec-freeze':
        return SessionStage.#gate1AsksSomething(specFreeze) ? 'spec-freeze' : 'none'
      case 'groom':
      case 'implementation':
        return SessionStage.#gate2AsksSomething(epicGroom) ? 'epic-groom' : 'none'
    }
  }
}

export type { GateBandKind, SessionStageOf, SessionStep }
