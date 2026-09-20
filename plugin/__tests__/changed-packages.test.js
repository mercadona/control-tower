import { describe, expect, it } from 'vitest'
import { ChangedPackages } from '../scripts/changed-packages.js'

class Diff {
  static nothing() { return [] }
  static onlyBackend() { return ['backend/src/infrastructure/ct-api.ts'] }
  static onlyFrontend() { return ['frontend/src/pages/home/Home.tsx'] }
  static onlyPlugin() { return ['plugin/scripts/ct-next.mjs'] }
  static root() { return ['README.md'] }
  static backendAndFrontend() { return [...Diff.onlyBackend(), ...Diff.onlyFrontend()] }
  static aFileNamedLikeAPackage() { return ['backend'] }
}

describe('which suites a change turns on', () => {
  it('a_change_inside_one_package_turns_on_that_package', () => {
    expect(ChangedPackages.of(Diff.onlyBackend())).toEqual({ plugin: false, backend: true, frontend: false })
    expect(ChangedPackages.of(Diff.onlyFrontend())).toEqual({ plugin: false, backend: false, frontend: true })
    expect(ChangedPackages.of(Diff.backendAndFrontend()))
      .toEqual({ plugin: false, backend: true, frontend: true })
  })

  it('a_plugin_change_drags_the_backend_in_because_the_backend_compiles_against_plugin_sources', () => {
    expect(ChangedPackages.of(Diff.onlyPlugin())).toEqual({ plugin: true, backend: true, frontend: false })
  })

  it('anything_outside_the_three_packages_turns_everything_on_rather_than_being_attributed_to_one', () => {
    expect(ChangedPackages.of(Diff.root())).toEqual(ChangedPackages.everything())
    expect(ChangedPackages.of([...Diff.onlyBackend(), ...Diff.root()])).toEqual(ChangedPackages.everything())
  })

  it('a_diff_nobody_could_read_is_not_evidence_of_a_small_change', () => {
    expect(ChangedPackages.of(Diff.nothing())).toEqual(ChangedPackages.everything())
    expect(ChangedPackages.of(null)).toEqual(ChangedPackages.everything())
    expect(ChangedPackages.of(['', '   '])).toEqual(ChangedPackages.everything())
  })

  it('a_file_named_like_a_package_is_not_a_change_inside_it', () => {
    expect(ChangedPackages.of(Diff.aFileNamedLikeAPackage())).toEqual(ChangedPackages.everything())
  })

  it('it_answers_in_the_shape_the_workflow_writes_to_its_output', () => {
    expect(ChangedPackages.outputFor(ChangedPackages.of(Diff.onlyBackend())))
      .toBe('plugin=false\nbackend=true\nfrontend=false')
    expect(ChangedPackages.namesIn(ChangedPackages.of(Diff.onlyPlugin()))).toEqual(['plugin', 'backend'])
  })
})
