import { describe, it, expect } from 'vitest'
import { HeadlessPlanAgents, HarnessCall, HarnessStep } from '../../src/infrastructure/headless-plan-agents.ts'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.ts'
import type { RunSpec, StartedPid } from '../../src/infrastructure/detached-run.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { PlanAgentNotLaunched } from '../../src/domain/exceptions.ts'

class BriefPaths {
  static readonly DISPATCH_CHECK = '/plugin/scripts/dispatch-check.mjs'
  static readonly CONVENTIONS = '/plugin/conventions'
  static readonly CT_STEP = '/plugin/scripts/ct-step.mjs'

  static composed() {
    return {
      dispatchCheck: BriefPaths.DISPATCH_CHECK,
      conventions: BriefPaths.CONVENTIONS,
      ctStep: BriefPaths.CT_STEP,
    }
  }
}

class BriefDouble {
  static readonly ERRAND = 'escribe el plan de #42 en josemerca/ct-loop-sandbox'

  readonly asked: { issue: PlanIssue, repository: RepositoryName }[]

  constructor() {
    this.asked = []
  }

  composing(): PlanAgentBrief {
    const asked = this.asked

    class Composing extends PlanAgentBrief {
      errandFor({ issue, repository }: { issue: PlanIssue, repository: RepositoryName }): string {
        asked.push({ issue, repository })

        return BriefDouble.ERRAND
      }
    }

    return new Composing(BriefPaths.composed())
  }
}

class HeadlessAgent {
  static readonly RUNS_IN = '/state/harness'
  static readonly WORKTREE = '/repo/.worktrees/42'
  static readonly ISSUE = new PlanIssue({ number: 42, url: 'https://github.com/owner/name/issues/42' })
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly WRITE_PLAN_MODEL = 'fable'
  static readonly PLUGIN_ROOT = '/plugin'
  static readonly AGENT = '11111111-2222-3333-4444-555555555555'
  static readonly STARTED_AT = 1_700_000_000_000
  static readonly PID = 4321
  static readonly DIRECTORY =
    `${HeadlessAgent.RUNS_IN}/${HeadlessAgent.AGENT}/${HarnessStep.WRITE_PLAN}-${HeadlessAgent.STARTED_AT}`

  static readonly STREAM_PATH = `${HeadlessAgent.DIRECTORY}/${HarnessCall.STREAM_FILE}`
  static readonly ERROR_PATH = `${HeadlessAgent.DIRECTORY}/${HarnessCall.ERROR_FILE}`
  static readonly CALL_PATH = `${HeadlessAgent.DIRECTORY}/${HarnessCall.CALL_FILE}`
  static readonly CONVERSATION_PATH = `${HeadlessAgent.RUNS_IN}/${HeadlessAgent.AGENT}/conversation.json`

  readonly errands: BriefDouble
  readonly brief: PlanAgentBrief
  readonly startCalls: RunSpec[]
  readonly startAnswer: StartedPid | Error
  readonly makeDirectoryAnswer: Error | null
  readonly conversationWriteAnswer: Error | null
  readonly callWriteAnswer: Error | null
  readonly mintAnswers: string[]
  readonly clockAnswers: number[] | null
  readonly writeCalls: [string, string][]
  readonly makeDirectoryCalls: string[]
  readonly stopCalls: StartedPid[]
  readonly trace: string[]

  constructor({
    startAnswer = { pid: HeadlessAgent.PID },
    makeDirectoryAnswer = null,
    conversationWriteAnswer = null,
    callWriteAnswer = null,
    mintAnswers = [HeadlessAgent.AGENT],
    clockAnswers = null,
  }: {
    startAnswer?: StartedPid | Error,
    makeDirectoryAnswer?: Error | null,
    conversationWriteAnswer?: Error | null,
    callWriteAnswer?: Error | null,
    mintAnswers?: string[],
    clockAnswers?: number[] | null,
  } = {}) {
    this.errands = new BriefDouble()
    this.brief = this.errands.composing()
    this.startCalls = []
    this.startAnswer = startAnswer
    this.makeDirectoryAnswer = makeDirectoryAnswer
    this.conversationWriteAnswer = conversationWriteAnswer
    this.callWriteAnswer = callWriteAnswer
    this.mintAnswers = [...mintAnswers]
    this.clockAnswers = clockAnswers === null ? null : [...clockAnswers]
    this.writeCalls = []
    this.makeDirectoryCalls = []
    this.stopCalls = []
    this.trace = []
  }

