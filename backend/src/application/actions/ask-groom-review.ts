import { PhasePrompt } from '../../domain/value-objects/phase-prompt.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { EpicSpecs } from '../../domain/ports/epic-specs.ts'
import type { LiveSession } from '../../domain/value-objects/live-session.ts'
import type { LiveSessions } from '../../domain/ports/live-sessions.ts'
import type { GroomReviewAdmission, GroomReviewRefusalValue } from '../../domain/ports/groom-review-admission.ts'

export class AskGroomReviewParams {
  readonly root: CheckoutRoot
  readonly session: LiveSession
  readonly target: string

  constructor({ root, session, target }: { root: CheckoutRoot, session: LiveSession, target: string }) {
    this.root = root
    this.session = session
    this.target = target
    Object.freeze(this)
  }
}

export const GroomReviewAsk = Object.freeze({
  ASKED: 'asked',
  NO_SPEC: 'no-spec',
  REFUSED: 'refused',
} as const)

export type GroomReviewAskValue = (typeof GroomReviewAsk)[keyof typeof GroomReviewAsk]

export class GroomReviewAsked {
  readonly outcome: GroomReviewAskValue
  readonly refusal: GroomReviewRefusalValue | null

  private constructor(outcome: GroomReviewAskValue, refusal: GroomReviewRefusalValue | null = null) {
    this.outcome = outcome
    this.refusal = refusal
    Object.freeze(this)
  }

  static asked(): GroomReviewAsked {
    return new GroomReviewAsked(GroomReviewAsk.ASKED)
  }

  static noSpec(): GroomReviewAsked {
    return new GroomReviewAsked(GroomReviewAsk.NO_SPEC)
  }

  static refused(refusal: GroomReviewRefusalValue): GroomReviewAsked {
    return new GroomReviewAsked(GroomReviewAsk.REFUSED, refusal)
  }
}

export class AskGroomReview {
  readonly specs: EpicSpecs
  readonly liveSessions: LiveSessions
  readonly admission: GroomReviewAdmission

  constructor({ specs, liveSessions, admission }: {
    specs: EpicSpecs, liveSessions: LiveSessions, admission: GroomReviewAdmission,
  }) {
    this.specs = specs
    this.liveSessions = liveSessions
    this.admission = admission
  }

  async execute(params: AskGroomReviewParams): Promise<GroomReviewAsked> {
    const spec = await this.specs.mostRecent(params.root)
    if (spec === null) return GroomReviewAsked.noSpec()

    const prompt = PhasePrompt.groomReview({ spec, milestone: spec.title()! })
    const refusal = this.admission.refusalFor({ target: params.target, session: params.session })
    if (refusal !== null) return GroomReviewAsked.refused(refusal)
    await this.liveSessions.submit({ session: params.session, text: prompt.oneLine() })

    return GroomReviewAsked.asked()
  }
}
