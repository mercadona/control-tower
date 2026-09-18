import { writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProcessRunner } from './process-runner.js'

export class CommandExit extends Error {
  constructor(code) {
    super(`Command finished with exit ${code}`)
    this.code = code
  }

  static with(code) { throw new CommandExit(code) }
}

export class CommandFailure extends Error {
  constructor(bin, argv, output) {
    super(output.error?.message ?? `Command failed: ${bin} ${argv.join(' ')}\n${output.stderr}`)
    this.status = output.signal || output.error ? null : output.code
    this.stdout = output.stdout
    this.stderr = output.stderr
    this.signal = output.signal
    this.code = output.error?.code
    this.killed = output.signal === 'SIGKILL'
  }
}

class PluginScripts {
  constructor(cwd, env) { this.cwd = cwd; this.env = env }

  run([bin, ...argv], options) {
    return new ProcessRunner({ bin, cwd: this.cwd, env: this.env }).run(argv, options)
  }
}

export class CommandIo {
  static production({ cwd = process.cwd(), env = process.env } = {}) {
    return {
      cwd,
      env,
      home: homedir(),
      pluginRoot: dirname(dirname(fileURLToPath(import.meta.url))),
      now: Date.now,
      out: (text) => CommandIo.#write(1, text),
      err: (text) => CommandIo.#write(2, text),
      git: new ProcessRunner({ bin: 'git', cwd, env }),
      shell: new ProcessRunner({ bin: 'sh', cwd, env }),
      scripts: new PluginScripts(cwd, env),
    }
  }

  static #write(fd, text) {
    try { writeSync(fd, text) } catch {}
  }

  static execFile(io, bin, argv, options) {
    const port = bin === 'git' ? io.git : bin === 'sh' ? io.shell : io.scripts
    const request = bin === 'git' || bin === 'sh' ? argv : [bin, ...argv]
    const output = port.run(request, options)
    if (output.code !== 0 || output.error || output.signal) throw new CommandFailure(bin, argv, output)
    return output.stdout
  }
}
