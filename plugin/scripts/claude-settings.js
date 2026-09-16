export class SettingsNotUnderstood extends Error {}

export class ControlTowerPlugin {
  static MARKETPLACE = 'control-tower'
  static MARKETPLACE_REPO = 'mercadona/control-tower'
  static PLUGIN_NAME = 'control-tower-loop'
  static SOURCE_KIND = 'github'

  static #RELEASE = /^\d+\.\d+\.\d+$/
  static #TAG_PREFIX = 'plugin-v'

  static get id() {
    return `${ControlTowerPlugin.PLUGIN_NAME}@${ControlTowerPlugin.MARKETPLACE}`
  }

  static get installCommand() {
    return `claude plugin install ${ControlTowerPlugin.id} --scope project`
  }

  static refFor(version) {
    if (!ControlTowerPlugin.#RELEASE.test(String(version ?? ''))) {
      throw new SettingsNotUnderstood(
        `the plugin declares no release to pin the marketplace to (got ${JSON.stringify(version)}). ` +
          'The ref is a tag that either resolves or does not, and it is not invented here.'
      )
    }
    return `${ControlTowerPlugin.#TAG_PREFIX}${version}`
  }

  static sourceFor(version) {
    return {
      source: ControlTowerPlugin.SOURCE_KIND,
      repo: ControlTowerPlugin.MARKETPLACE_REPO,
      ref: ControlTowerPlugin.refFor(version),
    }
  }
}

export class BashPermission {
  static #TRAILING_SHORTHAND = /:\*$/
  static #OPTIONAL_TAIL = ' *'
  static #ESCAPABLE = /[.+?^${}()|[\]\\]/g

  #pattern

  constructor(pattern) {
    this.#pattern = pattern
  }

  get pattern() {
    return this.#pattern
  }

  get rule() {
    return `Bash(${this.#pattern})`
  }

