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

  static withSentences(n) {
    return Array.from({ length: n }, (_, i) => `The task ${i} lands.`).join(' ')
  }

  static withATableRowOfCells(n) {
    return `| ${Array.from({ length: n }, (_, i) => `cell ${i}`).join(' | ')} |`
  }

  static withATaskMarkerSaying(marker, text) {
    return `${marker} ${text}`
  }

  static withACodeBlockSaying(text) {
    return ['Contract (src/a.js):', `${Plan.#FENCE}js`, text, Plan.#FENCE].join('\n')
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

describe('the length of a paragraph', () => {
  it('accepts six sentences and rejects seven', () => {
    expect(Violations.about(Plan.withSentences(PlanLanguage.PARAGRAPH_SENTENCES), 'paragraph')).toEqual([])
    expect(
      Violations.about(Plan.withSentences(PlanLanguage.PARAGRAPH_SENTENCES + 1), 'paragraph'),
    ).toHaveLength(1)
  })

  it('names the count and the limit', () => {
    const [violation] = Violations.about(Plan.withSentences(8), 'paragraph')
    expect(violation).toContain('carries 8 sentences and the limit is 6')
  })

  it('never counts the cells of a table row as sentences', () => {
    expect(Violations.about(Plan.withATableRowOfCells(8), 'paragraph')).toEqual([])
  })
})

describe('the objective of a task', () => {
  it('accepts one sentence and rejects two', () => {
    const one = Plan.withATaskMarkerSaying('**Objective:**', 'The barrel exports sum().')
    const two = Plan.withATaskMarkerSaying('**Objective:**', 'The barrel exports sum(). The test covers it.')
    expect(Violations.about(one, 'one-sentence')).toEqual([])
    expect(Violations.about(two, 'one-sentence')).toHaveLength(1)
  })

  it('asks the other markers for nothing', () => {
    const tests = Plan.withATaskMarkerSaying('**Tests:**', 'One lands. Another lands.')
    expect(Violations.about(tests, 'one-sentence')).toEqual([])
  })
})

describe('the words the standard does not approve', () => {
  it('rejects a single word and names its replacement', () => {
    const [violation] = Violations.about('The task utilizes the barrel.', 'word')
    expect(violation).toContain('"utilize" is not an approved word')
    expect(violation).toContain('Write "use"')
  })

  it('catches the inflections of a single word', () => {
    expect(Violations.about('The gate requires a plan.', 'word')).toHaveLength(1)
    expect(Violations.about('The gate required a plan.', 'word')).toHaveLength(1)
  })

  it('rejects a phrase', () => {
    expect(Violations.about('Read the issue prior to the plan.', 'word')[0]).toContain('Write "before"')
    expect(Violations.about('Read the issue in order to plan.', 'word')[0]).toContain('Write "to"')
  })

  it('never looks inside backticks', () => {
    expect(Violations.about('The flag is `--utilize`.', 'word')).toEqual([])
  })

  it('never looks inside a code block', () => {
    expect(Violations.about(Plan.withACodeBlockSaying('const utilize = 1'), 'word')).toEqual([])
  })

  it('leaves the words a contract fixes alone', () => {
    expect(Violations.about('**Files:** `src/a.js` (create), `src/b.js` (modify).', 'word')).toEqual([])
  })

  it('carries 48 entries, each with its replacement', () => {
    expect(PlanLanguage.NON_APPROVED).toHaveLength(48)
    expect(PlanLanguage.NON_APPROVED.every(([phrase, replacement]) => phrase && replacement)).toBe(true)
  })
})

describe('the passive voice', () => {
  it('rejects a be-form followed by a regular participle', () => {
    expect(Violations.about('The file is covered by the test.', 'passive')).toHaveLength(1)
  })

  it('rejects an irregular participle', () => {
    expect(Violations.about('The plan is written by the agent.', 'passive')).toHaveLength(1)
    expect(Violations.about('The suite has been run.', 'passive')).toHaveLength(1)
  })

  it('accepts a be-form followed by an article', () => {
    expect(Violations.about('It is a written plan.', 'passive')).toEqual([])
  })

  it('crosses an adverb and stops at anything else', () => {
    expect(Violations.about('The file is not covered.', 'passive')).toHaveLength(1)
    expect(Violations.about('The file is already fully covered.', 'passive')).toHaveLength(1)
    expect(Violations.about('The gate is the second control.', 'passive')).toEqual([])
  })

  it('leaves a word that ends in -ed and is not a participle alone', () => {
    expect(Violations.about('The test is red.', 'passive')).toEqual([])
    expect(Violations.about('The speed is enough.', 'passive')).toEqual([])
  })

  it('names what fired and asks for the actor', () => {
    const [violation] = Violations.about('The plan is written by the agent.', 'passive')
    expect(violation).toContain('"is written" is passive')
    expect(violation).toContain('Name who does it')
  })

  it('carries the irregular forms -ed does not catch', () => {
    expect(PlanLanguage.IRREGULAR_PARTICIPLES.has('written')).toBe(true)
    expect(PlanLanguage.IRREGULAR_PARTICIPLES.has('run')).toBe(true)
    expect(PlanLanguage.IRREGULAR_PARTICIPLES.has('covered')).toBe(false)
  })
})

describe('the -ing form', () => {
  it('rejects an -ing word that opens a sentence', () => {
    expect(Violations.about('Reading the issue comes first.', 'gerund')).toHaveLength(1)
  })

  it('rejects an -ing word right after a preposition', () => {
    expect(Violations.about('The agent commits before reading the issue.', 'gerund')).toHaveLength(1)
  })

  it('accepts an -ing word that a preposition does not touch', () => {
    expect(Violations.about('The agent reads one of the following files.', 'gerund')).toEqual([])
  })

  it('leaves the words that only look like gerunds alone', () => {
    expect(Violations.about('Nothing is left during the sweep.', 'gerund')).toEqual([])
    expect(Violations.about('The format is a string.', 'gerund')).toEqual([])
  })

  it('never looks inside backticks', () => {
    expect(Violations.about('The helper is `readingHelper`.', 'gerund')).toEqual([])
  })

  it('names the word and says what to write', () => {
    const [violation] = Violations.about('Reading the issue comes first.', 'gerund')
    expect(violation).toContain('"reading" is an -ing form')
  })

  it('carries the words that end in -ing and are not verb forms', () => {
    expect(PlanLanguage.ING_EXCEPTIONS.has('during')).toBe(true)
    expect(PlanLanguage.ING_EXCEPTIONS.has('reading')).toBe(false)
  })
})
