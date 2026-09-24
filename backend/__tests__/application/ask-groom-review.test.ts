import { describe, it, expect } from 'vitest'
import { AskGroomReview, AskGroomReviewParams, GroomReviewAsk } from '../../src/application/actions/ask-groom-review.ts'
import { EpicSpecsDouble } from '../epic-specs-double.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { PhasePrompt } from '../../src/domain/value-objects/phase-prompt.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { GroomReviewAdmission, GroomReviewRefusal } from '../../src/domain/ports/groom-review-admission.ts'
import type { GroomReviewRefusalValue } from '../../src/domain/ports/groom-review-admission.ts'

class AdmissionDouble extends GroomReviewAdmission {
  refusal: GroomReviewRefusalValue | null = null
  readonly asked: { target: string, session: LiveSession }[] = []

  refusalFor(asked: { target: string, session: LiveSession }): GroomReviewRefusalValue | null {
    this.asked.push(asked)

    return this.refusal
  }
}

class Deferred<T> {
  readonly promise: Promise<T>
  resolve!: (value: T) => void

  constructor() {
    this.promise = new Promise((resolve) => { this.resolve = resolve })
  }
}

class PendingSpecs extends EpicSpecsDouble {
  readonly reading = new Deferred<void>()
  readonly pending = new Deferred<EpicSpec | null>()

  constructor() {
    super(null)
  }

  override async of(): Promise<EpicSpec | null> {
    this.reading.resolve()

    return this.pending.promise
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
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'
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
      repository: Mother.REPOSITORY, root: Mother.ROOT, story: EpicSpecsDouble.STORY, session: Mother.SESSION, target: Mother.TARGET,
    })
  }
}

describe('AskGroomReview', () => {
  it('types the groom prompt of the frozen spec into the live session as one line it submits', async () => {
    const sessions = new LiveSessionsDouble()
    const ask = new AskGroomReview({
      specs: new EpicSpecsDouble(Mother.spec()), liveSessions: sessions, admission: new AdmissionDouble(),
    })

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
    const admission = new AdmissionDouble()
    const ask = new AskGroomReview({ specs: new EpicSpecsDouble(null), liveSessions: sessions, admission })

    const asked = await ask.execute(Mother.asking())

    expect(asked.outcome).toBe(GroomReviewAsk.NO_SPEC)
    expect(sessions.typed).toEqual([])
    expect(admission.asked).toEqual([])
  })

  it.each(Object.values(GroomReviewRefusal))(
    'types nothing when admission becomes %s while the spec is being read', async (refusal) => {
      const specs = new PendingSpecs()
      const sessions = new LiveSessionsDouble()
      const admission = new AdmissionDouble()
      const ask = new AskGroomReview({ specs, liveSessions: sessions, admission })

      const pending = ask.execute(Mother.asking())
      await specs.reading.promise
      expect(admission.asked).toEqual([])
      admission.refusal = refusal
      specs.pending.resolve(Mother.spec())
      const asked = await pending

      expect(asked.outcome).toBe(GroomReviewAsk.REFUSED)
      expect(asked.refusal).toBe(refusal)
      expect(sessions.typed).toEqual([])
      expect(admission.asked).toEqual([{ target: Mother.TARGET, session: Mother.SESSION }])
    }
  )

  it('writes in the same synchronous turn as the final admission check', async () => {
    const sessions = new LiveSessionsDouble()
    const admission = new AdmissionDouble()
    admission.refusalFor = (asked) => {
      admission.asked.push(asked)
      queueMicrotask(() => { admission.refusal = GroomReviewRefusal.AWAITING_PERMISSION })

      return null
    }
    sessions.write = ({ session, text }) => {
      expect(admission.asked).toEqual([{ target: Mother.TARGET, session: Mother.SESSION }])
      expect(admission.refusal).toBe(null)
      sessions.typed.push({ session, text })
    }
    const ask = new AskGroomReview({
      specs: new EpicSpecsDouble(Mother.spec()), liveSessions: sessions, admission,
    })

    const asked = await ask.execute(Mother.asking())

    expect(asked.outcome).toBe(GroomReviewAsk.ASKED)
    expect(sessions.typed).toHaveLength(1)
  })
})
