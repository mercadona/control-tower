export class PlanLanguage {
  static PROCEDURAL_WORDS = 20
  static DESCRIPTIVE_WORDS = 25
  static PARAGRAPH_SENTENCES = 6

  static #HEADING = /^#{1,6} /
  static #ROLE_LABEL = /^(?:Current state|Contract|Call site|Final text) \(/
  static #TABLE_SEPARATOR = /^\|[\s:|-]+\|$/
  static #TASK_MARKERS = ['**Objective:**', '**Files:**', '**TDD:**', '**Tests:**', '**Verification:**']
  static #SECTION_8 = '## 8. Global verification'
  static #SECTION_9 = '## 9. Assumptions'

  static #PREFIX = /^\s*(?:>\s?)?(?:(?:[-*+]|\d+\.)\s+)?/
  static #LINK = /\[([^\]]*)\]\([^)]*\)/g
  static #CODE_SPAN = /`[^`]*`/g
  static #OPAQUE = /\S*(?:\/|https?:)\S*/g
  static #EMPHASIS = /\*\*|\*|_/g
  static #SENTENCE_END = /(?<=[.!?])\s+/

  static violationsOf(lines) {
    const out = []
    const indexOf = (needle) => lines.findIndex((l) => l.structural && l.line.startsWith(needle))
    const opens8 = indexOf(PlanLanguage.#SECTION_8)
    const opens9 = indexOf(PlanLanguage.#SECTION_9)

    for (const paragraph of PlanLanguage.#paragraphsOf(lines)) {
      const marker = PlanLanguage.#markerOf(paragraph)
      const inSection8 = opens8 !== -1 && paragraph.at > opens8 && (opens9 === -1 || paragraph.at < opens9)
      const limit = marker || inSection8 ? PlanLanguage.PROCEDURAL_WORDS : PlanLanguage.DESCRIPTIVE_WORDS
      const text = PlanLanguage.#normalise(PlanLanguage.#withoutMarker(paragraph, marker))
      const sentences = paragraph.row ? PlanLanguage.#cellsOf(text) : PlanLanguage.#sentencesOf(text)
      const line = paragraph.at + 1

      for (const sentence of sentences) {
        const count = PlanLanguage.#wordsOf(sentence).length
        if (count > limit) {
          out.push(
            `line ${line}: length — the sentence "${PlanLanguage.#shorten(sentence)}" carries ${count} words and the limit here is ${limit}. Split it.`,
          )
        }
      }
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
    }
    return out
  }

  static #paragraphsOf(lines) {
    const out = []
    let run = null
    const flush = () => {
      if (run) out.push(run)
      run = null
    }
    lines.forEach((l, i) => {
      if (!l.structural) return flush()
      const text = l.line
      const isBreak =
        !text.trim() ||
        PlanLanguage.#HEADING.test(text) ||
        PlanLanguage.#ROLE_LABEL.test(text) ||
        PlanLanguage.#TABLE_SEPARATOR.test(text)
      if (isBreak) return flush()
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

  static #normalise(textLines) {
    return PlanLanguage.#gluePunctuationBack(
      textLines
        .map((line) => line.replace(PlanLanguage.#PREFIX, ''))
        .join(' ')
        .replace(PlanLanguage.#LINK, '$1')
        .replace(PlanLanguage.#CODE_SPAN, ' CODE ')
        .replace(PlanLanguage.#OPAQUE, PlanLanguage.#pathToOneToken)
        .replace(PlanLanguage.#EMPHASIS, ''),
    ).trim()
  }

  static #pathToOneToken(match) {
    const tail = match.match(/[.,;:!?]+$/)
    return ` CODE${tail ? tail[0] : ''} `
  }

  static #gluePunctuationBack(text) {
    return text.replace(/\s+([.,;:!?])/g, '$1')
  }

  static #markerOf(paragraph) {
    return PlanLanguage.#TASK_MARKERS.find((m) => paragraph.lines[0].startsWith(m)) ?? null
  }

  static #withoutMarker(paragraph, marker) {
    return marker ? [paragraph.lines[0].slice(marker.length), ...paragraph.lines.slice(1)] : paragraph.lines
  }

  static #cellsOf(text) {
    return text.split('|').map((cell) => cell.trim()).filter(Boolean)
  }

  static #sentencesOf(text) {
    return text.split(PlanLanguage.#SENTENCE_END).map((s) => s.trim()).filter(Boolean)
  }

  static #wordsOf(sentence) {
    return sentence.split(/\s+/).filter(Boolean)
  }

  static #shorten(sentence) {
    return sentence.length <= 60 ? sentence : `${sentence.slice(0, 57)}...`
  }
}