  static launching(): HeadlessAgent {
    return new HeadlessAgent()
  }

  static launchingWithAnIncrementingClock(): HeadlessAgent {
    return new HeadlessAgent({ clockAnswers: [HeadlessAgent.STARTED_AT, HeadlessAgent.STARTED_AT + 1] })
  }

  static refusing(failure: Error): HeadlessAgent {
    return new HeadlessAgent({ startAnswer: failure })
  }

  static directoryUnwritable(failure: Error): HeadlessAgent {
    return new HeadlessAgent({ makeDirectoryAnswer: failure })
  }

  static conversationUnwritable(failure: Error): HeadlessAgent {
    return new HeadlessAgent({ conversationWriteAnswer: failure })
  }

  static callUnwritable(failure: Error): HeadlessAgent {
    return new HeadlessAgent({ callWriteAnswer: failure })
  }

  agents(): HeadlessPlanAgents {
    return new HeadlessPlanAgents({
      start: {
        start: (call: RunSpec): StartedPid => {
          this.trace.push('start')
          this.startCalls.push(call)
          if (this.startAnswer instanceof Error) throw this.startAnswer

          return this.startAnswer
        },
        stop: (started: StartedPid): void => {
          this.trace.push('stop')
          this.stopCalls.push(started)
        },
      },
      makeDirectory: (path: string): Promise<void> => {
        this.trace.push('makeDirectory')
        this.makeDirectoryCalls.push(path)
        if (this.makeDirectoryAnswer instanceof Error) throw this.makeDirectoryAnswer

        return Promise.resolve()
      },
      write: (path: string, text: string): Promise<void> => {
        this.trace.push('write')
        const failure = path === HeadlessAgent.CONVERSATION_PATH ? this.conversationWriteAnswer : this.callWriteAnswer
        if (failure instanceof Error) throw failure
        this.writeCalls.push([path, text])

        return Promise.resolve()
      },
      read: (path: string): Promise<string | null> => {
        throw new Error(`launch never reads, it was asked to read ${path}`)
      },
      mint: (): string => {
        const next = this.mintAnswers.shift()
        if (next === undefined) throw new Error('no mint answer queued for launch')

        return next
      },
      clock: (): number => {
        if (this.clockAnswers === null) return HeadlessAgent.STARTED_AT
        const next = this.clockAnswers.shift()
        if (next === undefined) throw new Error('no clock answer queued for launch')

        return next
      },
      brief: this.brief,
      runsIn: HeadlessAgent.RUNS_IN,
      pluginRoot: HeadlessAgent.PLUGIN_ROOT,
    })
  }

  static briefing(): PlanBriefing {
    return new PlanBriefing({
      story: null,
      issue: HeadlessAgent.ISSUE,
      located: new WorkspaceLocation({ path: HeadlessAgent.WORKTREE, branch: 'feat/42' }),
      repository: HeadlessAgent.REPOSITORY,
    })
  }

  static briefingOfAnotherPlan(): PlanBriefing {
    return new PlanBriefing({
      story: null,
      issue: new PlanIssue({ number: 33, url: 'https://github.com/owner/repo/issues/33' }),
      located: new WorkspaceLocation({ path: HeadlessAgent.WORKTREE, branch: 'feat/42' }),
      repository: new RepositoryName('owner/repo'),
    })
  }

  launch(briefing: PlanBriefing = HeadlessAgent.briefing()): Promise<string> {
    return this.agents().launch(briefing)
  }

  async refusal(): Promise<Error> {
    try {
      const agent = await this.launch()
      throw new Error(`expected launch to refuse, but it resolved with ${agent}`)
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause

      return cause
    }
  }

  captured(): unknown {
    return this.capturedAt(HeadlessAgent.CALL_PATH)
  }

  capturedAt(path: string): unknown {
    const found = this.writeCalls.find(([written]) => written === path)

    return found === undefined ? null : JSON.parse(found[1])
  }
}

