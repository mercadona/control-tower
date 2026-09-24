import { afterEach, describe, it, expect } from 'vitest'
import { ClaudeCodeTranscript } from '../../../plugin/scripts/claude-code-usage.js'
import { ClaudeConversations } from '../../src/infrastructure/claude-conversations.ts'
import { Invocation } from '../../src/infrastructure/invocation.ts'
import { ConversationNotStarted } from '../../src/domain/exceptions.ts'
import { PtyLiveSessions } from '../../src/infrastructure/pty-live-sessions.ts'
import type { Terminal, TerminalSpawn } from '../../src/infrastructure/process-table.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

type RecordedSpawn = {
  file: string,
  argv: string[],
  options: { name: string, cols: number, rows: number, cwd: string, env: Record<string, string> },
}

class TerminalDouble implements Terminal {
  static readonly opened = new Set<TerminalDouble>()
  readonly pid = 4101
  #onExit: (() => void) | null = null

  constructor() {
    TerminalDouble.opened.add(this)
  }

  onData(): void {}
  onExit(listener: () => void): void { this.#onExit = listener }
  write(): void {}
  resize(): void {}

  exit(): void {
    this.#onExit?.()
    TerminalDouble.opened.delete(this)
  }

  static closeAll(): void {
    for (const terminal of [...TerminalDouble.opened]) terminal.exit()
  }
}

type RecordingSpawn = TerminalSpawn & { calls: RecordedSpawn[] }

class SpawnDouble {
  static recording(): RecordingSpawn {
    const calls: RecordedSpawn[] = []
    const spawn: TerminalSpawn = (file, argv, options) => {
      calls.push({ file, argv, options })

      return new TerminalDouble()
    }

    return Object.assign(spawn, { calls })
  }
}

class Governed {
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly ROOT = new CheckoutRoot('/repo/governed-checkout')
  static readonly ID = new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f')
  static readonly PROMPT_PATH = '/repo/governed-checkout/.agent/coordinating-session/phase-prompt.md'
  static readonly CLAUDE_DIRECTORY = '/home/someone/.claude'
  static readonly PLUGIN_ROOT = "/Users/someone/Pedro's code/control-tower/plugin"
  static readonly HOOKS_URL = 'http://127.0.0.1:4600/session-hooks'

  static conversation(id: ConversationId = Governed.ID): CoordinatingConversation {
    return new CoordinatingConversation({ id, repository: Governed.REPOSITORY, root: Governed.ROOT })
  }
}

type OverridableCollaborators = Partial<{
  shell: string | undefined,
  env: NodeJS.ProcessEnv,
  claudeDirectory: string,
  pluginRoot: string,
  listNames: (path: string) => string[],
  readText: (path: string) => string,
  newId: () => string,
  hooksUrl: () => string,
}>

class Adapter {
  static readyToOpen(overrides: OverridableCollaborators = {}): {
    conversations: ClaudeConversations, spawn: RecordingSpawn,
  } {
    const spawn = SpawnDouble.recording()
    const conversations = Adapter.#built(spawn, overrides)

    return { conversations, spawn }
  }

