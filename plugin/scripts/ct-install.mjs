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
    // CT_CLAUDE_BIN: the documented way to point this at a stand-in instead
    // of the real `claude` binary. It defaults to ClaudeCli.BINARY (the real
    // one), so production behaviour is unchanged; a test sets it to a fake
    // executable so it never reaches the real CLI or the network.
    const outcome = new PluginInstaller(new ClaudeCli(process.env.CT_CLAUDE_BIN || ClaudeCli.BINARY)).run(target)
    const configDir = configuredDir({ configDir: process.env.CLAUDE_CONFIG_DIR || null, home: homedir() })
    process.stdout.write(`${JSON.stringify({ ...outcome.toJSON(), configDir })}\n`)
    process.exit(outcome.status === 'refused' ? 1 : 0)
  }
}

CtInstallCli.run(process.argv[2])
