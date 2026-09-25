import { describe, it, expect } from 'vitest'
import { HeldStoryMilestone } from '../../src/infrastructure/held-story-milestone.ts'
import type { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { CoordinatingConversationMother } from '../coordinating-conversation-mother.ts'
import { EpicSpecsDouble } from '../epic-specs-double.ts'

class Mother {
  static readonly ROOT = new CheckoutRoot('/repo/checkout')
  static readonly OTHER_ROOT = new CheckoutRoot('/repo/another-checkout')
  static readonly REPOSITORY = new RepositoryName('mercadona/control-tower')
  static readonly OTHER_REPOSITORY = new RepositoryName('mercadona/another-repository')
  static readonly MILESTONE = 'The focused view follows the story through implementation'

  static held(): CoordinatingConversation {
    return CoordinatingConversationMother.of({
      id: new ConversationId('268643e6-1bea-4c37-b168-51275f7e702f'),
      repository: Mother.REPOSITORY,
      root: Mother.ROOT,
    })
  }

  static spec(): EpicSpec {
    return new EpicSpec({
      path: 'docs/superpowers/specs/STAFF-128-execution.md',
      text: `# ${Mother.MILESTONE}${EpicSpec.TITLE_SUFFIX}\n`,
    })
  }
}

describe('HeldStoryMilestone', () => {
  it('names the milestone of the held story for the checkout that story lives in', async () => {
    const specs = new EpicSpecsDouble(Mother.spec())
    const milestone = new HeldStoryMilestone({ held: () => Mother.held(), specs })

    expect(await milestone.of({ root: Mother.ROOT, repository: Mother.REPOSITORY })).toBe(Mother.MILESTONE)
    expect(specs.asked).toEqual([{ root: Mother.ROOT, story: EpicSpecsDouble.STORY }])
  })

  it('names nothing when no coordinating conversation is held', async () => {
    const milestone = new HeldStoryMilestone({ held: () => null, specs: new EpicSpecsDouble(Mother.spec()) })

    expect(await milestone.of({ root: Mother.ROOT, repository: Mother.REPOSITORY })).toBeNull()
  })

  it('names nothing for a checkout the held story does not live in', async () => {
    const specs = new EpicSpecsDouble(Mother.spec())
    const milestone = new HeldStoryMilestone({ held: () => Mother.held(), specs })

    expect(await milestone.of({ root: Mother.OTHER_ROOT, repository: Mother.REPOSITORY })).toBeNull()
    expect(await milestone.of({ root: Mother.ROOT, repository: Mother.OTHER_REPOSITORY })).toBeNull()
    expect(specs.asked).toEqual([])
  })

  it('names nothing while the held story has no execution spec', async () => {
    const milestone = new HeldStoryMilestone({ held: () => Mother.held(), specs: new EpicSpecsDouble(null) })

    expect(await milestone.of({ root: Mother.ROOT, repository: Mother.REPOSITORY })).toBeNull()
  })
})
