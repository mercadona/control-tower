// §3.3 of the handoff (docs/prompt-juez-lo-que-queda.md): the plan is per
// slice, so `## 3. Reference patterns` was rewritten in every plan and nothing
// guaranteed that slice 14 cited the same paths as slice 3. This test covers
// `scripts/vara.js`, the module that turns the repo's yardstick into one file
// per repo (`.agent/conventions.md`) instead of a per-slice selection repeated
// over and over.
//
// The "ties" tests further down are the part that really protects the design:
// the constant `CONVENTIONS_FILE` cannot diverge from the six texts that cite
// it (the scaffolder that seeds it, the judge that reads it, the implementer,
// the skill and the template that teach it, and the command that confirms it)
// — the same decoupling that JUDGE_TOOLS and VERDICT_RULES already suffered.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONVENTIONS_FILE, seccionDeVara } from '../scripts/vara.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('CONVENTIONS_FILE', () => {
  it('is .agent/conventions.md', () => {
    expect(CONVENTIONS_FILE).toBe('.agent/conventions.md')
  })
})

describe('seccionDeVara', () => {
  it('with content, returns a block with the banner and the content verbatim', () => {
    const seccion = seccionDeVara('# vara\n- `AGENTS.md`\n')
    expect(seccion).toContain('leída directo de `.agent/conventions.md`')
    expect(seccion).toContain('# vara\n- `AGENTS.md`')
  })

  it('with null, returns the empty string', () => {
    expect(seccionDeVara(null)).toBe('')
  })

  it('with undefined, returns the empty string', () => {
    expect(seccionDeVara(undefined)).toBe('')
  })

  it('with a blank declaration, returns the empty string (empty is not a yardstick)', () => {
    expect(seccionDeVara('  \n\n')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Ties: the constant cannot diverge from the texts that teach it.
// ---------------------------------------------------------------------------
describe('CONVENTIONS_FILE does not diverge from the texts that cite it', () => {
  const leer = (...partes) => readFileSync(join(root, ...partes), 'utf8')

  it('scripts/ct-init.sh seeds it', () => {
    expect(leer('scripts', 'ct-init.sh')).toContain(CONVENTIONS_FILE)
  })

  it('prompts/task-implementer.md names it', () => {
    expect(leer('prompts', 'task-implementer.md')).toContain(CONVENTIONS_FILE)
  })

  it('skills/writing-plans-prescriptive/SKILL.md names it', () => {
    expect(leer('skills', 'writing-plans-prescriptive', 'SKILL.md')).toContain(CONVENTIONS_FILE)
  })

  it('skills/writing-plans-prescriptive/plan-template.md names it', () => {
    expect(leer('skills', 'writing-plans-prescriptive', 'plan-template.md')).toContain(CONVENTIONS_FILE)
  })

  it('commands/ct-init.md names it', () => {
    expect(leer('commands', 'ct-init.md')).toContain(CONVENTIONS_FILE)
  })

  it('agents/ct-judge.md names it, and the mention lives INSIDE the `patrones` item', () => {
    const texto = leer('agents', 'ct-judge.md')
    expect(texto).toContain(CONVENTIONS_FILE)
    // The same regex step-contracts.test.js uses to isolate item 5: the exact
    // heading up to the next ### or ##.
    const m = /^### 5\. `patrones`[\s\S]*?(?=^### |^## )/m.exec(texto)
    expect(m).not.toBeNull()
    expect(m[0]).toContain(CONVENTIONS_FILE)
  })
})
