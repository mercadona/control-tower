import { describe, it, expect } from 'vitest'
import {
  HeadlessPlanAgents, HarnessCall, HarnessStep, HarnessPaths,
} from '../../src/infrastructure/headless-plan-agents.js'
import { StartedRun } from '../../src/infrastructure/detached-run.js'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PlanAgentNotLaunched, PlanAgentNotNamed, PlanAgentNotResumed } from '../../src/domain/exceptions.js'

class BriefDouble {
  static ERRAND = 'escribe el plan de #42 en josemerca/ct-loop-sandbox'
  static IMPLEMENTATION_ERRAND = 'implementa el plan de #42 en josemerca/ct-loop-sandbox'
  static REVIEW_ERRAND = 'rehaz el plan de #42 en josemerca/ct-loop-sandbox'
  static FIX_ERRAND = 'corrige la pull request de #42 en josemerca/ct-loop-sandbox'

  constructor() {
    this.asked = []
    this.implementationAsked = []
    this.reviewAsked = []
    this.fixAsked = []
  }

  errandFor({ issue, repository }) {
    this.asked.push({ issue, repository })

    return BriefDouble.ERRAND
  }

  implementationErrandFor({ issueNumber, repository }) {
    this.implementationAsked.push({ issueNumber, repository })

    return BriefDouble.IMPLEMENTATION_ERRAND
  }

  reviewErrandFor({ issueNumber, repository, changes }) {
    this.reviewAsked.push({ issueNumber, repository, changes })

    return BriefDouble.REVIEW_ERRAND
  }

