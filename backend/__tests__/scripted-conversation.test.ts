import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ToolRunner } from '../src/infrastructure/tool-runner.ts'
import { Capture, ScriptedConversation } from './scripted-conversation.ts'
import type { ScriptedRequest } from './scripted-conversation.ts'

class Locations {
  static readonly HERE = dirname(fileURLToPath(import.meta.url))
  static readonly BACKEND = join(Locations.HERE, '..')
  static readonly WORKTREE = join(Locations.BACKEND, '..')
  static readonly OUTSIDE = '/private/tmp'
}

class GitConversation {
  static headRequest(cwd: string): ScriptedRequest {
    return { binary: 'git', argv: ['rev-parse', 'HEAD'], cwd }
  }

  static insideTheWorktree(): ScriptedConversation {
    return new ScriptedConversation()
      .answering(GitConversation.headRequest(Locations.WORKTREE), Capture.read('git', 'rev-parse-head'))
  }

  static outsideARepository(): ScriptedConversation {
    return new ScriptedConversation()
      .answering(GitConversation.headRequest(Locations.OUTSIDE), Capture.read('git', 'rev-parse-outside-a-repository'))
  }

  static bothCwdsScriptedOutOfOrder(): ScriptedConversation {
    return new ScriptedConversation()
      .answering(GitConversation.headRequest(Locations.OUTSIDE), Capture.read('git', 'rev-parse-outside-a-repository'))
      .answering(GitConversation.headRequest(Locations.WORKTREE), Capture.read('git', 'rev-parse-head'))
  }
}

class Runner {
  static git(conversation: ScriptedConversation): ToolRunner {
    return new ToolRunner({ bin: 'git', budgetMs: 5000, processes: conversation, signal: () => {} })
  }
}

class RawCapture {
  static valid(): string {
    return RawCapture.#text(
      'command: git rev-parse HEAD',
      'version: git version 2.50.1 (Apple Git-155)',
      'date: 2026-09-24',
      'exit: 0',
    )
  }

  static missingCommand(): string {
    return RawCapture.#text(
      'command: ',
      'version: git version 2.50.1 (Apple Git-155)',
      'date: 2026-09-24',
      'exit: 0',
    )
  }

  static missingVersion(): string {
    return RawCapture.#text(
      'command: git rev-parse HEAD',
      'version: ',
      'date: 2026-09-24',
      'exit: 0',
    )
  }

  static missingDate(): string {
    return RawCapture.#text(
      'command: git rev-parse HEAD',
      'version: git version 2.50.1 (Apple Git-155)',
      'date: ',
      'exit: 0',
    )
  }

  static #text(...header: string[]): string {
    return [...header, '--- stdout', 'a9e84013456ff85edbe36613e3a4cfcc78c7c224', '--- stderr', ''].join('\n')
  }
}

describe('a ToolRunner over a ScriptedConversation reads its captured git answers', () => {
  it('a_tool_runner_over_the_conversation_reads_the_captured_answer_of_the_request_it_sent', async () => {
    const runner = Runner.git(GitConversation.insideTheWorktree())

    const output = await runner.run(['rev-parse', 'HEAD'], { cwd: Locations.WORKTREE })

    const capture = Capture.read('git', 'rev-parse-head')
    expect(output.code).toBe(0)
    expect(output.failed).toBe(false)
    expect(output.stdout).toBe(capture.stdout)
  })

  it('the_answer_follows_what_is_asked_not_the_order_the_answers_were_written', async () => {
    const conversation = GitConversation.bothCwdsScriptedOutOfOrder()
    const runner = Runner.git(conversation)

    const output = await runner.run(['rev-parse', 'HEAD'], { cwd: Locations.WORKTREE })

    expect(output.stdout).toBe(Capture.read('git', 'rev-parse-head').stdout)
    expect(conversation.asked).toEqual([GitConversation.headRequest(Locations.WORKTREE)])
  })

  it('a_request_nobody_scripted_raises_and_names_the_binary_the_argv_and_the_cwd', async () => {
    const conversation = GitConversation.insideTheWorktree()

    await expect(conversation.runAndWait('git', ['status'], { cwd: Locations.WORKTREE, timeoutMs: 1000 }))
      .rejects.toThrow(`nobody wrote an answer for git status in ${Locations.WORKTREE}`)

    await expect(conversation.runAndWait('git', ['rev-parse', 'HEAD'], { cwd: Locations.OUTSIDE, timeoutMs: 1000 }))
      .rejects.toThrow(`nobody wrote an answer for git rev-parse HEAD in ${Locations.OUTSIDE}`)
  })

  it('a_captured_refusal_reaches_the_tool_runner_as_its_exit_code_and_its_stderr', async () => {
    const runner = Runner.git(GitConversation.outsideARepository())

    const output = await runner.run(['rev-parse', 'HEAD'], { cwd: Locations.OUTSIDE })

    const capture = Capture.read('git', 'rev-parse-outside-a-repository')
    expect(output.code).toBe(128)
    expect(output.failed).toBe(true)
    expect(output.stderr).toBe(capture.stderr)
  })

  it('the_whole_output_path_reads_the_captured_stdout_through_the_launched_double', async () => {
    const runner = Runner.git(GitConversation.insideTheWorktree())

    const output = await runner.runWholeOutput(['rev-parse', 'HEAD'], { cwd: Locations.WORKTREE })

    const capture = Capture.read('git', 'rev-parse-head')
    expect(output.code).toBe(0)
    expect(output.stdout).toBe(capture.stdout)
  })

  it('a_capture_without_its_command_its_version_or_its_date_is_refused', () => {
    expect(() => Capture.parse(RawCapture.valid())).not.toThrow()
    expect(() => Capture.parse(RawCapture.missingCommand())).toThrow()
    expect(() => Capture.parse(RawCapture.missingVersion())).toThrow()
    expect(() => Capture.parse(RawCapture.missingDate())).toThrow()
  })
})
