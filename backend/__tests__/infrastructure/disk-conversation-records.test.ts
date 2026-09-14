import { describe, expect, it, vi } from 'vitest'
import { DiskConversationRecords } from '../../src/infrastructure/disk-conversation-records.ts'
import { ConversationNotRecorded, ConversationNotUnderstood } from '../../src/domain/exceptions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { PhasePrompt } from '../../src/domain/value-objects/phase-prompt.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

const STATE_ROOT = '/state'
const REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
const CHECKOUT_ROOT = new CheckoutRoot('/real/repo')
const CONVERSATION_ID = new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f')
const CONVERSATION = new CoordinatingConversation({ id: CONVERSATION_ID, repository: REPOSITORY, root: CHECKOUT_ROOT })

const PROMPT = PhasePrompt.brainstorming({ story: null, comment: null, repository: REPOSITORY, root: CHECKOUT_ROOT })
const PROMPT_TEXT = [
  'Invoke the skill control-tower-loop:brainstorming.',
  `You are the coordinating session of the epic for ${REPOSITORY.text}, in the checkout ${CHECKOUT_ROOT.text}: you cut no worktree and you switch no branch.`,
  PhasePrompt.FREEZE_IS_NOT_YOURS,
].join('\n')

const PROMPT_PATH = '/state/coordinating-session/2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f/phase-prompt.md'
const RECORD_PATH = '/state/coordinating-session/conversation.json'

describe('DiskConversationRecords', () => {
  it('answers the path of the prompt it wrote for that conversation', async () => {
    const write = vi.fn(async () => {})
    const read = vi.fn(async () => null)
    const records = new DiskConversationRecords({ read, write, root: STATE_ROOT })

    const path = await records.prepare({ conversation: CONVERSATION, prompt: PROMPT })

    expect(path).toBe(PROMPT_PATH)
    expect(write).toHaveBeenCalledWith(PROMPT_PATH, PROMPT_TEXT)
  })

  it('writes the record beside it with the conversation, the repository and the root', async () => {
    const write = vi.fn(async () => {})
    const read = vi.fn(async () => null)
    const records = new DiskConversationRecords({ read, write, root: STATE_ROOT })

    await records.prepare({ conversation: CONVERSATION, prompt: PROMPT })

    expect(write).toHaveBeenCalledWith(
      RECORD_PATH,
      `${JSON.stringify({
        conversation: '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f',
        repo: 'josemerca/ct-loop-sandbox',
        root: '/real/repo',
      }, null, 2)}\n`
    )
  })

  it('recalls the recorded conversation', async () => {
    const read = vi.fn(async () => JSON.stringify({
      conversation: '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f',
      repo: 'josemerca/ct-loop-sandbox',
      root: '/real/repo',
    }))
    const write = vi.fn(async () => {})
    const records = new DiskConversationRecords({ read, write, root: STATE_ROOT })

    const recalled = await records.recall()

    expect(recalled).toEqual(CONVERSATION)
    expect(read).toHaveBeenCalledWith(RECORD_PATH)
  })

  it('answers no conversation when nothing was ever recorded', async () => {
    const read = vi.fn(async () => null)
    const write = vi.fn(async () => {})
    const records = new DiskConversationRecords({ read, write, root: STATE_ROOT })

    expect(await records.recall()).toBeNull()
  })

  it('raises conversation-not-understood when the record cannot be read as a conversation', async () => {
    const read = vi.fn(async () => '{not json')
    const write = vi.fn(async () => {})
    const records = new DiskConversationRecords({ read, write, root: STATE_ROOT })

    await expect(records.recall()).rejects.toBeInstanceOf(ConversationNotUnderstood)
  })

  it('raises conversation-not-recorded when the prompt cannot be written', async () => {
    const write = vi.fn(async () => { throw new Error('disk is full') })
    const read = vi.fn(async () => null)
    const records = new DiskConversationRecords({ read, write, root: STATE_ROOT })

    await expect(records.prepare({ conversation: CONVERSATION, prompt: PROMPT })).rejects.toBeInstanceOf(ConversationNotRecorded)
  })
})
