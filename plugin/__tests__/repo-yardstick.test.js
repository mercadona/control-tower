// §3.3 of the handoff (docs/prompt-juez-lo-que-queda.md): the plan is per
// slice, so `## 3. Reference patterns` was rewritten in every plan and nothing
// guaranteed that slice 14 cited the same paths as slice 3. This test covers
// `scripts/repo-yardstick.js`, the module that turns the repo's yardstick into one file
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
import { CONVENTIONS_FILE, yardstickSection } from '../scripts/repo-yardstick.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('CONVENTIONS_FILE', () => {
  it('is .agent/conventions.md', () => {
    expect(CONVENTIONS_FILE).toBe('.agent/conventions.md')
  })
})

describe('yardstickSection', () => {
  it('with content, returns a block with the banner and the content verbatim', () => {
    const section = yardstickSection('# vara\n- `AGENTS.md`\n')
    expect(section).toContain('leída directo de `.agent/conventions.md`')
    expect(section).toContain('# vara\n- `AGENTS.md`')
  })

  it('with null, returns the empty string', () => {
    expect(yardstickSection(null)).toBe('')
  })

  it('with undefined, returns the empty string', () => {
    expect(yardstickSection(undefined)).toBe('')
  })

  it('with a blank declaration, returns the empty string (empty is not a yardstick)', () => {
    expect(yardstickSection('  \n\n')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Ties: the constant cannot diverge from the texts that teach it.
// ---------------------------------------------------------------------------
describe('CONVENTIONS_FILE does not diverge from the texts that cite it', () => {
  const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')

  it('scripts/ct-init.sh seeds it', () => {
    expect(read('scripts', 'ct-init.sh')).toContain(CONVENTIONS_FILE)
  })

  it('prompts/task-implementer.md names it', () => {
    expect(read('prompts', 'task-implementer.md')).toContain(CONVENTIONS_FILE)
  })

  it('skills/writing-plans-prescriptive/SKILL.md names it', () => {
    expect(read('skills', 'writing-plans-prescriptive', 'SKILL.md')).toContain(CONVENTIONS_FILE)
  })

  it('skills/writing-plans-prescriptive/plan-template.md names it', () => {
    expect(read('skills', 'writing-plans-prescriptive', 'plan-template.md')).toContain(CONVENTIONS_FILE)
  })

  it('commands/ct-init.md names it', () => {
    expect(read('commands', 'ct-init.md')).toContain(CONVENTIONS_FILE)
  })

  it('agents/ct-judge.md names it, and the mention lives INSIDE the `patrones` item', () => {
    const text = read('agents', 'ct-judge.md')
    expect(text).toContain(CONVENTIONS_FILE)
    // The same regex step-contracts.test.js uses to isolate item 5: the exact
    // heading up to the next ### or ##.
    const m = /^### 5\. `patrones`[\s\S]*?(?=^### |^## )/m.exec(text)
    expect(m).not.toBeNull()
    expect(m[0]).toContain(CONVENTIONS_FILE)
  })
})