  fixErrandFor({ issueNumber, repository, changes }) {
    this.fixAsked.push({ issueNumber, repository, changes })

    return BriefDouble.FIX_ERRAND
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
  static OTHER_AGENT = '66666666-7777-8888-9999-000000000000'
  static NEVER_LAUNCHED = 'ffffffff-1111-2222-3333-444444444444'
  static OTHER_WORKTREE = '/repo/.worktrees/99'
  static STARTED_AT = 1_700_000_000_000
  static PID = 4321
  static DIRECTORY =
    `${HeadlessAgent.RUNS_IN}/${HeadlessAgent.AGENT}/${HarnessStep.WRITE_PLAN}-${HeadlessAgent.STARTED_AT}`

  static STREAM_PATH = `${HeadlessAgent.DIRECTORY}/${HarnessCall.STREAM_FILE}`
  static ERROR_PATH = `${HeadlessAgent.DIRECTORY}/${HarnessCall.ERROR_FILE}`
  static CALL_PATH = `${HeadlessAgent.DIRECTORY}/${HarnessCall.CALL_FILE}`
  static CONVERSATION_PATH = `${HeadlessAgent.RUNS_IN}/${HeadlessAgent.AGENT}/conversation.json`
  static NOT_JSON_TEXT = 'not-json{'
  static ISSUE_NUMBER = HeadlessAgent.ISSUE.number
  static CHANGES = 'quita el mock y usa git de verdad'
  static IMPLEMENT_DIRECTORY =
    `${HeadlessAgent.RUNS_IN}/${HeadlessAgent.AGENT}/${HarnessStep.IMPLEMENT}-${HeadlessAgent.STARTED_AT}`
  static IMPLEMENT_CALL_PATH = `${HeadlessAgent.IMPLEMENT_DIRECTORY}/${HarnessCall.CALL_FILE}`
  static REVIEW_DIRECTORY =
    `${HeadlessAgent.RUNS_IN}/${HeadlessAgent.AGENT}/${HarnessStep.REVIEW_PLAN}-${HeadlessAgent.STARTED_AT}`
  static REVIEW_CALL_PATH = `${HeadlessAgent.REVIEW_DIRECTORY}/${HarnessCall.CALL_FILE}`
  static FIX_DIRECTORY =
    `${HeadlessAgent.RUNS_IN}/${HeadlessAgent.AGENT}/${HarnessStep.FIX_PULL_REQUEST}-${HeadlessAgent.STARTED_AT}`
  static FIX_CALL_PATH = `${HeadlessAgent.FIX_DIRECTORY}/${HarnessCall.CALL_FILE}`

  constructor({
    startAnswer = new StartedRun({ pid: HeadlessAgent.PID }),
    makeDirectoryAnswer = null,
    conversationWriteAnswer = null,
    callWriteAnswer = null,
    readAnswer = null,
    mintAnswers = [HeadlessAgent.AGENT],
  } = {}) {
    this.brief = new BriefDouble()
    this.startCalls = []
    this.startAnswer = startAnswer
    this.makeDirectoryAnswer = makeDirectoryAnswer
    this.conversationWriteAnswer = conversationWriteAnswer
    this.callWriteAnswer = callWriteAnswer
    this.readAnswer = readAnswer
    this.mintAnswers = [...mintAnswers]
    this.writeCalls = []
    this.makeDirectoryCalls = []
    this.trace = []
  }

  static launching() {
    return new HeadlessAgent()
  }

  static launchingTwoConversations() {
    return new HeadlessAgent({ mintAnswers: [HeadlessAgent.AGENT, HeadlessAgent.OTHER_AGENT] })
  }

  static refusing(failure) {
    return new HeadlessAgent({ startAnswer: failure })
  }

  static directoryUnwritable(failure) {
    return new HeadlessAgent({ makeDirectoryAnswer: failure })
  }

  static conversationUnwritable(failure) {
    return new HeadlessAgent({ conversationWriteAnswer: failure })
  }

  static callUnwritable(failure) {
    return new HeadlessAgent({ callWriteAnswer: failure })
  }

  static conversationReadRefused(failure) {
    return new HeadlessAgent({ readAnswer: failure })
  }

  static conversationUnreadable() {
    const headless = new HeadlessAgent()
    headless.recordConversation(HeadlessAgent.NOT_JSON_TEXT)

    return headless
  }

  static conversationMissingWorktree() {
    const headless = new HeadlessAgent()
    headless.recordConversation(JSON.stringify({ note: 'no worktree in here' }))

    return headless
  }

  static conversationRecordedAsNull() {
    const headless = new HeadlessAgent()
    headless.recordConversation('null')

    return headless
  }

  static resuming(overrides = {}) {
    const headless = new HeadlessAgent(overrides)
    headless.recordConversation(JSON.stringify({ worktree: HeadlessAgent.WORKTREE }))

    return headless
  }

  recordConversation(text) {
    this.writeCalls.push([HeadlessAgent.CONVERSATION_PATH, text])
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
      makeDirectory: (path) => {
        this.trace.push('makeDirectory')
        this.makeDirectoryCalls.push(path)
        if (this.makeDirectoryAnswer instanceof Error) throw this.makeDirectoryAnswer

        return Promise.resolve()
      },
      write: (path, text) => {
        this.trace.push('write')
        const failure = path === HeadlessAgent.CONVERSATION_PATH ? this.conversationWriteAnswer : this.callWriteAnswer
        if (failure instanceof Error) throw failure
        this.writeCalls.push([path, text])

        return Promise.resolve()
      },
      read: (path) => {
        this.trace.push('read')
        if (this.readAnswer instanceof Error) throw this.readAnswer

        const found = this.writeCalls.find(([written]) => written === path)

        return Promise.resolve(found === undefined ? null : found[1])
      },
      mint: () => {
        if (this.mintAnswers.length === 0) throw new Error('no mint answer queued for launch')

        return this.mintAnswers.shift()
      },
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

  static otherBriefing() {
    return new PlanBriefing({
      story: null,
      issue: HeadlessAgent.ISSUE,
      located: new WorkspaceLocation({ path: HeadlessAgent.OTHER_WORKTREE, branch: 'feat/99' }),
      repository: HeadlessAgent.REPOSITORY,
    })
  }

  launch(briefing = HeadlessAgent.briefing()) {
    return this.agents().launch(briefing)
  }

  resume(agent = HeadlessAgent.AGENT, overrides = {}) {
    return this.agents().resume({
      agent,
      issue: HeadlessAgent.ISSUE_NUMBER,
      repository: HeadlessAgent.REPOSITORY,
      ...overrides,
    })
  }

  review(agent = HeadlessAgent.AGENT, overrides = {}) {
    return this.agents().review({
      agent,
      issue: HeadlessAgent.ISSUE_NUMBER,
      repository: HeadlessAgent.REPOSITORY,
      changes: HeadlessAgent.CHANGES,
      ...overrides,
    })
  }

  fix(agent = HeadlessAgent.AGENT, overrides = {}) {
    return this.agents().fix({
      agent,
      issue: HeadlessAgent.ISSUE_NUMBER,
      repository: HeadlessAgent.REPOSITORY,
      changes: HeadlessAgent.CHANGES,
      ...overrides,
    })
  }

  refusal() {
    return this.launch().catch((cause) => cause)
  }

  resumeRefusal(agent) {
    return this.resume(agent).catch((cause) => cause)
  }

  captured() {
    return this.capturedAt(HeadlessAgent.CALL_PATH)
  }

  capturedAt(path) {
    const found = this.writeCalls.find(([written]) => written === path)

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

  it('a_call_that_cannot_be_started_leaves_no_record_of_a_call_that_never_ran', async () => {
    const headless = HeadlessAgent.refusing(new PlanAgentNotLaunched('spawn assigned no pid to "claude"'))

    const refusal = await headless.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(headless.writeCalls.some(([path]) => path === HeadlessAgent.CALL_PATH)).toBe(false)
    expect(headless.makeDirectoryCalls).toEqual([HeadlessAgent.DIRECTORY])
  })

  it('the_run_directory_is_made_with_the_composed_path_so_the_files_inside_it_have_somewhere_to_land', async () => {
    const headless = HeadlessAgent.launching()

    await headless.launch()

    expect(headless.makeDirectoryCalls).toEqual([HeadlessAgent.DIRECTORY])
  })

  it('the_directory_is_made_first_because_detached_run_opens_its_paths_and_fails_without_it_and_the_conversation_is_recorded_before_the_call_starts_because_spawning_cannot_be_undone', async () => {
    const headless = HeadlessAgent.launching()

    await headless.launch()

    expect(headless.trace).toEqual(['makeDirectory', 'write', 'start', 'write'])
  })

  it('a_directory_that_cannot_be_made_raises_the_same_family_as_a_refused_launch_so_start_plan_never_sees_a_raw_node_error', async () => {
    const headless = HeadlessAgent.directoryUnwritable(new Error('EACCES: permission denied'))

    const refusal = await headless.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.message).toContain(HeadlessAgent.DIRECTORY)
  })

  it('a_call_record_that_cannot_be_written_raises_the_same_family_as_a_refused_launch_so_start_plan_never_sees_a_raw_node_error', async () => {
    const headless = HeadlessAgent.callUnwritable(new Error('ENOSPC: no space left on device'))

    const refusal = await headless.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.message).toContain(HeadlessAgent.CALL_PATH)
  })

  it('a_conversation_record_that_cannot_be_written_refuses_before_anything_starts_so_a_filesystem_that_cannot_take_it_never_launches_a_call', async () => {
    const headless = HeadlessAgent.conversationUnwritable(new Error('ENOSPC: no space left on device'))

    const refusal = await headless.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.message).toContain(HeadlessAgent.CONVERSATION_PATH)
    expect(headless.startCalls).toEqual([])
  })

