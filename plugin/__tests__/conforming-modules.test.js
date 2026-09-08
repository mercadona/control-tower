import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

class BornConforming {
  static PATHS = [
    'scripts/plugin-yardstick.js',
    'scripts/yardstick-citation.js',
    '__tests__/plugin-yardstick.test.js',
    '__tests__/yardstick-citation.test.js',
    '__tests__/conventions-yardstick.test.js',
    'scripts/branch-reconciliation.js',
    'scripts/reconcile-outcome.js',
    '__tests__/conforming-modules.test.js',
    '__tests__/branch-reconciliation.test.js',
    '__tests__/branch-reconciliation-real-process.test.js',
    '__tests__/branch-reconciliation-production-real-process.test.js',
    '__tests__/branch-reconciliation-unreadable-base-real-process.test.js',
    '__tests__/reconcile-outcome.test.js',
    '__tests__/plan-section-real-process.test.js',
    '__tests__/distribution-boundary.test.js',
    'scripts/slice-collection.js',
    '__tests__/slice-collection.test.js',
    'scripts/slice-collector.js',
    '__tests__/slice-collector.test.js',
    'scripts/harvest-table.js',
    '__tests__/harvest-table.test.js',
    'scripts/bigquery-load.js',
    '__tests__/bigquery-load.test.js',
    'scripts/harvest-ledger.js',
    '__tests__/harvest-ledger.test.js',
    'scripts/plugin-manifest.js',
    '__tests__/plugin-manifest.test.js',
    '__tests__/fixtures/fake-bq-bin/bq',
    '__tests__/fixtures/scripted-runner.js',
    '__tests__/ct-harvest-bq-real-process.test.js',
    'scripts/slice-harvest.js',
    '__tests__/slice-harvest.test.js',
    'scripts/ct-step-commit.js',
    'scripts/dispatch-gate.js',
    'hooks/dispatch-guard.js',
    '__tests__/dispatch-gate.test.js',
    '__tests__/dispatch-guard-real-process.test.js',
    '__tests__/ct-step-dispatch-seal-real-process.test.js',
    '__tests__/dispatch-check-collect-bq-real-process.test.js',
    'scripts/role-bytes.js',
    '__tests__/role-bytes.test.js',
    'scripts/judge-agent-definition.js',
    'scripts/judge-bench-case.js',
    'scripts/judge-bench-workspace.js',
    'scripts/judge-dispatch.js',
    'scripts/judge-bench.js',
    'scripts/judge-bench.mjs',
    '__tests__/judge-bench.test.js',
    '__tests__/judge-bench-real-process.test.js',
  ]

  static PALABRAS_CASTELLANAS = [
    'cita', 'citas', 'nombre', 'nombres', 'texto', 'fila', 'filas', 'vara', 'documento', 'documentos',
    'encontrados', 'medir', 'medida', 'paso', 'pasos', 'regla', 'reglas', 'hallazgo', 'hallazgos',
    'intento', 'cuerpo', 'previos', 'comentario', 'comentarios', 'recorrido', 'alcance', 'sujeto',
  ]

  static MARKER = '-real-process.test.js'

  static RELATIVE_IMPORT = /from\s+['"](\.{1,2}\/[^'"]+)['"]/g

