#!/usr/bin/env node
// IO wrapper around scripts/claude-settings.js: reads the target repository's
// `.claude/settings.json`, merges what the loop needs into it and writes it
// back. ct-init.sh calls it and passes its stdout on.
//
// The output contract, deliberately poor so that ct-init.sh does not have to
// interpret anything:
//   exit 0  → done. Empty stdout = there was nothing to change;
//             stdout with text = what was declared or what was left alone,
//             already formatted.
//   exit 1  → it could NOT be done (wrong usage, a file that is not the object
//             these keys merge into, an unwritable directory). stderr explains
//             why. The caller must NEVER read this as "the plugin is wired up":
//             that is the expensive false negative — a repository that looks
//             bootstrapped and gives a fresh clone no plugin at all.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeClaudeSettings, PLUGIN_ID, SettingsNotUnderstood } from './claude-settings.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SETTINGS = ['.claude', 'settings.json']

const target = process.argv[2]
if (!target) {
  console.error('usage: seed-claude-settings.mjs <dir-repo>')
  process.exit(1)
}

// The version comes from the manifest and not from a literal: the ref this
// writes has to be the tag of the release that is really installed, and
// plugin.json is the file release-please bumps.
let version
try {
  version = JSON.parse(readFileSync(join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version
} catch (e) {
  console.error(`could not read this plugin's own version (.claude-plugin/plugin.json): ${e.message}`)
  process.exit(1)
}

const path = join(target, ...SETTINGS)

// A file that is not there is `{}`. A file that is there and is not JSON is an
// ERROR: reading it as empty would replace whatever the repository had, and
// "this is not the object we merge into" is not "this is empty". The same
// reading the cabin already takes for the file it merges its own hooks into.
let existing = {}
try {
  existing = JSON.parse(readFileSync(path, 'utf8'))
} catch (e) {
  if (e.code !== 'ENOENT') {
    console.error(
      `${path} is there but could not be read as JSON (${e.message}). Nothing has been written: ` +
        'fix that file, or move it aside, and run /ct-init again.'
    )
    process.exit(1)
  }
}

let merged
try {
  merged = mergeClaudeSettings(existing, { version })
} catch (e) {
  if (e instanceof SettingsNotUnderstood) {
    console.error(`${path}: ${e.message}`)
    process.exit(1)
  }
  throw e
}

const serialised = `${JSON.stringify(merged.settings, null, 2)}\n`
let before = null
try {
  before = readFileSync(path, 'utf8')
} catch {
  before = null
}
// Not writing a file whose bytes would not change: a second /ct-init over an
// already bootstrapped repository must leave the working tree alone, mtime
// included.
if (before !== serialised) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, serialised)
  } catch (e) {
    console.error(`could not write ${path}: ${e.message}. Nothing has been written.`)
    process.exit(1)
  }
}

if (merged.messages.length) {
  console.log(`${path}:`)
  for (const message of merged.messages) console.log(`  ${message}`)
}

// The one step this does not take, and says so instead. The JSON declares the
// marketplace and the plugin, but a plugin whose source is a git repository is
// still installed once per machine, and that command is not run from here: this
// script is driven by the suite against throwaway directories, and a branch that
// shelled out to `claude` when it happened to be on the PATH would make the
// suite depend on the machine running it. It is also normally running INSIDE a
// claude session already.
if (before !== serialised) {
  console.log('  run once in this repo, on each machine that works on it:')
  console.log(`    claude plugin install ${PLUGIN_ID} --scope project`)
}
