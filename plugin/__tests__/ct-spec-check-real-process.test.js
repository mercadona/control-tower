import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseScope } from '../scripts/scope.js'

class DraftMother {
  static valid() {
    return '# Support commands\n\n**Estado:** DRAFT\n\n## Hipótesis del experimento\nIndependent commands can ship concurrently.\n\n## Decisiones congeladas\n- **D-1 · Read only** — No writes. *(Procedencia: historia STAFF-127.)*\n\n## Contexto del milestone\n- **Alcance:** `src/tasks/`, `tests/tasks/**`\n'
  }

  static missingScope() {
    return DraftMother.valid().replace('- **Alcance:** `src/tasks/`, `tests/tasks/**`\n', '')
  }
}

class SpecCheckProcess {
  static script = fileURLToPath(new URL('../scripts/ct-spec-check.mjs', import.meta.url))
  static directories = []

  static run(text) {
    const directory = mkdtempSync(join(tmpdir(), 'ct-spec-check-'))
    SpecCheckProcess.directories.push(directory)
    const file = join(directory, 'draft with spaces.md')
    writeFileSync(file, text)
    const result = SpecCheckProcess.invoke([file], directory)
    expect(readFileSync(file, 'utf8')).toBe(text)
    expect(readdirSync(directory)).toEqual(['draft with spaces.md'])
    return result
  }

  static invoke(args, cwd) {
    return spawnSync(process.execPath, [SpecCheckProcess.script, ...args], { cwd, encoding: 'utf8', timeout: 10000 })
  }

  static clean() {
    for (const directory of SpecCheckProcess.directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  }
}

afterEach(() => SpecCheckProcess.clean())

describe('draft checking before the human freeze', () => {
  it('accepts a draft without freezing it or writing any other file', () => {
    const result = SpecCheckProcess.run(DraftMother.valid())
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({ hypothesis: 'ok', scope: 'ok', clarifications: [], decisionsWithoutProvenance: [] })
  })

  it('reports the missing scope that blocked STAFF-127 before requesting a freeze', () => {
    const result = SpecCheckProcess.run(DraftMother.missingScope())
    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout)).toEqual({ hypothesis: 'ok', scope: 'absent', clarifications: [], decisionsWithoutProvenance: [] })
  })

  it.each([
    ['hypothesis', (text) => text.replace('## Hipótesis del experimento', '## Experiment')],
    ['clarification', (text) => `${text}\n[NEEDS CLARIFICATION: output format]\n`],
    ['provenance', (text) => text.replace(' *(Procedencia: historia STAFF-127.)*', '')],
  ])('refuses an unresolved %s', (_, change) => {
    expect(SpecCheckProcess.run(change(DraftMother.valid())).status).toBe(2)
  })

  it('distinguishes an unreadable file from findings in a draft', () => {
    const result = SpecCheckProcess.invoke([join(tmpdir(), 'absent-ct-spec-check', 'draft.md')])
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('spec could not be checked:')
  })

  it.each([[], ['--unknown'], ['one.md', 'two.md']])('rejects an invalid invocation %j', (...args) => {
    const result = SpecCheckProcess.invoke(args)
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe('usage: ct-spec-check.mjs <spec>')
  })

  it('the installed template keeps explanatory prose out of the scope patterns', () => {
    const template = readFileSync(new URL('../templates/_TEMPLATE-execution-spec.md', import.meta.url), 'utf8')
    const filled = template.replaceAll('<dir/>', 'src/tasks/').replaceAll('<dir/**>', 'tests/tasks/**')
    expect(parseScope(filled).patterns).toEqual(['src/tasks/', 'tests/tasks/**'])
  })
})
