import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProcessRatchet } from './fixtures/process-ratchet.ts'

class Tests {
  static HERE = dirname(fileURLToPath(import.meta.url))
}

class TemporaryTree {
  static #make(): string {
    return mkdtempSync(join(tmpdir(), 'process-ratchet-'))
  }

  static withASpawningImport(): string {
    const root = TemporaryTree.#make()
    writeFileSync(join(root, 'unlisted.test.ts'), "import { spawn } from 'node:child_process'\n")
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

describe('no backend test launches a process', () => {
  it('the_backend_suite_launches_no_process', () => {
    expect(ProcessRatchet.spawningUnder(join(Tests.HERE, '..'))).toEqual([])
  })

  it('a_test_file_that_imports_child_process_spawns', () => {
    const root = TemporaryTree.withASpawningImport()

    try {
      expect(ProcessRatchet.spawningUnder(root)).toEqual(['unlisted.test.ts'])
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