  it('bin_names_the_binary_that_gets_spawned_as_claude_p_and_is_pinned_because_it_crosses_the_edge_into_a_real_process', () => {
    expect(HeadlessPlanAgents.BIN).toBe('claude')
  })
})

describe('HeadlessPlanAgents recording the worktree of a conversation', () => {
  it('a_conversation_records_the_worktree_its_calls_have_to_run_in', async () => {
    const headless = HeadlessAgent.launching()

    await headless.launch()

    const written = headless.writeCalls.find(([path]) => path === HeadlessAgent.CONVERSATION_PATH)

    expect(written?.[1]).toBe(`{"worktree":"${HeadlessAgent.WORKTREE}"}`)
  })

  it('two_conversations_do_not_share_the_worktree_they_recorded', async () => {
    const headless = HeadlessAgent.launchingTwoConversations()

    const first = await headless.launch(HeadlessAgent.briefing())
    const second = await headless.launch(HeadlessAgent.otherBriefing())
    await headless.resume(first)
    await headless.resume(second)

    expect(first).not.toBe(second)
    expect(headless.startCalls[2].cwd).toBe(HeadlessAgent.WORKTREE)
    expect(headless.startCalls[3].cwd).toBe(HeadlessAgent.OTHER_WORKTREE)
  })

  it('a_conversation_whose_worktree_was_never_recorded_refuses_instead_of_guessing_one', async () => {
    const headless = HeadlessAgent.launching()

    const refusal = await headless.resumeRefusal(HeadlessAgent.NEVER_LAUNCHED)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message.startsWith(HeadlessAgent.NEVER_LAUNCHED)).toBe(true)
  })

  it('a_conversation_file_that_cannot_be_read_raises_the_same_family_as_a_refused_resume_so_nothing_sees_a_raw_node_error', async () => {
    const headless = HeadlessAgent.conversationReadRefused(new Error('EACCES: permission denied'))

    const refusal = await headless.resumeRefusal(HeadlessAgent.AGENT)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message).toContain(HeadlessAgent.CONVERSATION_PATH)
  })

  it('a_conversation_recorded_as_something_that_is_not_json_refuses_instead_of_letting_a_syntax_error_escape', async () => {
    const headless = HeadlessAgent.conversationUnreadable()

    const refusal = await headless.resumeRefusal(HeadlessAgent.AGENT)

    let parserSaid
    try {
      JSON.parse(HeadlessAgent.NOT_JSON_TEXT)
      throw new Error('expected JSON.parse to throw on ' + HeadlessAgent.NOT_JSON_TEXT)
    } catch (cause) {
      parserSaid = cause.message
    }

    expect(refusal).toBeInstanceOf(PlanAgentNotNamed)
    expect(refusal.message).toBe(
      `${HeadlessAgent.AGENT} recorded a conversation at ${HeadlessAgent.CONVERSATION_PATH} that is not JSON: ${parserSaid}`
    )
  })

  it('a_conversation_recorded_with_no_worktree_refuses_instead_of_answering_undefined_as_a_cwd', async () => {
    const headless = HeadlessAgent.conversationMissingWorktree()

    const refusal = await headless.resumeRefusal(HeadlessAgent.AGENT)

    expect(refusal).toBeInstanceOf(PlanAgentNotNamed)
    expect(refusal.message).toBe(
      `${HeadlessAgent.AGENT} recorded a conversation at ${HeadlessAgent.CONVERSATION_PATH} with no worktree`
    )
  })

  it('a_conversation_recorded_as_the_json_literal_null_refuses_instead_of_crashing_on_null_dot_worktree', async () => {
    const headless = HeadlessAgent.conversationRecordedAsNull()

    const refusal = await headless.resumeRefusal(HeadlessAgent.AGENT)

    expect(refusal).toBeInstanceOf(PlanAgentNotNamed)
    expect(refusal.message).toBe(
      `${HeadlessAgent.AGENT} recorded a conversation at ${HeadlessAgent.CONVERSATION_PATH} with no worktree`
    )
  })

  it('a_conversation_that_cannot_be_understood_is_not_the_same_family_as_one_whose_read_was_refused', async () => {
    const notUnderstood = await HeadlessAgent.conversationUnreadable().resumeRefusal(HeadlessAgent.AGENT)
    const refused = await HeadlessAgent.conversationReadRefused(
      new Error('EACCES: permission denied')
    ).resumeRefusal(HeadlessAgent.AGENT)

    expect(notUnderstood).toBeInstanceOf(PlanAgentNotNamed)
    expect(refused).toBeInstanceOf(PlanAgentNotResumed)
    expect(notUnderstood).not.toBeInstanceOf(PlanAgentNotResumed)
    expect(refused).not.toBeInstanceOf(PlanAgentNotNamed)
  })
})

