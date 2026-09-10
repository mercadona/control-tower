import { describe, it, expect } from 'vitest'
import {
  HeadlessPlanAgents, HarnessCall, HarnessStep,
} from '../../src/infrastructure/headless-plan-agents.js'
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
  static WRITE_PLAN_MODEL = 'fable'
  static REVIEW_PLAN_MODEL = 'fable'
  static IMPLEMENT_MODEL = 'sonnet'
  static FIX_PULL_REQUEST_MODEL = 'sonnet'
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
  static IMPLEMENT_STREAM_PATH = `${HeadlessAgent.IMPLEMENT_DIRECTORY}/${HarnessCall.STREAM_FILE}`
  static IMPLEMENT_ERROR_PATH = `${HeadlessAgent.IMPLEMENT_DIRECTORY}/${HarnessCall.ERROR_FILE}`
  static REVIEW_DIRECTORY =
    `${HeadlessAgent.RUNS_IN}/${HeadlessAgent.AGENT}/${HarnessStep.REVIEW_PLAN}-${HeadlessAgent.STARTED_AT}`
  static REVIEW_CALL_PATH = `${HeadlessAgent.REVIEW_DIRECTORY}/${HarnessCall.CALL_FILE}`
  static FIX_DIRECTORY =
    `${HeadlessAgent.RUNS_IN}/${HeadlessAgent.AGENT}/${HarnessStep.FIX_PULL_REQUEST}-${HeadlessAgent.STARTED_AT}`
  static FIX_CALL_PATH = `${HeadlessAgent.FIX_DIRECTORY}/${HarnessCall.CALL_FILE}`

  constructor({
    startAnswer = { pid: HeadlessAgent.PID },
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
    this.stopCalls = []
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
    headless.recordConversation(JSON.stringify({
      issue: HeadlessAgent.ISSUE_NUMBER,
      repository: HeadlessAgent.REPOSITORY.text,
      startedAt: HeadlessAgent.STARTED_AT,
    }))

    return headless
  }

  static conversationMissingIssue() {
    const headless = new HeadlessAgent()
    headless.recordConversation(JSON.stringify({
      worktree: HeadlessAgent.WORKTREE,
      repository: HeadlessAgent.REPOSITORY.text,
      startedAt: HeadlessAgent.STARTED_AT,
    }))

    return headless
  }

  static conversationRecordedAsAnArray() {
    const headless = new HeadlessAgent()
    headless.recordConversation(JSON.stringify([HeadlessAgent.WORKTREE]))

    return headless
  }

  static conversationWithEmptyRepository() {
    const headless = new HeadlessAgent()
    headless.recordConversation(JSON.stringify({
      worktree: HeadlessAgent.WORKTREE,
      issue: HeadlessAgent.ISSUE_NUMBER,
      repository: '',
      startedAt: HeadlessAgent.STARTED_AT,
    }))

    return headless
  }

  static conversationRecordedAsNull() {
    const headless = new HeadlessAgent()
    headless.recordConversation('null')

    return headless
  }

  static resuming(overrides = {}) {
    const headless = new HeadlessAgent(overrides)
    headless.recordConversation(JSON.stringify({
      worktree: HeadlessAgent.WORKTREE,
      issue: HeadlessAgent.ISSUE_NUMBER,
      repository: HeadlessAgent.REPOSITORY.text,
      startedAt: HeadlessAgent.STARTED_AT,
    }))

    return headless
  }

  static continuationDirectoryUnwritable(failure) {
    return HeadlessAgent.resuming({ makeDirectoryAnswer: failure })
  }

  static continuationCallUnwritable(failure) {
    return HeadlessAgent.resuming({ callWriteAnswer: failure })
  }

  static continuationRefusing(failure) {
    return HeadlessAgent.resuming({ startAnswer: failure })
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
        stop: (started) => {
          this.trace.push('stop')
          this.stopCalls.push(started)
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

  resume(agent = HeadlessAgent.AGENT) {
    return this.agents().resume({
      agent,
      issue: HeadlessAgent.ISSUE_NUMBER,
      repository: HeadlessAgent.REPOSITORY,
    })
  }

  review() {
    return this.agents().review({
      agent: HeadlessAgent.AGENT,
      issue: HeadlessAgent.ISSUE_NUMBER,
      repository: HeadlessAgent.REPOSITORY,
      changes: HeadlessAgent.CHANGES,
    })
  }

  fix() {
    return this.agents().fix({
      agent: HeadlessAgent.AGENT,
      issue: HeadlessAgent.ISSUE_NUMBER,
      repository: HeadlessAgent.REPOSITORY,
      changes: HeadlessAgent.CHANGES,
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

  it('a_call_that_cannot_be_started_writes_no_call_json_even_though_its_directory_and_conversation_record_already_landed', async () => {
    const headless = HeadlessAgent.refusing(new PlanAgentNotLaunched('spawn assigned no pid to "claude"'))

    const refusal = await headless.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(headless.writeCalls.some(([path]) => path === HeadlessAgent.CALL_PATH)).toBe(false)
    expect(headless.writeCalls.some(([path]) => path === HeadlessAgent.CONVERSATION_PATH)).toBe(true)
    expect(headless.makeDirectoryCalls).toEqual([HeadlessAgent.DIRECTORY])
  })

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

  it('a_call_record_that_cannot_be_written_after_the_launch_already_started_signals_the_group_it_would_otherwise_leave_running', async () => {
    const headless = HeadlessAgent.callUnwritable(new Error('ENOSPC: no space left on device'))

    const refusal = await headless.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(headless.stopCalls).toHaveLength(1)
    expect(headless.stopCalls[0].pid).toBe(HeadlessAgent.PID)
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
  it('launch_records_which_plan_the_conversation_attends_and_when_it_started', async () => {
    const headless = HeadlessAgent.launching()
    const briefing = new PlanBriefing({
      story: null,
      issue: new PlanIssue({ number: 33, url: 'https://github.com/owner/repo/issues/33' }),
      located: new WorkspaceLocation({ path: HeadlessAgent.WORKTREE, branch: 'feat/42' }),
      repository: new RepositoryName('owner/repo'),
    })

    await headless.launch(briefing)

    const written = headless.capturedAt(HeadlessAgent.CONVERSATION_PATH)

    expect(written).toEqual({
      worktree: HeadlessAgent.WORKTREE,
      issue: 33,
      repository: 'owner/repo',
      startedAt: HeadlessAgent.STARTED_AT,
    })
  })

  it('a_conversation_recorded_without_the_issue_it_belongs_to_refuses_instead_of_resuming_a_plan_it_cannot_name', async () => {
    const headless = HeadlessAgent.conversationMissingIssue()

    const refusal = await headless.resumeRefusal(HeadlessAgent.AGENT)

    expect(refusal).toBeInstanceOf(PlanAgentNotNamed)
    expect(refusal.message).toBe(
      `${HeadlessAgent.AGENT} recorded a conversation at ${HeadlessAgent.CONVERSATION_PATH} that is not a well-formed record`
    )
  })

  it('a_conversation_recorded_as_a_json_array_refuses_instead_of_reading_fields_off_a_list', async () => {
    const headless = HeadlessAgent.conversationRecordedAsAnArray()

    const refusal = await headless.resumeRefusal(HeadlessAgent.AGENT)

    expect(refusal).toBeInstanceOf(PlanAgentNotNamed)
    expect(refusal.message).toBe(
      `${HeadlessAgent.AGENT} recorded a conversation at ${HeadlessAgent.CONVERSATION_PATH} that is not a well-formed record`
    )
  })

  it('a_conversation_whose_repository_is_the_empty_string_refuses_instead_of_naming_no_repository', async () => {
    const headless = HeadlessAgent.conversationWithEmptyRepository()

    const refusal = await headless.resumeRefusal(HeadlessAgent.AGENT)

    expect(refusal).toBeInstanceOf(PlanAgentNotNamed)
    expect(refusal.message).toBe(
      `${HeadlessAgent.AGENT} recorded a conversation at ${HeadlessAgent.CONVERSATION_PATH} that is not a well-formed record`
    )
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
      `${HeadlessAgent.AGENT} recorded a conversation at ${HeadlessAgent.CONVERSATION_PATH} that is not a well-formed record`
    )
  })

  it('a_conversation_recorded_as_the_json_literal_null_refuses_instead_of_crashing_on_null_dot_worktree', async () => {
    const headless = HeadlessAgent.conversationRecordedAsNull()

    const refusal = await headless.resumeRefusal(HeadlessAgent.AGENT)

    expect(refusal).toBeInstanceOf(PlanAgentNotNamed)
    expect(refusal.message).toBe(
      `${HeadlessAgent.AGENT} recorded a conversation at ${HeadlessAgent.CONVERSATION_PATH} that is not a well-formed record`
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
      '--fallback-model', 'opus',
      '--model', HeadlessAgent.IMPLEMENT_MODEL,
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

  it('the_continuation_leaves_its_agent_model_argv_and_pid_on_disk_because_no_reader_can_recover_them_later', async () => {
    const headless = HeadlessAgent.resuming()

    await headless.resume()

    const call = headless.capturedAt(HeadlessAgent.IMPLEMENT_CALL_PATH)

    expect(Object.keys(call)).toEqual([
      'step', 'agent', 'issue', 'repository', 'model', 'argv', 'pid', 'startedAt',
    ])
    expect(call.step).toBe(HarnessStep.IMPLEMENT)
    expect(call.agent).toBe(HeadlessAgent.AGENT)
    expect(call.issue).toBe(HeadlessAgent.ISSUE_NUMBER)
    expect(call.repository).toBe(HeadlessAgent.REPOSITORY.text)
    expect(call.model).toBe(HeadlessAgent.IMPLEMENT_MODEL)
    expect(call.pid).toBe(HeadlessAgent.PID)
    expect(call.startedAt).toBe(HeadlessAgent.STARTED_AT)
    expect(call.argv).toEqual(headless.startCalls[0].argv)
  })

  it('the_directory_of_a_continuation_is_made_before_the_call_starts_because_detached_run_opens_its_paths_and_fails_without_it', async () => {
    const headless = HeadlessAgent.resuming()

    await headless.resume()

    expect(headless.trace).toEqual(['read', 'makeDirectory', 'start', 'write'])
  })

  it('a_second_call_on_one_conversation_leaves_a_second_record_beside_the_first', async () => {
    const headless = HeadlessAgent.launching()

    await headless.launch()
    await headless.resume()

    expect(headless.makeDirectoryCalls).toEqual([HeadlessAgent.DIRECTORY, HeadlessAgent.IMPLEMENT_DIRECTORY])
    expect(headless.capturedAt(HeadlessAgent.CALL_PATH).step).toBe(HarnessStep.WRITE_PLAN)
    expect(headless.capturedAt(HeadlessAgent.IMPLEMENT_CALL_PATH).step).toBe(HarnessStep.IMPLEMENT)
    expect(headless.startCalls[1].out).toBe(HeadlessAgent.IMPLEMENT_STREAM_PATH)
    expect(headless.startCalls[1].err).toBe(HeadlessAgent.IMPLEMENT_ERROR_PATH)
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
    const headless = HeadlessAgent.continuationDirectoryUnwritable(new Error('EACCES: permission denied'))

    const refusal = await headless.resumeRefusal(HeadlessAgent.AGENT)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message).toContain(HeadlessAgent.IMPLEMENT_DIRECTORY)
  })

  it('a_call_record_that_cannot_be_written_for_a_continuation_raises_the_same_family_as_a_refused_resume_so_nothing_sees_a_raw_node_error', async () => {
    const headless = HeadlessAgent.continuationCallUnwritable(new Error('ENOSPC: no space left on device'))

    const refusal = await headless.resumeRefusal(HeadlessAgent.AGENT)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message).toContain(HeadlessAgent.IMPLEMENT_CALL_PATH)
  })

  it('a_call_record_that_cannot_be_written_after_a_continuation_already_started_signals_the_group_it_would_otherwise_leave_running', async () => {
    const headless = HeadlessAgent.continuationCallUnwritable(new Error('ENOSPC: no space left on device'))

    const refusal = await headless.resumeRefusal(HeadlessAgent.AGENT)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(headless.stopCalls).toHaveLength(1)
    expect(headless.stopCalls[0].pid).toBe(HeadlessAgent.PID)
  })

  it('a_call_that_cannot_be_started_for_a_continuation_raises_the_same_family_as_a_refused_resume_and_not_the_launch_cause', async () => {
    const headless = HeadlessAgent.continuationRefusing(
      new PlanAgentNotLaunched('spawn assigned no pid to "claude"')
    )

    const refusal = await headless.resumeRefusal(HeadlessAgent.AGENT)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal).not.toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.message).toBe('spawn assigned no pid to "claude"')
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
      errand: 'implementa el plan', step: HarnessStep.IMPLEMENT, pluginRoot: '/plugin', agent: 'abc', resuming: true,
    })

    expect(argv.slice(-2)).toEqual(['--resume', 'abc'])
    expect(argv).not.toContain('--session-id')
  })

  it('every_call_carries_the_fallback_model_the_cli_uses_when_the_default_is_overloaded_or_not_available', () => {
    const argv = HeadlessPlanAgents.argvFor({
      errand: 'implementa el plan', step: HarnessStep.IMPLEMENT, pluginRoot: '/plugin', agent: 'abc', resuming: true,
    })

    expect(argv).toContain('--fallback-model')
    expect(argv[argv.indexOf('--fallback-model') + 1]).toBe('opus')
  })

  it('a_step_no_model_was_declared_for_raises_instead_of_asking_for_undefined', () => {
    expect(() => HeadlessPlanAgents.argvFor({
      errand: 'x', step: 'invented-step', pluginRoot: '/plugin', agent: 'abc', resuming: false,
    })).toThrow(/no model declared for invented-step/)
  })
})

describe('HeadlessPlanAgents.MODELS', () => {
  it('every_member_of_HarnessStep_has_a_model_declared_so_a_fifth_step_could_not_quietly_ask_for_undefined', () => {
    expect(HeadlessPlanAgents.MODELS.members().sort()).toEqual(Object.values(HarnessStep).sort())
  })

  it('the_plan_and_its_review_are_asked_of_fable_and_the_implementation_and_its_fixes_of_sonnet', () => {
    expect(HeadlessPlanAgents.MODELS.of(HarnessStep.WRITE_PLAN)).toBe('fable')
    expect(HeadlessPlanAgents.MODELS.of(HarnessStep.REVIEW_PLAN)).toBe('fable')
    expect(HeadlessPlanAgents.MODELS.of(HarnessStep.IMPLEMENT)).toBe('sonnet')
    expect(HeadlessPlanAgents.MODELS.of(HarnessStep.FIX_PULL_REQUEST)).toBe('sonnet')
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

  it('projects_every_field_straight_through_so_a_value_object_handed_by_mistake_surfaces_instead_of_vanishing', () => {
    const call = new HarnessCall({
      step: HarnessStep.WRITE_PLAN,
      agent: HeadlessAgent.AGENT,
      issue: HeadlessAgent.ISSUE,
      repository: HeadlessAgent.REPOSITORY,
      model: HeadlessAgent.WRITE_PLAN_MODEL,
      argv: [],
      pid: HeadlessAgent.PID,
      startedAt: HeadlessAgent.STARTED_AT,
    })

    const stringified = JSON.parse(JSON.stringify(call.json))

    expect(stringified.issue).toEqual({ number: HeadlessAgent.ISSUE.number, url: HeadlessAgent.ISSUE.url })
    expect(stringified.repository).toEqual({ text: HeadlessAgent.REPOSITORY.text })
  })
})
