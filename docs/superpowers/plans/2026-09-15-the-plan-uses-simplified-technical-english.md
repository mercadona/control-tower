# The plan uses Simplified Technical English — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ASD-STE100 the measured language of every slice plan, so `dispatch-check --check-plan` refuses a plan whose prose breaks it.

**Architecture:** A new pure module, `plugin/scripts/plan-language.js`, receives the plan already annotated by `plan-contract.js` (one object per line, with `.line` and `.structural`) and returns its violations as strings. `validatePlan` pushes each one under a single rule name, `ste`, with the sub-rule inside the detail. The module groups prose into paragraphs before it measures anything, because markdown here wraps at about 100 characters and a sentence normally spans two or three lines.

**Tech Stack:** Node 24, ESM, vitest 5. No dependency is added.

**Spec:** `docs/superpowers/specs/2026-09-15-the-plan-uses-simplified-technical-english-design.md`

## Global Constraints

- **English everywhere.** Code, tests, test names, commit messages, documentation. `CLAUDE.md` gives one exemption, Spanish frontend product copy, and this work touches none.
- **`plugin/` is JavaScript and stays JavaScript.** `backend/conventions/this-repository.md:44`. No `.ts` under `plugin/`.
- **The module is pure.** No `readFile`, no port, no injected clock. `plan-contract.js` already works this way and its test touches no disk.
- **Test commands run from `plugin/`.** One file: `npx vitest run __tests__/<file>`. Fast subset: `npx vitest run --exclude '**/*-real-process.test.js'`. Whole suite: `npm test` (it builds first).
- **Word limits:** 20 words in a procedural sentence, 25 in a descriptive one, 6 sentences in a paragraph.
- **A fixture that fires the new rule gets its prose fixed. The rule is never loosened to keep a fixture green.**
- **No control is routed around.** No `--no-verify`, no `--force`, no weakened assertion. A hook that refuses is reported, not bypassed.
- **Every commit message ends with:** `Co-Authored-By: Claude <noreply@anthropic.com>`
- **The module is one type, and it carries no prose.** `plugin/conventions/style.md` grants its
  declared-debt exemption to "a module that was already there", and closes the hole in the next
  breath — "a new concept is a new module and is born conforming". So `plan-language.js` is
  `export class PlanLanguage`: `violationsOf(lines)` is the entry point, the limits and the three
  lists the test reads are public statics, everything else is a private static member, and there
  is not one comment. `plugin/__tests__/plan-language.test.js` follows
  `plugin/conventions/testing.md`: no comment, no loose helper, a `Plan` mother whose methods are
  named scenarios, and `Violations` as the test type that runs the measure. The conforming
  neighbours to copy are `plugin/scripts/telemetry-lines.js`, `role-bytes.js` and
  `plugin/__tests__/role-bytes.test.js` — NOT `plan-contract.js`, which is the declared debt.
  The "why" a comment would have carried lives in the spec and in the skill's new section.

---

### Task 1: The prose extractor and the `length` rule

> **Landed with a correction — read this before the steps.** The steps below prescribe a module of
> free functions with a prose banner, and that shape is wrong: `style.md` denies a NEW module the
> declared-debt exemption, and every module created in `plugin/scripts/` this September is a class
> with no comments. The task shipped in two commits: `e1b1f4a` carries the logic, and `96cbcac`
> reshapes it into `export class PlanLanguage` in `plugin/scripts/plan-language.js`, with
> `plugin/__tests__/plan-language.test.js` as its test. **The logic below is binding and landed
> byte for byte. The shape is not — the shape is the last bullet of the Global Constraints.** Read
> those two files: they are the shape every later task extends.

**Files:**
- Create: `plugin/scripts/plan-language.js`
- Create: `plugin/__tests__/plan-language.test.js`
- Modify: `plugin/scripts/plan-contract.js` (export `annotate`, today a module-private function at line 163)

**Interfaces:**
- Consumes: `annotate(markdown)` from `plan-contract.js` — returns `{ line, structural, fence, opens }[]`. The test imports it so that one annotation implementation exists in the tree, not two.
- Produces (as landed): `PlanLanguage.violationsOf(lines) -> string[]`, `PlanLanguage.PROCEDURAL_WORDS = 20`, `PlanLanguage.DESCRIPTIVE_WORDS = 25`. The steps below name them `steViolations`, `PROCEDURAL_WORDS` and `DESCRIPTIVE_WORDS`, which the reshape superseded.

- [ ] **Step 1: Write the failing test**

Create `plugin/__tests__/plan-language.test.js`:

```js
// The language of the prescriptive plan (scripts/plan-language.js), tested as what
// it is: a pure module. `annotate` comes from plan-contract.js so that the
// fence rule has one implementation in the tree, not two.
import { describe, it, expect } from 'vitest'
import { annotate } from '../scripts/plan-contract.js'
import { steViolations, PROCEDURAL_WORDS, DESCRIPTIVE_WORDS } from '../scripts/plan-language.js'

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/plan-language.test.js`
Expected: FAIL — `Failed to resolve import "../scripts/plan-language.js"`, and `annotate` is not an export of `plan-contract.js`.

