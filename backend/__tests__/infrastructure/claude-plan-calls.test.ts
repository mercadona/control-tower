import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { PlanRecords } from '../../src/domain/ports/plan-records.ts'
import { PlanNonLaunch } from '../../src/domain/value-objects/plan-non-launch.ts'
import { RecordedCall } from '../../src/infrastructure/recorded-call.ts'
import { CallDescriptor } from '../../src/infrastructure/claude-calls.ts'
import { DiskPlanRecords } from '../../src/infrastructure/disk-plan-records.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'

class CallsDouble extends ClaudeCalls {
  readonly invocations: CallInvocation[] = []
  readonly result: CompletedPlanCall
  recordedCall: StartedPlanCall | null = null
  historyRows: readonly RecordedCall[] = []
  deadline = Date.parse('2026-09-16T12:00:00.000Z')

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

  override async startedFor(): Promise<StartedPlanCall | null> {
    return this.recordedCall
  }

  override async wait(): Promise<CompletedPlanCall> {
    return this.result
  }

  override async history(): Promise<readonly RecordedCall[]> {
    return this.historyRows
  }

  override async deadlineOf(): Promise<number> {
    return this.deadline
  }
}

class RecordsDouble extends PlanRecords {
  proof: PlanNonLaunch | null = null

  override async nonLaunch(): Promise<PlanNonLaunch | null> {
    return this.proof
  }

  override async cleanupEvidence(): Promise<null> {
    return null
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

  static failed(call = PlanCallMother.CALL): CompletedPlanCall {
    return new CompletedPlanCall({
      call,
      code: 1,
      signal: null,
      finishedAt: '2026-09-16T10:01:00.000Z',
      wallDurationMs: 60_000,
      execution: { kind: 'error', diagnostic: 'planner failed' },
      measurement: {
        cost: { kind: 'unavailable', reason: 'failed call' },
        turns: null,
        durationMs: null,
        unavailable: ['failed call'],
      },
    })
  }
}

class Subject {
  readonly calls = new CallsDouble()
  readonly records = new RecordsDouble()
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
    records: this.records,
    nowMs: () => Date.parse('2026-09-16T10:00:00.000Z'),
    resumable: async (watch): Promise<boolean> => {
      this.resumableWatches.push(watch)
      return this.resumable
    },
  })
}