  static #numbered(path) {
    return readFileSync(join(root, path), 'utf8')
      .split('\n')
      .map((line, index) => [index + 1, line])
  }

  static proseIn(path) {
    return BornConforming.#numbered(path)
      .filter(([, line]) => /^\s*(?:\/\/|\/\*|\*)/.test(line))
      .map(([number]) => number)
  }

  static looseFunctionsIn(path) {
    return BornConforming.#numbered(path)
      .filter(([, line]) => /^(?:export\s+)?(?:async\s+)?function\b/.test(line))
      .map(([number]) => number)
  }

  static disguisedLooseFunctionsIn(path) {
    return BornConforming.#numbered(path)
      .filter(([, line]) => /^(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*(?:\(|async\s*\(|function\b)/.test(line))
      .map(([number]) => number)
  }

  static spanishIdentifiersIn(path) {
    const source = readFileSync(join(root, path), 'utf8')
    const declared = [...source.matchAll(/\b(?:class|const|let|var|function|static)\s+#?([A-Za-z_$][\w$]*)/g)]
      .map((match) => match[1])
    return [...new Set(declared.filter((identifier) =>
      BornConforming.PALABRAS_CASTELLANAS.includes(identifier.toLowerCase())
    ))]
  }

  static #testStringsIn(path) {
    return BornConforming.#numbered(path)
      .map(([number, line]) => [number, line.match(/^\s*(?:describe|it)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/)])
      .filter(([, match]) => match)
      .map(([number, match]) => [number, match[2].replace(/\$\{[^}]*\}/g, ' ')])
  }

  static #nonAsciiLetterIn(text) {
    return [...text].some((character) => {
      if (character.codePointAt(0) <= 127) return false
      if (character === '¿' || character === '¡') return true
      return /\p{L}/u.test(character)
    })
  }

  static nonAsciiTestNamesIn(path) {
    return BornConforming.#testStringsIn(path)
      .filter(([, text]) => BornConforming.#nonAsciiLetterIn(text))
      .map(([number]) => number)
  }

  static spanishTestNamesIn(path) {
    return BornConforming.#testStringsIn(path)
      .filter(([, text]) => text.split(/[^A-Za-z]+/).some((word) =>
        BornConforming.PALABRAS_CASTELLANAS.includes(word.toLowerCase())
      ))
      .map(([number]) => number)
  }

  static launchesRealProcesses(path, seen = new Set()) {
    if (seen.has(path)) return false
    seen.add(path)
    const source = readFileSync(join(root, path), 'utf8')
    if (/(?:from\s+['"]node:child_process['"]|require\(\s*['"]node:child_process['"]\s*\))/.test(source)) {
      return true
    }
    return [...source.matchAll(BornConforming.RELATIVE_IMPORT)]
      .map(([, specifier]) => join(dirname(path), specifier))
      .filter((relative) => relative.startsWith('__tests__/fixtures/'))
      .some((relative) => BornConforming.launchesRealProcesses(relative, seen))
  }

  static withoutMarker() {
    return BornConforming.PATHS.filter((path) =>
      path.endsWith('.test.js') &&
      !path.endsWith(BornConforming.MARKER) &&
      BornConforming.launchesRealProcesses(path)
    )
  }

  static decorativeMarker() {
    return BornConforming.PATHS.filter((path) =>
      path.endsWith(BornConforming.MARKER) &&
      !BornConforming.launchesRealProcesses(path)
    )
  }
}

describe('modules born under the yardstick keep being born conforming', () => {
  it('measures only the THREE rules of style.md and not a fourth invented one: that document does not forbid a loose constant, only a loose function', () => {
    expect(BornConforming.proseIn('scripts/yardstick-citation.js')).toEqual([])
    expect(BornConforming.looseFunctionsIn('scripts/yardstick-citation.js')).toEqual([])
    expect(BornConforming.disguisedLooseFunctionsIn('scripts/yardstick-citation.js')).toEqual([])
  })

  it('the list names both modules and names ITSELF: a guard blind to its own file once left 21 comments inside it', () => {
    expect(BornConforming.PATHS).toContain('scripts/plugin-yardstick.js')
    expect(BornConforming.PATHS).toContain('scripts/yardstick-citation.js')
    expect(BornConforming.PATHS).toContain('__tests__/conforming-modules.test.js')
  })

  for (const path of BornConforming.PATHS) {
    it(`${path} does not carry a single line of prose`, () => {
      expect(BornConforming.proseIn(path), `${path} has comments on those lines`).toEqual([])
    })

    it(`${path} does not declare any loose function at module level`, () => {
      expect(BornConforming.looseFunctionsIn(path), `${path} declares loose functions on those lines`)
        .toEqual([])
    })

    it(`${path} does not sneak in a loose module-level function disguised as an arrow constant`, () => {
      expect(BornConforming.disguisedLooseFunctionsIn(path), `${path} declares loose arrow functions`)
        .toEqual([])
    })
  }
})

describe('the language of identifiers, by an EXACT block list', () => {
  for (const path of ['scripts/plugin-yardstick.js', 'scripts/yardstick-citation.js']) {
    it(`${path} does not declare identifiers in Spanish`, () => {
      expect(BornConforming.spanishIdentifiersIn(path)).toEqual([])
    })
  }

  it('the match is exact and not by prefix: by prefix it flagged `citation`, which is perfect English', () => {
    expect(BornConforming.PALABRAS_CASTELLANAS).toContain('cita')
    expect(BornConforming.spanishIdentifiersIn('scripts/yardstick-citation.js')).toEqual([])
  })
})

describe('the language of test names, by two mechanical checks: no non-ASCII letters, and the same EXACT block list', () => {
  for (const path of BornConforming.PATHS) {
    it(`${path} carries no describe or it with a non-ASCII letter`, () => {
      expect(BornConforming.nonAsciiTestNamesIn(path), `${path} has a non-ASCII test name on those lines`).toEqual([])
    })

    it(`${path} carries no describe or it with a word from the Spanish block list`, () => {
      expect(BornConforming.spanishTestNamesIn(path), `${path} has a Spanish test name on those lines`)
        .toEqual([])
    })
  }
})

describe('the marker of a real subprocess, in both directions', () => {
  it('a_test_born_conforming_that_launches_a_real_process_carries_the_marker_in_its_file_name', () => {
    expect(BornConforming.withoutMarker()).toEqual([])
  })

  it('a_test_born_conforming_that_carries_the_marker_really_launches_a_real_process', () => {
    expect(BornConforming.decorativeMarker()).toEqual([])
  })

  it('a_test_born_conforming_that_launches_a_real_process_through_a_fixture_counts_as_launching_it', () => {
    expect(BornConforming.launchesRealProcesses('__tests__/ct-step-dispatch-seal-real-process.test.js')).toBe(true)
  })

  it('a_test_that_imports_neither_child_process_nor_a_spawning_fixture_does_not_count_as_launching_one', () => {
    expect(BornConforming.launchesRealProcesses('__tests__/plugin-manifest.test.js')).toBe(false)
  })
})
