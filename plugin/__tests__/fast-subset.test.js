// The guard that keeps `test:fast` from becoming a lie again.
//
// It was one: `--exclude '**/*-real-process.test.js'` removed 14 files and
// 7.3 % of the time, while 85 files and 99.9 % of it went on spawning. The
// subset is derived now (vitest.fast.config.js), and what follows is what
// makes the derivation checkable instead of believed: the config's exclusions
// and the detection have to name the same files, and the detection has to be
// shown firing in both directions so this file cannot pass by finding nothing.
import { describe, it, expect } from 'vitest'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import fastConfig from '../vitest.fast.config.js'
import { SpawningTests } from './fixtures/spawning-tests.js'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))

class FastSubset {
  static excluded() {
    return fastConfig.test.exclude.filter((pattern) => pattern.endsWith('.test.js'))
  }

  static running() {
    const excluded = new Set(FastSubset.excluded())

    return SpawningTests.all(PLUGIN).filter((path) => !excluded.has(path))
  }
}

describe('the fast subset is the one that does not spawn', () => {
  it('no test that launches a real process survives in it', () => {
    const spawning = new Set(SpawningTests.spawning(PLUGIN))

    expect(FastSubset.running().filter((path) => spawning.has(path))).toEqual([])
  })

  it('no test that stays in process is thrown out of it', () => {
    const running = new Set(FastSubset.running())

    expect(SpawningTests.inProcess(PLUGIN).filter((path) => !running.has(path))).toEqual([])
  })

  it('it is most of the suite and not a handful, or excluding the slow half bought nothing', () => {
    expect(FastSubset.running().length).toBeGreaterThan(SpawningTests.all(PLUGIN).length / 3)
  })
})

describe('the detection really fires, so the subset cannot be right by measuring nothing', () => {
  it('a test that imports child_process counts as launching one', () => {
    expect(SpawningTests.launches(PLUGIN, '__tests__/ct-init.test.js')).toBe(true)
  })

  it('a test that reaches child_process only through a fixture counts too', () => {
    expect(SpawningTests.launches(PLUGIN, '__tests__/ct-step-advice.test.js')).toBe(true)
  })

  it('a test that imports neither does not count', () => {
    expect(SpawningTests.launches(PLUGIN, '__tests__/plugin-manifest.test.js')).toBe(false)
  })

  it('the marker alone is enough, because a test can spawn through the production code it drives', () => {
    expect(SpawningTests.launches(PLUGIN, '__tests__/baseline-real-process.test.js')).toBe(false)
    expect(SpawningTests.spawning(PLUGIN)).toContain('__tests__/baseline-real-process.test.js')
  })
})
