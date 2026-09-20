import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

class StateEnvironment {
  static readonly #MAKEFILE = fileURLToPath(new URL('../../../Makefile', import.meta.url))
  static readonly #roots: string[] = []

  static async fromLocalConfiguration(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'ct-state-env-'))
    StateEnvironment.#roots.push(root)
    await copyFile(StateEnvironment.#MAKEFILE, join(root, 'Makefile'))
    await writeFile(join(root, '.env'), 'CT_STATE_DIR=/isolated/state with spaces\n')
    await writeFile(join(root, 'state-probe.mk'), 'state-environment:\n\t@env\n')
    const environment = execFileSync('make', ['--no-print-directory', '-f', 'Makefile', '-f', 'state-probe.mk', 'state-environment'], {
      cwd: root, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, CT_STATE_DIR: '/inherited/state' },
    })

    return environment.split('\n').find(line => line.startsWith('CT_STATE_DIR=')) ?? ''
  }

  static async clean(): Promise<void> {
    await Promise.all(StateEnvironment.#roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  }
}

afterEach(() => StateEnvironment.clean())

describe('the real Makefile exports the independent state directory', () => {
  it('passes_the_local_env_value_to_child_processes_without_shell_splitting', async () => {
    expect(await StateEnvironment.fromLocalConfiguration()).toBe('CT_STATE_DIR=/isolated/state with spaces')
  })
})
