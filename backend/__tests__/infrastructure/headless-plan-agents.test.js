import { describe, it, expect } from 'vitest'
import { HeadlessPlanAgents, HarnessCall, HarnessStep } from '../../src/infrastructure/headless-plan-agents.js'
import { StartedRun } from '../../src/infrastructure/detached-run.js'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PlanAgentNotLaunched } from '../../src/domain/exceptions.js'

class BriefDouble {
  static ERRAND = 'escribe el plan de #42 en josemerca/ct-loop-sandbox'

  constructor() {
    this.asked = []
  }

  errandFor({ issue, repository }) {
    this.asked.push({ issue, repository })

    return BriefDouble.ERRAND
  }
}

class HeadlessAgent {
  static RUNS_IN = '/state/harness'
  static WORKTREE = '/repo/.worktrees/42'
  static ISSUE = new PlanIssue({ number: 42, url: 'https://github.com/owner/name/issues/42' })
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static MODEL = 'opus'
  static PLUGIN_ROOT = '/plugin'
  static AGENT = '11111111-2222-3333-4444-555555555555'
  static STARTED_AT = 1_700_000_000_000
  static PID = 4321
  static DIRECTORY =
    `${HeadlessAgent.RUNS_IN}/${HeadlessAgent.AGENT}/${HarnessStep.WRITE_PLAN}-${HeadlessAgent.STARTED_AT}`

  static STREAM_PATH = `${HeadlessAgent.DIRECTORY}/${HarnessCall.STREAM_FILE}`
  static ERROR_PATH = `${HeadlessAgent.DIRECTORY}/${HarnessCall.ERROR_FILE}`
  static CALL_PATH = `${HeadlessAgent.DIRECTORY}/${HarnessCall.CALL_FILE}`

  constructor({ startAnswer = new StartedRun({ pid: HeadlessAgent.PID }) } = {}) {
    this.brief = new BriefDouble()
    this.startCalls = []
    this.startAnswer = startAnswer
    this.writeCalls = []
    this.trace = []
  }

  static launching() {
    return new HeadlessAgent()
  }

  static refusing(failure) {
    return new HeadlessAgent({ startAnswer: failure })
  }

  agents() {
    return new HeadlessPlanAgents({
      start: {
        start: (call) => {
          this.trace.push('start')
          this.startCalls.push(call)
          if (this.startAnswer instanceof Error) throw this.startAnswer

          return this.startAnswer
        },
      },
      write: (path, text) => {
        this.trace.push('write')
        this.writeCalls.push([path, text])

        return Promise.resolve()
      },
      mint: () => HeadlessAgent.AGENT,
      clock: () => HeadlessAgent.STARTED_AT,
      brief: this.brief,
      runsIn: HeadlessAgent.RUNS_IN,
      model: HeadlessAgent.MODEL,
      pluginRoot: HeadlessAgent.PLUGIN_ROOT,
    })
  }

  static briefing() {
    return new PlanBriefing({
      story: null,
      issue: HeadlessAgent.ISSUE,
      located: new WorkspaceLocation({ path: HeadlessAgent.WORKTREE, branch: 'feat/42' }),
      repository: HeadlessAgent.REPOSITORY,
    })
  }

  launch(briefing = HeadlessAgent.briefing()) {
    return this.agents().launch(briefing)
  }

  refusal() {
    return this.launch().catch((cause) => cause)
  }

  captured() {
    const found = this.writeCalls.find(([path]) => path === HeadlessAgent.CALL_PATH)

    return found === undefined ? null : JSON.parse(found[1])
  }
}

describe('HeadlessPlanAgents', () => {
  it('the_plan_is_asked_for_with_the_errand_the_brief_composed_and_the_model_it_was_given', async () => {
    const headless = HeadlessAgent.launching()

    await headless.launch()

    expect(headless.startCalls[0].argv).toEqual([
      '-p', BriefDouble.ERRAND,
      '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'bypassPermissions',
      '--model', HeadlessAgent.MODEL,
      '--plugin-dir', HeadlessAgent.PLUGIN_ROOT,
      '--session-id', HeadlessAgent.AGENT,
    ])
    expect(headless.brief.asked).toEqual([{ issue: HeadlessAgent.ISSUE, repository: HeadlessAgent.REPOSITORY }])
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

    const call = headless.captured()

    expect(Object.keys(call)).toEqual([
      'step', 'agent', 'issue', 'repository', 'model', 'argv', 'pid', 'startedAt',
    ])
    expect(call.step).toBe(HarnessStep.WRITE_PLAN)
    expect(call.model).toBe(HeadlessAgent.MODEL)
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

  it('a_call_that_cannot_be_started_refuses_without_leaving_a_conversation_behind', async () => {
    const headless = HeadlessAgent.refusing(new PlanAgentNotLaunched('spawn assigned no pid to "claude"'))

    const refusal = await headless.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(headless.writeCalls.some(([path]) => path === HeadlessAgent.CALL_PATH)).toBe(false)
  })

  it('the_out_file_is_touched_before_the_process_is_started_so_its_directory_already_exists', async () => {
    const headless = HeadlessAgent.launching()

    await headless.launch()

    expect(headless.trace).toEqual(['write', 'start', 'write'])
    expect(headless.writeCalls[0]).toEqual([HeadlessAgent.STREAM_PATH, ''])
  })
})

describe('HeadlessPlanAgents.argvFor', () => {
  it('a_conversation_being_resumed_carries_resume_and_not_a_fresh_session_id', () => {
    const argv = HeadlessPlanAgents.argvFor({
      errand: 'implementa el plan', model: 'opus', pluginRoot: '/plugin', agent: 'abc', resuming: true,
    })

    expect(argv.slice(-2)).toEqual(['--resume', 'abc'])
    expect(argv).not.toContain('--session-id')
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

  it('is_frozen_so_nothing_downstream_of_launch_can_mutate_the_record_it_wrote', () => {
    const call = new HarnessCall({
      step: HarnessStep.WRITE_PLAN,
      agent: HeadlessAgent.AGENT,
      issue: HeadlessAgent.ISSUE,
      repository: HeadlessAgent.REPOSITORY,
      model: HeadlessAgent.MODEL,
      argv: [],
      pid: HeadlessAgent.PID,
      startedAt: HeadlessAgent.STARTED_AT,
    })

    expect(Object.isFrozen(call)).toBe(true)
  })
})