  get #expanded() {
    return this.#pattern.replace(BashPermission.#TRAILING_SHORTHAND, BashPermission.#OPTIONAL_TAIL)
  }

  get #asRegExp() {
    const expanded = this.#expanded
    const bare = expanded.endsWith(BashPermission.#OPTIONAL_TAIL)
      ? expanded.slice(0, -BashPermission.#OPTIONAL_TAIL.length)
      : null
    const source = (text) => text.replace(BashPermission.#ESCAPABLE, '\\$&').replaceAll('*', '[\\s\\S]*')
    const alternatives = bare === null ? [expanded] : [expanded, bare]
    return new RegExp(`^(?:${alternatives.map(source).join('|')})$`)
  }

  matches(command) {
    return this.#asRegExp.test(command)
  }

  static rulesOf(permissions) {
    return permissions.map((permission) => permission.rule)
  }

  static matching(permissions, command) {
    return permissions.filter((permission) => permission.matches(command))
  }
}

export class LoopPermissions {
  static ALLOWED = [new BashPermission('gh:*'), new BashPermission('git:*')]

  static FORBIDDEN = [
    new BashPermission('git commit *--no-verify*'),
    new BashPermission('git push *--no-verify*'),
    new BashPermission('git push *--force*'),
    new BashPermission('git -c core.hooksPath=*'),
  ]

  static get allow() {
    return BashPermission.rulesOf(LoopPermissions.ALLOWED)
  }

  static get deny() {
    return BashPermission.rulesOf(LoopPermissions.FORBIDDEN)
  }

  static forbids(command) {
    return BashPermission.matching(LoopPermissions.FORBIDDEN, command).length > 0
  }
}

class SettingsShape {
  static isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  static root(settings) {
    if (SettingsShape.isObject(settings)) return settings
    throw new SettingsNotUnderstood(
      'the settings file is not a JSON object, so there is nothing to merge these keys into. ' +
        'Nothing has been written: not being the object we merge into is not being empty.'
    )
  }

  static objectAt(settings, key) {
    if (!(key in settings)) return {}
    if (SettingsShape.isObject(settings[key])) return settings[key]
    throw new SettingsNotUnderstood(
      `\`${key}\` is in the settings file and it is not an object, it is ${typeof settings[key]}. ` +
        'Nothing has been written: reading it as empty would replace whatever is really there.'
    )
  }

  static listAt(settings, key) {
    if (!(key in settings)) return []
    if (Array.isArray(settings[key])) return settings[key]
    throw new SettingsNotUnderstood(
      `\`permissions.${key}\` is in the settings file and it is not a list, it is ${typeof settings[key]}. ` +
        'Nothing has been written.'
    )
  }

  static union(present, ours) {
    const added = ours.filter((entry) => !present.includes(entry))
    return { entries: [...present, ...added], added }
  }
}

class MarketplaceEntry {
  static KEY = 'extraKnownMarketplaces'

  #present
  #source

  constructor(present, source) {
    this.#present = present
    this.#source = source
  }

  static from(settings, version) {
    const declared = SettingsShape.objectAt(settings, MarketplaceEntry.KEY)
    return new MarketplaceEntry(declared, ControlTowerPlugin.sourceFor(version))
  }

  get #entry() {
    return this.#present[ControlTowerPlugin.MARKETPLACE]
  }

  get #declaredSource() {
    const entry = this.#entry
    if (SettingsShape.isObject(entry) && SettingsShape.isObject(entry.source)) return entry.source
    throw new SettingsNotUnderstood(
      `\`${MarketplaceEntry.KEY}.${ControlTowerPlugin.MARKETPLACE}\` is there and it carries no \`source\` object. ` +
        'Nothing has been written.'
    )
  }

  get #absent() {
    return !(ControlTowerPlugin.MARKETPLACE in this.#present)
  }

  #declaring() {
    return {
      entries: { ...this.#present, [ControlTowerPlugin.MARKETPLACE]: { source: this.#source } },
      messages: [
        `declared the marketplace \`${ControlTowerPlugin.MARKETPLACE}\` ` +
          `(${this.#source.repo}, pinned at ${this.#source.ref})`,
      ],
    }
  }

  #pinning(declared) {
    return {
      entries: {
        ...this.#present,
        [ControlTowerPlugin.MARKETPLACE]: { ...this.#entry, source: { ...declared, ref: this.#source.ref } },
      },
      messages: [`pinned the marketplace \`${ControlTowerPlugin.MARKETPLACE}\` at ${this.#source.ref}`],
    }
  }

  #reporting(message) {
    return { entries: this.#present, messages: [message] }
  }

  #otherRepository(declared) {
    return (
      `the marketplace \`${ControlTowerPlugin.MARKETPLACE}\` reads ${JSON.stringify(declared.repo)} and this ` +
      `plugin comes from ${this.#source.repo}. Left as it is: which repository a marketplace reads is not ` +
      'changed from here.'
    )
  }

  #otherRelease(declared) {
    return (
      `this repository is pinned at ${JSON.stringify(declared.ref)} and this plugin is ${this.#source.ref}. ` +
      `Left as it is. To move it, set \`${MarketplaceEntry.KEY}.${ControlTowerPlugin.MARKETPLACE}.source.ref\` ` +
      `to ${this.#source.ref}: one line, and a person decides which release a repository runs.`
    )
  }

  merged() {
    if (this.#absent) return this.#declaring()
    const declared = this.#declaredSource
    if (declared.repo !== this.#source.repo) return this.#reporting(this.#otherRepository(declared))
    if (declared.ref === undefined) return this.#pinning(declared)
    if (declared.ref !== this.#source.ref) return this.#reporting(this.#otherRelease(declared))
    return { entries: this.#present, messages: [] }
  }
}

class EnabledPlugin {
  static KEY = 'enabledPlugins'

  #present

  constructor(present) {
    this.#present = present
  }

  static from(settings) {
    return new EnabledPlugin(SettingsShape.objectAt(settings, EnabledPlugin.KEY))
  }

  get #declared() {
    return this.#present[ControlTowerPlugin.id]
  }

  #switchedOff() {
    return (
      `\`${ControlTowerPlugin.id}\` is declared as ${JSON.stringify(this.#declared)} in this repository, not ` +
      '`true`. Left as it is: somebody switched this plugin off here on purpose, and a scaffolder does not ' +
      'switch it back on.'
    )
  }

  merged() {
    if (!(ControlTowerPlugin.id in this.#present)) {
      return {
        entries: { ...this.#present, [ControlTowerPlugin.id]: true },
        messages: [`enabled \`${ControlTowerPlugin.id}\``],
      }
    }
    if (this.#declared !== true) return { entries: this.#present, messages: [this.#switchedOff()] }
    return { entries: this.#present, messages: [] }
  }
}

class Permissions {
  static KEY = 'permissions'

  #present

  constructor(present) {
    this.#present = present
  }

  static from(settings) {
    return new Permissions(SettingsShape.objectAt(settings, Permissions.KEY))
  }

  merged() {
    const allow = SettingsShape.union(SettingsShape.listAt(this.#present, 'allow'), LoopPermissions.allow)
    const deny = SettingsShape.union(SettingsShape.listAt(this.#present, 'deny'), LoopPermissions.deny)
    const messages = []
    if (allow.added.length) messages.push(`allowed ${allow.added.join(', ')}`)
    if (deny.added.length) messages.push(`denied ${deny.added.join(', ')}`)
    return { entries: { ...this.#present, allow: allow.entries, deny: deny.entries }, messages }
  }
}

export class ClaudeSettings {
  static merge(existing, { version } = {}) {
    const settings = { ...SettingsShape.root(existing) }
    const marketplace = MarketplaceEntry.from(settings, version).merged()
    const plugin = EnabledPlugin.from(settings).merged()
    const permissions = Permissions.from(settings).merged()
    settings[MarketplaceEntry.KEY] = marketplace.entries
    settings[EnabledPlugin.KEY] = plugin.entries
    settings[Permissions.KEY] = permissions.entries
    return {
      settings,
      messages: [...marketplace.messages, ...plugin.messages, ...permissions.messages],
    }
  }
}
