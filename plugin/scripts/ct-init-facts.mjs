#!/usr/bin/env node
// Two machine facts `ct-init.sh --json` names in its report: this plugin's own
// release, and the config directory `CLAUDE_CONFIG_DIR` resolves to. Both are
// reused, not reimplemented here:
//   - the release comes from plugin-release.js, the same read
//     seed-claude-settings.mjs already does;
//   - the config directory comes from configuredDir() in run-metrics.js —
//     the rule `controlTowerDir()` builds on, and the same one
//     backend/src/infrastructure/invocation.ts's Invocation.configuredIn
//     applies (an empty CLAUDE_CONFIG_DIR reads as unset).
// Prints one JSON object, {"ctInitVersion": "...", "configDir": "..."}, and
// nothing else, to stdout. ct-init.sh captures it whole with `node ... .mjs`.
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pluginVersion } from './plugin-release.js'
import { configuredDir } from './run-metrics.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(HERE, '..')

const facts = {
  ctInitVersion: pluginVersion(PLUGIN_ROOT),
  configDir: configuredDir({ configDir: process.env.CLAUDE_CONFIG_DIR || null, home: homedir() }),
}

process.stdout.write(`${JSON.stringify(facts)}\n`)