describe('HeadlessPlanAgents', () => {
  it('the_plan_is_asked_for_with_the_errand_the_brief_composed_and_the_model_its_step_declares', async () => {
    const headless = HeadlessAgent.launching()

    await headless.launch()

    expect(headless.startCalls[0].argv).toEqual([
      '-p', BriefDouble.ERRAND,
      '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'bypassPermissions',
      '--fallback-model', 'opus',
      '--model', HeadlessAgent.WRITE_PLAN_MODEL,
      '--plugin-dir', HeadlessAgent.PLUGIN_ROOT,
      '--session-id', HeadlessAgent.AGENT,
    ])
    expect(headless.errands.asked).toEqual([{ issue: HeadlessAgent.ISSUE, repository: HeadlessAgent.REPOSITORY }])
  })

  it('the_conversation_carries_the_id_the_adapter_imposed_and_not_one_read_back', async () => {
    const headless = HeadlessAgent.launching()

    const agent = await headless.launch()

    expect(agent).toBe(HeadlessAgent.AGENT)
    expect(headless.startCalls[0].argv).toContain('--session-id')
    expect(headless.startCalls[0].argv).not.toContain('--resume')
  })

  it('the_call_leaves_its_step_and_its_model_on_disk_because_no_reader_can_recover_them_later', async () => {
    const headless = HeadlessAgent.launching()

    await headless.launch()

    const call = headless.captured() as Record<string, unknown>

    expect(Object.keys(call)).toEqual([
      'step', 'agent', 'issue', 'repository', 'model', 'argv', 'pid', 'startedAt',
    ])
    expect(call.step).toBe(HarnessStep.WRITE_PLAN)
    expect(call.model).toBe(HeadlessAgent.WRITE_PLAN_MODEL)
    expect(call.agent).toBe(HeadlessAgent.AGENT)
    expect(call.issue).toBe(HeadlessAgent.ISSUE.number)
    expect(call.repository).toBe(HeadlessAgent.REPOSITORY.text)
    expect(call.pid).toBe(HeadlessAgent.PID)
    expect(call.startedAt).toBe(HeadlessAgent.STARTED_AT)
    expect(call.argv).toEqual(headless.startCalls[0].argv)
  })

  it('the_stream_of_the_call_and_its_diagnosis_are_two_different_files', async () => {
    const headless = HeadlessAgent.launching()

    await headless.launch()

    expect(headless.startCalls[0].out).toBe(HeadlessAgent.STREAM_PATH)
    expect(headless.startCalls[0].err).toBe(HeadlessAgent.ERROR_PATH)
    expect(headless.startCalls[0].out).not.toBe(headless.startCalls[0].err)
  })

  it('the_plan_is_written_in_the_worktree_that_was_prepared_and_not_where_the_api_runs', async () => {
    const headless = HeadlessAgent.launching()

    await headless.launch()

    expect(headless.startCalls[0].cwd).toBe(HeadlessAgent.WORKTREE)
    expect(headless.startCalls[0].cwd).not.toBe(process.cwd())
  })

  it(
    'a_call_that_cannot_be_started_writes_no_call_json_even_though_its_directory_and_' +
    'conversation_record_already_landed',
    async () => {
      const headless = HeadlessAgent.refusing(new PlanAgentNotLaunched('spawn assigned no pid to "claude"'))

      const refusal = await headless.refusal()

      expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
      expect(headless.writeCalls.some(([path]) => path === HeadlessAgent.CALL_PATH)).toBe(false)
      expect(headless.writeCalls.some(([path]) => path === HeadlessAgent.CONVERSATION_PATH)).toBe(true)
      expect(headless.makeDirectoryCalls).toEqual([HeadlessAgent.DIRECTORY])
    }
  )

  it('a_raw_error_that_escapes_the_start_of_a_launch_becomes_the_launch_cause_with_its_message_kept', async () => {
    const headless = HeadlessAgent.refusing(new Error('ENOENT: no such file or directory, open \'stream.ndjson\''))

    const refusal = await headless.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.message).toBe('ENOENT: no such file or directory, open \'stream.ndjson\'')
  })

  it('the_run_directory_is_made_with_the_composed_path_so_the_files_inside_it_have_somewhere_to_land', async () => {
    const headless = HeadlessAgent.launching()

    await headless.launch()

    expect(headless.makeDirectoryCalls).toEqual([HeadlessAgent.DIRECTORY])
  })

  it(
    'the_directory_is_made_first_because_detached_run_opens_its_paths_and_fails_without_it_' +
    'and_the_conversation_is_recorded_before_the_call_starts_because_spawning_cannot_be_undone',
    async () => {
      const headless = HeadlessAgent.launching()

      await headless.launch()

      expect(headless.trace).toEqual(['makeDirectory', 'write', 'start', 'write'])
    }
  )

  it(
    'a_directory_that_cannot_be_made_raises_the_same_family_as_a_refused_launch_so_start_plan_never_sees_a_raw_node_error',
    async () => {
      const headless = HeadlessAgent.directoryUnwritable(new Error('EACCES: permission denied'))

      const refusal = await headless.refusal()

      expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
      expect(refusal.message).toContain(HeadlessAgent.DIRECTORY)
    }
  )

  it(
    'a_call_record_that_cannot_be_written_raises_the_same_family_as_a_refused_launch_so_start_plan_never_sees_a_raw_node_error',
    async () => {
      const headless = HeadlessAgent.callUnwritable(new Error('ENOSPC: no space left on device'))

      const refusal = await headless.refusal()

      expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
      expect(refusal.message).toContain(HeadlessAgent.CALL_PATH)
    }
  )

  it(
    'a_call_record_that_cannot_be_written_after_the_launch_already_started_signals_the_group_it_would_otherwise_leave_running',
    async () => {
      const headless = HeadlessAgent.callUnwritable(new Error('ENOSPC: no space left on device'))

      const refusal = await headless.refusal()

      expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
      expect(headless.stopCalls).toHaveLength(1)
      expect(headless.stopCalls[0].pid).toBe(HeadlessAgent.PID)
    }
  )

  it(
    'a_conversation_record_that_cannot_be_written_refuses_before_anything_starts_so_a_filesystem_that_' +
    'cannot_take_it_never_launches_a_call',
    async () => {
      const headless = HeadlessAgent.conversationUnwritable(new Error('ENOSPC: no space left on device'))

      const refusal = await headless.refusal()

      expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
      expect(refusal.message).toContain(HeadlessAgent.CONVERSATION_PATH)
      expect(headless.startCalls).toEqual([])
    }
  )

  it(
    'bin_names_the_binary_that_gets_spawned_as_claude_p_and_is_pinned_because_it_crosses_the_edge_into_a_real_process',
    () => {
      expect(HeadlessPlanAgents.BIN).toBe('claude')
    }
  )
})