describe('HeadlessPlanAgents continuing a conversation', () => {
  it('the_go_hands_the_implementation_errand_to_the_conversation_that_wrote_the_plan', async () => {
    const headless = HeadlessAgent.resuming()

    await headless.resume()

    expect(headless.startCalls[0].argv).toEqual([
      '-p', BriefDouble.IMPLEMENTATION_ERRAND,
      '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'bypassPermissions',
      '--model', HeadlessAgent.MODEL,
      '--plugin-dir', HeadlessAgent.PLUGIN_ROOT,
      '--resume', HeadlessAgent.AGENT,
    ])
    expect(headless.startCalls[0].argv).not.toContain('--session-id')
    expect(headless.brief.implementationAsked).toEqual([
      { issueNumber: HeadlessAgent.ISSUE_NUMBER, repository: HeadlessAgent.REPOSITORY },
    ])
  })

  it('the_implementation_runs_in_the_worktree_where_the_plan_was_written_and_not_where_the_api_runs', async () => {
    const headless = HeadlessAgent.resuming()

    await headless.resume()

    expect(headless.startCalls[0].cwd).toBe(HeadlessAgent.WORKTREE)
    expect(headless.startCalls[0].cwd).not.toBe(process.cwd())
  })

  it('a_second_call_on_one_conversation_leaves_a_second_record_beside_the_first', async () => {
    const headless = HeadlessAgent.launching()

    await headless.launch()
    await headless.resume()

    expect(headless.makeDirectoryCalls).toEqual([HeadlessAgent.DIRECTORY, HeadlessAgent.IMPLEMENT_DIRECTORY])
    expect(headless.capturedAt(HeadlessAgent.CALL_PATH).step).toBe(HarnessStep.WRITE_PLAN)
    expect(headless.capturedAt(HeadlessAgent.IMPLEMENT_CALL_PATH).step).toBe(HarnessStep.IMPLEMENT)
    expect(headless.startCalls[1].out).toBe(`${HeadlessAgent.IMPLEMENT_DIRECTORY}/${HarnessCall.STREAM_FILE}`)
    expect(headless.startCalls[1].err).toBe(`${HeadlessAgent.IMPLEMENT_DIRECTORY}/${HarnessCall.ERROR_FILE}`)
  })

  it('the_changes_a_person_asked_for_travel_in_the_errand_of_the_review_call', async () => {
    const headless = HeadlessAgent.resuming()

    await headless.review()

    expect(headless.startCalls[0].argv).toContain(BriefDouble.REVIEW_ERRAND)
    expect(headless.brief.reviewAsked).toEqual([
      { issueNumber: HeadlessAgent.ISSUE_NUMBER, repository: HeadlessAgent.REPOSITORY, changes: HeadlessAgent.CHANGES },
    ])
    expect(headless.capturedAt(HeadlessAgent.REVIEW_CALL_PATH).step).toBe(HarnessStep.REVIEW_PLAN)
  })

  it('a_directory_that_cannot_be_made_for_a_continuation_raises_the_same_family_as_a_refused_resume_so_nothing_sees_a_raw_node_error', async () => {
    const headless = HeadlessAgent.resuming({ makeDirectoryAnswer: new Error('EACCES: permission denied') })

    const refusal = await headless.resumeRefusal(HeadlessAgent.AGENT)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message).toContain(HeadlessAgent.IMPLEMENT_DIRECTORY)
  })

  it('a_call_record_that_cannot_be_written_for_a_continuation_raises_the_same_family_as_a_refused_resume_so_nothing_sees_a_raw_node_error', async () => {
    const headless = HeadlessAgent.resuming({ callWriteAnswer: new Error('ENOSPC: no space left on device') })

    const refusal = await headless.resumeRefusal(HeadlessAgent.AGENT)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message).toContain(HeadlessAgent.IMPLEMENT_CALL_PATH)
  })

  it('the_fixes_of_a_pull_request_are_asked_for_with_the_step_that_says_so', async () => {
    const headless = HeadlessAgent.resuming()

    await headless.fix()

    const call = headless.capturedAt(HeadlessAgent.FIX_CALL_PATH)

    expect(call.step).toBe('fix-pull-request')
    expect(call.issue).toBe(HeadlessAgent.ISSUE_NUMBER)
    expect(call.repository).toBe(HeadlessAgent.REPOSITORY.text)
    expect(headless.brief.fixAsked).toEqual([
      { issueNumber: HeadlessAgent.ISSUE_NUMBER, repository: HeadlessAgent.REPOSITORY, changes: HeadlessAgent.CHANGES },
    ])
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

  it('pathsFor_composes_the_directory_and_the_three_files_a_call_leaves_inside_it', () => {
    const paths = HarnessCall.pathsFor({
      runsIn: HeadlessAgent.RUNS_IN,
      agent: HeadlessAgent.AGENT,
      step: HarnessStep.WRITE_PLAN,
      startedAt: HeadlessAgent.STARTED_AT,
    })

    expect(paths).toBeInstanceOf(HarnessPaths)
    expect(paths.directory).toBe(HeadlessAgent.DIRECTORY)
    expect(paths.out).toBe(HeadlessAgent.STREAM_PATH)
    expect(paths.err).toBe(HeadlessAgent.ERROR_PATH)
    expect(paths.call).toBe(HeadlessAgent.CALL_PATH)
  })

  it('projects_every_field_straight_through_so_a_value_object_handed_by_mistake_surfaces_instead_of_vanishing', () => {
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

    expect(call.json.issue).toBe(HeadlessAgent.ISSUE)
    expect(call.json.repository).toBe(HeadlessAgent.REPOSITORY)
  })
})
