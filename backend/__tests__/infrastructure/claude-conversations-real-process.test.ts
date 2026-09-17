import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeConversations } from '../../src/infrastructure/claude-conversations.ts'
import { PtyLiveSessions } from '../../src/infrastructure/pty-live-sessions.ts'
import type { Terminal, TerminalSpawn } from '../../src/infrastructure/pty-live-sessions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class TerminalDouble implements Terminal {
  readonly pid = 4101
  onData(): void {}
  onExit(): void {}
  write(): void {}
  resize(): void {}
}

class Governed {
  static readonly ID = new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f')
  static readonly PROMPT_PATH = '/tmp/state with spaces/phase-prompt.md'
  static readonly PLUGIN_ROOT = "/opt/plugins with spaces/Pedro's code/control-tower/plugin"

  static conversation(): CoordinatingConversation {
    return new CoordinatingConversation({
      id: Governed.ID,
      repository: new RepositoryName('josemerca/ct-loop-sandbox'),
      root: new CheckoutRoot('/repo/governed-checkout'),
    })
  }
}

class TheOpeningCommand {
  static of(conversation: CoordinatingConversation, promptPath: string): string {
    const commands: string[] = []
    const spawn: TerminalSpawn = (file, argv) => {
      commands.push(argv[argv.length - 1])

      return new TerminalDouble()
    }
    const conversations = new ClaudeConversations({
      liveSessions: new PtyLiveSessions({
        spawn,
        newId: () => 'terminal-1',
        stderr: (): void => {},
        signal: (): void => {},
        sleep: async (): Promise<void> => {},
        now: () => 0,
        termGraceMs: 1,
        killGraceMs: 1,
        pollMs: 1,
      }),
      shell: '/bin/sh',
      env: {},
      claudeDirectory: '/home/someone/.claude',
      pluginRoot: Governed.PLUGIN_ROOT,
      listNames: (): string[] => [],
      readText: (): string => { throw new Error('no transcript recorded') },
      newId: (): string => conversation.id.text,
      hooksUrl: (): string => 'http://127.0.0.1:4600/session-hooks',
    })
    conversations.start({ conversation, promptPath })

    return commands[0]
  }
}

class AClaudeThatPrintsItsArguments {
  static readonly SCRIPT = ['#!/bin/sh', 'for given in "$@"; do printf \'%s\\n\' "$given"; done'].join('\n')

  static async onThePath(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'ct-claude-arguments-'))
    await writeFile(join(directory, ClaudeConversations.BIN), `${AClaudeThatPrintsItsArguments.SCRIPT}\n`, { mode: 0o755 })

    return directory
  }

  static argumentsOf(command: string, { path, promptPath }: { path: string, promptPath: string }): string[] {
    const printed = execFileSync('/bin/sh', ['-c', command], {
      encoding: 'utf8',
      env: {
        PATH: path,
        [ClaudeConversations.PROMPT_VARIABLE]: promptPath,
        [ClaudeConversations.PLUGIN_ROOT_VARIABLE]: Governed.PLUGIN_ROOT,
      },
    })

    return printed.split('\n').filter((given) => given !== '')
  }
}

describe('ClaudeConversations against a real shell', () => {
  it('sends the opening sentence and the plugin root to claude as one argument each when both paths carry spaces and a single quote', async () => {
    const conversation = Governed.conversation()
    const path = await AClaudeThatPrintsItsArguments.onThePath()

    const given = AClaudeThatPrintsItsArguments.argumentsOf(
      TheOpeningCommand.of(conversation, Governed.PROMPT_PATH),
      { path, promptPath: Governed.PROMPT_PATH }
    )

    expect(given).toEqual([
      '--session-id',
      conversation.id.text,
      '--permission-mode',
      'auto',
      '--model',
      ClaudeConversations.MODEL,
      ClaudeConversations.PLUGIN_DIR_FLAG,
      Governed.PLUGIN_ROOT,
      `Read the file at ${Governed.PROMPT_PATH} and do exactly what it says.`,
    ])
    await rm(path, { recursive: true, force: true })
  })
})
