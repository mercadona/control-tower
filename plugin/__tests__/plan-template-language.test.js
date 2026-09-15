import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { annotate } from '../scripts/plan-contract.js'
import { PlanLanguage } from '../scripts/plan-language.js'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

class Template {
  static markdown() {
    return readFileSync(join(PLUGIN_ROOT, 'skills', 'writing-plans-prescriptive', 'plan-template.md'), 'utf8')
  }
}

describe('the template of the prescriptive plan', () => {
  it('obeys the language rule the gate applies to the plan', () => {
    expect(PlanLanguage.violationsOf(annotate(Template.markdown()))).toEqual([])
  })
})
