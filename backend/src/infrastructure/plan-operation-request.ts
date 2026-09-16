import { ConversationId } from '../domain/value-objects/conversation-id.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'

export type PlanProjectionRefresh = { recover(): Promise<string | null> }

export class MalformedPlanOperationRequest extends Error {}

export class PlanOperationRequest {
  readonly repository: RepositoryName
  readonly issue: number
  readonly agent: string

  private constructor(asked: { repository: RepositoryName, issue: number, agent: string }) {
    this.repository = asked.repository
    this.issue = asked.issue
    this.agent = asked.agent
    Object.freeze(this)
  }

  static from(raw: string): PlanOperationRequest {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new MalformedPlanOperationRequest('body must be exactly {"repo":"owner/name","issue":123,"agent":"uuid"}')
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new MalformedPlanOperationRequest('body must be a JSON object')
    }
    const record = parsed as Record<string, unknown>
    const fields = Object.keys(record).sort()
    if (fields.join(',') !== 'agent,issue,repo') {
      throw new MalformedPlanOperationRequest('body must contain exactly repo, issue and agent')
    }
    if (!RepositoryName.isWellFormed(record.repo)) throw new MalformedPlanOperationRequest('repo must be owner/name')
    if (typeof record.issue !== 'number' || !Number.isSafeInteger(record.issue) || record.issue <= 0) {
      throw new MalformedPlanOperationRequest('issue must be a positive integer')
    }
    if (!ConversationId.isWellFormed(record.agent)) {
      throw new MalformedPlanOperationRequest('agent must be a conversation id')
    }
    return new PlanOperationRequest({
      repository: new RepositoryName(record.repo),
      issue: record.issue,
      agent: record.agent,
    })
  }
}
