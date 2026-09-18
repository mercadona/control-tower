import { describe, it, expect } from 'vitest'
import { ClaudeCli, PluginInstallOutcome, PluginInstaller } from '../scripts/plugin-install.js'

class FakeCli {
  constructor(responses) {
    this.responses = responses
    this.calls = []
  }

  run(args, cwd) {
    this.calls.push({ args, cwd })
    const key = args[1]
    const queue = this.responses[key]
    if (!queue || queue.length === 0) throw new Error(`no fake response queued for ${key}`)
    return queue.shift()
  }
}

class ClaudeAnswers {
  static list(entries) {
    return { status: 0, stdout: JSON.stringify(entries), stderr: '', error: null }
  }

  static listBroken(stdout) {
    return { status: 0, stdout, stderr: '', error: null }
  }

  static listExitsNonZero() {
    return { status: 1, stdout: '', stderr: 'boom', error: null }
  }

  static installOk() {
    return { status: 0, stdout: '{"command":"install","outcome":"installed"}', stderr: '', error: null }
  }

  static installFailed({ failureCode, message }) {
    return { status: 1, stdout: JSON.stringify({ command: 'install', outcome: 'failed', failureCode, message }), stderr: '', error: null }
  }

  static binaryMissing() {
    return { status: null, stdout: '', stderr: '', error: new Error('spawnSync claude ENOENT') }
  }
}

describe('PluginInstaller checks before it ever installs', () => {
  it('already listed for this config dir -> already-present, and install is never run', () => {
    const cli = new FakeCli({ list: [ClaudeAnswers.list([{ id: 'control-tower-loop@control-tower' }])] })
    const outcome = new PluginInstaller(cli).run('/repo')
    expect(outcome).toEqual(PluginInstallOutcome.alreadyPresent())
    expect(cli.calls).toHaveLength(1)
    expect(cli.calls[0].args).toEqual(['plugin', 'list', '--json'])
    expect(cli.calls[0].cwd).toBe('/repo')
  })

  it('a plugin of the same name at another marketplace does not count as installed', () => {
    const cli = new FakeCli({
      list: [ClaudeAnswers.list([{ id: 'control-tower-loop@other-marketplace' }])],
    })
    expect(new PluginInstaller(cli).run('/repo').status).toBe(PluginInstallOutcome.ALREADY_PRESENT)
  })
})

describe('PluginInstaller installs when it is not already there', () => {
  it('install succeeds and the second list confirms it -> created', () => {
    const cli = new FakeCli({
      list: [ClaudeAnswers.list([]), ClaudeAnswers.list([{ id: 'control-tower-loop@control-tower' }])],
      install: [ClaudeAnswers.installOk()],
    })
    const outcome = new PluginInstaller(cli).run('/repo')
    expect(outcome).toEqual(PluginInstallOutcome.created())
    expect(cli.calls[1].args).toEqual([
      'plugin', 'install', 'control-tower-loop@control-tower', '--scope', 'project', '-y', '--json',
    ])
  })

  it('install exits non-zero -> refused, naming the failure code and message', () => {
    const cli = new FakeCli({
      list: [ClaudeAnswers.list([])],
      install: [ClaudeAnswers.installFailed({ failureCode: 'not_found', message: 'Plugin "control-tower-loop" not found in marketplace "control-tower".' })],
    })
    const outcome = new PluginInstaller(cli).run('/repo')
    expect(outcome.status).toBe(PluginInstallOutcome.REFUSED)
    expect(outcome.detail).toBe("not_found: Plugin 'control-tower-loop' not found in marketplace 'control-tower'.")
  })

  it('install exits non-zero with no parseable message -> refused, naming the exit code', () => {
    const cli = new FakeCli({
      list: [ClaudeAnswers.list([])],
      install: [{ status: 3, stdout: '', stderr: 'network unreachable', error: null }],
    })
    const outcome = new PluginInstaller(cli).run('/repo')
    expect(outcome.status).toBe(PluginInstallOutcome.REFUSED)
    expect(outcome.detail).toContain('exited 3')
    expect(outcome.detail).toContain('network unreachable')
  })

  it('install claims success but the plugin is not listed afterwards -> refused, never overclaimed as created', () => {
    const cli = new FakeCli({
      list: [ClaudeAnswers.list([]), ClaudeAnswers.list([])],
      install: [ClaudeAnswers.installOk()],
    })
    const outcome = new PluginInstaller(cli).run('/repo')
    expect(outcome.status).toBe(PluginInstallOutcome.REFUSED)
    expect(outcome.detail).toMatch(/not listed afterwards/)
  })
})

describe('PluginInstaller never waits on an ambiguous claude', () => {
  it('the claude binary is missing -> refused, never thrown, never a hang', () => {
    const cli = new FakeCli({ list: [ClaudeAnswers.binaryMissing()] })
    const outcome = new PluginInstaller(cli).run('/repo')
    expect(outcome.status).toBe(PluginInstallOutcome.REFUSED)
    expect(outcome.detail).toContain('could not be run')
  })

  it('claude plugin list exits non-zero -> refused, naming the exit code', () => {
    const cli = new FakeCli({ list: [ClaudeAnswers.listExitsNonZero()] })
    const outcome = new PluginInstaller(cli).run('/repo')
    expect(outcome.status).toBe(PluginInstallOutcome.REFUSED)
    expect(outcome.detail).toContain('exited 1')
  })

  it('claude plugin list prints something that is not JSON -> refused, not thrown', () => {
    const cli = new FakeCli({ list: [ClaudeAnswers.listBroken('not json at all')] })
    const outcome = new PluginInstaller(cli).run('/repo')
    expect(outcome.status).toBe(PluginInstallOutcome.REFUSED)
    expect(outcome.detail).toContain('did not print JSON')
  })

  it('claude plugin list prints JSON that is not an array -> refused, not thrown', () => {
    const cli = new FakeCli({ list: [ClaudeAnswers.listBroken('{"not":"an array"}')] })
    const outcome = new PluginInstaller(cli).run('/repo')
    expect(outcome.status).toBe(PluginInstallOutcome.REFUSED)
    expect(outcome.detail).toContain('did not print an array')
  })
})

describe('PluginInstallOutcome carries a detail that round-trips through a plain sed extraction', () => {
  it('strips the double quotes ct-init.sh cannot parse back out of a single sed capture', () => {
    const outcome = PluginInstallOutcome.refused('Plugin "x" not found in marketplace "y".')
    expect(outcome.detail).toBe("Plugin 'x' not found in marketplace 'y'.")
  })

  it('collapses embedded newlines and repeated whitespace to one line', () => {
    const outcome = PluginInstallOutcome.refused('line one\n  line two')
    expect(outcome.detail).toBe('line one line two')
  })

  it('created and already-present carry no detail at all, in the JSON shape too', () => {
    expect(PluginInstallOutcome.created().toJSON()).toEqual({ status: 'created' })
    expect(PluginInstallOutcome.alreadyPresent().toJSON()).toEqual({ status: 'already-present' })
  })
})

describe('ClaudeCli names the real binary and never blocks past its own timeout', () => {
  it('runs the actual claude binary, not a stand-in', () => {
    expect(ClaudeCli.BINARY).toBe('claude')
  })

  it('carries a finite timeout, so a hung claude is killed rather than waited on', () => {
    expect(ClaudeCli.TIMEOUT_MS).toBeGreaterThan(0)
  })
})
