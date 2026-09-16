import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BashPermission,
  ClaudeSettings,
  ControlTowerPlugin,
  LoopPermissions,
  SettingsNotUnderstood,
} from '../scripts/claude-settings.js'

class Manifests {
  static ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

  static get marketplace() {
    return JSON.parse(readFileSync(join(Manifests.ROOT, '..', '.claude-plugin', 'marketplace.json'), 'utf8'))
  }

  static get plugin() {
    return JSON.parse(readFileSync(join(Manifests.ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
  }
}

class Given {
  static RELEASE = '0.57.0'

  static merged(existing = {}, version = Given.RELEASE) {
    return ClaudeSettings.merge(existing, { version })
  }

  static seeded(version = Given.RELEASE) {
    return Given.merged({}, version).settings
  }

  static sourceOf(settings) {
    return settings.extraKnownMarketplaces[ControlTowerPlugin.MARKETPLACE].source
  }

  static flagOf(settings) {
    return settings.enabledPlugins[ControlTowerPlugin.id]
  }

  static occurrencesOf(list, entry) {
    return list.filter((each) => each === entry).length
  }
}

describe('BashPermission reads a rule the way Claude Code reads it', () => {
  it('the :* shorthand at the end of a pattern stands for a trailing space and star', () => {
    expect(new BashPermission('git:*').matches('git commit --no-verify -m x')).toBe(true)
    expect(new BashPermission('gh:*').matches('gh pr view 1')).toBe(true)
  })

  it('a trailing star also matches the bare command', () => {
    expect(new BashPermission('git:*').matches('git')).toBe(true)
  })

  it('a colon anywhere but the end is a literal colon and matches no real command', () => {
    expect(new BashPermission('git commit:*--no-verify*').matches('git commit --no-verify -m x')).toBe(false)
    expect(new BashPermission('git commit:*--no-verify*').matches('git commit:--no-verify')).toBe(true)
  })

  it('a pattern with no star is an exact match', () => {
    expect(new BashPermission('git status').matches('git status')).toBe(true)
    expect(new BashPermission('git status').matches('git status --short')).toBe(false)
  })

  it('a rule renders as the Bash specifier Claude Code expects', () => {
    expect(new BashPermission('gh:*').rule).toBe('Bash(gh:*)')
  })
})

describe('the permissions the loop declares', () => {
  it('allows gh and git, and nothing wider', () => {
    expect(LoopPermissions.allow).toEqual(['Bash(gh:*)', 'Bash(git:*)'])
  })

  it.each([
    'git commit --no-verify -m x',
    'git commit -m x --no-verify',
    'git push --no-verify',
    'git push --force origin main',
    'git push origin main --force',
    'git -c core.hooksPath=/dev/null commit -m x',
  ])('denies %s, which the allowance for git would otherwise cover', (command) => {
    expect(new BashPermission('git:*').matches(command)).toBe(true)
    expect(LoopPermissions.forbids(command)).toBe(true)
  })

  it.each(['git commit -m x', 'git push origin main', 'git status', 'gh pr view 1'])(
    'leaves %s alone',
    (command) => {
      expect(LoopPermissions.forbids(command)).toBe(false)
    }
  )

  it('every denial is a pattern that matches a command somebody could really type', () => {
    for (const permission of LoopPermissions.FORBIDDEN) {
      expect(permission.pattern).not.toMatch(/:\*(?!$)/)
    }
  })
})

describe('ClaudeSettings.merge declares what a cloned repository needs', () => {
  it('an empty file gets the marketplace, the plugin and both permission lists', () => {
    const settings = Given.seeded()
    expect(Given.sourceOf(settings)).toEqual({
      source: 'github',
      repo: ControlTowerPlugin.MARKETPLACE_REPO,
      ref: 'plugin-v0.57.0',
    })
    expect(Given.flagOf(settings)).toBe(true)
    expect(settings.permissions.allow).toEqual(LoopPermissions.allow)
    expect(settings.permissions.deny).toEqual(LoopPermissions.deny)
  })

  it('it says what it declared, so the caller does not have to read the JSON back', () => {
    expect(Given.merged().messages.join('\n')).toContain(ControlTowerPlugin.MARKETPLACE)
  })

  it('keys that are not ours survive untouched', () => {
    const existing = {
      model: 'opus',
      extraKnownMarketplaces: { 'other-team': { source: { source: 'github', repo: 'other/repo' } } },
      enabledPlugins: { 'other-plugin@other-team': true },
    }
    const { settings } = Given.merged(existing)
    expect(settings.model).toBe('opus')
    expect(settings.extraKnownMarketplaces['other-team']).toEqual(existing.extraKnownMarketplaces['other-team'])
    expect(settings.enabledPlugins['other-plugin@other-team']).toBe(true)
    expect(Given.flagOf(settings)).toBe(true)
  })

  it('a file that already declares what we would write says nothing', () => {
    expect(Given.merged(Given.seeded()).messages).toEqual([])
  })

  it('running it twice changes nothing', () => {
    const first = Given.seeded()
    expect(Given.merged(first).settings).toEqual(first)
  })

  it('the plugin flag set to false is reported and not put back', () => {
    const { settings, messages } = Given.merged({ enabledPlugins: { [ControlTowerPlugin.id]: false } })
    expect(Given.flagOf(settings)).toBe(false)
    expect(messages.join('\n')).toContain('false')
  })

  it('a ref pinned at another release is reported with both releases, and not moved', () => {
    const { settings, messages } = Given.merged(Given.seeded('0.55.0'))
    expect(Given.sourceOf(settings).ref).toBe('plugin-v0.55.0')
    expect(messages.join('\n')).toContain('plugin-v0.55.0')
    expect(messages.join('\n')).toContain('plugin-v0.57.0')
  })

  it('a marketplace of ours carrying no ref is pinned: an absent leaf key is filled in', () => {
    const existing = {
      extraKnownMarketplaces: {
        [ControlTowerPlugin.MARKETPLACE]: { source: { source: 'github', repo: ControlTowerPlugin.MARKETPLACE_REPO } },
      },
    }
    const { settings, messages } = Given.merged(existing)
    expect(Given.sourceOf(settings).ref).toBe('plugin-v0.57.0')
    expect(messages.join('\n')).toContain('plugin-v0.57.0')
    expect(messages.join('\n')).not.toContain('undefined')
  })

  it('pinning an unpinned marketplace keeps whatever else its entry carried', () => {
    const existing = {
      extraKnownMarketplaces: {
        [ControlTowerPlugin.MARKETPLACE]: {
          autoUpdate: false,
          source: { source: 'github', repo: ControlTowerPlugin.MARKETPLACE_REPO },
        },
      },
    }
    const { settings } = Given.merged(existing)
    expect(settings.extraKnownMarketplaces[ControlTowerPlugin.MARKETPLACE].autoUpdate).toBe(false)
  })

  it('a marketplace reading another repository is reported, and not moved', () => {
    const existing = {
      extraKnownMarketplaces: {
        [ControlTowerPlugin.MARKETPLACE]: { source: { source: 'github', repo: 'someone/else' } },
      },
    }
    const { settings, messages } = Given.merged(existing)
    expect(Given.sourceOf(settings).repo).toBe('someone/else')
    expect(messages.join('\n')).toContain('someone/else')
  })

  it('foreign permission entries are kept and ours are added', () => {
    const { settings } = Given.merged({ permissions: { allow: ['Bash(make:*)'], deny: ['Bash(rm:*)'] } })
    expect(settings.permissions.allow).toContain('Bash(make:*)')
    expect(settings.permissions.allow).toContain('Bash(gh:*)')
    expect(settings.permissions.deny).toContain('Bash(rm:*)')
  })

  it('two runs do not duplicate a permission entry', () => {
    const { settings } = Given.merged(Given.seeded())
    expect(Given.occurrencesOf(settings.permissions.allow, 'Bash(gh:*)')).toBe(1)
    for (const entry of settings.permissions.deny) {
      expect(Given.occurrencesOf(settings.permissions.deny, entry)).toBe(1)
    }
  })

  it('an entry of ours that this release no longer emits is not removed', () => {
    const { settings } = Given.merged({ permissions: { allow: ['Bash(bq:*)'] } })
    expect(settings.permissions.allow).toContain('Bash(bq:*)')
  })
})

describe('a settings file that is not what these keys merge into', () => {
  it.each([['text'], [42], [null], [['a']]])('refuses settings that are not an object: %s', (bad) => {
    expect(() => Given.merged(bad)).toThrow(SettingsNotUnderstood)
  })

  it.each(['extraKnownMarketplaces', 'enabledPlugins', 'permissions'])(
    'refuses a %s holding something else',
    (key) => {
      expect(() => Given.merged({ [key]: 'text' })).toThrow(SettingsNotUnderstood)
    }
  )

  it('refuses a permission list that is not a list', () => {
    expect(() => Given.merged({ permissions: { allow: 'Bash(gh:*)' } })).toThrow(SettingsNotUnderstood)
  })

  it('refuses a marketplace entry carrying no source object', () => {
    expect(() =>
      Given.merged({ extraKnownMarketplaces: { [ControlTowerPlugin.MARKETPLACE]: 'text' } })
    ).toThrow(SettingsNotUnderstood)
  })

  it.each([[undefined], [''], ['not-a-release']])('refuses to invent a ref out of version %s', (bad) => {
    expect(() => ClaudeSettings.merge({}, { version: bad })).toThrow(SettingsNotUnderstood)
  })

  it('refuses to invent a ref when no version is handed over at all', () => {
    expect(() => ClaudeSettings.merge({})).toThrow(SettingsNotUnderstood)
  })
})

describe('the literals this module carries instead of reading', () => {
  it('the marketplace name is the one the marketplace declares', () => {
    expect(ControlTowerPlugin.MARKETPLACE).toBe(Manifests.marketplace.name)
  })

  it('the plugin id joins the plugin name and the marketplace name', () => {
    expect(ControlTowerPlugin.id).toBe(`${Manifests.plugin.name}@${Manifests.marketplace.name}`)
    expect(Manifests.marketplace.plugins.some((each) => each.name === Manifests.plugin.name)).toBe(true)
  })

  it('the ref is the tag release-please creates for the release the plugin declares', () => {
    expect(ControlTowerPlugin.refFor(Manifests.plugin.version)).toBe(`plugin-v${Manifests.plugin.version}`)
  })
})
