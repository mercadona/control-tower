import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SpawnedChildren } from './spawned-children.ts'

class Backend {
  static HERE = dirname(fileURLToPath(import.meta.url))
  static ROOT = join(Backend.HERE, '..')

  static sites() {
    return SpawnedChildren.sitesUnder(Backend.ROOT)
  }

  static importers() {
    return SpawnedChildren.importersUnder(Backend.ROOT)
  }

  static sourceOf(file: string): string {
    return readFileSync(join(Backend.ROOT, SpawnedChildren.SOURCE, file), 'utf8')
  }
}

class Source {
  static undeclaredSpawn() {
    return "import { spawn } from 'node:child_process'\nspawn('claude', [])\n"
  }

  static regularExpression() {
    return "const step = /^step: ([a-z-]+)$/m.exec(asked.stdout)?.[1]\n"
  }

  static typePosition() {
    return "readonly spawn: typeof import('node:child_process').spawn\n"
  }

  static releasingEntrypoint() {
    return 'class W {\n  static async main(argv: readonly string[]): Promise<void> {\n    InheritedTerminals.ofThisProcess().released()\n    const x = 1\n  }\n}\n'
  }

  static releasingLate() {
    return 'class W {\n  static async main(argv: readonly string[]): Promise<void> {\n    const x = 1\n    InheritedTerminals.ofThisProcess().released()\n  }\n}\n'
  }
}

describe('no long-lived child of this backend is born holding a terminal', () => {
  it('every_process_this_backend_starts_is_accounted_for_by_name', () => {
    expect(SpawnedChildren.unaccountedIn(Backend.sites())).toEqual([])
  })

  it('every_module_that_reaches_for_a_spawning_library_is_accounted_for_too_even_when_it_only_hands_it_on', () => {
    expect(SpawnedChildren.importersWithoutAnEntry(Backend.importers())).toEqual([])
  })

  it('an_entry_that_no_longer_matches_a_real_spawn_fails_instead_of_rotting_in_the_table', () => {
    expect(SpawnedChildren.declaredWithoutASite(Backend.sites(), Backend.importers())).toEqual([])
  })

  it.each(SpawnedChildren.childrenThatMustRelease())(
    '%s releases the terminals it inherited before it can spawn anything',
    (child) => {
      expect(SpawnedChildren.releasesBeforeAnythingElseIn(Backend.sourceOf(child))).toBe(true)
    }
  )

  it('the_table_names_a_reason_for_every_entry_so_nothing_is_accounted_for_by_being_listed', () => {
    for (const entry of SpawnedChildren.ACCOUNTED) {
      expect(entry.reason.length).toBeGreaterThan(0)
    }
  })

  it('the_border_is_the_only_module_of_src_that_imports_a_spawning_library', () => {
    expect(Backend.importers()).toEqual([join('infrastructure', 'process-border.ts')])
  })
})

describe('the guard really fires, so it cannot pass by finding nothing', () => {
  it('a_spawn_no_entry_covers_is_named_with_its_file_and_its_call', () => {
    const found = SpawnedChildren.sitesIn(Source.undeclaredSpawn(), 'infrastructure/new-thing.ts')

    expect(found.map((site) => site.call)).toEqual(['spawn'])
    expect(SpawnedChildren.unaccountedIn(found)[0]).toContain('infrastructure/new-thing.ts')
    expect(SpawnedChildren.unaccountedIn(found)[0]).toContain('spawn')
  })

  it('a_second_spawn_in_an_already_declared_file_is_not_waved_through_by_the_first', () => {
    const declared = SpawnedChildren.ACCOUNTED[0]
    const grown = [
      ...declared.calls.map((call) => ({ file: declared.file, line: 1, call })),
      { file: declared.file, line: 99, call: 'fork' },
    ]

    expect(SpawnedChildren.unaccountedIn(grown)[0]).toContain(declared.file)
  })

  it('an_entry_that_claims_a_call_it_no_longer_makes_is_named', () => {
    const rotted = SpawnedChildren.declaredWithoutASite([], [])

    expect(rotted.length).toBeGreaterThan(0)
    expect(rotted.join(' ')).toContain(SpawnedChildren.ACCOUNTED[0].file)
  })

  it('a_regular_expression_exec_is_not_mistaken_for_a_process', () => {
    expect(SpawnedChildren.sitesIn(Source.regularExpression(), 'x.ts')).toEqual([])
    expect(SpawnedChildren.sitesIn(Source.typePosition(), 'x.ts')).toEqual([])
  })

  it('a_call_through_a_process_port_is_a_site_of_its_own', () => {
    const found = SpawnedChildren.sitesIn("this.processes.launch('git', [])\n", 'x.ts')

    expect(found.map((site) => site.call)).toEqual(['launch'])
  })

  it('a_release_that_is_not_the_first_thing_the_entrypoint_does_does_not_count_as_released', () => {
    expect(SpawnedChildren.releasesBeforeAnythingElseIn(Source.releasingEntrypoint())).toBe(true)
    expect(SpawnedChildren.releasesBeforeAnythingElseIn(Source.releasingLate())).toBe(false)
    expect(SpawnedChildren.releasesBeforeAnythingElseIn('class W {}')).toBe(false)
  })
})
