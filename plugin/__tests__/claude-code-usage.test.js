import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { ClaudeCodeTranscript, ClaudeCodeUsage } from '../scripts/claude-code-usage.js'
import { UsageStatus } from '../scripts/tool-usage.js'

class Environments {
  static SESSION = 'd85bb4ff-7a98-40c7-a999-8676335f9aef'
  static CLAUDE_DIRECTORY = '/home/someone/.claude'
  static CWD = '/home/someone/code/control-tower/.worktrees/slice'

  static claudeCode(overrides = {}) {
    return {
      CLAUDECODE: '1',
      AI_AGENT: 'claude-code_2-1-266_agent',
      CLAUDE_CODE_SESSION_ID: Environments.SESSION,
      ...overrides,
    }
  }

  static withoutAgentBanner() {
    const env = Environments.claudeCode()
    delete env.AI_AGENT
    return env
  }

  static withoutSession() {
    const env = Environments.claudeCode()
    delete env.CLAUDE_CODE_SESSION_ID
    return env
  }

  static anotherTool() {
    return { PATH: '/usr/bin' }
  }
}

class Entries {
  static assistant(requestId, usage) {
    return { type: 'assistant', requestId, isSidechain: false, message: { model: 'claude-opus-5', usage } }
  }

  static subagent(requestId, usage) {
    return { ...Entries.assistant(requestId, usage), isSidechain: true }
  }

  static usage({ input = 2, cacheRead = 27151, cacheCreation = 27366, output = 312 } = {}) {
    return {
      input_tokens: input,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheCreation,
      output_tokens: output,
    }
  }

  static user() {
    return { type: 'user', message: { role: 'user', content: 'go on' } }
  }
}

class Transcripts {
  static of(entries) {
    return entries.map((entry) => `${JSON.stringify(entry)}\n`).join('')
  }

  static folder() {
    return ClaudeCodeTranscript.folderFor(Environments.CWD)
  }

  static at(entries, { folders = [Transcripts.folder()] } = {}) {
    const path = join(Environments.CLAUDE_DIRECTORY, 'projects', folders.at(-1), `${Environments.SESSION}.jsonl`)
    const files = new Map([[path, Transcripts.of(entries)]])
    return new ClaudeCodeTranscript({
      claudeDirectory: Environments.CLAUDE_DIRECTORY,
      cwd: Environments.CWD,
      listNames: () => folders,
      readText: (asked) => {
        if (!files.has(asked)) throw new Error(`ENOENT: ${asked}`)
        return files.get(asked)
      },
    })
  }

  static missing() {
    return new ClaudeCodeTranscript({
      claudeDirectory: Environments.CLAUDE_DIRECTORY,
      cwd: Environments.CWD,
      listNames: () => [],
      readText: (asked) => {
        throw new Error(`ENOENT: ${asked}`)
      },
    })
  }
}

class Adapters {
  static over(entries, options) {
    return new ClaudeCodeUsage({ env: Environments.claudeCode(), transcript: Transcripts.at(entries, options) })
  }
}

