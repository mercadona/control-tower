import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanningActivityNotRead, RunNotAdvanced, RunNotUnderstood } from '../../src/domain/exceptions.ts'
import { CompletedPlanCall, StartedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanningActivityState } from '../../src/domain/value-objects/planning-activity.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { CallDescriptor, ClaudeCalls } from '../../src/infrastructure/claude-calls.ts'
import { ClaudePlanCalls } from '../../src/infrastructure/claude-plan-calls.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.ts'
import { RecordedCall } from '../../src/domain/value-objects/recorded-call.ts'
import { StreamPlanningActivities } from '../../src/infrastructure/stream-planning-activities.ts'

class CallsDouble extends ClaudeCalls {
  historyRows: readonly RecordedCall[] = []
  historyFailure: Error | null = null

  constructor() {
    super({
      files: new HeadlessFiles({ root: '/state', fs, newId: () => 'temporary-record' }),
      binary: 'claude',
      worker: 'worker.ts',
      spawn,
      env: {},
      newId: () => Mother.CALL.id,
      now: () => Mother.STARTED_AT,
      budgetMs: 1,
      killGraceMs: 1,
      acceptanceMs: 1,
      pollMs: 1,
      sleep: async () => {},
    })
  }

  override async history(): Promise<readonly RecordedCall[]> {
    if (this.historyFailure !== null) throw this.historyFailure
    return this.historyRows
  }
}

class Mother {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly STARTED_AT = '2026-09-22T10:00:00.000Z'
  static readonly CALL = new StartedPlanCall({ conversation: Mother.CONVERSATION, id: '22222222-2222-4222-8222-222222222222' })

  static watch(): PlanWatch {
    return new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: 500, url: 'https://github.com/mercadona/control-tower-plugin/issues/500' }),
      located: new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/500', branch: 'feat/500' }),
      repository: new RepositoryName('mercadona/control-tower-plugin'),
      agent: Mother.CONVERSATION,
    })
  }

  static running(): RecordedCall {
    return new RecordedCall({ call: Mother.CALL, purpose: 'plan', startedAt: Mother.STARTED_AT, completion: null })
  }

  static finished(wallDurationMs = 60_000): RecordedCall {
    return new RecordedCall({
      call: Mother.CALL,
      purpose: 'plan',
      startedAt: Mother.STARTED_AT,
      completion: new CompletedPlanCall({
        call: Mother.CALL,
        code: 0,
        signal: null,
        finishedAt: '2026-09-22T10:01:00.000Z',
        wallDurationMs,
        execution: { kind: 'success' },
        measurement: { cost: { kind: 'unavailable', reason: 'not measured' }, turns: null, durationMs: null, unavailable: [] },
      }),
    })
  }
}

class Subject {
  readonly root: string
  readonly calls: CallsDouble
  readonly planCalls: ClaudePlanCalls
  nowMsValue: number

  constructor(root: string) {
    this.root = root
    this.calls = new CallsDouble()
    this.nowMsValue = Date.parse('2026-09-22T10:06:12.000Z')
    this.planCalls = new ClaudePlanCalls({
      calls: this.calls,
      brief: new PlanAgentBrief({
        dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
        conventions: '/plugin/conventions',
        ctStep: '/plugin/scripts/ct-step.mjs',
      }),
      pluginRoot: '/installed/control-tower-loop',
      records: {} as never,
      nowMs: () => this.nowMsValue,
      resumable: async () => true,
    })
  }

  files(): HeadlessFiles {
    return new HeadlessFiles({ root: this.root, fs, newId: () => 'temporary-record' })
  }

  adapter(): StreamPlanningActivities {
    return new StreamPlanningActivities({ planCalls: this.planCalls, files: this.files(), nowMs: () => this.nowMsValue })
  }

  async streamPath(): Promise<string> {
    const directory = this.files().callDirectory(Mother.CALL)
    await mkdir(directory, { recursive: true })
    return join(directory, CallDescriptor.STREAM)
  }
}

