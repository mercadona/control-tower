import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { PlanAgentNotResumed } from '../../src/domain/exceptions.ts'
import { CompletedPlanCall, StartedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { CallInvocation, ClaudeCalls } from '../../src/infrastructure/claude-calls.ts'
import { ClaudePlanCalls } from '../../src/infrastructure/claude-plan-calls.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.ts'

class CallsDouble extends ClaudeCalls {
  readonly invocations: CallInvocation[] = []
  readonly result: CompletedPlanCall

  constructor() {
    super({
      files: new HeadlessFiles({ root: '/state', fs, newId: () => 'temporary-record' }),
      binary: 'claude',
      worker: 'worker.ts',
      spawn,
      env: {},
      newId: () => PlanCallMother.CALL.id,
      now: () => '2026-09-16T10:00:00.000Z',
      budgetMs: 1,
      killGraceMs: 1,
      acceptanceMs: 1,
      pollMs: 1,
      sleep: async () => {},
    })
    this.result = PlanCallMother.completed()
  }

  override async start(invocation: CallInvocation): Promise<StartedPlanCall> {
    this.invocations.push(invocation)
    return PlanCallMother.CALL
  }

  override async wait(): Promise<CompletedPlanCall> {
    return this.result
  }
}

class PlanCallMother {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly CALL = new StartedPlanCall({
    conversation: PlanCallMother.CONVERSATION,
    id: '22222222-2222-4222-8222-222222222222',
  })

  static watch(agent = PlanCallMother.CONVERSATION): PlanWatch {
    return new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: 331, url: 'https://github.com/mercadona/control-tower-plugin/issues/331' }),
      located: new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/331', branch: 'feat/331' }),
      repository: new RepositoryName('mercadona/control-tower-plugin'),
      agent,
    })
  }

  static completed(): CompletedPlanCall {
    return new CompletedPlanCall({
      call: PlanCallMother.CALL,
      code: 0,
      signal: null,
      finishedAt: '2026-09-16T10:01:00.000Z',
      wallDurationMs: 60_000,
      execution: { kind: 'success' },
      measurement: {
        cost: { kind: 'reported', totalUsd: 1, attribution: 'initial-invocation' },
        turns: 1,
        durationMs: 1_000,
        unavailable: [],
      },
    })
  }
}

class Subject {
  readonly calls = new CallsDouble()
  readonly resumableWatches: PlanWatch[] = []
  resumable = true
  readonly adapter = new ClaudePlanCalls({
    calls: this.calls,
    brief: new PlanAgentBrief({
      dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
      conventions: '/plugin/conventions',
      ctStep: '/plugin/scripts/ct-step.mjs',
    }),
    pluginRoot: '/installed/control-tower-loop',
    resumable: async (watch): Promise<boolean> => {
      this.resumableWatches.push(watch)
      return this.resumable
    },
  })
}

describe('ClaudePlanCalls', () => {
  it('resumes preserve conversation identity and carry only the prompt path', async () => {
    const subject = new Subject()
    const watch = PlanCallMother.watch()

    const started = await subject.adapter.start(watch, 'implementation', null)

    expect(started).toBe(PlanCallMother.CALL)
    expect(subject.resumableWatches).toEqual([watch])
    expect(subject.calls.invocations).toHaveLength(1)
    expect(subject.calls.invocations[0].conversation).toBe(PlanCallMother.CONVERSATION)
    expect(subject.calls.invocations[0].cwd).toBe('/repo/.worktrees/331')
    expect(subject.calls.invocations[0].argv).toEqual([
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'acceptEdits',
      '--model', 'opus',
      '--plugin-dir', '/installed/control-tower-loop',
      '--resume', PlanCallMother.CONVERSATION,
      'Read the file at $CT_CALL_PROMPT and do exactly what it says.',
    ])
    expect(subject.calls.invocations[0].argv.join(' ')).not.toContain(subject.calls.invocations[0].prompt)
    expect(await subject.adapter.wait(started)).toBe(subject.calls.result)
  })

  it('a missing conversation is refused rather than reopened', async () => {
    const subject = new Subject()
    subject.resumable = false

    const refusal = await subject.adapter.start(PlanCallMother.watch(), 'implementation', null).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(subject.calls.invocations).toEqual([])
  })
})
