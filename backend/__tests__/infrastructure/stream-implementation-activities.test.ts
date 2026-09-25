import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentCalls } from '../../src/domain/ports/agent-calls.ts'
import { ImplementationActivityNotRead } from '../../src/domain/exceptions.ts'
import { CompletedPlanCall, StartedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import type { PlanCallPurpose } from '../../src/domain/value-objects/plan-call.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RecordedCall } from '../../src/domain/value-objects/recorded-call.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { CallDescriptor, type CallInvocation } from '../../src/infrastructure/claude-calls.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { StreamImplementationActivities } from '../../src/infrastructure/stream-implementation-activities.ts'

class CallsDouble extends AgentCalls<CallInvocation, CallDescriptor> {
  historyRows: readonly RecordedCall[] = []

  override async history(): Promise<readonly RecordedCall[]> {
    return this.historyRows
  }

  override async start(): Promise<StartedPlanCall> {
    throw new Error('a stream implementation activity double never starts a call')
  }

  override async startedFor(): Promise<StartedPlanCall | null> {
    throw new Error('a stream implementation activity double never starts a call')
  }

  override async wait(): Promise<CompletedPlanCall> {
    throw new Error('a stream implementation activity double never waits on a call')
  }

  override async completed(): Promise<CompletedPlanCall | null> {
    throw new Error('a stream implementation activity double never polls completion')
  }

  override async recover(): Promise<readonly RecordedCall[]> {
    throw new Error('a stream implementation activity double never recovers a conversation')
  }

  override async descriptorOf(): Promise<CallDescriptor> {
    throw new Error('a stream implementation activity double never describes a call')
  }

  override async deadlineOf(): Promise<number> {
    throw new Error('a stream implementation activity double never asks for a deadline')
  }

  override owns(): boolean {
    throw new Error('a stream implementation activity double never asks about ownership')
  }
}

class Mother {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'

  static watch(): PlanWatch {
    return new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: 591, url: 'https://github.com/mercadona/control-tower/issues/591' }),
      located: new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/591', branch: 'feat/591' }),
      repository: new RepositoryName('mercadona/control-tower'),
      agent: Mother.CONVERSATION,
    })
  }

  static call(id: string): StartedPlanCall {
    return new StartedPlanCall({ conversation: Mother.CONVERSATION, id })
  }

  static recorded(id: string, purpose: PlanCallPurpose, startedAt: string): RecordedCall {
    return new RecordedCall({ call: Mother.call(id), purpose, startedAt, completion: null })
  }
}

class Subject {
  readonly root: string
  readonly calls: CallsDouble
  readonly files: HeadlessFiles

  constructor(root: string) {
    this.root = root
    this.calls = new CallsDouble()
    this.files = new HeadlessFiles({ root, fs, newId: () => 'temporary-record' })
  }

  adapter(): StreamImplementationActivities {
    return new StreamImplementationActivities({ calls: this.calls, files: this.files })
  }

  async streamPathFor(call: StartedPlanCall): Promise<string> {
    const directory = this.files.callDirectory(call)
    await mkdir(directory, { recursive: true })
    return join(directory, CallDescriptor.STREAM)
  }
}

class StreamLines {
  static text(text: string): string {
    return `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })}\n`
  }

  static toolUse(name: string, input: Record<string, unknown>): string {
    return `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })}\n`
  }
}

describe('StreamImplementationActivities', () => {
  let root: string

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('the current implementation call is the one started last among implementation calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-implementation-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [
      Mother.recorded('later-implementation', 'implementation', '2026-09-25T11:00:00.000Z'),
      Mother.recorded('earlier-implementation', 'implementation', '2026-09-25T10:00:00.000Z'),
      Mother.recorded('a-plan-call', 'plan', '2026-09-25T12:00:00.000Z'),
    ]
    const path = await subject.streamPathFor(Mother.call('later-implementation'))
    await writeFile(path, StreamLines.text('reading the plan'), 'utf8')

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity?.startedAt).toBe('2026-09-25T11:00:00.000Z')
    expect(activity?.lastText).toBe('reading the plan')
  })

  it('the current implementation call is chosen by startedAt, not by its position in the history', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-implementation-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [
      Mother.recorded('earlier-implementation', 'implementation', '2026-09-25T10:00:00.000Z'),
      Mother.recorded('later-implementation', 'implementation', '2026-09-25T11:00:00.000Z'),
    ]

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity?.startedAt).toBe('2026-09-25T11:00:00.000Z')
  })

  it('a conversation with no implementation call has no implementation activity', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-implementation-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.recorded('a-plan-call', 'plan', '2026-09-25T12:00:00.000Z')]

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity).toBeNull()
  })

  it('the last tool and the last text come from the stream of the current call', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-implementation-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.recorded('the-call', 'implementation', '2026-09-25T10:00:00.000Z')]
    const path = await subject.streamPathFor(Mother.call('the-call'))
    await writeFile(
      path, StreamLines.toolUse('Bash', { command: 'npx vitest run' }) + StreamLines.text('running the suite'), 'utf8'
    )

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity?.lastToolCall).toEqual({ name: 'Bash', argument: 'npx vitest run' })
    expect(activity?.lastText).toBe('running the suite')
  })

  it('a call with no stream file yet answers with no last tool and no last text', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-implementation-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.recorded('the-call', 'implementation', '2026-09-25T10:00:00.000Z')]

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity?.lastToolCall).toBeNull()
    expect(activity?.lastText).toBeNull()
  })

  it('a stream that cannot be read is an implementation activity not read', async () => {
    const brokenFs = {
      readFile: async () => {
        throw Object.assign(new Error('permission denied reading the stream'), { code: 'EACCES' })
      },
    } as unknown as typeof fs
    const calls = new CallsDouble()
    calls.historyRows = [Mother.recorded('the-call', 'implementation', '2026-09-25T10:00:00.000Z')]
    const adapter = new StreamImplementationActivities({
      calls, files: new HeadlessFiles({ root: '/state', fs: brokenFs, newId: () => 'temporary-record' }),
    })

    const refusal = await adapter.of(Mother.watch()).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(ImplementationActivityNotRead)
    expect(refusal.message).toMatch(/permission denied reading the stream/)
  })
})