describe('StreamPlanningActivities, against a real claude -p --output-format stream-json --verbose capture at __tests__/infrastructure/fixtures/claude-stream-assistant.jsonl', () => {
  let root: string

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it.each([
    new RunNotAdvanced('agent measurements could not be recorded: disk full'),
    new RunNotUnderstood('agent measurements contain conflicting bytes'),
  ])('measurement refusal %s retains its diagnostic in the planning observation contract', async (failure) => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyFailure = failure

    await expect(subject.adapter().of(Mother.watch()))
      .rejects.toEqual(new PlanningActivityNotRead(failure.message))
  })

  it('unexpected history failures remain programming errors rather than measurement refusals', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    const failure = new TypeError('a bug in history')
    subject.calls.historyFailure = failure

    await expect(subject.adapter().of(Mother.watch())).rejects.toBe(failure)
  })

  it('running_with_zero_tool_calls_before_the_file_exists', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.running()]

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity.state).toBe(PlanningActivityState.RUNNING)
    expect(activity.toolCalls).toBe(0)
    expect(activity.lastToolCall).toBeNull()
    expect(activity.lastText).toBeNull()
    expect(activity.runningMs).toBe(subject.nowMsValue - Date.parse(Mother.STARTED_AT))
  })

  it('a_real_captured_transcript_is_parsed_into_tool_calls_a_main_argument_and_the_last_text_block', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.running()]
    const path = await subject.streamPath()
    const captured = await readFile(
      join(import.meta.dirname, 'fixtures', 'claude-stream-assistant.jsonl'), 'utf8'
    )
    await writeFile(path, captured, 'utf8')

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity.state).toBe(PlanningActivityState.RUNNING)
    expect(activity.toolCalls).toBe(2)
    expect(activity.lastToolCall).toEqual({ name: 'Bash', argument: 'echo done' })
    expect(activity.lastText).toBe(
      '`note.txt` contains one line: `hello fixture capture`. The command printed `done`.'
    )
  })

  it('the_first_string_fallback_is_used_when_no_candidate_key_is_present', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.running()]
    const path = await subject.streamPath()
    await writeFile(path, StreamLines.toolUse('CustomTool', { unusual: 'sideways' }), 'utf8')

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity.lastToolCall).toEqual({ name: 'CustomTool', argument: 'sideways' })
  })

  it('the_argument_and_the_text_are_truncated_at_the_declared_cap', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.running()]
    const path = await subject.streamPath()
    const longArgument = 'x'.repeat(250)
    const longText = 'y'.repeat(250)
    await writeFile(
      path,
      StreamLines.toolUse('Read', { file_path: longArgument }) + StreamLines.text(longText),
      'utf8'
    )

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity.lastToolCall?.argument).toBe(`${'x'.repeat(200)}…`)
    expect(activity.lastText).toBe(`${'y'.repeat(200)}…`)
  })

  it('the_last_text_block_wins_over_an_earlier_one', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.running()]
    const path = await subject.streamPath()
    await writeFile(path, StreamLines.text('first thought') + StreamLines.text('second thought'), 'utf8')

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity.lastText).toBe('second thought')
  })

  it('an_unknown_block_type_is_ignored_without_raising', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.running()]
    const path = await subject.streamPath()
    await writeFile(
      path,
      `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'pondering' }] } })}\n`,
      'utf8'
    )

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity.toolCalls).toBe(0)
    expect(activity.lastText).toBeNull()
  })

  it('a_malformed_json_line_is_ignored_without_raising', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.running()]
    const path = await subject.streamPath()
    await writeFile(path, 'not json at all\n', 'utf8')

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity.toolCalls).toBe(0)
  })

  it('a_non_assistant_line_is_ignored', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.running()]
    const path = await subject.streamPath()
    await writeFile(path, `${JSON.stringify({ type: 'system', subtype: 'init' })}\n`, 'utf8')

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity.toolCalls).toBe(0)
    expect(activity.lastText).toBeNull()
  })

  it('two_polls_with_content_appended_between_them_give_cumulative_counters', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.running()]
    const path = await subject.streamPath()
    await writeFile(path, StreamLines.toolUse('Read', { file_path: 'a.txt' }), 'utf8')
    const adapter = subject.adapter()
    const first = await adapter.of(Mother.watch())
    expect(first.toolCalls).toBe(1)

    await appendFile(path, StreamLines.toolUse('Write', { file_path: 'b.txt' }), 'utf8')
    const second = await adapter.of(Mother.watch())

    expect(second.toolCalls).toBe(2)
    expect(second.lastToolCall).toEqual({ name: 'Write', argument: 'b.txt' })
  })

  it('a_shorter_file_is_reparsed_from_scratch', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.running()]
    const path = await subject.streamPath()
    await writeFile(
      path,
      StreamLines.toolUse('Read', { file_path: 'a.txt' }) + StreamLines.toolUse('Write', { file_path: 'b.txt' }),
      'utf8'
    )
    const adapter = subject.adapter()
    const first = await adapter.of(Mother.watch())
    expect(first.toolCalls).toBe(2)

    await writeFile(path, StreamLines.toolUse('Grep', { pattern: 'needle' }), 'utf8')
    const second = await adapter.of(Mother.watch())

    expect(second.toolCalls).toBe(1)
    expect(second.lastToolCall).toEqual({ name: 'Grep', argument: 'needle' })
  })

  it('a_trailing_line_with_no_newline_is_left_unread_while_still_running', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.running()]
    const path = await subject.streamPath()
    await writeFile(path, StreamLines.toolUse('Read', { file_path: 'a.txt' }).trimEnd(), 'utf8')

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity.toolCalls).toBe(0)
    expect(activity.lastToolCall).toBeNull()
  })

  it('a_finished_call_catches_up_the_tail_it_had_not_read_yet_including_a_line_with_no_trailing_newline', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.finished(45_000)]
    const path = await subject.streamPath()
    await writeFile(path, StreamLines.toolUse('Read', { file_path: 'a.txt' }).trimEnd(), 'utf8')

    const activity = await subject.adapter().of(Mother.watch())

    expect(activity.state).toBe(PlanningActivityState.FINISHED)
    expect(activity.runningMs).toBe(45_000)
    expect(activity.toolCalls).toBe(1)
    expect(activity.lastToolCall).toEqual({ name: 'Read', argument: 'a.txt' })
  })

  it('a_second_finished_poll_after_the_catch_up_still_answers_the_same_cumulative_counters', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.finished(45_000)]
    const path = await subject.streamPath()
    await writeFile(path, StreamLines.toolUse('Read', { file_path: 'a.txt' }), 'utf8')
    const adapter = subject.adapter()
    const first = await adapter.of(Mother.watch())
    expect(first.toolCalls).toBe(1)

    const second = await adapter.of(Mother.watch())

    expect(second.toolCalls).toBe(1)
    expect(second.lastToolCall).toEqual({ name: 'Read', argument: 'a.txt' })
  })

  it('a_planner_not_resolved_to_exactly_one_call_is_told_apart_from_a_read_failure', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = []

    const refusal = await subject.adapter().of(Mother.watch()).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanningActivityNotRead)
    expect(refusal.message).toMatch(/recorded planner calls/)
  })

  it('a_non_enoent_read_failure_is_told_apart_from_an_unresolved_planner', async () => {
    root = await mkdtemp(join(tmpdir(), 'ct-planning-activity-'))
    const subject = new Subject(root)
    subject.calls.historyRows = [Mother.running()]
    const brokenFs = {
      readFile: async () => {
        throw Object.assign(new Error('permission denied reading the stream'), { code: 'EACCES' })
      },
    } as unknown as typeof fs
    const adapter = new StreamPlanningActivities({
      planCalls: subject.planCalls,
      files: new HeadlessFiles({ root, fs: brokenFs, newId: () => 'temporary-record' }),
      nowMs: () => subject.nowMsValue,
    })

    const refusal = await adapter.of(Mother.watch()).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanningActivityNotRead)
    expect(refusal.message).toMatch(/permission denied reading the stream/)
  })
})

class StreamLines {
  static text(text: string): string {
    return `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })}\n`
  }

  static toolUse(name: string, input: Record<string, unknown>): string {
    return `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })}\n`
  }
}
