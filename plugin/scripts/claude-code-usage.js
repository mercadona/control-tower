import { join } from 'node:path'
import { TelemetryLines } from './telemetry-lines.js'
import { ToolIdentity, ToolUsage, UsageStatus } from './tool-usage.js'

export class ClaudeCodeTranscript {
  static FOLDER = 'projects'
  static EXTENSION = '.jsonl'

  static folderFor(cwd) {
    return String(cwd ?? '').replace(/[^A-Za-z0-9]/g, '-')
  }

  constructor({ claudeDirectory, cwd, listNames, readText }) {
    this.claudeDirectory = claudeDirectory
    this.cwd = cwd
    this.listNames = listNames
    this.readText = readText
    Object.freeze(this)
  }

  get #root() {
    return join(this.claudeDirectory, ClaudeCodeTranscript.FOLDER)
  }

  read(sessionId) {
    for (const folder of this.#candidates()) {
      const text = this.#readAt(join(this.#root, folder, `${sessionId}${ClaudeCodeTranscript.EXTENSION}`))
      if (text !== null) return text
    }
    return null
  }

  #candidates() {
    const preferred = ClaudeCodeTranscript.folderFor(this.cwd)
    const rest = this.#names().filter((name) => name !== preferred)
    return [preferred, ...rest]
  }

  #names() {
    try {
      return this.listNames(this.#root)
    } catch {
      return []
    }
  }

  #readAt(path) {
    try {
      return this.readText(path)
    } catch {
      return null
    }
  }
}

export class ClaudeCodeUsage {
  static TOOL = 'claude-code'
  static ASSISTANT_ENTRY = 'assistant'
  static #AGENT_VERSION = /^claude-code_(\d+)-(\d+)-(\d+)(?:_|$)/

  static detects(env) {
    return env.CLAUDECODE === '1' || ClaudeCodeUsage.#sessionOf(env) !== null
  }

  static #sessionOf(env) {
    const session = env.CLAUDE_CODE_SESSION_ID
    return typeof session === 'string' && session.length > 0 ? session : null
  }

  static identityOf(env) {
    return new ToolIdentity({ tool: ClaudeCodeUsage.TOOL, version: ClaudeCodeUsage.#versionOf(env) })
  }

  static #versionOf(env) {
    const matched = ClaudeCodeUsage.#AGENT_VERSION.exec(String(env.AI_AGENT ?? ''))
    return matched === null ? null : `${matched[1]}.${matched[2]}.${matched[3]}`
  }

  constructor({ env, transcript }) {
    this.env = env
    this.transcript = transcript
    Object.freeze(this)
  }

  usageFor(claimed) {
    const identity = ClaudeCodeUsage.identityOf(this.env)
    const sessionId = ClaudeCodeUsage.#sessionOf(this.env)
    if (sessionId === null) return ToolUsage.notRead({ identity })
    const text = this.transcript.read(sessionId)
    if (text === null) return ToolUsage.notRead({ identity })
    return ClaudeCodeUsage.#usageOfTranscript({ identity, text, claimed })
  }

  static #usageOfTranscript({ identity, text, claimed }) {
    const evidence = []
    const attributed = new Set()
    let inputTokens = 0
    let cachedInputTokens = 0
    let outputTokens = 0
    let gaps = 0
    for (const entry of TelemetryLines.objectsOf(text)) {
      if (entry.type !== ClaudeCodeUsage.ASSISTANT_ENTRY) continue
      const request = entry.requestId
      if (typeof request !== 'string' || request.length === 0) continue
      if (claimed.has(request) || attributed.has(request)) continue
      attributed.add(request)
      evidence.push(request)
      const tokens = ClaudeCodeUsage.#tokensOf(entry.message)
      if (tokens === null) {
        gaps += 1
        continue
      }
      inputTokens += tokens.inputTokens
      cachedInputTokens += tokens.cachedInputTokens
      outputTokens += tokens.outputTokens
    }
    if (gaps === 0) {
      return ToolUsage.measured({
        identity, inputTokens, cachedInputTokens, outputTokens, evidence,
        durationStatus: UsageStatus.UNSUPPORTED, activeDurationMs: null,
      })
    }
    if (evidence.length === gaps) return ToolUsage.unmeasured({ identity, evidence, gaps })
    return ToolUsage.partial({ identity, evidence, gaps, durationStatus: UsageStatus.UNSUPPORTED, activeDurationMs: null })
  }

  static #tokensOf(message) {
    const usage = message?.usage
    if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return null
    const inputTokens = ClaudeCodeUsage.#count(usage.input_tokens)
    const outputTokens = ClaudeCodeUsage.#count(usage.output_tokens)
    if (inputTokens === null || outputTokens === null) return null
    const cacheRead = ClaudeCodeUsage.#count(usage.cache_read_input_tokens) ?? 0
    const cacheCreation = ClaudeCodeUsage.#count(usage.cache_creation_input_tokens) ?? 0
    return { inputTokens, cachedInputTokens: cacheRead + cacheCreation, outputTokens }
  }

  static #count(value) {
    return Number.isInteger(value) && value >= 0 ? value : null
  }
}
