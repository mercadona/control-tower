#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClaudeSettings, ControlTowerPlugin, SettingsNotUnderstood } from './claude-settings.js'
import { pluginVersion } from './plugin-release.js'

class Seeding {
  static HERE = dirname(fileURLToPath(import.meta.url))
  static PLUGIN_ROOT = join(Seeding.HERE, '..')
  static SETTINGS = ['.claude', 'settings.json']
  static USAGE = 'usage: seed-claude-settings.mjs <dir-repo>'

  static fail(message) {
    console.error(message)
    process.exit(1)
  }

  static get installedVersion() {
    try {
      return pluginVersion(Seeding.PLUGIN_ROOT)
    } catch (failure) {
      return Seeding.fail(`could not read this plugin's own release (.claude-plugin/plugin.json): ${failure.message}`)
    }
  }

  static contentOf(path) {
    try {
      return readFileSync(path, 'utf8')
    } catch (failure) {
      if (failure.code === 'ENOENT') return null
      return Seeding.fail(
        `${path} is there and could not be read as text (${failure.message}). Nothing has been written: ` +
          'fix that file, or move it aside, and run /ct-init again.'
      )
    }
  }

  static parsed(path, content) {
    if (content === null) return {}
    try {
      return JSON.parse(content)
    } catch (failure) {
      return Seeding.fail(
        `${path} is there and could not be read as JSON (${failure.message}). Nothing has been written: ` +
          'fix that file, or move it aside, and run /ct-init again.'
      )
    }
  }

  static merged(path, existing, version) {
    try {
      return ClaudeSettings.merge(existing, { version })
    } catch (failure) {
      if (failure instanceof SettingsNotUnderstood) return Seeding.fail(`${path}: ${failure.message}`)
      throw failure
    }
  }

  static write(path, serialised) {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, serialised)
    } catch (failure) {
      Seeding.fail(`could not write ${path}: ${failure.message}. Nothing has been written.`)
    }
  }

  static report(path, messages) {
    if (messages.length === 0) {
      console.log(`${path} already declares this plugin, nothing to change`)
      return
    }
    console.log(`${path}:`)
    for (const message of messages) console.log(`  ${message}`)
  }

  static reportInstallStep() {
    console.log('  run once in this repo, on every machine that works on it:')
    console.log(`    ${ControlTowerPlugin.installCommand}`)
    console.log('  and trust the folder, or a project marketplace declares nothing.')
  }

  static run(target) {
    if (!target) Seeding.fail(Seeding.USAGE)
    const path = join(target, ...Seeding.SETTINGS)
    const before = Seeding.contentOf(path)
    const merged = Seeding.merged(path, Seeding.parsed(path, before), Seeding.installedVersion)
    const serialised = `${JSON.stringify(merged.settings, null, 2)}\n`
    if (before !== serialised) Seeding.write(path, serialised)
    Seeding.report(path, merged.messages)
    Seeding.reportInstallStep()
  }
}

Seeding.run(process.argv[2])
