import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PlanLanguage } from '../scripts/plan-language.js'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

class Skill {
  static text() {
    return readFileSync(join(PLUGIN_ROOT, 'skills', 'ct-writing-plans-prescriptive', 'SKILL.md'), 'utf8')
  }
}

describe('what the skill teaches about the language gate', () => {
  it('sends a refusal the plan cannot obey to a person, and never to the list itself', () => {
    const s = Skill.text()
    expect(s).not.toMatch(/add it to the exception/i)
    expect(s).toMatch(/a wrong refusal is a finding for a person/)
    expect(s).toMatch(/say so in\n?`?## 9\. Assumptions`? and stop/)
  })

  it('teaches the adjacency the gerund rule really applies, not a looser one', () => {
    expect(Skill.text()).toContain('directly follows a preposition')
  })

  it('counts the non-approved words the module carries, so the prose cannot drift from it', () => {
    expect(Skill.text()).toContain(`the ${PlanLanguage.NON_APPROVED.length} non-approved words`)
  })
})
