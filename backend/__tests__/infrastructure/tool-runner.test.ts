import { describe, it, expect } from 'vitest'
import { ToolRunner } from '../../src/infrastructure/tool-runner.ts'
import { ProcessRunner } from '../../src/infrastructure/process-runner.ts'
import type { LaunchedProcess, LaunchOptions, RunAndWaitOptions, RunOutcome } from '../../src/infrastructure/process-runner.ts'
import { Capture, ScriptedConversation, UnscriptedRequest } from './fixtures/scripted-conversation.ts'

class AnsweredRunner extends ProcessRunner {
  readonly asked: { binary: string, argv: readonly string[], options: RunAndWaitOptions }[] = []
  readonly #outcome: RunOutcome

  constructor(outcome: RunOutcome) {
    super()
    this.#outcome = outcome
  }

  override async runAndWait(binary: string, argv: readonly string[], options: RunAndWaitOptions): Promise<RunOutcome> {
    this.asked.push({ binary, argv, options })
    return this.#outcome
  }

  override launch(binary: string, argv: readonly string[], options: LaunchOptions): LaunchedProcess {
    throw new UnscriptedRequest({ binary, argv, cwd: options.cwd })
  }
}

class Answered {
  static succeeding(stdout: string): RunOutcome {
    return { failure: null, stdout, stderr: '' }
  }

  static refusing(code: number, stderr: string): RunOutcome {
    return { failure: { code, killed: false, signal: null, message: stderr }, stdout: '', stderr }
  }

  static refusingWithStdout(stdout: string): RunOutcome {
    return { failure: { code: 1, killed: false, signal: null, message: 'half an answer, then exit 1' }, stdout, stderr: '' }
  }

  static exitingWithNoStderr(code: number, diagnosticNobodyAsked: string): RunOutcome {
    return { failure: { code, killed: false, signal: null, message: diagnosticNobodyAsked }, stdout: '', stderr: '' }
  }

  static exhaustingItsBudget(diagnostic: string): RunOutcome {
    return { failure: { code: null, killed: true, signal: 'SIGTERM', message: diagnostic }, stdout: '', stderr: '' }
  }

  static exitingNumericallyAfterATimeout(stdout: string, diagnostic: string): RunOutcome {
    return { failure: { code: 1, killed: true, signal: null, message: diagnostic }, stdout, stderr: '' }
  }

  static missing(bin: string): RunOutcome {
    return { failure: { code: 'ENOENT', killed: false, signal: null, message: `spawn ${bin} ENOENT` }, stdout: '', stderr: '' }
  }
}

class Runner {
  static readonly BIN = 'gh'
  static readonly BUDGET_MS = 30_000

  static of(processes: ProcessRunner): ToolRunner {
    return Runner.named(Runner.BIN, processes)
  }

  static named(bin: string, processes: ProcessRunner): ToolRunner {
    return new ToolRunner({ bin, budgetMs: Runner.BUDGET_MS, processes, signal: (): void => {} })
  }

  static budgeted(processes: ProcessRunner, budgetMs: number): ToolRunner {
    return new ToolRunner({ bin: Runner.BIN, budgetMs, processes, signal: (): void => {} })
  }

  static withEnvironment(processes: ProcessRunner, env: NodeJS.ProcessEnv): ToolRunner {
    return new ToolRunner({ bin: Runner.BIN, budgetMs: Runner.BUDGET_MS, env, processes, signal: (): void => {} })
  }
}

