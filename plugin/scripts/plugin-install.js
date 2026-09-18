import { spawnSync } from 'node:child_process'
import { ControlTowerPlugin } from './claude-settings.js'

export class ClaudeCliUnavailable extends Error {}

export class ClaudeCli {
  static BINARY = 'claude'
  static TIMEOUT_MS = 60000

  constructor(binary = ClaudeCli.BINARY) {
    this.binary = binary
    Object.freeze(this)
  }

  run(args, cwd) {
    return spawnSync(this.binary, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: ClaudeCli.TIMEOUT_MS,
      killSignal: 'SIGKILL',
    })
  }
}

export class PluginInstallOutcome {
  static CREATED = 'created'
  static ALREADY_PRESENT = 'already-present'
  static REFUSED = 'refused'

  constructor({ status, detail = null }) {
    this.status = status
    this.detail = detail
    Object.freeze(this)
  }

  static created() {
    return new PluginInstallOutcome({ status: PluginInstallOutcome.CREATED })
  }

  static alreadyPresent() {
    return new PluginInstallOutcome({ status: PluginInstallOutcome.ALREADY_PRESENT })
  }

  static refused(detail) {
    return new PluginInstallOutcome({ status: PluginInstallOutcome.REFUSED, detail: PluginInstallOutcome.#sanitized(detail) })
  }

  static #sanitized(detail) {
    return String(detail).replace(/"/g, "'").replace(/\s+/g, ' ').trim()
  }

  toJSON() {
    return this.detail === null
      ? { status: this.status }
      : { status: this.status, detail: this.detail }
  }
}

export class PluginInstaller {
  constructor(cli) {
    this.cli = cli
    Object.freeze(this)
  }

  run(cwd) {
    let presentBefore
    try {
      presentBefore = this.#isInstalledIn(cwd)
    } catch (failure) {
      return PluginInstallOutcome.refused(failure.message)
    }
    if (presentBefore) return PluginInstallOutcome.alreadyPresent()

    const ran = this.cli.run(
      ['plugin', 'install', ControlTowerPlugin.id, '--scope', 'project', '-y', '--json'],
      cwd
    )
    if (ran.error) return PluginInstallOutcome.refused(`claude plugin install could not be run: ${ran.error.message}`)
    if (ran.status !== 0) return PluginInstallOutcome.refused(PluginInstaller.#reasonFrom(ran))

    let presentAfter
    try {
      presentAfter = this.#isInstalledIn(cwd)
    } catch (failure) {
      return PluginInstallOutcome.refused(`installed but could not be verified: ${failure.message}`)
    }
    if (presentAfter) return PluginInstallOutcome.created()
    return PluginInstallOutcome.refused('claude plugin install exited 0 but the plugin is not listed afterwards')
  }

  #isInstalledIn(cwd) {
    const ran = this.cli.run(['plugin', 'list', '--json'], cwd)
    if (ran.error) throw new ClaudeCliUnavailable(`claude plugin list --json could not be run: ${ran.error.message}`)
    if (ran.status !== 0) {
      throw new ClaudeCliUnavailable(`claude plugin list --json exited ${ran.status}: ${PluginInstaller.#trimmed(ran)}`)
    }
    let parsed
    try {
      parsed = JSON.parse(ran.stdout)
    } catch (failure) {
      throw new ClaudeCliUnavailable(`claude plugin list --json did not print JSON: ${failure.message}`)
    }
    if (!Array.isArray(parsed)) throw new ClaudeCliUnavailable('claude plugin list --json did not print an array')
    return parsed.some((entry) => entry?.id === ControlTowerPlugin.id)
  }

  static #reasonFrom(ran) {
    try {
      const parsed = JSON.parse(ran.stdout)
      if (parsed && typeof parsed.message === 'string') {
        return parsed.failureCode ? `${parsed.failureCode}: ${parsed.message}` : parsed.message
      }
    } catch {}
    return `claude plugin install exited ${ran.status}: ${PluginInstaller.#trimmed(ran)}`
  }

  static #trimmed(ran) {
    return (ran.stderr || ran.stdout || '').trim().slice(0, 500)
  }
}
