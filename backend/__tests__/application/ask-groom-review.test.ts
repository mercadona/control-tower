import { describe, it, expect } from 'vitest'
import { AskGroomReview, AskGroomReviewParams, GroomReviewAsk } from '../../src/application/actions/ask-groom-review.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { PhasePrompt } from '../../src/domain/value-objects/phase-prompt.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class EpicSpecsDouble extends EpicSpecs {
  readonly asked: CheckoutRoot[]
  readonly answer: EpicSpec | null

  constructor(answer: EpicSpec | null) {
    super()
    this.asked = []
    this.answer = answer
  }

  async mostRecent(root: CheckoutRoot): Promise<EpicSpec | null> {
    this.asked.push(root)

    return this.answer
  }
}

class LiveSessionsDouble extends LiveSessions {
  readonly typed: { session: LiveSession, text: string }[]

  constructor() {
    super()
    this.typed = []
  }

  write({ session, text }: { session: LiveSession, text: string }): void {
    this.typed.push({ session, text })
  }
}

class Mother {
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly SESSION = new LiveSession({ id: 'session-9', name: 'brainstorming' })
  static readonly MILESTONE = 'The loop enters through brainstorming'
  static readonly SPEC_PATH = 'docs/superpowers/specs/2026-09-14-the-loop-execution.md'

  static spec(): EpicSpec {
    return new EpicSpec({
      path: Mother.SPEC_PATH,
      text: `# ${Mother.MILESTONE}${EpicSpec.TITLE_SUFFIX}\n\n${EpicSpec.STATE_LINE} ${EpicSpec.FROZEN}\n`,
    })
  }

  static asking(): AskGroomReviewParams {
    return new AskGroomReviewParams({
      repository: Mother.REPOSITORY, root: Mother.ROOT, session: Mother.SESSION,
    })
  }
}

describe('AskGroomReview', () => {
  it('types the groom prompt of the frozen spec into the live session as one line it submits', async () => {
    const sessions = new LiveSessionsDouble()
    const ask = new AskGroomReview({ specs: new EpicSpecsDouble(Mother.spec()), liveSessions: sessions })

    const asked = await ask.execute(Mother.asking())

    expect(asked.outcome).toBe(GroomReviewAsk.ASKED)
    expect(sessions.typed).toHaveLength(1)
    expect(sessions.typed[0].session).toBe(Mother.SESSION)
    const typed = sessions.typed[0].text
    expect(typed.endsWith(AskGroomReview.SUBMIT)).toBe(true)
    expect(typed.slice(0, -AskGroomReview.SUBMIT.length)).not.toContain('\n')
    expect(typed).toContain(PhasePrompt.GROOM_SKILL)
    expect(typed).toContain(Mother.MILESTONE)
    expect(typed).toContain(Mother.SPEC_PATH)
    expect(typed).toContain(PhasePrompt.ISSUES_ARE_NOT_YOURS)
  })

  it('types nothing when the checkout carries no execution spec', async () => {
    const sessions = new LiveSessionsDouble()
    const ask = new AskGroomReview({ specs: new EpicSpecsDouble(null), liveSessions: sessions })

    const asked = await ask.execute(Mother.asking())

    expect(asked.outcome).toBe(GroomReviewAsk.NO_SPEC)
    expect(sessions.typed).toEqual([])
  })
})