  static unableToSpawn(message: string): { conversations: ClaudeConversations } {
    const spawn: TerminalSpawn = (): never => { throw new Error(message) }

    return { conversations: Adapter.#built(spawn, {}) }
  }

  static #built(spawn: TerminalSpawn, overrides: OverridableCollaborators): ClaudeConversations {
    const liveSessions = new PtyLiveSessions({
      spawn,
      newId: () => 'terminal-1',
      stderr: (): void => {},
      signal: (): void => {},
      sleep: async (): Promise<void> => {},
      now: () => 0,
      termGraceMs: 1,
      killGraceMs: 1,
      pollMs: 1,
      inspectProcessTable: async () => ' 4101  4101 Thu Sep 17 22:29:08 2026\n',
    })

    return new ClaudeConversations({
      liveSessions,
      shell: overrides.shell ?? '/bin/zsh',
      env: overrides.env ?? { PATH: '/usr/bin' },
      claudeDirectory: overrides.claudeDirectory ?? Governed.CLAUDE_DIRECTORY,
      pluginRoot: overrides.pluginRoot ?? Governed.PLUGIN_ROOT,
      listNames: overrides.listNames ?? ((): string[] => []),
      readText: overrides.readText ?? ((): string => { throw new Error('no transcript recorded') }),
      newId: overrides.newId ?? ((): string => Governed.ID.text),
      hooksUrl: overrides.hooksUrl ?? ((): string => Governed.HOOKS_URL),
    })
  }
}

describe('ClaudeConversations', () => {
  afterEach(() => {
    TerminalDouble.closeAll()
  })

  it('passes_the_state_root_to_the_coordinator_without_replacing_its_claude_account', () => {
    const { conversations, spawn } = Adapter.readyToOpen({
      env: { PATH: '/usr/bin', CT_STATE_DIR: '/isolated/state' },
      claudeDirectory: Governed.CLAUDE_DIRECTORY,
    })

    conversations.start({ conversation: Governed.conversation(), promptPath: Governed.PROMPT_PATH })

    expect(spawn.calls[0].options.env.CT_STATE_DIR).toBe('/isolated/state')
    expect(spawn.calls[0].options.env.CLAUDE_CONFIG_DIR).toBe(Governed.CLAUDE_DIRECTORY)
  })

  it('hands the session the resolved claude directory, so an empty one in its own environment does not reach it', () => {
    const { conversations, spawn } = Adapter.readyToOpen({
      env: { PATH: '/usr/bin', [Invocation.CONFIG_VARIABLE]: '' },
      claudeDirectory: Governed.CLAUDE_DIRECTORY,
    })

    conversations.start({ conversation: Governed.conversation(), promptPath: Governed.PROMPT_PATH })

    const [call] = spawn.calls
    expect(call.options.env[Invocation.CONFIG_VARIABLE]).toBe(Governed.CLAUDE_DIRECTORY)
  })

  it('leaves the prompt path in the environment and never in the command', () => {
    const { conversations, spawn } = Adapter.readyToOpen({ newId: () => Governed.ID.text })
    const id = conversations.mint()
    const conversation = Governed.conversation(id)

    conversations.start({ conversation, promptPath: Governed.PROMPT_PATH })

    const [call] = spawn.calls
    expect(call.argv).toEqual([
      PtyLiveSessions.LOGIN_INTERACTIVE, '-c',
      `exec claude --session-id ${Governed.ID.text} --permission-mode auto --model opus ` +
        '--plugin-dir "$CT_PLUGIN_ROOT" ' +
        '"Read the file at $CT_PHASE_PROMPT and do exactly what it says."',
    ])
    expect(call.options.env[ClaudeConversations.PROMPT_VARIABLE]).toBe(Governed.PROMPT_PATH)
    expect(call.argv.join(' ')).not.toContain(Governed.PROMPT_PATH)
  })

  it('loads the plugin for the session it starts, so the phase skill resolves', () => {
    const { conversations, spawn } = Adapter.readyToOpen()
    const conversation = Governed.conversation()

    conversations.start({ conversation, promptPath: Governed.PROMPT_PATH })

    const [call] = spawn.calls
    expect(call.argv).toEqual([
      '-il', '-c',
      `exec claude --session-id ${conversation.id.text} ` +
        '--permission-mode auto --model opus --plugin-dir "$CT_PLUGIN_ROOT" ' +
        '"Read the file at $CT_PHASE_PROMPT and do exactly what it says."',
    ])
  })

  it('leaves the plugin root in the environment and never in the command', () => {
    const { conversations, spawn } = Adapter.readyToOpen()
    const conversation = Governed.conversation()

    conversations.start({ conversation, promptPath: Governed.PROMPT_PATH })

    const [call] = spawn.calls
    expect(call.options.env[ClaudeConversations.PLUGIN_ROOT_VARIABLE]).toBe(Governed.PLUGIN_ROOT)
    expect(call.argv.join(' ')).not.toContain(Governed.PLUGIN_ROOT)
  })

  it('resumes a recorded conversation instead of opening a new one', () => {
    const { conversations, spawn } = Adapter.readyToOpen()
    const conversation = Governed.conversation()

    conversations.resume(conversation)

    const [call] = spawn.calls
    expect(call.argv).toEqual([
      PtyLiveSessions.LOGIN_INTERACTIVE, '-c',
      `exec claude --resume ${conversation.id.text} --permission-mode auto --model opus ` +
        '--plugin-dir "$CT_PLUGIN_ROOT"',
    ])
    expect(Object.keys(call.options.env)).not.toContain(ClaudeConversations.PROMPT_VARIABLE)
  })

  it('runs in the governed checkout', () => {
    const { conversations, spawn } = Adapter.readyToOpen()
    const conversation = Governed.conversation()

    conversations.resume(conversation)

    expect(spawn.calls[0].options.cwd).toBe(Governed.ROOT.text)
  })

  it('raises conversation-not-started when the terminal cannot be spawned', () => {
    const { conversations } = Adapter.unableToSpawn('claude: command not found')
    const conversation = Governed.conversation()

    expect(() => conversations.start({ conversation, promptPath: Governed.PROMPT_PATH }))
      .toThrow(ConversationNotStarted)
  })

  it('answers that a conversation Claude Code no longer holds cannot be resumed', () => {
    const { conversations } = Adapter.readyToOpen({
      readText: (): string => { throw new Error('ENOENT') },
    })
    const conversation = Governed.conversation()

    expect(conversations.isResumable(conversation)).toBe(false)
  })

  it('answers that a recorded transcript can be resumed', () => {
    const conversation = Governed.conversation()
    const folder = ClaudeCodeTranscript.folderFor(conversation.root.text)
    const path = `${Governed.CLAUDE_DIRECTORY}/projects/${folder}/${conversation.id.text}.jsonl`
    const readCalls: string[] = []
    const { conversations } = Adapter.readyToOpen({
      listNames: (): string[] => [],
      readText: (asked): string => {
        readCalls.push(asked)
        if (asked !== path) throw new Error(`ENOENT: ${asked}`)

        return '{"type":"user"}\n'
      },
    })

    const resumable = conversations.isResumable(conversation)

    expect(resumable).toBe(true)
    expect(readCalls).toEqual([path])
  })
})
