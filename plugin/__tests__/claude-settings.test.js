import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  mergeClaudeSettings,
  MARKETPLACE,
  PLUGIN_ID,
  MARKETPLACE_REPO,
  marketplaceRef,
  SettingsNotUnderstood,
} from '../scripts/claude-settings.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('mergeClaudeSettings', () => {
  it('an empty file gets the marketplace, the plugin and both permission lists', () => {
    const { settings } = mergeClaudeSettings({}, { version: '0.57.0' })
    expect(settings.extraKnownMarketplaces[MARKETPLACE].source).toEqual({
      source: 'github',
      repo: MARKETPLACE_REPO,
      ref: 'plugin-v0.57.0',
    })
    expect(settings.enabledPlugins[PLUGIN_ID]).toBe(true)
    expect(settings.permissions.allow).toContain('Bash(gh:*)')
    expect(settings.permissions.deny.length).toBeGreaterThan(0)
  })

  it('it says what it created, so ct-init does not have to read the JSON back', () => {
    const { messages } = mergeClaudeSettings({}, { version: '0.57.0' })
    expect(messages.join('\n')).toContain(MARKETPLACE)
  })

  // The whole reason this merges instead of writing the file: a repository may
  // already carry its own settings, with other plugins, other marketplaces and
  // keys that have nothing to do with the loop. Replacing that file would break
  // the repository to bootstrap it.
  it('keys that are not ours survive untouched', () => {
    const existing = {
      model: 'opus',
      extraKnownMarketplaces: { 'other-team': { source: { source: 'github', repo: 'other/repo' } } },
      enabledPlugins: { 'other-plugin@other-team': true },
    }
    const { settings } = mergeClaudeSettings(existing, { version: '0.57.0' })
    expect(settings.model).toBe('opus')
    expect(settings.extraKnownMarketplaces['other-team']).toEqual(existing.extraKnownMarketplaces['other-team'])
    expect(settings.enabledPlugins['other-plugin@other-team']).toBe(true)
    expect(settings.enabledPlugins[PLUGIN_ID]).toBe(true)
  })

  it('a file that already declares exactly what we would write says nothing', () => {
    const first = mergeClaudeSettings({}, { version: '0.57.0' }).settings
    const { messages } = mergeClaudeSettings(first, { version: '0.57.0' })
    expect(messages).toEqual([])
  })

  it('running it twice changes nothing', () => {
    const first = mergeClaudeSettings({}, { version: '0.57.0' }).settings
    const { settings } = mergeClaudeSettings(first, { version: '0.57.0' })
    expect(settings).toEqual(first)
  })

  // Somebody who set the flag to `false` took a decision. Putting it back to
  // `true` from a scaffolder is indistinguishable from overriding them, and the
  // repository would be left running a plugin its owner switched off.
  it('the plugin flag set to false is reported and NOT put back', () => {
    const existing = { enabledPlugins: { [PLUGIN_ID]: false } }
    const { settings, messages } = mergeClaudeSettings(existing, { version: '0.57.0' })
    expect(settings.enabledPlugins[PLUGIN_ID]).toBe(false)
    expect(messages.join('\n')).toMatch(/false/)
  })

  // The upgrade path, and the only one: a repository pinned to an older release
  // visited by a newer ct-init is TOLD, with both versions named, and is not
  // moved. Which plugin release somebody else's repository runs is not a
  // scaffolder's decision.
  it('a ref pinned to another release is reported with both versions, and not moved', () => {
    const existing = mergeClaudeSettings({}, { version: '0.55.0' }).settings
    const { settings, messages } = mergeClaudeSettings(existing, { version: '0.57.0' })
    expect(settings.extraKnownMarketplaces[MARKETPLACE].source.ref).toBe('plugin-v0.55.0')
    const said = messages.join('\n')
    expect(said).toContain('plugin-v0.55.0')
    expect(said).toContain('plugin-v0.57.0')
  })

  it('a marketplace pointing at another repository is reported, and not moved', () => {
    const existing = {
      extraKnownMarketplaces: { [MARKETPLACE]: { source: { source: 'github', repo: 'someone/else' } } },
    }
    const { settings, messages } = mergeClaudeSettings(existing, { version: '0.57.0' })
    expect(settings.extraKnownMarketplaces[MARKETPLACE].source.repo).toBe('someone/else')
    expect(messages.join('\n')).toContain('someone/else')
  })

  describe('the permission lists', () => {
    it('foreign entries are kept and ours are added', () => {
      const existing = { permissions: { allow: ['Bash(make:*)'], deny: ['Bash(rm:*)'] } }
      const { settings } = mergeClaudeSettings(existing, { version: '0.57.0' })
      expect(settings.permissions.allow).toContain('Bash(make:*)')
      expect(settings.permissions.allow).toContain('Bash(gh:*)')
      expect(settings.permissions.deny).toContain('Bash(rm:*)')
    })

    it('two runs do not duplicate an entry', () => {
      const first = mergeClaudeSettings({}, { version: '0.57.0' }).settings
      const { settings } = mergeClaudeSettings(first, { version: '0.57.0' })
      const counted = (list, entry) => list.filter((e) => e === entry).length
      expect(counted(settings.permissions.allow, 'Bash(gh:*)')).toBe(1)
      for (const entry of settings.permissions.deny) {
        expect(counted(settings.permissions.deny, entry)).toBe(1)
      }
    })

    // `Bash(git:*)` would otherwise auto-allow the very invocations this
    // repository's CLAUDE.md forbids — a control is not an obstacle to route
    // around. The deny list carries that rule into every governed repository,
    // and it applies before the folder is trusted.
    it('every invocation CLAUDE.md forbids is denied', () => {
      const { settings } = mergeClaudeSettings({}, { version: '0.57.0' })
      const denied = settings.permissions.deny.join('\n')
      expect(denied).toContain('--no-verify')
      expect(denied).toContain('--force')
      expect(denied).toContain('core.hooksPath')
    })

    it('nothing broader than gh and git is allowed', () => {
      const { settings } = mergeClaudeSettings({}, { version: '0.57.0' })
      expect(settings.permissions.allow).toEqual(['Bash(gh:*)', 'Bash(git:*)'])
    })

    // An entry a later version stops emitting is left where it is. Widening an
    // allow list is not the hazard a stale hook is: a leftover entry sits there
    // doing nothing, and removing what we do not recognise would be removing
    // somebody's rule on the strength of not having written it ourselves.
    it('an entry of ours that this version no longer emits is not removed', () => {
      const existing = { permissions: { allow: ['Bash(bq:*)'] } }
      const { settings } = mergeClaudeSettings(existing, { version: '0.57.0' })
      expect(settings.permissions.allow).toContain('Bash(bq:*)')
    })
  })

  // "It is not the object we merge into" is not "it is empty". Treating a
  // string, a list or a null as `{}` would silently replace whatever the
  // repository had. The same reading `SessionHooksNotUnderstood` already takes
  // for the file the cabin merges into.
  describe('a file that is not what we can merge into', () => {
    it('settings that are not an object', () => {
      for (const bad of ['text', 42, null, ['a']]) {
        expect(() => mergeClaudeSettings(bad, { version: '0.57.0' })).toThrow(SettingsNotUnderstood)
      }
    })

    it('one of our own containers holding something else', () => {
      for (const key of ['extraKnownMarketplaces', 'enabledPlugins', 'permissions']) {
        expect(() => mergeClaudeSettings({ [key]: 'text' }, { version: '0.57.0' })).toThrow(SettingsNotUnderstood)
      }
    })

    it('a permission list that is not a list', () => {
      expect(() => mergeClaudeSettings({ permissions: { allow: 'Bash(gh:*)' } }, { version: '0.57.0' })).toThrow(
        SettingsNotUnderstood
      )
    })

    it('the marketplace entry present but not an object', () => {
      expect(() =>
        mergeClaudeSettings({ extraKnownMarketplaces: { [MARKETPLACE]: 'text' } }, { version: '0.57.0' })
      ).toThrow(SettingsNotUnderstood)
    })
  })

  // The version cannot be invented: the ref is a tag that either exists or does
  // not, and writing `plugin-vundefined` would fail at install with a message
  // about a tag instead of about the missing version.
  it('with no version there is no ref to write', () => {
    for (const bad of [undefined, '', 'not-a-version']) {
      expect(() => mergeClaudeSettings({}, { version: bad })).toThrow(SettingsNotUnderstood)
    }
  })
})

describe('the literals this module carries', () => {
  // plugin/__tests__/distribution-boundary.test.js forbids anything under
  // plugin/ from reaching outside it, and .claude-plugin/marketplace.json is at
  // the ROOT of this repository — outside. So the names cannot be read at
  // runtime and live here as literals. This is the test that replaces that
  // read: it compares them against the real files, from the test tree, which is
  // allowed to look.
  const marketplace = JSON.parse(readFileSync(join(ROOT, '..', '.claude-plugin', 'marketplace.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))

  it('the marketplace name is the one the marketplace declares', () => {
    expect(MARKETPLACE).toBe(marketplace.name)
  })

  it('the plugin id is the plugin name and the marketplace name', () => {
    expect(PLUGIN_ID).toBe(`${manifest.name}@${marketplace.name}`)
    expect(marketplace.plugins.some((p) => p.name === manifest.name)).toBe(true)
  })

  it('the ref is the tag release-please creates for the version the plugin declares', () => {
    expect(marketplaceRef(manifest.version)).toBe(`plugin-v${manifest.version}`)
  })
})
