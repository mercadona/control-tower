import { ClaudeCodeTranscript } from '../../../plugin/scripts/claude-code-usage.js'
import { ConversationNotStarted } from '../domain/exceptions.ts'
import { Conversations } from '../domain/ports/conversations.ts'
import { ConversationId } from '../domain/value-objects/conversation-id.ts'
import { SessionProgram } from '../domain/value-objects/session-program.ts'
import { PtyLiveSessions } from './pty-live-sessions.ts'
import { Invocation } from './invocation.ts'
import type { CoordinatingConversation } from '../domain/value-objects/coordinating-conversation.ts'
import type { LiveSession } from '../domain/value-objects/live-session.ts'

export class ClaudeConversations extends Conversations {
  static readonly BIN = 'claude'
  static readonly NAME = 'brainstorming'
  static readonly PROMPT_VARIABLE = 'CT_PHASE_PROMPT'
  static readonly HOOKS_URL_VARIABLE = 'CT_SESSION_HOOKS_URL'
  static readonly PLUGIN_ROOT_VARIABLE = 'CT_PLUGIN_ROOT'
  static readonly PERMISSION_MODE = 'auto'
  static readonly MODEL = 'opus'
  static readonly PLUGIN_DIR_FLAG = '--plugin-dir'
  static readonly OPENING = `Read the file at $${ClaudeConversations.PROMPT_VARIABLE} and do exactly what it says.`
  static readonly #PLUGIN_DIR_ARGUMENTS =
    `${ClaudeConversations.PLUGIN_DIR_FLAG} "$${ClaudeConversations.PLUGIN_ROOT_VARIABLE}"`

  readonly liveSessions: PtyLiveSessions
  readonly shell: string | undefined
  readonly env: NodeJS.ProcessEnv
  readonly claudeDirectory: string
  readonly pluginRoot: string
  readonly listNames: (path: string) => string[]
  readonly readText: (path: string) => string
  readonly newId: () => string
  readonly hooksUrl: () => string

  constructor({ liveSessions, shell, env, claudeDirectory, pluginRoot, listNames, readText, newId, hooksUrl }: {
    liveSessions: PtyLiveSessions, shell: string | undefined, env: NodeJS.ProcessEnv,
    claudeDirectory: string, pluginRoot: string, listNames: (path: string) => string[],
    readText: (path: string) => string, newId: () => string, hooksUrl: () => string,
  }) {
    super()
    this.liveSessions = liveSessions
    this.shell = shell
    this.env = env
    this.claudeDirectory = claudeDirectory
    this.pluginRoot = pluginRoot
    this.listNames = listNames
    this.readText = readText
    this.newId = newId
    this.hooksUrl = hooksUrl
  }

  mint(): ConversationId {
    return new ConversationId(this.newId())
  }

  isResumable(conversation: CoordinatingConversation): boolean {
    const transcript = new ClaudeCodeTranscript({
      claudeDirectory: this.claudeDirectory,
      cwd: conversation.root.text,
      listNames: this.listNames,
      readText: this.readText,
    })

    return transcript.read(conversation.id.text) !== null
  }

  start({ conversation, promptPath }: {
    conversation: CoordinatingConversation, promptPath: string,
  }): LiveSession {
    return this.#open({
      conversation,
      command: ClaudeConversations.#startCommand(conversation.id.text),
      extra: { [ClaudeConversations.PROMPT_VARIABLE]: promptPath },
    })
  }

  resume(conversation: CoordinatingConversation): LiveSession {
    return this.#open({
      conversation,
      command: ClaudeConversations.#resumeCommand(conversation.id.text),
      extra: {},
    })
  }

  static #startCommand(id: string): string {
    return `exec ${ClaudeConversations.BIN} --session-id ${id} ` +
      `--permission-mode ${ClaudeConversations.PERMISSION_MODE} --model ${ClaudeConversations.MODEL} ` +
      `${ClaudeConversations.#PLUGIN_DIR_ARGUMENTS} ` +
      `"${ClaudeConversations.OPENING}"`
  }

  static #resumeCommand(id: string): string {
    return `exec ${ClaudeConversations.BIN} --resume ${id} ` +
      `--permission-mode ${ClaudeConversations.PERMISSION_MODE} --model ${ClaudeConversations.MODEL} ` +
      `${ClaudeConversations.#PLUGIN_DIR_ARGUMENTS}`
  }

  #open({ conversation, command, extra }: {
    conversation: CoordinatingConversation, command: string, extra: Readonly<Record<string, string>>,
  }): LiveSession {
    const program = new SessionProgram({
      name: ClaudeConversations.NAME,
      file: this.shell ?? PtyLiveSessions.FALLBACK_SHELL,
      argv: [PtyLiveSessions.LOGIN_INTERACTIVE, '-c', command],
      cwd: conversation.root.text,
      env: {
        ...ClaudeConversations.#definedEntriesOf(this.env),
        [Invocation.CONFIG_VARIABLE]: this.claudeDirectory,
        [ClaudeConversations.HOOKS_URL_VARIABLE]: this.hooksUrl(),
        [ClaudeConversations.PLUGIN_ROOT_VARIABLE]: this.pluginRoot,
        ...extra,
      },
    })
    try {
      return this.liveSessions.open(program)
    } catch (cause) {
      throw new ConversationNotStarted(
        `${ClaudeConversations.BIN} could not be spawned in ${conversation.root.text}: ${(cause as Error).message}`
      )
    }
  }

  static #definedEntriesOf(env: NodeJS.ProcessEnv): Record<string, string> {
    const filtered: Record<string, string> = {}
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) filtered[key] = value
    }

    return filtered
  }
}
