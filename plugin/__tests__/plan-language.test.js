import { describe, it, expect } from 'vitest'
import { annotate } from '../scripts/plan-contract.js'
import { PlanLanguage } from '../scripts/plan-language.js'

class Plan {
  static #FENCE = '```'

  static withADescriptiveSentenceOf(n) {
    return Plan.#words(n)
  }

  static wrappingOneSentenceAcrossTwoLines() {
    return `${Plan.#words(14, '')}\n${Plan.#words(14)}`
  }

  static withATaskMarker(n, marker = '**Objective:**') {
    return `${marker} ${Plan.#words(n)}`
  }

  static withASectionEightParagraphOf(n) {
    return ['## 8. Global verification', Plan.#words(n), '## 9. Assumptions', Plan.#words(n)].join('\n')
  }

  static withACodeBlockOf(n) {
    return ['Contract (src/a.js):', `${Plan.#FENCE}js`, Plan.#words(n), Plan.#FENCE].join('\n')
  }

  static citingABacktickedPath() {
    return `${Plan.#words(24, '')} \`server/src/analysis/git.ts\`.`
  }

  static citingABarePath() {
    return `${Plan.#words(24, '')} server/src/analysis/git.ts.`
  }

  static withATableRowOf(n) {
    return `| ${Plan.#words(n, '')} | ${Plan.#words(n, '')} |`
  }

  static withHeadingsRoleLabelsAndTableSeparators() {
    return ['## 1. ' + Plan.#words(30, ''), '|---|---|', 'Current state (src/a.js, lines 1-2):'].join('\n')
  }

  static #words(n, tail = '.') {
    return `${Array.from({ length: n }, (_, i) => `word${i}`).join(' ')}${tail}`
  }
}

class Violations {
  static of(markdown) {
    return PlanLanguage.violationsOf(annotate(markdown))
  }

  static about(markdown, rule) {
    return Violations.of(markdown).filter((v) => v.includes(`: ${rule} —`))
  }
}

describe('the length of a sentence', () => {
  it('accepts a descriptive sentence of 25 words and rejects one of 26', () => {
    expect(Violations.about(Plan.withADescriptiveSentenceOf(PlanLanguage.DESCRIPTIVE_WORDS), 'length')).toEqual([])
    expect(
      Violations.about(Plan.withADescriptiveSentenceOf(PlanLanguage.DESCRIPTIVE_WORDS + 1), 'length'),
    ).toHaveLength(1)
  })

  it('counts a sentence that wraps across two lines as one sentence', () => {
    expect(Violations.about(Plan.wrappingOneSentenceAcrossTwoLines(), 'length')).toHaveLength(1)
  })

  it('measures a paragraph that starts with a task marker against 20 words', () => {
    expect(Violations.about(Plan.withATaskMarker(PlanLanguage.PROCEDURAL_WORDS), 'length')).toEqual([])
    expect(Violations.about(Plan.withATaskMarker(PlanLanguage.PROCEDURAL_WORDS + 1), 'length')).toHaveLength(1)
  })

  it('measures a paragraph of section 8 against 20 words', () => {
    expect(
      Violations.about(Plan.withASectionEightParagraphOf(PlanLanguage.PROCEDURAL_WORDS + 1), 'length'),
    ).toHaveLength(1)
  })

  it('does not spend one of the 20 words on the marker itself', () => {
    const plan = Plan.withATaskMarker(PlanLanguage.PROCEDURAL_WORDS, '**Verification:**')
    expect(Violations.about(plan, 'length')).toEqual([])
  })

  it('never measures a code block', () => {
    expect(Violations.of(Plan.withACodeBlockOf(40))).toEqual([])
  })

  it('counts a backticked path as one word', () => {
    expect(Violations.about(Plan.citingABacktickedPath(), 'length')).toEqual([])
  })

  it('counts a bare path as one word', () => {
    expect(Violations.about(Plan.citingABarePath(), 'length')).toEqual([])
  })

  it('names the line, the count and the limit', () => {
    const [violation] = Violations.about(Plan.withADescriptiveSentenceOf(30), 'length')
    expect(violation).toContain('line 1: length —')
    expect(violation).toContain('carries 30 words and the limit here is 25')
  })

  it('measures each cell of a table row on its own', () => {
    expect(Violations.about(Plan.withATableRowOf(24), 'length')).toEqual([])
  })

  it('drops headings, role labels and table separators', () => {
    expect(Violations.of(Plan.withHeadingsRoleLabelsAndTableSeparators())).toEqual([])
  })
})
