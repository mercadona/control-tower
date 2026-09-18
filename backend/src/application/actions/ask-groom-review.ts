import { PhasePrompt } from '../../domain/value-objects/phase-prompt.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { EpicSpecs } from '../../domain/ports/epic-specs.ts'
import type { LiveSession } from '../../domain/value-objects/live-session.ts'
import type { LiveSessions } from '../../domain/ports/live-sessions.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'

export class AskGroomReviewParams {
  readonly repository: RepositoryName
  readonly root: CheckoutRoot
  readonly session: LiveSession

  constructor({ repository, root, session }: {
    repository: RepositoryName, root: CheckoutRoot, session: LiveSession,
  }) {
    this.repository = repository
    this.root = root
    this.session = session
    Object.freeze(this)
  }
}

export const GroomReviewAsk = Object.freeze({
  ASKED: 'asked',
  NO_SPEC: 'no-spec',
} as const)

export type GroomReviewAskValue = (typeof GroomReviewAsk)[keyof typeof GroomReviewAsk]

export class GroomReviewAsked {
  readonly outcome: GroomReviewAskValue

  private constructor(outcome: GroomReviewAskValue) {
    this.outcome = outcome
    Object.freeze(this)
  }

  static asked(): GroomReviewAsked {
    return new GroomReviewAsked(GroomReviewAsk.ASKED)
  }

  static noSpec(): GroomReviewAsked {
    return new GroomReviewAsked(GroomReviewAsk.NO_SPEC)
  }
}

export class AskGroomReview {
  static readonly SUBMIT = '\r'

  readonly specs: EpicSpecs
  readonly liveSessions: LiveSessions

  constructor({ specs, liveSessions }: { specs: EpicSpecs, liveSessions: LiveSessions }) {
    this.specs = specs
    this.liveSessions = liveSessions
  }

  async execute(params: AskGroomReviewParams): Promise<GroomReviewAsked> {
    const spec = await this.specs.mostRecent(params.root)
    if (spec === null) return GroomReviewAsked.noSpec()

    const prompt = PhasePrompt.groom({
      spec, milestone: spec.title()!, repository: params.repository, root: params.root,
    })
    this.liveSessions.write({
      session: params.session,
      text: `${prompt.oneLine()}${AskGroomReview.SUBMIT}`,
    })

    return GroomReviewAsked.asked()
  }
}