describe('HeadlessPlanAgents recording which plan a conversation attends and refusing an ill-formed record', () => {
  it('launch_records_which_plan_the_conversation_attends_and_when_it_started', async () => {
    const headless = HeadlessAgent.launching()

    await headless.launch(HeadlessAgent.briefingOfAnotherPlan())

    const written = headless.capturedAt(HeadlessAgent.CONVERSATION_PATH)

    expect(written).toEqual({
      worktree: HeadlessAgent.WORKTREE,
      issue: 33,
      repository: 'owner/repo',
      startedAt: HeadlessAgent.STARTED_AT,
    })
  })

  it('launch_reads_the_clock_once_so_the_conversation_and_its_first_call_share_the_same_instant', async () => {
    const headless = HeadlessAgent.launchingWithAnIncrementingClock()

    await headless.launch()

    const conversation = headless.capturedAt(HeadlessAgent.CONVERSATION_PATH) as Record<string, unknown>
    const call = headless.capturedAt(HeadlessAgent.CALL_PATH) as Record<string, unknown>

    expect(conversation.startedAt).toBe(call.startedAt)
  })
})

describe('HeadlessPlanAgents.argvFor', () => {
  it('a_conversation_being_resumed_carries_resume_and_not_a_fresh_session_id', () => {
    const argv = HeadlessPlanAgents.argvFor({
      errand: 'implementa el plan', step: HarnessStep.IMPLEMENT, pluginRoot: '/plugin', agent: 'abc', resuming: true,
    })

    expect(argv.slice(-2)).toEqual(['--resume', 'abc'])
    expect(argv).not.toContain('--session-id')
  })

  it(
    'every_call_carries_the_fallback_model_the_cli_uses_when_the_default_is_overloaded_or_not_available',
    () => {
      const argv = HeadlessPlanAgents.argvFor({
        errand: 'implementa el plan', step: HarnessStep.IMPLEMENT, pluginRoot: '/plugin', agent: 'abc', resuming: true,
      })

      expect(argv).toContain('--fallback-model')
      expect(argv[argv.indexOf('--fallback-model') + 1]).toBe('opus')
    }
  )

  it('a_step_no_model_was_declared_for_raises_instead_of_asking_for_undefined', () => {
    expect(() => HeadlessPlanAgents.argvFor({
      errand: 'x', step: 'invented-step', pluginRoot: '/plugin', agent: 'abc', resuming: false,
    })).toThrow(/no model declared for invented-step/)
  })
})

