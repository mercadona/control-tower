// The language of the prescriptive plan (scripts/plan-ste.js), tested as what
// it is: a pure module. `annotate` comes from plan-contract.js so that the
// fence rule has one implementation in the tree, not two.
import { describe, it, expect } from 'vitest'
import { annotate } from '../scripts/plan-contract.js'
import { steViolations, PROCEDURAL_WORDS, DESCRIPTIVE_WORDS } from '../scripts/plan-ste.js'

const F = '```'

const violations = (markdown) => steViolations(annotate(markdown))
const of = (markdown, sub) => violations(markdown).filter((v) => v.includes(`: ${sub} —`))

const words = (n, tail = '.') => `${Array.from({ length: n }, (_, i) => `word${i}`).join(' ')}${tail}`

describe('the length of a sentence', () => {
  it('accepts a descriptive sentence of 25 words and rejects one of 26', () => {
    expect(of(words(DESCRIPTIVE_WORDS), 'length')).toEqual([])
    expect(of(words(DESCRIPTIVE_WORDS + 1), 'length')).toHaveLength(1)
  })

  it('counts a sentence that wraps across two lines as one sentence', () => {
    const wrapped = `${words(14, '')}\n${words(14)}`
    expect(of(wrapped, 'length')).toHaveLength(1)
  })

  it('measures a paragraph that starts with a task marker against 20 words', () => {
    expect(of(`**Objective:** ${words(PROCEDURAL_WORDS)}`, 'length')).toEqual([])
    expect(of(`**Objective:** ${words(PROCEDURAL_WORDS + 1)}`, 'length')).toHaveLength(1)
  })

  it('measures a paragraph of section 8 against 20 words', () => {
    const plan = ['## 8. Global verification', words(21), '## 9. Assumptions', words(21)].join('\n')
    expect(of(plan, 'length')).toHaveLength(1)
  })

  it('does not spend one of the 20 words on the marker itself', () => {
    expect(of(`**Verification:** ${words(PROCEDURAL_WORDS)}`, 'length')).toEqual([])
  })

  it('never measures a code block', () => {
    const plan = ['Contract (src/a.js):', F + 'js', words(40), F].join('\n')
    expect(violations(plan)).toEqual([])
  })

  it('counts a backticked path as one word', () => {
    expect(of(`${words(24, '')} \`server/src/analysis/git.ts\`.`, 'length')).toEqual([])
  })

  it('counts a bare path as one word', () => {
    expect(of(`${words(24, '')} server/src/analysis/git.ts.`, 'length')).toEqual([])
  })

  it('names the line, the count and the limit', () => {
    expect(of(words(30), 'length')[0]).toContain('line 1: length —')
    expect(of(words(30), 'length')[0]).toContain('carries 30 words and the limit here is 25')
  })

  it('measures each cell of a table row on its own', () => {
    const row = `| ${words(24, '')} | ${words(24, '')} |`
    expect(of(row, 'length')).toEqual([])
  })

  it('drops headings, role labels and table separators', () => {
    const plan = ['## 1. ' + words(30, ''), '|---|---|', 'Current state (src/a.js, lines 1-2):'].join('\n')
    expect(violations(plan)).toEqual([])
  })
})
