import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

class TripwireProbe {
  static roots = []

  static accidentalProcess() {
    const root = mkdtempSync(join(tmpdir(), 'ct-step-tripwire-'))
    TripwireProbe.roots.push(root)
    const vitest = fileURLToPath(new URL('../node_modules/vitest/dist/index.js', import.meta.url))
    const cli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
    const guard = fileURLToPath(new URL('./fixtures/process-tripwire.js', import.meta.url))
    const marker = join(root, 'child-started')
    const child = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`
    writeFileSync(join(root, 'ct-step-accidental.test.js'), [
      `import { it } from ${JSON.stringify(vitest)}`,
      'import { spawnSync } from "node:child_process"',
      `it('an accidental spawn', () => { try { spawnSync(process.execPath, ['-e', ${JSON.stringify(child)}]) } catch {} })`,
    ].join('\n'))
    const config = join(root, 'vitest.config.mjs')
    writeFileSync(config, `export default { test: { setupFiles: [${JSON.stringify(guard)}] } }`)
    const result = spawnSync(process.execPath, [cli, 'run', '--root', root, '--config', config], { encoding: 'utf8', timeout: 60000 })
    return { ...result, marker }
  }

  static clean() { for (const root of TripwireProbe.roots.splice(0)) rmSync(root, { recursive: true, force: true }) }
}

describe('the decision-test process tripwire', () => {
  afterEach(() => TripwireProbe.clean())

  it('an accidental spawn fails the test even when the caller catches the refusal', () => {
    const result = TripwireProbe.accidentalProcess()
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toContain('A decision test tried to start a real process')
    expect(existsSync(result.marker)).toBe(false)
  })
})
