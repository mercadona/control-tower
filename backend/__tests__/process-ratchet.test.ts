import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProcessRatchet } from './process-ratchet.ts'

class Tests {
  static HERE = dirname(fileURLToPath(import.meta.url))
}

class TemporaryTree {
  static #make(): string {
    return mkdtempSync(join(tmpdir(), 'process-ratchet-'))
  }

  static withAnUnlistedSpawn(): string {
    const root = TemporaryTree.#make()
    writeFileSync(join(root, 'unlisted.test.ts'), "import { spawn } from 'node:child_process'\n")
    return root
  }

  static withAListedEntryThatNoLongerSpawns(): string {
    const root = TemporaryTree.#make()
    writeFileSync(join(root, 'gone-quiet.test.ts'), 'export const calm = 1\n')
    return root
  }

  static withASpawningFixtureFollowedThroughAnImport(): string {
    const root = TemporaryTree.#make()
    mkdirSync(join(root, 'fixtures'), { recursive: true })
    writeFileSync(join(root, 'fixtures', 'launcher.ts'), "import { spawn } from 'node:child_process'\nexport const launch = spawn\n")
    writeFileSync(join(root, 'walks-the-fixture.test.ts'), "import { launch } from './fixtures/launcher.ts'\n")
    return root
  }

  static withOnlyTheMarkerAndNoSpawningImport(): string {
    const root = TemporaryTree.#make()
    writeFileSync(join(root, 'quiet-real-process.test.ts'), 'export const quiet = 1\n')
    return root
  }

  static withAnImportOfTheBorder(): string {
    const root = TemporaryTree.#make()
    writeFileSync(join(root, 'imports-the-border.test.ts'), "import { SystemProcesses } from '../src/infrastructure/process-border.ts'\n")
    return root
  }
}

describe('the ratchet over the test files that still launch a process', () => {
  it('the_backend_suite_launches_processes_in_exactly_the_listed_files', () => {
    expect(ProcessRatchet.spawningUnder(Tests.HERE)).toEqual(ProcessRatchet.LISTED)
  })

  it('a_spawning_test_file_the_list_does_not_name_fails_the_ratchet', () => {
    const root = TemporaryTree.withAnUnlistedSpawn()

    try {
      const spawning = ProcessRatchet.spawningUnder(root)

      expect(ProcessRatchet.unlisted(spawning, [])).toEqual([
        'unlisted.test.ts launches a process and ProcessRatchet.LISTED does not name it',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a_listed_file_that_no_longer_spawns_fails_the_ratchet', () => {
    const root = TemporaryTree.withAListedEntryThatNoLongerSpawns()

    try {
      const spawning = ProcessRatchet.spawningUnder(root)

      expect(ProcessRatchet.stale(spawning, ['gone-quiet.test.ts'])).toEqual([
        'gone-quiet.test.ts is in ProcessRatchet.LISTED and launches no process any more',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a_test_that_spawns_through_a_fixture_is_found_by_the_import_it_follows', () => {
    const root = TemporaryTree.withASpawningFixtureFollowedThroughAnImport()

    try {
      expect(ProcessRatchet.spawningUnder(root)).toEqual(['walks-the-fixture.test.ts'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('the_real_process_marker_alone_makes_a_file_spawning', () => {
    const root = TemporaryTree.withOnlyTheMarkerAndNoSpawningImport()

    try {
      expect(ProcessRatchet.spawningUnder(root)).toEqual(['quiet-real-process.test.ts'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a_test_that_imports_the_border_spawns', () => {
    const root = TemporaryTree.withAnImportOfTheBorder()

    try {
      expect(ProcessRatchet.spawningUnder(root)).toEqual(['imports-the-border.test.ts'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