describe('HeadlessPlanAgents.MODELS', () => {
  it(
    'every_member_of_HarnessStep_has_a_model_declared_so_a_fifth_step_could_not_quietly_ask_for_undefined',
    () => {
      expect(HeadlessPlanAgents.MODELS.members().sort()).toEqual(Object.values(HarnessStep).sort())
    }
  )

  it('the_plan_and_its_review_are_asked_of_fable_and_the_implementation_and_its_fixes_of_sonnet', () => {
    expect(HeadlessPlanAgents.MODELS.of(HarnessStep.WRITE_PLAN)).toBe('fable')
    expect(HeadlessPlanAgents.MODELS.of(HarnessStep.REVIEW_PLAN)).toBe('fable')
    expect(HeadlessPlanAgents.MODELS.of(HarnessStep.IMPLEMENT)).toBe('sonnet')
    expect(HeadlessPlanAgents.MODELS.of(HarnessStep.FIX_PULL_REQUEST)).toBe('sonnet')
  })
})

describe('HeadlessPlanAgents.conversationPathFor', () => {
  it('composes_the_same_path_launch_writes_the_conversation_record_to', async () => {
    const headless = HeadlessAgent.launching()

    await headless.launch()

    const [conversationWrittenTo] = headless.writeCalls[0]

    expect(conversationWrittenTo).toBe(
      HeadlessPlanAgents.conversationPathFor({ runsIn: HeadlessAgent.RUNS_IN, agent: HeadlessAgent.AGENT })
    )
  })
})

describe('HarnessStep', () => {
  it('names_the_four_literal_steps_a_call_can_be_and_is_frozen_so_none_can_be_added', () => {
    expect(HarnessStep).toEqual({
      WRITE_PLAN: 'write-plan',
      REVIEW_PLAN: 'review-plan',
      IMPLEMENT: 'implement',
      FIX_PULL_REQUEST: 'fix-pull-request',
    })
    expect(Object.isFrozen(HarnessStep)).toBe(true)
  })
})

describe('HarnessCall', () => {
  it('names_the_three_literal_files_a_call_leaves_on_disk', () => {
    expect(HarnessCall.CALL_FILE).toBe('call.json')
    expect(HarnessCall.STREAM_FILE).toBe('stream.ndjson')
    expect(HarnessCall.ERROR_FILE).toBe('stderr.log')
  })

  it('pathsFor_composes_the_directory_and_the_three_files_a_call_leaves_inside_it', () => {
    const paths = HarnessCall.pathsFor({
      runsIn: HeadlessAgent.RUNS_IN,
      agent: HeadlessAgent.AGENT,
      step: HarnessStep.WRITE_PLAN,
      startedAt: HeadlessAgent.STARTED_AT,
    })

    expect(paths.directory).toBe(HeadlessAgent.DIRECTORY)
    expect(paths.out).toBe(HeadlessAgent.STREAM_PATH)
    expect(paths.err).toBe(HeadlessAgent.ERROR_PATH)
    expect(paths.call).toBe(HeadlessAgent.CALL_PATH)
  })
})
