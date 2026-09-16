// The `.claude/settings.json` of a governed repository: what it must declare so
// that whoever clones that repository gets this plugin, and the rules for
// writing it into a file that is not ours.
//
// WHY A FILE IN THE REPOSITORY AND NOT AN INSTALLATION ON THE MACHINE. Until
// now the only route was `/plugin marketplace add` plus `/plugin install`, which
// write to `~/.claude/settings.json` — the machine of whoever ran them. Nothing
// travelled with the repository, so a fresh clone got no commands, no skills, no
// agents and no hooks, and there was no way to tell that from a repository that
// was never bootstrapped. A project's own `.claude/settings.json` is read by
// Claude Code and can name the marketplace and the plugin, so the declaration
// lives where the work lives.
//
// WHY THE REST OF THE PLUGIN IS NOT COPIED IN WITH IT. A dispatched agent does
// not only read files: `ct-next.mjs` resolves absolute paths to `ct-step.mjs`,
// `dispatch-check.mjs` and `conventions/` from wherever the plugin is installed
// and types them into the agent's terminal, and the kickoff names the skill
// `control-tower-loop:writing-plans-prescriptive`, which only resolves when the
// plugin is loaded. Copying the skills in would not finish that job — it would
// take the whole tree, in every governed repository, kept in step by hand. One
// file that names the plugin gets the same outcome with nothing duplicated.
//
// WHAT THIS MODULE IS NOT. It is pure logic: it takes the parsed settings and
// returns the settings to write plus what to say. The disk is
// `seed-claude-settings.mjs`, and the same split as `conventions.js` /
// `conventions-io.js`, for the same reason: this is the part that has to be
// testable with no repository on the ground.

// The three names that cannot be read at runtime. `.claude-plugin/marketplace.json`
// is at the ROOT of this repository, outside `plugin/`, and
// `__tests__/distribution-boundary.test.js` forbids anything under `plugin/`
// from reaching outside it — an installation only ever carries `plugin/`, so a
// read of that file would work here and fail everywhere it matters. They are
// literals, and `__tests__/claude-settings.test.js` compares them against the
// real manifests; that test is what replaces the read.
export const MARKETPLACE = 'control-tower'
export const MARKETPLACE_REPO = 'mercadona/control-tower'
export const PLUGIN_ID = 'control-tower-loop@control-tower'

// THE VERSION PIN. `enabledPlugins` holds a boolean and nothing else, so it pins
// no version; the pin is the marketplace's `ref`. It reaches the plugin's code
// because the marketplace entry's `source` is `./plugin`, inside the same
// checkout: the ref that decides which commit of the marketplace is read
// decides which plugin is installed with it.
//
// The tag is the one release-please already creates on every plugin release
// (`plugin-v0.57.0`, `plugin-v0.56.0`). So a governed repository records, in a
// committed file, exactly which release it runs, and moving it is a one-line
// change somebody reviews.
//
// It has one edge, and it is the honest one: release-please creates the tag
// AFTER the version bump lands, so a ct-init run from an unreleased commit
// writes a ref that does not resolve and the install fails naming the tag. That
// beats the alternative — no ref at all — which floats every governed
// repository onto `main` and records nothing.
export const marketplaceRef = (version) => `plugin-v${version}`

const VERSION = /^\d+\.\d+\.\d+$/

// `gh` and `git`, and deliberately nothing wider. The loop's own commands run
// as `node <absolute plugin path>/scripts/*.mjs`, and that path is different on
// every machine — a committed file cannot name it, and a rule that looks
// machine-independent while matching nothing on every real machine is worse
// than no rule.
export const ALLOWED = ['Bash(gh:*)', 'Bash(git:*)']

// The four invocations this repository's CLAUDE.md names, under "a repository
// control is not an obstacle to route around". `Bash(git:*)` above would
// otherwise auto-allow every one of them, so the allowance arrives with them
// already shut. `deny` is also the half that applies before the folder is
// trusted, which is the half that matters for a clone nobody has opened yet.
export const DENIED = [
  'Bash(git commit:*--no-verify*)',
  'Bash(git push:*--no-verify*)',
  'Bash(git push:*--force*)',
  'Bash(git -c core.hooksPath=*)',
]

export class SettingsNotUnderstood extends Error {}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

function container(settings, key) {
  if (!(key in settings)) return {}
  const found = settings[key]
  if (!isRecord(found)) {
    throw new SettingsNotUnderstood(
      `\`${key}\` is in the settings file but it is not an object, it is ${typeof found}. ` +
        'Nothing has been written: this file is not the one these keys get merged into, and reading it as ' +
        'empty would replace whatever is really there.'
    )
  }
  return found
}