describe('ClaudePlanCalls', () => {
  it('headless tools are explicitly authorized for every call purpose', async () => {
    const subject = new Subject()

    await subject.adapter.start(PlanCallMother.watch(), 'plan', null)
    await subject.adapter.start(PlanCallMother.watch(), 'implementation', null)
    await subject.adapter.start(PlanCallMother.watch(), 'fix', 'Address the review')

    expect(subject.calls.invocations.map((invocation) => invocation.purpose)).toEqual(['plan', 'implementation', 'fix'])
    for (const invocation of subject.calls.invocations) {
      const grant = invocation.argv.indexOf('--allowedTools')
      expect(grant, invocation.purpose).toBeGreaterThan(-1)
      expect(invocation.argv[grant + 1], invocation.purpose).toBe('Read,Glob,Grep,Edit,Write,Bash,Skill,Agent')
      const identity = invocation.purpose === 'plan' ? '--session-id' : '--resume'
      expect(invocation.argv.slice(-3, -1), invocation.purpose).toEqual([identity, PlanCallMother.CONVERSATION])
    }
  })

  it('headless authorization preserves settings hooks and conversation identity', async () => {
    const subject = new Subject()

    await subject.adapter.start(PlanCallMother.watch(), 'implementation', null)

    const [invocation] = subject.calls.invocations
    expect(invocation.conversation).toBe(PlanCallMother.CONVERSATION)
    expect(invocation.argv).toEqual(expect.arrayContaining([
      '--permission-mode', 'acceptEdits',
      '--plugin-dir', '/installed/control-tower-loop',
      '--resume', PlanCallMother.CONVERSATION,
    ]))
    expect(invocation.argv).not.toContain('--settings')
    expect(invocation.argv).not.toContain('--setting-sources')
    expect(invocation.argv).not.toContain('--disable-hooks')
    expect(invocation.argv).not.toContain('--dangerously-skip-permissions')
  })

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
      '--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash,Skill,Agent',
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

  it('existing implementation needs no transcript', async () => {
    const subject = new Subject()
    subject.resumable = false
    subject.calls.recordedCall = PlanCallMother.CALL

    expect(await subject.adapter.start(
      PlanCallMother.watch(),
      'implementation',
      null,
      `implementation:${PlanCallMother.CALL.id}`,
    )).toBe(PlanCallMother.CALL)
    expect(subject.resumableWatches).toEqual([])
    expect(subject.calls.invocations).toEqual([])
  })

  it('successful planner recovery continues the original call', async () => {
    const subject = new Subject()
    subject.calls.historyRows = [new RecordedCall({
      call: PlanCallMother.CALL,
      purpose: 'plan',
      startedAt: '2026-09-16T10:00:00.000Z',
      completion: PlanCallMother.completed(),
    })]

    const recovery = await subject.adapter.recoveryFor(PlanCallMother.watch())

    expect(recovery.action).toBe('continue')
    expect(recovery.call()).toBe(PlanCallMother.CALL)
  })

  it('partial preparation exposes cleanup without strict history', async () => {
    const subject = new Subject()
    subject.records.proof = new PlanNonLaunch({
      conversation: PlanCallMother.CONVERSATION,
      callId: PlanCallMother.CALL.id,
      source: 'before-worker',
      diagnostic: 'descriptor publication failed before worker spawn',
      observedAt: '2026-09-16T10:00:00.000Z',
    })
    subject.calls.history = async () => { throw new Error('strict history must not be read') }

    const recovery = await subject.adapter.recoveryFor(PlanCallMother.watch())

    expect(recovery.action).toBe('cleanup')
  })

  it.each(['allocated call without a directory', 'prompt-only call directory'] as const)(
    'partial filesystem preparation reaches cleanup without history: %s', async (shape) => {
      const root = await mkdtemp(join(tmpdir(), 'ct-partial-plan-call-'))
      try {
        const files = new HeadlessFiles({ root, fs, newId: () => 'temporary-record' })
        const records = new DiskPlanRecords({
          files,
          newId: () => PlanCallMother.CONVERSATION,
          now: () => '2026-09-16T10:00:00.000Z',
          exists: async () => true,
        })
        const watch = await records.prepare(new PlanBriefing({
          story: null,
          issue: PlanCallMother.watch().issue,
          repository: PlanCallMother.watch().repository,
          located: PlanCallMother.watch().located,
        }))
        await records.recordNonLaunch(watch, new PlanNonLaunch({
          conversation: watch.agent,
          callId: PlanCallMother.CALL.id,
          source: 'before-worker',
          diagnostic: 'descriptor publication failed before worker spawn',
          observedAt: '2026-09-16T10:00:00.000Z',
        }))
        if (shape === 'prompt-only call directory') {
          const directory = files.callDirectory(PlanCallMother.CALL)
          await mkdir(directory, { recursive: true })
          await writeFile(join(directory, CallDescriptor.PROMPT), 'persisted prompt', 'utf8')
        }
        const calls = new ClaudeCalls({
          files,
          binary: 'claude',
          worker: 'worker.ts',
          spawn: (() => { throw new Error('partial recovery must not spawn') }) as typeof spawn,
          env: {},
          newId: () => { throw new Error('partial recovery must not allocate identity') },
          now: () => { throw new Error('partial recovery must not ask current time') },
          budgetMs: 1,
          killGraceMs: 1,
          acceptanceMs: 1,
          pollMs: 1,
          sleep: async () => { throw new Error('partial recovery must not sleep') },
        })
        const adapter = new ClaudePlanCalls({
          calls,
          brief: new PlanAgentBrief({
            dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
            conventions: '/plugin/conventions',
            ctStep: '/plugin/scripts/ct-step.mjs',
          }),
          pluginRoot: '/plugin',
          records,
          nowMs: () => Date.parse('2026-09-16T10:00:00.000Z'),
          resumable: async () => { throw new Error('partial recovery must not inspect a transcript') },
        })

        expect((await adapter.recoveryFor(watch)).action).toBe('cleanup')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  )

  it('planner recovery reads its original deadline across a rebuilt graph', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-planner-deadline-'))
    try {
      const files = new HeadlessFiles({ root, fs, newId: () => 'temporary-record' })
      const records = new DiskPlanRecords({
        files,
        newId: () => PlanCallMother.CONVERSATION,
        now: () => '2026-09-16T10:00:00.000Z',
        exists: async () => true,
      })
      const watch = await records.prepare(new PlanBriefing({
        story: null,
        issue: PlanCallMother.watch().issue,
        repository: PlanCallMother.watch().repository,
        located: PlanCallMother.watch().located,
      }))
      const descriptor = new CallDescriptor({
        conversation: watch.agent,
        purpose: 'plan',
        requestId: null,
        cwd: watch.located.path,
        binary: 'claude',
        argv: ['--session-id', watch.agent],
        startedAt: '2026-09-16T10:00:00.000Z',
        budgetMs: 10_000,
        killGraceMs: 5_000,
      })
      const descriptorPath = join(files.callDirectory(PlanCallMother.CALL), CallDescriptor.FILE)
      await mkdir(files.callDirectory(PlanCallMother.CALL), { recursive: true })
      await writeFile(descriptorPath, descriptor.text(), 'utf8')
      const originalBytes = await readFile(descriptorPath, 'utf8')
      const deadline = descriptor.deadlineMs()

      for (const [nowMs, action] of [
        [deadline - 1, 'observe'], [deadline, 'inspect'], [deadline + 1, 'inspect'],
      ] as const) {
        const calls = new ClaudeCalls({
          files,
          binary: 'claude',
          worker: 'worker.ts',
          spawn: (() => { throw new Error('deadline recovery must not spawn') }) as typeof spawn,
          env: {},
          newId: () => { throw new Error('deadline recovery must not allocate identity') },
          now: () => { throw new Error('deadline recovery must retain recorded time') },
          budgetMs: 1,
          killGraceMs: 1,
          acceptanceMs: 1,
          pollMs: 1,
          sleep: async () => { throw new Error('deadline recovery must not sleep') },
        })
        const rebuilt = new ClaudePlanCalls({
          calls,
          brief: new PlanAgentBrief({
            dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
            conventions: '/plugin/conventions',
            ctStep: '/plugin/scripts/ct-step.mjs',
          }),
          pluginRoot: '/plugin',
          records,
          nowMs: () => nowMs,
          resumable: async () => true,
        })
        const recovery = await rebuilt.recoveryFor(watch)
        expect(recovery.action).toBe(action)
        if (action === 'observe') expect(recovery.call()).toEqual(PlanCallMother.CALL)
        expect(await readFile(descriptorPath, 'utf8')).toBe(originalBytes)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('incomplete implementation recovery observes only within its recorded deadline', async () => {
    const subject = new Subject()
    subject.calls.historyRows = [new RecordedCall({
      call: PlanCallMother.CALL,
      purpose: 'implementation',
      startedAt: '2026-09-16T10:00:00.000Z',
      completion: null,
    })]

    const observing = await subject.adapter.recoveryFor(PlanCallMother.watch())
    expect(observing.action).toBe('observe')
    expect(observing.call()).toBe(PlanCallMother.CALL)
    subject.calls.deadline = Date.parse('2026-09-16T09:59:59.000Z')
    expect((await subject.adapter.recoveryFor(PlanCallMother.watch())).action).toBe('inspect')
    subject.calls.deadline = Date.parse('2026-09-16T10:00:00.000Z')
    expect((await subject.adapter.recoveryFor(PlanCallMother.watch())).action).toBe('inspect')
    subject.calls.deadline = Date.parse('2026-09-16T10:00:00.001Z')
    expect((await subject.adapter.recoveryFor(PlanCallMother.watch())).action).toBe('observe')
  })

  it('failed planner and multiple unfinished calls remain inspect-only', async () => {
    const subject = new Subject()
    subject.calls.historyRows = [new RecordedCall({
      call: PlanCallMother.CALL,
      purpose: 'plan',
      startedAt: '2026-09-16T09:00:00.000Z',
      completion: PlanCallMother.failed(),
    })]
    expect((await subject.adapter.recoveryFor(PlanCallMother.watch())).action).toBe('inspect')

    const other = new StartedPlanCall({
      conversation: PlanCallMother.CONVERSATION,
      id: '33333333-3333-4333-8333-333333333333',
    })
    subject.calls.historyRows = [
      new RecordedCall({
        call: PlanCallMother.CALL, purpose: 'plan', startedAt: '2026-09-16T09:00:00.000Z', completion: null,
      }),
      new RecordedCall({
        call: other, purpose: 'fix', startedAt: '2026-09-16T09:01:00.000Z', completion: null,
      }),
    ]
    expect((await subject.adapter.recoveryFor(PlanCallMother.watch())).action).toBe('inspect')
  })

  it('timestamp ties remain inspect-only', async () => {
    const subject = new Subject()
    const other = new StartedPlanCall({
      conversation: PlanCallMother.CONVERSATION,
      id: '33333333-3333-4333-8333-333333333333',
    })
    subject.calls.historyRows = [
      new RecordedCall({
        call: PlanCallMother.CALL,
        purpose: 'plan',
        startedAt: '2026-09-16T10:00:00.000Z',
        completion: PlanCallMother.completed(),
      }),
      new RecordedCall({
        call: other,
        purpose: 'implementation',
        startedAt: '2026-09-16T10:00:00.000Z',
        completion: null,
      }),
    ]

    const recovery = await subject.adapter.recoveryFor(PlanCallMother.watch())
    expect(recovery.action).toBe('inspect')
    expect(recovery.detail).toContain('ambiguous')
  })
})
