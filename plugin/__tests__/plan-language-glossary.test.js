import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PlanLanguage } from '../scripts/plan-language.js'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

class Glossary {
  static #ENGLISH_COLUMN = /^\|[^|]*\|([^|]*)\|/

  static decidedTerms() {
    return new Set(
      readFileSync(join(REPO_ROOT, 'docs', 'glossary.md'), 'utf8')
        .split('\n')
        .map((line) => line.match(Glossary.#ENGLISH_COLUMN)?.[1])
        .filter(Boolean)
        .map((term) => term.trim().replace(/\*/g, '')),
    )
  }
}

describe('the words the standard does not approve, read against the words this repository decided', () => {
  it('never asks the author to write away a term the glossary already ruled on', () => {
    const decided = Glossary.decidedTerms()
    expect(PlanLanguage.NON_APPROVED.filter(([phrase]) => decided.has(phrase))).toEqual([])
  })
})
