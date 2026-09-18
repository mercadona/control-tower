import { spawnSync } from 'node:child_process'

export class ProcessRunner {
  constructor({ bin, cwd, env }) {
    this.bin = bin
    this.cwd = cwd
    this.env = env
  }

  run(argv, options = {}) {
    const result = spawnSync(this.bin, argv, {
      encoding: 'utf8',
      ...options,
      cwd: options.cwd ?? this.cwd,
      env: options.env ?? this.env,
    })
    return {
      code: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      signal: result.signal,
      error: result.error,
    }
  }
}
