import { afterEach, beforeEach, expect, vi } from 'vitest'

class ProcessTripwire {
  static calls = []

  static install() {
    const path = expect.getState().testPath ?? ''
    if (!/(?:\/ct-step-|\/e2e-ct-step\.)/.test(path) || path.endsWith('-real-process.test.js')) return
    const refuse = (name) => (...args) => {
      const message = `A decision test tried to start a real process: ${name}(${JSON.stringify(args[0])})`
      ProcessTripwire.calls.push(message)
      throw new Error(message)
    }
    vi.doMock('node:child_process', () => Object.fromEntries(
      ['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec', 'fork']
        .map((name) => [name, refuse(name)])
    ))
    beforeEach(() => { ProcessTripwire.calls.length = 0 })
    afterEach(() => { expect(ProcessTripwire.calls, 'decision tests must not start processes').toEqual([]) })
  }
}

ProcessTripwire.install()
