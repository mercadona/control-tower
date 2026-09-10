import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

class JavaScriptCensus {
  static MIGRATING_EXTENSIONS = ['.js', '.mjs']
  static SKIPPED_DIRECTORIES = ['node_modules']

  static under(root: string, directory: string = root): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        return JavaScriptCensus.SKIPPED_DIRECTORIES.includes(entry.name)
          ? []
          : JavaScriptCensus.under(root, full)
      }
      return JavaScriptCensus.isMigrating(entry.name) ? [JavaScriptCensus.pathOf(root, full)] : []
    })
  }

  static isMigrating(name: string): boolean {
    return JavaScriptCensus.MIGRATING_EXTENSIONS.some((extension) => name.endsWith(extension))
  }

  static pathOf(root: string, full: string): string {
    return relative(root, full).split(sep).join('/')
  }
}

class MigrationBoundary {
  static HERE = dirname(fileURLToPath(import.meta.url))
  static BACKEND = join(MigrationBoundary.HERE, '..')
  static CENSUSED_FOLDERS = ['src', '__tests__']
  static BASELINE = join(MigrationBoundary.HERE, 'fixtures', 'javascript-migration-baseline.txt')

  static baseline(): string[] {
    return readFileSync(MigrationBoundary.BASELINE, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
  }

  static present(): string[] {
    return MigrationBoundary.CENSUSED_FOLDERS.flatMap((folder) =>
      JavaScriptCensus.under(MigrationBoundary.BACKEND, join(MigrationBoundary.BACKEND, folder))
    ).sort()
  }

  static bornAfterTheBaseline({ present, baseline }: { present: string[], baseline: string[] }): string[] {
    return present.filter((path) => !baseline.includes(path))
  }
}

describe('no new JavaScript is born in the backend while it migrates to TypeScript', () => {
  it('every_javascript_path_under_the_backend_was_already_there_when_the_migration_started', () => {
    const born = MigrationBoundary.bornAfterTheBaseline({
      present: MigrationBoundary.present(),
      baseline: MigrationBoundary.baseline(),
    })

    expect(born, `born as JavaScript after the migration started: ${born.join(', ')}`).toEqual([])
  })

  it('the_baseline_is_a_fixed_superset_so_a_converted_file_leaves_the_tree_without_anyone_editing_it', () => {
    const withAConvertedEntryLeftBehind = [
      ...MigrationBoundary.baseline(),
      'src/domain/value-objects/converted-long-ago.js',
    ]

    expect(
      MigrationBoundary.bornAfterTheBaseline({
        present: MigrationBoundary.present(),
        baseline: withAConvertedEntryLeftBehind,
      })
    ).toEqual([])
  })

  it('the_census_finds_its_subjects_by_walking_so_a_new_file_is_covered_without_anyone_listing_it', () => {
    const present = MigrationBoundary.present()

    expect(present).toContain('__tests__/conventions-no-restatement.test.js')
    expect(present).toContain('__tests__/infrastructure/no-window-titles-parsed.test.js')
    expect(present).toContain('__tests__/yardstick.js')
    expect(present).not.toContain('__tests__/typescript-migration-boundary.test.ts')
  })

  it('the_detector_really_fires_so_the_guard_cannot_pass_by_detecting_nothing', () => {
    expect(
      MigrationBoundary.bornAfterTheBaseline({
        present: ['src/domain/old.js', 'src/domain/new.js'],
        baseline: ['src/domain/old.js'],
      })
    ).toEqual(['src/domain/new.js'])
    expect(
      MigrationBoundary.bornAfterTheBaseline({
        present: ['src/domain/old.js'],
        baseline: ['src/domain/old.js', 'src/domain/already-migrated.js'],
      })
    ).toEqual([])
  })
})