function list(permissions, key) {
  if (!(key in permissions)) return []
  const found = permissions[key]
  if (!Array.isArray(found)) {
    throw new SettingsNotUnderstood(
      `\`permissions.${key}\` is in the settings file but it is not a list, it is ${typeof found}. ` +
        'Nothing has been written.'
    )
  }
  return found
}

// Our entries added, everything already there kept — including an entry of ours
// that this version no longer emits. Widening an allow list is not the hazard a
// stale hook is: a leftover entry sits there doing nothing, while removing what
// we do not recognise removes somebody's rule on the strength of not having
// written it ourselves. These lists also merge across settings sources, so
// "ours" was never a closed set to begin with.
function union(present, ours) {
  const added = ours.filter((entry) => !present.includes(entry))
  return { entries: [...present, ...added], added }
}

/**
 * @param {unknown} existing the parsed `.claude/settings.json`, or `{}` if there was none
 * @param {{version: string}} plugin the version this plugin declares
 * @returns {{settings: object, messages: string[]}}
 */
export function mergeClaudeSettings(existing, { version } = {}) {
  if (!isRecord(existing)) {
    throw new SettingsNotUnderstood(
      'the settings file is not a JSON object, so there is nothing to merge these keys into. ' +
        'Nothing has been written: "it is not the object we merge into" is not "it is empty".'
    )
  }
  if (!VERSION.test(String(version ?? ''))) {
    throw new SettingsNotUnderstood(
      `the plugin declares no version to pin the marketplace to (got ${JSON.stringify(version)}). ` +
        'The ref is a tag that either exists or does not, and it is not invented here.'
    )
  }

  const messages = []
  const settings = { ...existing }

  // Our two keys and the ref: created if absent, REPORTED and left alone if
  // present with another value. The same reading `ct-init.sh` already takes for
  // STATE.md, conventions.md and AGENTS.md — a value that is there is somebody's
  // decision, and this is a scaffolder, not an arbiter of it. It is also the
  // upgrade path: a repository pinned to an older release is told, with both
  // versions named, and moves when a person moves it.
  const marketplaces = container(settings, 'extraKnownMarketplaces')
  const ref = marketplaceRef(version)
  const source = { source: 'github', repo: MARKETPLACE_REPO, ref }
  if (!(MARKETPLACE in marketplaces)) {
    settings.extraKnownMarketplaces = { ...marketplaces, [MARKETPLACE]: { source } }
    messages.push(`declared the marketplace \`${MARKETPLACE}\` (${MARKETPLACE_REPO}, pinned at ${ref})`)
  } else {
    settings.extraKnownMarketplaces = marketplaces
    const entry = marketplaces[MARKETPLACE]
    if (!isRecord(entry) || !isRecord(entry.source)) {
      throw new SettingsNotUnderstood(
        `\`extraKnownMarketplaces.${MARKETPLACE}\` is there but it does not carry a \`source\` object. ` +
          'Nothing has been written.'
      )
    }
    if (entry.source.repo !== MARKETPLACE_REPO) {
      messages.push(
        `the marketplace \`${MARKETPLACE}\` points at ${JSON.stringify(entry.source.repo)} and this plugin ` +
          `comes from ${MARKETPLACE_REPO}. Left as it is: which repository a marketplace reads is not changed ` +
          'from here.'
      )
    } else if (entry.source.ref !== ref) {
      messages.push(
        `this repository is pinned at ${JSON.stringify(entry.source.ref)} and this plugin is ${ref}. ` +
          `Left as it is. To move it, set \`extraKnownMarketplaces.${MARKETPLACE}.source.ref\` to ${ref} — ` +
          'one line, and a person decides which release a repository runs.'
      )
    }
  }

  const plugins = container(settings, 'enabledPlugins')
  if (!(PLUGIN_ID in plugins)) {
    settings.enabledPlugins = { ...plugins, [PLUGIN_ID]: true }
    messages.push(`enabled \`${PLUGIN_ID}\``)
  } else {
    settings.enabledPlugins = plugins
    if (plugins[PLUGIN_ID] !== true) {
      messages.push(
        `\`${PLUGIN_ID}\` is declared as ${JSON.stringify(plugins[PLUGIN_ID])} in this repository, not \`true\`. ` +
          'Left as it is: somebody switched this plugin off here on purpose, and a scaffolder does not switch it ' +
          'back on.'
      )
    }
  }

  const permissions = container(settings, 'permissions')
  const allow = union(list(permissions, 'allow'), ALLOWED)
  const deny = union(list(permissions, 'deny'), DENIED)
  settings.permissions = { ...permissions, allow: allow.entries, deny: deny.entries }
  if (allow.added.length) messages.push(`allowed ${allow.added.join(', ')}`)
  if (deny.added.length) messages.push(`denied ${deny.added.length} invocation(s) a control would have to refuse`)

  return { settings, messages }
}