describe('ToolRunner', () => {
  it('a_refusal_and_an_answer_nobody_can_parse_come_back_apart', async () => {
    const url = 'https://github.com/mercadona/control-tower/issues/999999999'
    const ghArgv = ['issue', 'view', url, '--json', 'title,body,comments']
    const claudeArgv = ['-p', '--output-format', 'text', 'Answer with the single word ok.']
    const conversation = new ScriptedConversation()
      .answering({ binary: 'gh', argv: ghArgv }, Capture.read('gh', 'issue-view-missing'))
      .answering({ binary: 'claude', argv: claudeArgv }, Capture.read('claude', 'result-text'))
    const missing = Capture.read('gh', 'issue-view-missing')
    const text = Capture.read('claude', 'result-text')

    const refusal = await Runner.named('gh', conversation).run(ghArgv)
    const answer = await Runner.named('claude', conversation).run(claudeArgv)

    expect(refusal.failed).toBe(true)
    expect(refusal.code).toBe(1)
    expect(refusal.stderr).toBe(missing.stderr)
    expect(answer.failed).toBe(false)
    expect(answer.stdout).toBe(text.stdout)
  })

  it('what_the_tool_prints_comes_back_with_the_code_that_says_it_went_well', async () => {
    const runner = new AnsweredRunner(Answered.succeeding('printed'))

    const output = await Runner.of(runner).run(['whatever'])

    expect(output.stdout).toBe('printed')
    expect(output.code).toBe(0)
    expect(output.failed).toBe(false)
  })

  it('a_tool_that_outlives_its_budget_comes_back_failed_with_a_reason', async () => {
    const budgetMs = 250
    const runner = new AnsweredRunner(Answered.exhaustingItsBudget('killed after exceeding its budget'))

    const output = await Runner.budgeted(runner, budgetMs).run(['whatever'])

    expect(output.failed).toBe(true)
    expect(output.stderr).not.toBe('')
    expect(runner.asked[0].options.timeoutMs).toBe(budgetMs)
  })

  it('timeout exits keep a diagnostic even when the child exits numerically', async () => {
    const runner = new AnsweredRunner(Answered.exitingNumericallyAfterATimeout('ready\n', 'terminated after its budget elapsed'))

    const output = await Runner.of(runner).run(['whatever'])

    expect(output).toMatchObject({ code: 1, stdout: 'ready\n' })
    expect(output.stderr).not.toBe('')
  })

  it('a_tool_that_refuses_is_a_code_and_a_reason_and_not_something_thrown_at_the_caller', async () => {
    const runner = new AnsweredRunner(Answered.refusing(3, 'no such work item'))

    const output = await Runner.of(runner).run(['whatever'])

    expect(output.code).toBe(3)
    expect(output.stderr).toBe('no such work item')
  })

  it('a normal nonzero exit preserves an actually empty stderr channel', async () => {
    const runner = new AnsweredRunner(Answered.exitingWithNoStderr(1, 'Command failed with exit code 1.'))

    const output = await Runner.of(runner).run(['whatever'])

    expect(output).toMatchObject({ code: 1, stdout: '', stderr: '' })
  })

  it('what_the_tool_printed_before_refusing_is_kept_because_the_adapter_may_have_to_read_it', async () => {
    const runner = new AnsweredRunner(Answered.refusingWithStdout('half an answer'))

    const output = await Runner.of(runner).run(['whatever'])

    expect(output.stdout).toBe('half an answer')
    expect(output.failed).toBe(true)
  })

  it('a_tool_that_is_not_installed_is_a_refusal_with_a_reason_and_not_an_empty_channel', async () => {
    const runner = new AnsweredRunner(Answered.missing('ct-no-such-tool'))

    const output = await Runner.named('ct-no-such-tool', runner).run(['whatever'])

    expect(output.failed).toBe(true)
    expect(output.stderr).toContain('ct-no-such-tool')
  })

  it('the_directory_the_caller_names_is_the_one_the_runner_asks_for', async () => {
    const runner = new AnsweredRunner(Answered.succeeding(''))
    const elsewhere = '/somewhere/the/caller/chose'

    await Runner.of(runner).run(['whatever'], { cwd: elsewhere })

    expect(runner.asked[0].options.cwd).toBe(elsewhere)
  })

  it('a_call_that_names_no_directory_still_runs_where_the_api_was_started', async () => {
    const runner = new AnsweredRunner(Answered.succeeding(''))

    await Runner.of(runner).run(['whatever'])

    expect(runner.asked[0].options.cwd).toBeUndefined()
  })

  it('the_environment_the_caller_composed_is_the_one_the_runner_hands_over', async () => {
    const runner = new AnsweredRunner(Answered.succeeding(''))
    const env = { CT_TOOL_RUNNER_GIVEN: 'from the caller' }

    await Runner.withEnvironment(runner, env).run(['whatever'])

    expect(runner.asked[0].options.env).toBe(env)
  })

  it('a_runner_that_names_no_environment_hands_over_none_so_the_tool_inherits_the_api_one', async () => {
    const runner = new AnsweredRunner(Answered.succeeding(''))

    await Runner.of(runner).run(['whatever'])

    expect(runner.asked[0].options.env).toBeUndefined()
  })

  it('keeps every byte when its output is collected whole, and still tells its exit code and its stderr', async () => {
    const openIssuesArgv = ['api', 'graphql', '--paginate', '--slurp']
    const issueViewArgv = ['issue', 'view', 'https://github.com/mercadona/control-tower/issues/999999999', '--json', 'title,body,comments']
    const conversation = new ScriptedConversation()
      .answering({ binary: 'gh', argv: openIssuesArgv }, Capture.read('gh', 'graphql-open-issues-repo-pulse'))
      .answering({ binary: 'gh', argv: issueViewArgv }, Capture.read('gh', 'issue-view-missing'))
    const opened = Capture.read('gh', 'graphql-open-issues-repo-pulse')
    const missing = Capture.read('gh', 'issue-view-missing')
    const runner = Runner.of(conversation)

    const whole = await runner.runWholeOutput(openIssuesArgv)
    const refusal = await runner.runWholeOutput(issueViewArgv)

    expect(whole.stdout).toBe(opened.stdout)
    expect(whole.code).toBe(0)
    expect(refusal.code).toBe(1)
    expect(refusal.stderr).toBe(missing.stderr)
  })
})
