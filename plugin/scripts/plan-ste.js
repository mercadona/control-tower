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