- [ ] **Step 3: Export `annotate` from `plan-contract.js`**

In `plugin/scripts/plan-contract.js`, line 163, the declaration becomes an export. Nothing else changes:

```js
export function annotate(markdown) {
```

Leave the comment above it as it is: it already says what the function does.

- [ ] **Step 4: Write the module**

Create `plugin/scripts/plan-language.js`:

```js
// ============================================================================
// PLAN-STE — the language of a slice's prescriptive plan.
//
// plan-contract.js measures the plan's structure, the taxonomy of its blocks
// and the literality of its citations. It did NOT measure its prose, and that
// prose is the whole brief of a zero-context subagent: a 33-word passive
// sentence hides who does what, which is the one thing that reader needs.
//
// ASD-STE100 (Simplified Technical English) is the aerospace standard for that
// problem. This module measures the part of it a machine can measure without
// guessing: sentence length, paragraph length, passive voice, the -ing form,
// and a list of non-approved words that carries the approved replacement.
//
// PURE, like plan-contract.js: it receives the plan already annotated (one
// object per line, with .line and .structural) and returns the violations as
// strings. No I/O and no ports.
//
// THE UNIT IS THE PARAGRAPH, not the line. Markdown prose wraps at about 100
// characters in this repository, so a sentence normally spans two or three
// lines. Measured line by line, every sentence would look shorter than it is
// and the wrap would split it in the middle.
// ============================================================================

export const PROCEDURAL_WORDS = 20
export const DESCRIPTIVE_WORDS = 25

const HEADING = /^#{1,6} /
const ROLE_LABEL = /^(?:Current state|Contract|Call site|Final text) \(/
const TABLE_SEPARATOR = /^\|[\s:|-]+\|$/
const TASK_MARKERS = ['**Objective:**', '**Files:**', '**TDD:**', '**Tests:**', '**Verification:**']
const SECTION_8 = '## 8. Global verification'
const SECTION_9 = '## 9. Assumptions'

// A prefix that carries no meaning for the measure: the blockquote marker and
// the bullet or number of a list item.
const PREFIX = /^\s*(?:>\s?)?(?:(?:[-*+]|\d+\.)\s+)?/
const LINK = /\[([^\]]*)\]\([^)]*\)/g
const CODE_SPAN = /`[^`]*`/g
// A token that carries a slash or a scheme: a path or a URL. One word, and
// the punctuation that closes the sentence survives it: without that, a
// paragraph that ends on a path loses the boundary between two sentences.
const OPAQUE = /\S*(?:\/|https?:)\S*/g
const opaqueToCode = (match) => {
  const tail = match.match(/[.,;:!?]+$/)
  return ` CODE${tail ? tail[0] : ''} `
}
const EMPHASIS = /\*\*|\*|_/g
const SENTENCE_END = /(?<=[.!?])\s+/

function paragraphsOf(lines) {
  const out = []
  let run = null
  const flush = () => {
    if (run) out.push(run)
    run = null
  }
  lines.forEach((l, i) => {
    if (!l.structural) return flush()
    const text = l.line
    if (!text.trim() || HEADING.test(text) || ROLE_LABEL.test(text) || TABLE_SEPARATOR.test(text)) return flush()
    if (text.trimStart().startsWith('|')) {
      flush()
      out.push({ at: i, lines: [text], row: true })
      return
    }
    if (!run) run = { at: i, lines: [], row: false }
    run.lines.push(text)
  })
  flush()
  return out
}

function normalise(textLines) {
  return textLines
    .map((line) => line.replace(PREFIX, ''))
    .join(' ')
    .replace(LINK, '$1')
    .replace(CODE_SPAN, ' CODE ')
    .replace(OPAQUE, opaqueToCode)
    .replace(EMPHASIS, '')
    // A replacement above injects a trailing space, so a closing mark that
    // followed a backticked span ends up as a word of its own. Glue it back to
    // the token before it.
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()
}

const markerOf = (paragraph) => TASK_MARKERS.find((m) => paragraph.lines[0].startsWith(m)) ?? null

const withoutMarker = (paragraph, marker) =>
  marker ? [paragraph.lines[0].slice(marker.length), ...paragraph.lines.slice(1)] : paragraph.lines

const cellsOf = (text) => text.split('|').map((cell) => cell.trim()).filter(Boolean)

const sentencesOf = (text) => text.split(SENTENCE_END).map((s) => s.trim()).filter(Boolean)

const wordsOf = (sentence) => sentence.split(/\s+/).filter(Boolean)

const shorten = (sentence) => (sentence.length <= 60 ? sentence : `${sentence.slice(0, 57)}...`)

export function steViolations(lines) {
  const out = []
  const indexOf = (needle) => lines.findIndex((l) => l.structural && l.line.startsWith(needle))
  const opens8 = indexOf(SECTION_8)
  const opens9 = indexOf(SECTION_9)

  for (const paragraph of paragraphsOf(lines)) {
    const marker = markerOf(paragraph)
    const inSection8 = opens8 !== -1 && paragraph.at > opens8 && (opens9 === -1 || paragraph.at < opens9)
    const limit = marker || inSection8 ? PROCEDURAL_WORDS : DESCRIPTIVE_WORDS
    const text = normalise(withoutMarker(paragraph, marker))
    const sentences = paragraph.row ? cellsOf(text) : sentencesOf(text)
    const line = paragraph.at + 1

    for (const sentence of sentences) {
      const count = wordsOf(sentence).length
      if (count > limit) {
        out.push(
          `line ${line}: length — the sentence "${shorten(sentence)}" carries ${count} words and the limit here is ${limit}. Split it.`,
        )
      }
    }
  }
  return out
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run __tests__/plan-language.test.js`
Expected: PASS — 11 tests.

- [ ] **Step 6: Run the fast subset to verify nothing else moved**

Run: `npx vitest run --exclude '**/*-real-process.test.js'`
Expected: PASS. `steViolations` has no caller yet, so no other test can see it.

- [ ] **Step 7: Commit**

```bash
git add plugin/scripts/plan-language.js plugin/__tests__/plan-language.test.js plugin/scripts/plan-contract.js
git commit -m "$(cat <<'MSG'
The plan's prose is measured by the paragraph, and a sentence has a limit

plan-language.js groups the plan's prose into paragraphs before it measures
anything: markdown wraps at about 100 characters here, so a sentence
spans two or three lines and a line-by-line measure would see every one
of them as shorter than it is.

On that unit it applies the first rule of ASD-STE100 that a machine can
apply without guessing: 20 words in a paragraph that starts with a task
marker or lives in section 8, and 25 anywhere else. A code block is
never measured, and a path counts as one word whether it carries
backticks or not.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The `paragraph` and `one-sentence` rules

**Files:**
- Modify: `plugin/scripts/plan-language.js`
- Modify: `plugin/__tests__/plan-language.test.js`

**Interfaces:**
- Consumes: `PlanLanguage.violationsOf`, `#paragraphsOf` and `#sentencesOf` from Task 1, plus the `Plan` mother and the `Violations` test type its test carries.
- Produces: `PARAGRAPH_SENTENCES = 6`.

- [ ] **Step 1: Write the failing test**

Append two describe blocks to `plugin/__tests__/plan-language.test.js`, and three named scenarios
to its `Plan` mother. A case whose subject IS a literal sentence goes straight to
`Violations.about`: a mother method that returns its own argument buys nothing.

Add to `class Plan`:

```js
  static withSentences(n) {
    return Array.from({ length: n }, (_, i) => `The task ${i} lands.`).join(' ')
  }

  static withATableRowOfCells(n) {
    return `| ${Array.from({ length: n }, (_, i) => `cell ${i}`).join(' | ')} |`
  }

  static withATaskMarkerSaying(marker, text) {
    return `${marker} ${text}`
  }
```

And the two describe blocks:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/plan-language.test.js`
Expected: FAIL — `PlanLanguage.PARAGRAPH_SENTENCES` is undefined, and the `paragraph` and `one-sentence` lists come back empty.

- [ ] **Step 3: Write the implementation**

In `plugin/scripts/plan-language.js`, next to the other two limits:

```js
  static PARAGRAPH_SENTENCES = 6
```

And inside the paragraph `for` of `violationsOf`, right after the sentence loop that measures
`length`:

```js
      if (!paragraph.row && sentences.length > PlanLanguage.PARAGRAPH_SENTENCES) {
        out.push(
          `line ${line}: paragraph — the paragraph carries ${sentences.length} sentences and the limit is ${PlanLanguage.PARAGRAPH_SENTENCES}. Split it.`,
        )
      }
      if (marker === '**Objective:**' && sentences.length > 1) {
        out.push(
          `line ${line}: one-sentence — **Objective:** carries ${sentences.length} sentences and it takes one. Say the observable behaviour of the commit, and nothing else.`,
        )
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/plan-language.test.js`
Expected: PASS — 16 tests.

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/plan-language.js plugin/__tests__/plan-language.test.js
git commit -m "$(cat <<'MSG'
A paragraph holds six sentences, and an objective holds one

Two rules on the unit Task 1 built. Six sentences is the standard's
limit for a paragraph. One sentence is what the skill already asked of
**Objective:** and nothing measured: the marker exists to say the
observable behaviour of one commit, and a second sentence is either
another commit or prose that belongs elsewhere.

A table row is exempt from the paragraph rule: its cells are values, and
counting them as sentences would fail every inventory.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: The `word` rule and the non-approved list

**Files:**
- Modify: `plugin/scripts/plan-language.js`
- Modify: `plugin/__tests__/plan-language.test.js`

**Interfaces:**
- Produces: `PlanLanguage.NON_APPROVED` — a public static array of `[phrase, replacement]` pairs, 48 entries.

- [ ] **Step 1: Write the failing test**

Append one describe block to `plugin/__tests__/plan-language.test.js`, and one named scenario to
its `Plan` mother:

```js
  static withACodeBlockSaying(text) {
    return ['Contract (src/a.js):', `${Plan.#FENCE}js`, text, Plan.#FENCE].join('\n')
  }
```

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/plan-language.test.js`
Expected: FAIL — `PlanLanguage.NON_APPROVED` is undefined and the `word` lists come back empty.

- [ ] **Step 3: Write the implementation**

**The list is a blacklist, not the standard's dictionary of about 900 approved words.** A
whitelist would reject every technical name of the project, and a plan is full of them.

**Two kinds of word never enter it.** First, a value a contract fixes: `create` and `modify` are
the two words `**Files:**` is written with, so `modify` on this list would fail every plan ever
written, and the task markers, the parsed headings of `CLAUDE.md` and the GitHub labels of the
ladder are the same case. Second, the repository's ubiquitous language: `dispatch`, `harvest`,
`slice`, `judge`, `gate` and `yardstick` are domain terms, and the standard allows a project its
own technical vocabulary. **No comment in the code says any of this** — the no-prose rule forbids
it. The rule lives in the spec and in the skill's new section, which Task 9 writes.

In `plugin/scripts/plan-language.js`, after the limits:

```js
  static NON_APPROVED = [
    ['utilize', 'use'],
    ['utilise', 'use'],
    ['prior to', 'before'],
    ['subsequent to', 'after'],
    ['in order to', 'to'],
    ['due to', 'because of'],
    ['as well as', 'and'],
    ['via', 'with'],
    ['ensure', 'make sure'],
    ['obtain', 'get'],
    ['commence', 'start'],
    ['terminate', 'stop'],
    ['attempt', 'try'],
    ['assist', 'help'],
    ['provide', 'give'],
    ['approximately', 'about'],
    ['additional', 'more'],
    ['numerous', 'many'],
    ['however', 'but'],
    ['therefore', 'so'],
    ['thus', 'so'],
    ['hence', 'so'],
    ['whilst', 'while'],
    ['regarding', 'about'],
    ['concerning', 'about'],
    ['in terms of', 'for'],
    ['with respect to', 'about'],
    ['with regard to', 'about'],
    ['leverage', 'use'],
    ['facilitate', 'help'],
    ['initiate', 'start'],
    ['finalize', 'finish'],
    ['indicate', 'show'],
    ['require', 'need'],
    ['comprise', 'have'],
    ['in the event that', 'if'],
    ['at this point in time', 'now'],
    ['a number of', 'some'],
    ['the majority of', 'most'],
    ['it should be noted that', 'remove it and say the thing'],
    ['please note', 'remove it and say the thing'],
    ['e.g.', 'for example'],
    ['i.e.', 'that is'],
    ['etc.', 'name the items'],
    ['alternatively', 'or'],
    ['furthermore', 'also'],
    ['moreover', 'also'],
    ['nevertheless', 'but'],
  ]

  static #MATCHERS = PlanLanguage.NON_APPROVED.map(([phrase, replacement]) => ({
    re: PlanLanguage.#matcherFor(phrase),
    phrase,
    replacement,
  }))
```

A single word matches its inflections (`require`, `requires`, `required`, `requiring`); a phrase
matches as it stands, with any run of whitespace between its words, because the paragraph joined
two lines into one. Two private statics do that:

```js
  static #escapeRe(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  static #matcherFor(phrase) {
    const body = PlanLanguage.#escapeRe(phrase).replace(/ /g, '\\s+')
    const inflections = phrase.includes(' ') ? '' : '(?:s|es|d|ed|ing)?'
    return new RegExp(`(?<![\\w-])${body}${inflections}(?![\\w-])`, 'i')
  }
```

`#MATCHERS` is a static field whose initialiser calls a private static method, which works
because private static methods are installed on the class before any static field initialiser
runs. Declare `NON_APPROVED` above `#MATCHERS`, and both above nothing in particular: the methods
may sit anywhere in the body.

And inside the paragraph `for` of `violationsOf`, after the `one-sentence` rule:

```js
      for (const { re, phrase, replacement } of PlanLanguage.#MATCHERS) {
        if (re.test(text)) {
          out.push(`line ${line}: word — "${phrase}" is not an approved word. Write "${replacement}".`)
        }
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/plan-language.test.js`
Expected: PASS — 23 tests.

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/plan-language.js plugin/__tests__/plan-language.test.js
git commit -m "$(cat <<'MSG'
48 words the standard does not approve, each with the word to write instead

One word per meaning is the rule the standard opens with, and the gate
now says which word. The list is a blacklist of 48 entries, not the
standard's dictionary of about 900 approved words: a whitelist would
reject every technical name of the project, and a plan is full of them.

Two kinds of word stay out of it, and this plan says which because the code may not:
a value a contract fixes (`modify` on this list would fail every plan
ever written) and the repository's own ubiquitous language.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The `passive` rule

**Files:**
- Modify: `plugin/scripts/plan-language.js`
- Modify: `plugin/__tests__/plan-language.test.js`

**Interfaces:**
- Produces: `PlanLanguage.IRREGULAR_PARTICIPLES` — a public static `Set` of the participles that `-ed` does not catch.

- [ ] **Step 1: Write the failing test**

Append one describe block to `plugin/__tests__/plan-language.test.js`. Every case here is a
literal sentence, so no scenario is added to `Plan`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/plan-language.test.js`
Expected: FAIL — `PlanLanguage.IRREGULAR_PARTICIPLES` is undefined and the `passive` lists come back empty.

- [ ] **Step 3: Write the implementation**

At most two adverbs may stand between the be-form and the participle, and that guard is the
whole precision of the rule: "it is a written plan" does not fire because `a` is not an adverb and
the chain breaks there. A fourth list carries the words that end in `-ed` and are not participles;
without it "the test is red" fires, and red is what a test is before it is green. Neither fact
reaches the code as a comment: both live in the spec.

In `plugin/scripts/plan-language.js`, after the matchers:

```js
  static #BE_FORMS = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being', 'am'])

  static #ADVERBS = new Set(['not', 'never', 'already', 'also', 'only', 'then', 'now', 'still', 'always'])

  static IRREGULAR_PARTICIPLES = new Set([
    'written', 'built', 'run', 'made', 'done', 'taken', 'given', 'seen', 'known', 'shown',
    'held', 'kept', 'left', 'read', 'sent', 'set', 'put', 'lost', 'found', 'told',
    'said', 'brought', 'bought', 'caught', 'taught', 'thought', 'chosen', 'driven', 'spoken',
    'broken', 'frozen', 'grown', 'drawn', 'thrown', 'torn', 'worn', 'begun', 'become', 'come',
    'gone', 'been', 'had',
  ])

  static #NOT_PARTICIPLES = new Set([
    'red', 'need', 'speed', 'seed', 'feed', 'indeed', 'exceed', 'proceed', 'succeed', 'embed',
    'hundred', 'sacred',
  ])

  static #tokensOf(text) {
    return text.toLowerCase().match(/[a-z']+/g) ?? []
  }

  static #isAdverb(token) {
    return PlanLanguage.#ADVERBS.has(token) || token.endsWith('ly')
  }

  static #isParticiple(token) {
    if (PlanLanguage.#NOT_PARTICIPLES.has(token)) return false
    return PlanLanguage.IRREGULAR_PARTICIPLES.has(token) || (token.endsWith('ed') && token.length > 3)
  }

  static #passiveIn(tokens) {
    const out = []
    tokens.forEach((token, i) => {
      if (!PlanLanguage.#BE_FORMS.has(token)) return
      for (let j = i + 1; j <= i + 3 && j < tokens.length; j++) {
        if (PlanLanguage.#isParticiple(tokens[j])) {
          out.push(`${token} ${tokens[j]}`)
          return
        }
        if (!PlanLanguage.#isAdverb(tokens[j])) return
      }
    })
    return out
  }
```

R1 of the pre-flight scan binds here: the scan goes INSIDE the sentence loop `violationsOf`
already opens for `length`, not in a second loop over the same array. So the sentence loop's body
grows by three lines:

```js
        for (const chain of PlanLanguage.#passiveIn(PlanLanguage.#tokensOf(sentence))) {
          out.push(
            `line ${line}: passive — "${chain}" is passive. Name who does it, and write the sentence active.`,
          )
        }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/plan-language.test.js`
Expected: PASS — 30 tests.

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/plan-language.js plugin/__tests__/plan-language.test.js
git commit -m "$(cat <<'MSG'
The passive voice fires, and the guard keeps "a written plan" out of it

A be-form followed by a past participle, with at most two adverbs
between them. The adverb guard is the whole precision of the rule: "it
is a written plan" does not fire because `a` breaks the chain, and "the
file is not covered" does because `not` crosses it.

Two lists carry what the -ed suffix cannot: the irregular participles it
misses, and the words that end in -ed and are not participles at all.
Without the second one, "the test is red" fires, and red is what a test
is before it is green.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: The `gerund` rule

**Files:**
- Modify: `plugin/scripts/plan-language.js`
- Modify: `plugin/__tests__/plan-language.test.js`

**Interfaces:**
- Produces: `PlanLanguage.ING_EXCEPTIONS` — a public static `Set` of the words that end in `-ing` and are not verb forms.

- [ ] **Step 1: Write the failing test**

Append one describe block to `plugin/__tests__/plan-language.test.js`. Literal sentences again,
so `Plan` gains nothing:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/plan-language.test.js`
Expected: FAIL — `PlanLanguage.ING_EXCEPTIONS` is undefined and the `gerund` lists come back empty.

- [ ] **Step 3: Write the implementation**

Adjacency is what bounds the rule: "of the following" does not fire, because `the` stands between
the preposition and the word. The code says it by testing `tokens[i - 1]` and nothing further, so
no comment is wanted.

In `plugin/scripts/plan-language.js`, after `#passiveIn`:

```js
  static #GERUND_PREPOSITIONS = new Set([
    'by', 'for', 'of', 'after', 'before', 'without', 'when', 'while', 'on', 'in', 'at', 'from', 'with',
  ])

  static ING_EXCEPTIONS = new Set([
    'during', 'string', 'strings', 'nothing', 'something', 'anything', 'everything', 'thing',
    'things', 'according',
  ])

  static #gerundsIn(tokens) {
    const out = []
    tokens.forEach((token, i) => {
      if (!token.endsWith('ing') || PlanLanguage.ING_EXCEPTIONS.has(token)) return
      if (i === 0 || PlanLanguage.#GERUND_PREPOSITIONS.has(tokens[i - 1])) out.push(token)
    })
    return out
  }
```

And inside the same sentence loop, next to the passive scan (R1 again — one loop, not a third):

```js
        for (const gerund of PlanLanguage.#gerundsIn(PlanLanguage.#tokensOf(sentence))) {
          out.push(
            `line ${line}: gerund — "${gerund}" is an -ing form. Write the verb in the simple present, or name the action with a noun.`,
          )
        }
```

Compute `PlanLanguage.#tokensOf(sentence)` once into a local and pass it to both scans: two calls
over the same sentence is the duplication R1 exists to avoid.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/plan-language.test.js`
Expected: PASS — 37 tests.

- [ ] **Step 5: Run the fast subset**

Run: `npx vitest run --exclude '**/*-real-process.test.js'`
Expected: PASS. The module still has no caller.

- [ ] **Step 6: Commit**

```bash
git add plugin/scripts/plan-language.js plugin/__tests__/plan-language.test.js
git commit -m "$(cat <<'MSG'
The -ing form fires in two positions, and adjacency is what bounds it

An -ing word fires when it opens a sentence or when a preposition stands
immediately before it. Adjacency is the whole bound: "of the following"
does not fire, because `the` breaks the pair, and a rule that fired on
every -ing word in the plan would be noise instead of a control.

An exception set carries the words that end in -ing and are not verb
forms, `during` and `string` among them.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: The blockquote marker moves to the standard

**Files:**
- Modify: `plugin/scripts/plan-contract.js:24` (`BLOCKQUOTE_MARKER`)
- Modify: `plugin/skills/writing-plans-prescriptive/plan-template.md:3-9` (the blockquote)
- Modify: every test that carries the old marker — `plugin/__tests__/plan-contract.test.js`, `ct-step-merge-base.test.js`, `dispatch-check-dryrun.test.js`, `dispatch-check-merge-base.test.js`, `dispatch-check-watch-merge.test.js`, `e2e-ct-step.test.js`, `e2e-release-correspondence.test.js`, `f22-slice-state.test.js`, `f38-the-plan-gate-go.test.js`, `fixtures/ct-step-harness.js`

**Interfaces:**
- Produces: the marker string `Task-scoped subagents execute this plan`.

This task changes a constant and every copy of it. No rule is added, so the suite stays green from the first step to the last.

- [ ] **Step 1: Find every copy of the old marker**

Run from the repository root:

```bash
grep -rln "This plan is written to be executed" --include="*.js" --include="*.md" . | grep -v node_modules
```

Expected: the ten files of **Files:** above, plus `plugin/scripts/plan-contract.js`, `plugin/skills/writing-plans-prescriptive/plan-template.md` and the two fixtures `plugin/__tests__/fixtures/plan-real-issue-5*.md`.

**The two `plan-real-issue-5*.md` fixtures do not change.** They are the real plan of repo-pulse's slice #5, read only by `plan-tasks.test.js` through `extractTasks`, which never looks at the marker. They are a historical record and they stay as they were written.

- [ ] **Step 2: Change the constant**

In `plugin/scripts/plan-contract.js`, line 24:

```js
const BLOCKQUOTE_MARKER = 'Task-scoped subagents execute this plan'
```

Today's sentence is passive twice, so no compliant sentence can hold it. The new one is six words and active, and it stays distinctive as an anchor.

- [ ] **Step 3: Rewrite the template's blockquote**

In `plugin/skills/writing-plans-prescriptive/plan-template.md`, replace lines 3 to 9 with:

```markdown
> **Task-scoped subagents execute this plan. They arrive with no context and they decide
> nothing.** Each task carries the current state of what it changes, copied exactly from the
> repo. It also carries the contracts it obeys and the exact commands that verify it. You write
> the bodies, and you write the test first. This document decided the names, the signatures, the
> constants and the test names. If a decision is not clear, follow the issue body and AGENTS.md.
```

- [ ] **Step 4: Rewrite the marker in every test that carries it**

In each of the ten files, the fixture line becomes:

```js
  '> **Task-scoped subagents execute this plan. They arrive with no context.**',
```

- [ ] **Step 5: Run the whole suite**

Run from `plugin/`: `npm test`
Expected: PASS. Nothing measures the sentence yet, so the only thing that could break is a fixture that kept the old marker.

- [ ] **Step 6: Commit**

```bash
git add plugin/scripts/plan-contract.js plugin/skills/writing-plans-prescriptive/plan-template.md plugin/__tests__
git commit -m "$(cat <<'MSG'
The blockquote the plan opens with says who executes it, in the active voice

"This plan is written to be executed by task-scoped subagents" is
passive twice, and it is the one sentence every plan carries verbatim.
No sentence in Simplified Technical English can hold it, so the anchor
itself moves: "Task-scoped subagents execute this plan", six words,
active, and still distinctive enough to locate the header by.

The rest of the blockquote moves with it, and the ten test fixtures that
carry a copy move too. The two plan-real-issue-5 fixtures do not: they
are the real plan of a slice that already happened, nothing reads their
marker, and a historical record is not rewritten.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: The contract calls the rule

**Files:**
- Modify: `plugin/scripts/plan-contract.js` (the import, and the call at the end of `validatePlan`)
- Modify: `plugin/__tests__/plan-contract.test.js` (the wiring test, and the fixture prose that now fires)
- Modify: whatever other test the suite names in Step 4

**Interfaces:**
- Consumes: `PlanLanguage.violationsOf(lines)` from Tasks 1 to 5.
- Produces: violations of rule `ste` out of `validatePlan` and `checkPlans`.

- [ ] **Step 1: Write the failing test**

In `plugin/__tests__/plan-contract.test.js`, add one describe block. `violationsOf` and `planWithTasks` already exist in the file:

```js
describe('the language of the plan', () => {
  it('returns the prose violations under the rule `ste`', () => {
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')
    const plan = planWithTasks([[CONTRACT]], { beforeTasks: [] }).replace('Unit with vitest.', `${long}.`)
    expect(violationsOf(plan, 'ste')).toHaveLength(1)
    expect(violationsOf(plan, 'ste')[0].detail).toContain('length —')
  })

  it('leaves a plan whose prose obeys the standard with no ste violation', () => {
    expect(violationsOf(PLAN_WITH_ROLES, 'ste')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/plan-contract.test.js`
Expected: FAIL — both tests, because no violation carries the rule `ste` yet. After Step 3 the
first one stays red for a second reason, and Step 4 is what closes it: the fixture's own prose
breaks the standard, so the plan carries more than the one violation the test asks for.

- [ ] **Step 3: Wire the module in**

In `plugin/scripts/plan-contract.js`, next to the existing import:

```js
import { PlanLanguage } from './plan-language.js'
```

And at the end of `validatePlan`, right before `return { ok: violations.length === 0, violations }`:

```js
  for (const detail of PlanLanguage.violationsOf(lines)) push('ste', detail)
```

- [ ] **Step 4: Run the whole suite and fix the fixture prose it names**

Run from `plugin/`: `npm test`

Every failure is a fixture whose prose breaks the standard. Fix the prose, never the rule. These four are known:

| File | Today | Write |
|---|---|---|
| `plan-contract.test.js` | `sum() exists and has to be covered.` | `sum() exists and needs a test.` |
| `plan-contract.test.js` | `sum() has to be exposed through the barrel.` | `The barrel does not export sum() yet.` |
| `plan-contract.test.js` | `**Objective:** job ${i + 1} is done.` | `**Objective:** Task ${i + 1} writes its file.` |
| `plan-contract.test.js` | `No code — the configuration is described in prose with the value inline.` | `No code — the prose carries the configuration value inline.` |

For any other failure the suite reports, read the detail: it names the line, the sub-rule and the words. Rewrite that fixture's prose the same way.

- [ ] **Step 5: Run the whole suite again**

Run from `plugin/`: `npm test`
Expected: PASS, with the two new tests of Step 1 green.

- [ ] **Step 6: Commit**

```bash
git add plugin/scripts/plan-contract.js plugin/__tests__
git commit -m "$(cat <<'MSG'
--check-plan refuses a plan whose prose breaks the standard

plan-contract.js calls plan-language.js and pushes what it returns under one
rule name, `ste`, with the sub-rule inside the detail. From here the gate
measures the plan's language the same way it already measured its
structure, its block taxonomy and the literality of its citations: a
check that only prints is not a check.

The fixtures the new rule fires on get their prose fixed, five of them
passive. The rule is not loosened to keep a fixture green.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: The template obeys the rule it teaches

**Files:**
- Modify: `plugin/skills/writing-plans-prescriptive/plan-template.md` (every `{{…}}` guidance line)
- Create: `plugin/__tests__/plan-template-language.test.js`

**Interfaces:**
- Consumes: `annotate` from `plan-contract.js`, `PlanLanguage` from `plan-language.js`.

- [ ] **Step 1: Write the failing test**

Create `plugin/__tests__/plan-template-language.test.js`:

```js
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
```

No comment, and the read hangs off `Template` rather than a loose const: `PLUGIN_ROOT` stays loose
because `plugin/__tests__/role-bytes.test.js` keeps its own that way, and a path is not a
function.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/plan-template-language.test.js`
Expected: FAIL — a list of violations, each naming a line of the template.

- [ ] **Step 3: Rewrite the template's guidance**

Read every violation the test printed and rewrite that line. The rules to apply, in the order they bite:

1. One instruction per sentence, and the condition before the instruction.
2. Active voice: name who does the thing.
3. 20 words in a marker paragraph, 25 elsewhere.
4. No `-ing` form where a simple present says the same.
5. The approved word the message names.

Worked example — the guidance of `**Verification:**` today reads:

> `{{what the commands prove, in prose if it helps — the commands themselves go in the fenced block below, one per line, already run. A program executes that block, so it carries commands and --check-plan rejects a task without one.}}`

and becomes:

> `{{Say what the commands prove. The commands go in the fenced block below, one to a line, and you ran them already. A program executes that block, so it carries commands only, and --check-plan refuses a task with none.}}`

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/plan-template-language.test.js`
Expected: PASS.

- [ ] **Step 5: Verify the template still passes the rest of the contract**

The template is not a plan (it carries `{{…}}` placeholders, which `FORBIDDEN` refuses on purpose), so `validatePlan` is not run on it. Run the whole suite instead:

Run from `plugin/`: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/writing-plans-prescriptive/plan-template.md plugin/__tests__/plan-template-language.test.js
git commit -m "$(cat <<'MSG'
The template the plan is copied from obeys the rule the gate applies

Every guidance line of plan-template.md moves to Simplified Technical
English, and a test keeps it there: PlanLanguage.violationsOf over the
template returns an empty list.

The template is what the author copies, so it is where the rule is
learned. A template that breaks the rule the gate applies teaches the
opposite of the gate, and the author finds out at the gate instead of at
the template.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: The skill says the rule

**Files:**
- Modify: `plugin/skills/writing-plans-prescriptive/SKILL.md`

**Interfaces:**
- Consumes: nothing. This task is documentation.

- [ ] **Step 1: Say that four things are machine-checked, not three**

In `plugin/skills/writing-plans-prescriptive/SKILL.md`, the paragraph that opens with "This skill is the Control Tower port of crear-plan-detallado" reads today:

> Three things are non-negotiable and machine-checked by `plan-contract.js`: the fixed structure, the **literality rule** (every quoted current state exists verbatim in the repo), and the **block taxonomy** below.

It becomes:

> Four things are non-negotiable and machine-checked by `plan-contract.js`: the fixed structure, the **literality rule** (every quoted current state exists verbatim in the repo), the **block taxonomy** below, and the **language** of the prose.

- [ ] **Step 2: Add the new section**

Insert it immediately before `## Structure`, written in the standard it describes:

```markdown
## The plan uses Simplified Technical English

The plan is the whole brief of a subagent that arrives with no context. A long passive sentence
hides who does what, and that is the one thing this reader needs. So the plan's prose follows
ASD-STE100, and `--check-plan` measures it. Six sub-rules fire, all under the rule name `ste`:

| Sub-rule | What fails |
|---|---|
| `length` | A sentence carries more words than its limit |
| `paragraph` | A paragraph carries more than 6 sentences |
| `passive` | A form of `be` stands before a past participle |
| `gerund` | An `-ing` word opens a sentence, or follows a preposition |
| `word` | A word of the non-approved list appears. The message names the replacement |
| `one-sentence` | `**Objective:**` carries more than one sentence |

**Two limits, and position decides which one applies.** A paragraph that starts with a task
marker gets 20 words per sentence, and so does every paragraph of `## 8. Global verification`.
Everywhere else the limit is 25. The marker itself costs nothing: the gate removes it first.

**What the gate never measures.** A code block, whole: your verbatim citations, your contracts
and your commands. A backticked span, a path and a URL all count as one word.

**A test name goes inside backticks.** `**TDD:**` carries a literal name such as
`it('the header is read before the body')`. That name belongs to the test, and inside backticks
the gate leaves it alone. Outside them it fires `passive` for a name you cannot reword.

**Before and after.** *"The analysis is read by the module that was written in Task 3, and its
output is then validated against the fixtures."* (24 words, passive three times) becomes: *"Task
3 writes the module. The module reads the analysis. The fixtures verify its output."*

The four lists live in `scripts/plan-language.js`: the 48 non-approved words with their
replacement, the irregular participles, the words that end in `-ed` and are not participles, and
the words that end in `-ing` and are not verb forms. If the gate refuses a word this repository
needs, add it to the exception, and say so in `## 9. Assumptions`.
```

- [ ] **Step 3: Verify the skill still passes its own suite**

Run from `plugin/`: `npm test`
Expected: PASS. `plugin-yardstick.js` and `prompts-en-positivo.test.js` read the skills, and the new section is English.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/writing-plans-prescriptive/SKILL.md
git commit -m "$(cat <<'MSG'
The skill says the rule the gate measures, in the language it asks for

A new section carries the six sub-rules, the two limits and what the
gate never measures, plus the one thing an author has to do on purpose:
put a test name inside backticks, so the gate leaves alone a name the
author cannot reword.

The section is written in Simplified Technical English, so it shows the
rule instead of describing it. The opening line of the skill now says
four things are machine-checked, not three.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```