describe('the claude-code adapter reads the exact usage the runtime wrote and estimates nothing', () => {
  it('the_runtime_is_recognised_and_its_version_comes_out_of_the_agent_banner', () => {
    expect(ClaudeCodeUsage.detects(Environments.claudeCode())).toBe(true)
    expect(ClaudeCodeUsage.identityOf(Environments.claudeCode())).toEqual({ tool: 'claude-code', version: '2.1.266' })
  })

  it('another_runtime_is_not_claimed_as_claude_code', () => {
    expect(ClaudeCodeUsage.detects(Environments.anotherTool())).toBe(false)
  })

  it('a_version_the_runtime_did_not_publish_is_null_and_the_tool_still_travels', () => {
    expect(ClaudeCodeUsage.identityOf(Environments.withoutAgentBanner())).toEqual({ tool: 'claude-code', version: null })
  })

  it('the_cached_input_is_the_cache_read_plus_the_cache_creation_and_lands_apart_from_the_fresh_input', () => {
    const usage = Adapters.over([Entries.assistant('req_1', Entries.usage({ input: 2, cacheRead: 100, cacheCreation: 40, output: 7 }))]).usageFor(new Set())

    expect(usage.status).toBe(UsageStatus.MEASURED)
    expect(usage.inputTokens).toBe(2)
    expect(usage.cachedInputTokens).toBe(140)
    expect(usage.outputTokens).toBe(7)
    expect(usage.totalTokens).toBe(149)
  })

  it('a_request_the_transcript_repeats_across_entries_is_attributed_once', () => {
    const repeated = Entries.usage({ input: 2, cacheRead: 100, cacheCreation: 0, output: 10 })
    const usage = Adapters.over([
      Entries.assistant('req_1', repeated),
      Entries.assistant('req_1', repeated),
      Entries.assistant('req_1', repeated),
    ]).usageFor(new Set())

    expect(usage.evidence).toEqual(['req_1'])
    expect(usage.totalTokens).toBe(112)
  })

  it('a_request_an_earlier_row_already_claimed_is_not_attributed_again_when_the_session_is_resumed', () => {
    const entries = [
      Entries.assistant('req_1', Entries.usage({ input: 1, cacheRead: 10, cacheCreation: 0, output: 1 })),
      Entries.subagent('req_2', Entries.usage({ input: 5, cacheRead: 50, cacheCreation: 0, output: 5 })),
    ]

    const first = Adapters.over(entries).usageFor(new Set())
    const second = Adapters.over(entries).usageFor(new Set(first.evidence))

    expect(first.evidence).toEqual(['req_1', 'req_2'])
    expect(first.totalTokens).toBe(72)
    expect(second.evidence).toEqual([])
    expect(second.status).toBe(UsageStatus.MEASURED)
    expect(second.totalTokens).toBe(0)
  })

  it('the_turns_of_a_dispatched_subagent_are_counted_beside_the_coordinators_own', () => {
    const usage = Adapters.over([
      Entries.assistant('req_1', Entries.usage({ input: 1, cacheRead: 0, cacheCreation: 0, output: 1 })),
      Entries.subagent('req_2', Entries.usage({ input: 2, cacheRead: 0, cacheCreation: 0, output: 2 })),
    ]).usageFor(new Set())

    expect(usage.totalTokens).toBe(6)
  })

  it('what_is_not_an_assistant_turn_carries_no_cost_and_is_not_claimed', () => {
    const usage = Adapters.over([Entries.user(), Entries.assistant('req_1', Entries.usage({ input: 1, cacheRead: 0, cacheCreation: 0, output: 1 }))]).usageFor(new Set())

    expect(usage.evidence).toEqual(['req_1'])
  })

  it('a_transcript_with_no_assistant_turn_yet_is_a_measured_zero_and_not_an_absence', () => {
    const usage = Adapters.over([Entries.user()]).usageFor(new Set())

    expect(usage.status).toBe(UsageStatus.MEASURED)
    expect(usage.totalTokens).toBe(0)
    expect(usage.gaps).toBe(0)
  })

  it('a_transcript_that_cannot_be_found_is_not_read_and_lands_no_number', () => {
    const adapter = new ClaudeCodeUsage({ env: Environments.claudeCode(), transcript: Transcripts.missing() })

    const usage = adapter.usageFor(new Set())

    expect(usage.status).toBe(UsageStatus.NOT_READ)
    expect(usage.totalTokens).toBeNull()
    expect(usage.identity.tool).toBe('claude-code')
  })

  it('a_runtime_that_published_no_session_id_is_not_read_instead_of_being_guessed', () => {
    const adapter = new ClaudeCodeUsage({ env: Environments.withoutSession(), transcript: Transcripts.at([]) })

    expect(adapter.usageFor(new Set()).status).toBe(UsageStatus.NOT_READ)
  })

  it('a_turn_whose_usage_the_runtime_did_not_write_is_a_gap_and_leaves_the_attempt_partial', () => {
    const usage = Adapters.over([
      Entries.assistant('req_1', Entries.usage({ input: 1, cacheRead: 0, cacheCreation: 0, output: 1 })),
      Entries.assistant('req_2', null),
    ]).usageFor(new Set())

    expect(usage.status).toBe(UsageStatus.PARTIAL)
    expect(usage.gaps).toBe(1)
    expect(usage.totalTokens).toBeNull()
    expect(usage.evidence).toEqual(['req_1', 'req_2'])
  })

  it('a_transcript_where_no_turn_carries_usage_is_unmeasured_and_never_estimated_from_the_text', () => {
    const usage = Adapters.over([Entries.assistant('req_1', null), Entries.assistant('req_2', { input_tokens: 'many' })]).usageFor(new Set())

    expect(usage.status).toBe(UsageStatus.UNMEASURED)
    expect(usage.gaps).toBe(2)
    expect(usage.totalTokens).toBeNull()
  })

  it('the_transcript_is_looked_for_under_the_folder_the_runtime_derives_from_the_working_directory', () => {
    expect(ClaudeCodeTranscript.folderFor('/home/someone/code/ct/.worktrees/slice'))
      .toBe('-home-someone-code-ct--worktrees-slice')
  })

  it('a_session_whose_folder_does_not_follow_the_working_directory_is_still_found_by_the_listing', () => {
    const usage = Adapters.over(
      [Entries.assistant('req_1', Entries.usage({ input: 1, cacheRead: 0, cacheCreation: 0, output: 1 }))],
      { folders: ['-somewhere-else'] },
    ).usageFor(new Set())

    expect(usage.status).toBe(UsageStatus.MEASURED)
    expect(usage.totalTokens).toBe(2)
  })

  it('the_runtime_reports_no_active_duration_so_the_duration_is_declared_unsupported_and_not_derived_from_timestamps', () => {
    const usage = Adapters.over([Entries.assistant('req_1', Entries.usage())]).usageFor(new Set())

    expect(usage.durationStatus).toBe(UsageStatus.UNSUPPORTED)
    expect(usage.activeDurationMs).toBeNull()
  })
})
