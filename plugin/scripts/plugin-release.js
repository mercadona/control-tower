// This plugin's own release, read once, from the one file that carries it —
// `.claude-plugin/plugin.json`, right beside the plugin root. `seed-claude-settings.mjs`
// used to read it inline; it now calls this, and `ct-init-facts.mjs` (the
// `--json` report of `ct-init.sh`) calls the same function, so the two never
// drift into two different readings of the same manifest.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// pluginRoot: the directory that holds `.claude-plugin/`, i.e. `plugin/`.
export function pluginVersion(pluginRoot) {
  const manifestPath = join(pluginRoot, '.claude-plugin', 'plugin.json')
  return JSON.parse(readFileSync(manifestPath, 'utf8')).version
}
