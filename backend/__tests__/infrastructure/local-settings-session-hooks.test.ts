import { describe, it, expect, vi } from 'vitest'
import { LocalSettingsSessionHooks } from '../../src/infrastructure/local-settings-session-hooks.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { SessionHooksNotUnderstood, SessionHooksNotWritten } from '../../src/domain/exceptions.ts'

const ROOT = new CheckoutRoot('/repo')
const SETTINGS_PATH = '/repo/.claude/settings.local.json'

const OWN_COMMAND =
  'if [ -n "$CT_SESSION_HOOKS_URL" ]; then curl -sS -m 2 -o /dev/null -X POST' +
  " -H 'Content-Type: application/json' --data-binary @- \"$CT_SESSION_HOOKS_URL\" || true; fi"

const OWN_GROUP = { hooks: [{ type: 'command', command: OWN_COMMAND, timeout: 5 }] }

const FOREIGN_STOP_GROUP = { hooks: [{ type: 'command', command: 'echo goodbye', timeout: 30 }] }

const STALE_OWN_GROUP = {
  hooks: [{
    type: 'command',
    command:
      'if [ -n "$CT_SESSION_HOOKS_URL" ]; then curl -sS -m 2 -o /dev/null -X POST' +
      ' -H \'Content-Type: application/json\' --data-binary @- "http://localhost:4009/hooks" || true; fi',
    timeout: 5,
  }],
}

describe('LocalSettingsSessionHooks', () => {
  it('purges its own stale hooks for every event before writing the new ones', async () => {
    const write = vi.fn()
    const read = vi.fn(async () => JSON.stringify({
      hooks: { Stop: [STALE_OWN_GROUP, FOREIGN_STOP_GROUP] },
    }))
    const hooks = new LocalSettingsSessionHooks({ read, write })

    await hooks.install(ROOT)

    expect(write).toHaveBeenCalledWith(
      SETTINGS_PATH,
      `${JSON.stringify({
        hooks: {
          Stop: [FOREIGN_STOP_GROUP, OWN_GROUP],
          UserPromptSubmit: [OWN_GROUP],
          Notification: [OWN_GROUP],
        },
      }, null, 2)}\n`
    )
  })

  it('leaves hooks that are not ours exactly where they were', async () => {
    const write = vi.fn()
    const read = vi.fn(async () => JSON.stringify({
      hooks: { Stop: [FOREIGN_STOP_GROUP] },
    }))
    const hooks = new LocalSettingsSessionHooks({ read, write })

    await hooks.install(ROOT)

    const [, written] = write.mock.calls[0] as [string, string]
    const parsed = JSON.parse(written)
    expect(parsed.hooks.Stop).toContainEqual(FOREIGN_STOP_GROUP)
  })

  it('writes one command per reported event', async () => {
    const write = vi.fn()
    const read = vi.fn(async () => JSON.stringify({}))
    const hooks = new LocalSettingsSessionHooks({ read, write })

    await hooks.install(ROOT)

    const [, written] = write.mock.calls[0] as [string, string]
    const parsed = JSON.parse(written)
    expect(parsed.hooks.UserPromptSubmit).toEqual([OWN_GROUP])
    expect(parsed.hooks.Notification).toEqual([OWN_GROUP])
    expect(parsed.hooks.Stop).toEqual([OWN_GROUP])
  })

  it('treats a missing settings file as an empty one', async () => {
    const write = vi.fn()
    const read = vi.fn(async () => null)
    const hooks = new LocalSettingsSessionHooks({ read, write })

    await hooks.install(ROOT)

    expect(write).toHaveBeenCalledWith(
      SETTINGS_PATH,
      `${JSON.stringify({
        hooks: {
          UserPromptSubmit: [OWN_GROUP],
          Notification: [OWN_GROUP],
          Stop: [OWN_GROUP],
        },
      }, null, 2)}\n`
    )
  })

  it('raises session-hooks-not-understood instead of overwriting a settings file it cannot parse', async () => {
    const write = vi.fn()
    const read = vi.fn(async () => '{not json')
    const hooks = new LocalSettingsSessionHooks({ read, write })

    await expect(hooks.install(ROOT)).rejects.toBeInstanceOf(SessionHooksNotUnderstood)
    expect(write).not.toHaveBeenCalled()
  })

  it('raises session-hooks-not-written when the file cannot be written', async () => {
    const write = vi.fn(async () => { throw new Error('disk is full') })
    const read = vi.fn(async () => null)
    const hooks = new LocalSettingsSessionHooks({ read, write })

    await expect(hooks.install(ROOT)).rejects.toBeInstanceOf(SessionHooksNotWritten)
  })
})

describe('LocalSettingsSessionHooks publishing the state root into the checkout', () => {
  const ISOLATED = '/isolated/state'

  it('writes_the_root_the_backend_resolved_so_a_command_in_that_checkout_inherits_it', async () => {
    const write = vi.fn()
    const read = vi.fn(async () => null)
    const hooks = new LocalSettingsSessionHooks({ read, write, stateRoot: ISOLATED })

    await hooks.install(ROOT)

    expect(JSON.parse(write.mock.calls[0][1]).env).toEqual({ CT_STATE_DIR: ISOLATED })
  })

  it('leaves environment entries that are not ours exactly where they were', async () => {
    const write = vi.fn()
    const read = vi.fn(async () => JSON.stringify({ env: { FOREIGN: 'kept', CT_STATE_DIR: '/an/older/root' } }))
    const hooks = new LocalSettingsSessionHooks({ read, write, stateRoot: ISOLATED })

    await hooks.install(ROOT)

    expect(JSON.parse(write.mock.calls[0][1]).env).toEqual({ FOREIGN: 'kept', CT_STATE_DIR: ISOLATED })
  })

  it('writes_no_environment_block_at_all_when_no_root_was_given_to_publish', async () => {
    const write = vi.fn()
    const read = vi.fn(async () => null)
    const hooks = new LocalSettingsSessionHooks({ read, write })

    await hooks.install(ROOT)

    expect(JSON.parse(write.mock.calls[0][1])).not.toHaveProperty('env')
  })
})
