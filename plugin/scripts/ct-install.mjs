#!/usr/bin/env node
import { homedir } from 'node:os'
import { ClaudeCli, PluginInstaller } from './plugin-install.js'
import { configuredDir } from './run-metrics.js'

export class CtInstallCli {
  static USAGE = 'usage: ct-install.mjs <dir-repo>'

  static run(target) {
    if (!target) {
      console.error(CtInstallCli.USAGE)
      process.exit(2)
    }
    const outcome = new PluginInstaller(new ClaudeCli(process.env.CT_CLAUDE_BIN || ClaudeCli.BINARY)).run(target)
    const configDir = configuredDir({ configDir: process.env.CLAUDE_CONFIG_DIR || null, home: homedir() })
    process.stdout.write(`${JSON.stringify({ ...outcome.toJSON(), configDir })}\n`)
    process.exit(outcome.status === 'refused' ? 1 : 0)
  }
}

CtInstallCli.run(process.argv[2])
