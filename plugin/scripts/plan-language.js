export class PlanLanguage {
  static PROCEDURAL_WORDS = 20
  static DESCRIPTIVE_WORDS = 25
  static PARAGRAPH_SENTENCES = 6

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
        const tokens = PlanLanguage.#tokensOf(sentence)
        for (const chain of PlanLanguage.#passiveIn(tokens)) {
          out.push(
            `line ${line}: passive — "${chain}" is passive. Name who does it, and write the sentence active.`,
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
      for (const { re, phrase, replacement } of PlanLanguage.#MATCHERS) {
        if (re.test(text)) {
          out.push(`line ${line}: word — "${phrase}" is not an approved word. Write "${replacement}".`)
        }
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

  static #shorten(sentence) {
    return sentence.length <= 60 ? sentence : `${sentence.slice(0, 57)}...`
  }

  static #escapeRe(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  static #matcherFor(phrase) {
    const body = PlanLanguage.#escapeRe(phrase).replace(/ /g, '\\s+')
    const inflections = phrase.includes(' ') ? '' : '(?:s|es|d|ed|ing)?'
    return new RegExp(`(?<![\\w-])${body}${inflections}(?![\\w-])`, 'i')
  }
}
