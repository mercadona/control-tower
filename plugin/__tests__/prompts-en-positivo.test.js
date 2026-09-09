// #99 — THE TEXTS AGENTS READ, WRITTEN IN THE POSITIVE.
//
// The `negative-bleedthrough` obstacle (Kassner & Schütze 2020) says that
// naming what is forbidden activates its tokens: a text that enumerates what
// must not be there is teaching the model exactly that. The `point-the-target`
// pattern proposes the opposite — describing the target — and that is what the
// #99 rewrite applied to the nine rules of the task judge, to the three of the
// slice judge, to the kickoff and to the implementer's prompt.
//
// This test is the only thing that pins the result. The rewrite is prose:
// nothing protects it from filling up with negations again round after round,
// because each new negative sentence looks harmless on its own. A per-file
// threshold turns that drift into a test failure the first time it happens.
//
// THE THRESHOLDS ARE THE MEASURED COUNT PLUS A SHORT MARGIN. They are not a
// target («get below 30»): they are a guardrail against the count going up.
// Lowering them when a change leaves the text cleaner is correct; raising them
// demands that whoever does it write down why that negation is MECHANISM and
// not a prohibition aimed at the model — which is the distinction this rewrite
// had to make one by one.
//
// WHAT COUNTS AS A NEGATION, and why nothing else does:
//   - The four words of #99's criterion are counted: `not`, `never`,
//     `cannot`, `no`.
//   - TWO literals that are not prose are discounted: `no-aplica`, which is a
//     member of the `RUBRIC_OUTCOMES` enum that the judge has to write with
//     that exact spelling, and `No TDD`, which is the literal marker of the
//     plan's `**TDD:**` line. Counting them would force a choice between the
//     threshold and the contract.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderKickoff } from '../scripts/kickoff.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

class NegationCount {
  // Contract literals: discounted before counting (see the header).
  static CONTRACT_LITERALS = [/no-aplica/g, /No TDD/g]

  static ENGLISH_WORDS = /\b(not|never|cannot|no)\b/gi

  static SPANISH_WORDS = /\b(no|nunca|jamás|tampoco)\b/gi

  static #withoutLiterals(text) {
    let cleaned = text
    for (const literal of NegationCount.CONTRACT_LITERALS) cleaned = cleaned.replace(literal, ' ')
    return cleaned
  }

  static inEnglish(text) {
    return (NegationCount.#withoutLiterals(text).match(NegationCount.ENGLISH_WORDS) || []).length
  }

  static inSpanish(text) {
    return (NegationCount.#withoutLiterals(text).match(NegationCount.SPANISH_WORDS) || []).length
  }

  static inUppercase(text) {
    return (text.match(/\b(NO|NUNCA|JAMÁS)\b/g) || []).length
  }
}

// The reference slice: one that declares EVERYTHING the kickoff knows how to
// render —signal, e2e runs, type addendum— so that the count measures the
// longest kickoff the dispatcher can end up typing, and not a short version
// that hides the conditional lines.
class ReferenceSlice {
  static withEverythingDeclared() {
    return {
      n: 42,
      name: 'card de resumen',
      ac: ['AC1', 'AC2'],
      type: 'backend',
      senal: 'métrica ct_cards_rendered',
      e2eRuns: ['comprar una cesta'],
      epic: 'epic-1',
    }
  }

  static options() {
    return {
      repo: 'o/r',
      dispatchCheckPath: '/x/dispatch-check.mjs',
      ctStepPath: '/x/ct-step.mjs',
      conventionsDir: '/x/plugin/conventions',
      base: 'main',
    }
  }
}

const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8')

// The thresholds, in a single place, with the count of the day they were
// measured. The «measured» column is documentation: what breaks the test is
// the threshold.
const THRESHOLDS = [
  ['agents/ct-judge.md', ['agents', 'ct-judge.md'], 50], // measured: 40 (before #99: 151)
  ['agents/ct-slice-judge.md', ['agents', 'ct-slice-judge.md'], 40], // measured: 29 (before: 88)
  ['prompts/task-implementer.md', ['prompts', 'task-implementer.md'], 25], // measured: 17 (before: 56)
]

describe("#99 — the judge's and the implementer's texts describe the target", () => {
  it.each(THRESHOLDS)('%s stays below its negation threshold', (_, parts, threshold) => {
    expect(NegationCount.inEnglish(read(...parts))).toBeLessThanOrEqual(threshold)
  })

  // The rewrite deliberately keeps the negations that are MECHANISM, and this
  // test names them so that nobody takes them for drift and deletes them: the
  // field the program writes, and the two items whose vocabulary is closed by
  // the schema.
  it('the negations that are mechanism are still standing', () => {
    const judge = read('agents', 'ct-judge.md')
    expect(judge).toContain('There is no `review_token` for you to write')
    expect(judge).toContain('never `sin-vara`')
    expect(judge).toMatch(/never reports `medium`/)
    expect(read('agents', 'ct-slice-judge.md')).toContain('There is no `review_token` for you to write')
  })
})

describe('#99 — the kickoff is a sequence of what gets done', () => {
  const kickoff = () => renderKickoff(ReferenceSlice.withEverythingDeclared(), ReferenceSlice.options())

  // #99's literal criterion. Uppercase was the emphasis with which the kickoff
  // shouted its prohibitions —«NO mergees», «NO crees worktrees», «NO está en
  // este kickoff»— and it is also what weighs most in the bleedthrough.
  it('no uppercase negation, not even in the gate lines', () => {
    expect(NegationCount.inUppercase(kickoff())).toBe(0)
  })

  it('the whole kickoff stays below its negation threshold', () => {
    // measured: 19 (the longest kickoff, with signal, e2e and the four gates).
    expect(NegationCount.inSpanish(kickoff())).toBeLessThanOrEqual(25)
  })

  // What the kickoff says NOW where it used to forbid: the machine dictates
  // the sequence, and every act has an owner.
  it('ct-step dictates the sequence and every act says whose it is', () => {
    const k = kickoff()
    expect(k).toMatch(/la secuencia de la implementación la dicta la máquina/)
    expect(k).toMatch(/quien comitea es ct-step/)
    expect(k).toMatch(/el merge del PR y el arranque del siguiente slice son de la sesión coordinadora/)
  })
})
