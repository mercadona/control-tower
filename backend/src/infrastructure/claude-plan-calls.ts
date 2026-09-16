import { PlanAgentNotResumed } from '../domain/exceptions.ts'
import { PlanCalls } from '../domain/ports/plan-calls.ts'
import type { CompletedPlanCall, PlanCallPurpose, StartedPlanCall } from '../domain/value-objects/plan-call.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import { CallDescriptor, CallInvocation, type ClaudeCalls } from './claude-calls.ts'
import { ClaudeConversations } from './claude-conversations.ts'
import type { PlanAgentBrief } from './plan-agent-brief.ts'
import type { RecordedCall } from './recorded-call.ts'

type CallMode = 'initial' | 'resume'

export class ClaudePlanCalls extends PlanCalls {
  static readonly OPENING = `Read the file at $${CallDescriptor.PROMPT_VARIABLE} and do exactly what it says.`
  static readonly ALLOWED_TOOLS = 'Read,Glob,Grep,Edit,Write,Bash,Skill,Agent'

  readonly calls: ClaudeCalls
  readonly brief: PlanAgentBrief
  readonly pluginRoot: string
  readonly resumable: (watch: PlanWatch) => Promise<boolean>

  constructor(ports: {
    calls: ClaudeCalls,
    brief: PlanAgentBrief,
    pluginRoot: string,
    resumable: (watch: PlanWatch) => Promise<boolean>,
  }) {
    super()
    this.calls = ports.calls
    this.brief = ports.brief
    this.pluginRoot = ports.pluginRoot
    this.resumable = ports.resumable
  }

  async start(
    watch: PlanWatch,
    purpose: PlanCallPurpose,
    changes: string | null,
    requestId?: string,
  ): Promise<StartedPlanCall> {
    const prompt = this.#prompt(watch, purpose, changes)
    const mode = ClaudePlanCalls.#modeFor(purpose)
    const invocation = new CallInvocation({
      conversation: watch.agent,
      purpose,
      cwd: watch.located.path,
      argv: this.#argv(watch.agent, mode),
      prompt,
      requestId,
    })
    const recorded = await this.calls.startedFor(invocation)
    if (recorded !== null) return recorded
    if (mode === 'resume' && (watch.agent.length === 0 || !await this.resumable(watch))) {
      throw new PlanAgentNotResumed(`conversation ${JSON.stringify(watch.agent)} is not resumable`)
    }

    return this.calls.start(invocation)
  }

  async planningFor(watch: PlanWatch): Promise<StartedPlanCall> {
    const calls = await this.#history(watch)
    const planners = calls.filter((recorded) => recorded.purpose === 'plan')
    if (planners.length !== 1) {
      throw new PlanAgentNotResumed(
        `conversation ${JSON.stringify(watch.agent)} has ${planners.length} recorded planner calls`
      )
    }
    return planners[0].call
  }

  async implementationFor(watch: PlanWatch): Promise<StartedPlanCall | null> {
    const calls = await this.#history(watch)
    const implementations = calls.filter((recorded) => recorded.purpose === 'implementation')
    if (implementations.length > 1) {
      throw new PlanAgentNotResumed(
        `conversation ${JSON.stringify(watch.agent)} has multiple recorded implementation calls`
      )
    }
    return implementations[0]?.call ?? null
  }

  wait(call: StartedPlanCall): Promise<CompletedPlanCall> {
    return this.calls.wait(call)
  }

  async #history(watch: PlanWatch): Promise<readonly RecordedCall[]> {
    const history = await this.calls.history(watch.agent)
    const unfinished = history.filter((recorded) => recorded.completion === null)
    if (unfinished.length > 1) {
      throw new PlanAgentNotResumed(
        `conversation ${JSON.stringify(watch.agent)} has conflicting unfinished calls`
      )
    }
    return history
  }

  #argv(conversation: string, mode: CallMode): readonly string[] {
    return [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', ClaudeConversations.PERMISSION_MODE,
      '--allowedTools', ClaudePlanCalls.ALLOWED_TOOLS,
      '--model', ClaudeConversations.MODEL,
      '--plugin-dir', this.pluginRoot,
      mode === 'resume' ? '--resume' : '--session-id', conversation,
      ClaudePlanCalls.OPENING,
    ]
  }

  #prompt(watch: PlanWatch, purpose: PlanCallPurpose, changes: string | null): string {
    switch (purpose) {
      case 'plan':
        ClaudePlanCalls.#requireNoChanges(purpose, changes)
        return this.brief.errandFor({ issue: watch.issue, repository: watch.repository })
      case 'implementation':
        ClaudePlanCalls.#requireNoChanges(purpose, changes)
        return this.brief.implementationErrandFor({
          issueNumber: watch.issue.number,
          repository: watch.repository,
        })
      case 'fix':
        if (changes === null || changes.trim().length === 0) {
          throw new TypeError('fix calls require nonempty changes')
        }
        return this.brief.fixErrandFor({
          issueNumber: watch.issue.number,
          repository: watch.repository,
          changes,
        })
    }
    return purpose satisfies never
  }

  static #requireNoChanges(purpose: 'plan' | 'implementation', changes: string | null): void {
    if (changes !== null) throw new TypeError(`${purpose} calls require null changes`)
  }

  static #modeFor(purpose: PlanCallPurpose): CallMode {
    switch (purpose) {
      case 'plan':
        return 'initial'
      case 'implementation':
      case 'fix':
        return 'resume'
    }
    return purpose satisfies never
  }
}
