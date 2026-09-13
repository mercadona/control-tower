import { join } from 'node:path'
import { SessionHooks } from '../domain/ports/session-hooks.ts'
import { SessionHooksNotUnderstood, SessionHooksNotWritten } from '../domain/exceptions.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'

type ReadSettings = (path: string) => Promise<string | null>
type WriteSettings = (path: string, text: string) => Promise<void>
type JsonRecord = Record<string, unknown>

export class LocalSettingsSessionHooks extends SessionHooks {
  static readonly SETTINGS: readonly string[] = ['.claude', 'settings.local.json']
  static readonly EVENTS: readonly string[] = ['UserPromptSubmit', 'Notification', 'Stop']
  static readonly MARKER = 'CT_SESSION_HOOKS_URL'
  static readonly TIMEOUT_SECONDS = 5
  static readonly COMMAND =
    'if [ -n "$CT_SESSION_HOOKS_URL" ]; then curl -sS -m 2 -o /dev/null -X POST' +
    " -H 'Content-Type: application/json' --data-binary @- \"$CT_SESSION_HOOKS_URL\" || true; fi"

  readonly read: ReadSettings
  readonly write: WriteSettings

  constructor({ read, write }: { read: ReadSettings, write: WriteSettings }) {
    super()
    this.read = read
    this.write = write
  }

  static #isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  static #isOwnEntry(entry: unknown): boolean {
    return LocalSettingsSessionHooks.#isRecord(entry) &&
      typeof entry.command === 'string' &&
      entry.command.includes(LocalSettingsSessionHooks.MARKER)
  }

  static #withoutOwnEntries(group: unknown): JsonRecord | null {
    if (!LocalSettingsSessionHooks.#isRecord(group) || !Array.isArray(group.hooks)) {
      return LocalSettingsSessionHooks.#isRecord(group) ? group : null
    }
    const hooks = group.hooks.filter((entry) => !LocalSettingsSessionHooks.#isOwnEntry(entry))
    return hooks.length === 0 ? null : { ...group, hooks }
  }

  static #purged(groups: unknown): JsonRecord[] {
    if (!Array.isArray(groups)) return []
    return groups
      .map((group) => LocalSettingsSessionHooks.#withoutOwnEntries(group))
      .filter((group): group is JsonRecord => group !== null)
  }

  static #ownGroup(): JsonRecord {
    return {
      hooks: [{
        type: 'command',
        command: LocalSettingsSessionHooks.COMMAND,
        timeout: LocalSettingsSessionHooks.TIMEOUT_SECONDS,
      }],
    }
  }

  static #parsed(text: string, path: string): unknown {
    try {
      return JSON.parse(text)
    } catch {
      throw new SessionHooksNotUnderstood(`the settings file at ${path} is not JSON`)
    }
  }

  async #settingsAt(path: string): Promise<JsonRecord> {
    const text = await this.read(path)
    if (text === null) return {}

    const parsed = LocalSettingsSessionHooks.#parsed(text, path)
    if (!LocalSettingsSessionHooks.#isRecord(parsed)) {
      throw new SessionHooksNotUnderstood(`the settings file at ${path} is not a JSON object`)
    }
    return parsed
  }

  async #persisted(path: string, written: JsonRecord): Promise<void> {
    try {
      await this.write(path, `${JSON.stringify(written, null, 2)}\n`)
    } catch (cause) {
      throw new SessionHooksNotWritten(`the settings file at ${path} could not be written: ${String(cause)}`)
    }
  }

  async install(root: CheckoutRoot): Promise<void> {
    const path = join(root.text, ...LocalSettingsSessionHooks.SETTINGS)
    const settings = await this.#settingsAt(path)
    const existing = LocalSettingsSessionHooks.#isRecord(settings.hooks) ? settings.hooks : {}
    const hooks: JsonRecord = { ...existing }

    for (const event of LocalSettingsSessionHooks.EVENTS) {
      hooks[event] = [...LocalSettingsSessionHooks.#purged(hooks[event]), LocalSettingsSessionHooks.#ownGroup()]
    }

    await this.#persisted(path, { ...settings, hooks })
  }
}
