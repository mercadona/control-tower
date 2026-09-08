import { describe, it, expect } from 'vitest'
import { githubSlug, inlineText, documentHeadings, headingAbove } from '../scripts/anchor.js'
import { analyzeSlicesTable } from '../scripts/slices.js'

// Every pair in this file comes out of a verification run against GitHub's
// REAL renderer, not out of reading its documentation: three markdown files
// pushed to josemerca/ct-loop-sandbox and fetched back with
// `gh api repos/<o>/<r>/contents/<path> -H "Accept: application/vnd.github.html"`,
// which returns the HTML exactly as GitHub paints it, with the
// `<a id="user-content-<slug>" class="anchor">` of every heading. The ~50
// headings of that run match today, one by one, what scripts/anchor.js
// produces.
//
// They are kept as literal pairs ON PURPOSE: if tomorrow somebody
// "simplifies" the slug, what fails is the comparison against what GitHub
// really did, not against another implementation of our own.

describe('githubSlug — the anchor GitHub generates for the text of a heading (pairs observed against the real renderer)', () => {
  const OBSERVED = [
    // the case that F10 comes from: the link said "#9", the real anchor is another
    ['9. Slices', '9-slices'],
    ['10. Riesgos & Mitigaciones', '10-riesgos--mitigaciones'],
    ['Desglose en slices (§9) — tabla', 'desglose-en-slices-9--tabla'],
    ['Slices: parseo + validación', 'slices-parseo--validación'],
    ['¿Qué entrega? Diseño técnico', 'qué-entrega-diseño-técnico'],
    ['9.1. Sub-slices / detalle', '91-sub-slices--detalle'],
    ['Ámbito, límites y "excepciones"', 'ámbito-límites-y-excepciones'],
    // the space is NOT collapsed: each one leaves its own hyphen
    ['Sección con  dobles   espacios', 'sección-con--dobles---espacios'],
    // out: emoji, symbols, punctuation
    ['Emoji 🚀 en cabecera', 'emoji--en-cabecera'],
    ['a+b', 'ab'], ['a=b', 'ab'], ['a~b', 'ab'], ['a·b', 'ab'], ['a°b', 'ab'],
    ['100%', '100'], ['v1.2.3', 'v123'], ["a's b", 'as-b'], ['$var', 'var'],
    ['9 – Slices', '9--slices'], ['9 — Slices', '9--slices'],
    // in: underscore, hyphen (even leading or trailing), letters and digits
    // of any alphabet, and the ª (which is a letter, not a symbol)
    ['a_b c', 'a_b-c'],
    ['-leading hyphen', '-leading-hyphen'],
    ['trailing hyphen -', 'trailing-hyphen--'],
    ['日本語 セクション', '日本語-セクション'],
    ['Sección с кириллицей', 'sección-с-кириллицей'],
    ['ñ Ñ Ü', 'ñ-ñ-ü'],
    ['ªb', 'ªb'],
    // neither the tab nor the NBSP counts as a space: they fall out whole
    ['a\tb', 'ab'],
    ['9. Slices', '9slices'],
  ]
  for (const [text, anchor] of OBSERVED) {
    it(`${JSON.stringify(text)} → ${JSON.stringify(anchor)}`, () => {
      expect(githubSlug(text)).toBe(anchor)
    })
  }

  // The case that forces "no anchor" to be a first-class result: GitHub
  // emitted `id=""` and `href="#"` for "## ...". Emitting a bare "#" in a link
  // would be exactly the broken link F10 fixes, wearing another face.
  it('a heading with no surviving character at all ("...") → empty string, NEVER "#"', () => {
    expect(githubSlug('...')).toBe('')
    expect(githubSlug('')).toBe('')
    expect(githubSlug(null)).toBe('')
  })

  // A text in NFD (macOS produces one easily) keeps its combining mark in
  // GitHub's id — checked byte by byte in the real HTML. Normalising to NFC
  // here would produce an anchor that is not in the document.
  it('text in NFD keeps the combining mark (the id GitHub emits keeps it too)', () => {
    const nfd = 'Śeccion'.normalize('NFD')
    expect(githubSlug(nfd)).toContain('́')
    expect(githubSlug(nfd)).toBe(nfd.toLowerCase())
  })
})

describe('inlineText — the text GitHub paints inside the <h2>, not the raw markdown', () => {
  it('link: the text stays, the destination goes (observed: "link-heading")', () => {
    expect(githubSlug(inlineText('[link](https://example.com) heading'))).toBe('link-heading')
  })
  it('image: it contributes NOTHING, not even the alt — and the space it leaves in front does count (observed: "-alt-heading")', () => {
    expect(githubSlug(inlineText('![img](https://example.com/a.png) alt heading'))).toBe('-alt-heading')
  })
  it('raw HTML: the tag disappears without leaving a gap (observed: "html-heading", "ab")', () => {
    expect(githubSlug(inlineText('<b>html</b> heading'))).toBe('html-heading')
    expect(githubSlug(inlineText('a<br>b'))).toBe('ab')
  })
  it('entity: it resolves to the character, which can then fall out (observed: "a--b")', () => {
    expect(githubSlug(inlineText('a &amp; b'))).toBe('a--b')
  })
  it('code span: the content is kept and the backticks fall out (observed: "slices-parseo--validación")', () => {
    expect(githubSlug(inlineText('Slices: `parseo` + validación'))).toBe('slices-parseo--validación')
  })
  it('a code span protects its content from the HTML sweep (a tag quoted as code is not erased)', () => {
    expect(githubSlug(inlineText('etiqueta `<br>` citada'))).toBe('etiqueta-br-citada')
  })
  it('bold/italics with asterisks (observed: "bold-heading")', () => {
    expect(githubSlug(inlineText('**bold** heading'))).toBe('bold-heading')
  })
  // The underscore is the only emphasis marker that SURVIVES the slug, so it
  // is the only one that really has to be resolved — and it has to be resolved
  // without breaking the file names that begin or end with an underscore, the
  // same care slices.js takes with the label tokens.
  it('a paired emphasis underscore → out', () => {
    expect(githubSlug(inlineText('__negrita__ y _cursiva_'))).toBe('negrita-y-cursiva')
  })
  // MIND THIS: it was an assumption of mine, and GitHub contradicted it. I
  // took for granted that "__init__.py" was kept whole (it is what
  // cells.js#PAIRED_UNDERSCORE_RE does with the label tokens, and for good
  // reasons). The real HTML says otherwise: "__init__.py y _layout.tsx"
  // produces `id="initpy-y-_layouttsx"` — the "__init__" IS strong emphasis
  // for CommonMark (the closing "__" is followed by a full stop, which is
  // punctuation, so it can close), while the "_" of "_layout.tsx", with no
  // pair, stays. The pair is left exactly as GitHub observed it, not as I
  // expected it to be.
  it('underscore: "__init__" IS emphasis (observed), an unpaired "_layout.tsx" is kept', () => {
    expect(githubSlug(inlineText('__init__.py y _layout.tsx'))).toBe('initpy-y-_layouttsx')
  })
})

describe('documentHeadings — order, collision suffix, and what is NOT a heading', () => {
  it('the collision counter belongs to the DOCUMENT and is shared by every level (observed: 9-slices, -1, -2)', () => {
    const md = '## 9. Slices\n\n### 9. Slices\n\n#### 9. Slices\n'
    expect(documentHeadings(md).map((h) => h.anchor)).toEqual(['9-slices', '9-slices-1', '9-slices-2'])
  })
  it('a heading inside a code fence generates NO anchor NOR consumes a collision number (observed)', () => {
    const md = '## 9. Slices\n\n```\n## 9. Slices\n```\n\n## 9. Slices\n'
    expect(documentHeadings(md).map((h) => h.anchor)).toEqual(['9-slices', '9-slices-1'])
  })
  it('a heading inside a multi-line HTML comment, the same (observed)', () => {
    const md = '## 9. Slices\n\n<!--\n## 9. Slices\n-->\n\n## 9. Slices\n'
    expect(documentHeadings(md).map((h) => h.anchor)).toEqual(['9-slices', '9-slices-1'])
  })
  it('a setext heading (underlined) also generates an anchor (observed: "setext-nueve-slices")', () => {
    const md = 'Setext nueve. Slices\n--------------------\n'
    expect(documentHeadings(md)).toEqual([{ line: 0, text: 'Setext nueve. Slices', anchor: 'setext-nueve-slices' }])
  })
  it('an indentation of up to 3 spaces is still a heading; "##foo" with no space is NOT', () => {
    expect(documentHeadings('   ## Indentada tres espacios\n').map((h) => h.anchor)).toEqual(['indentada-tres-espacios'])
    expect(documentHeadings('##foo\n')).toEqual([])
  })
  it('the closing sequence of an ATX heading does not go into the anchor (observed: "## 9. Slices ##" → "9-slices")', () => {
    expect(documentHeadings('## 9. Slices ##\n').map((h) => h.anchor)).toEqual(['9-slices'])
  })
  // YAML front matter is not markdown: GitHub paints it as metadata. Its
  // closing "---", if it were counted as a setext underline, would invent a
  // heading and would shift the collision counter of the WHOLE document — a
  // valid anchor pointing at the wrong place.
  it('YAML front matter produces no phantom headings', () => {
    const md = '---\ntitle: Plan\n---\n\n## 9. Slices\n'
    expect(documentHeadings(md).map((h) => h.anchor)).toEqual(['9-slices'])
  })
  it('a "---" that does NOT close front matter (with no opening on line 0) is still an ordinary setext underline', () => {
    const md = 'Intro\n\nNueve\n-----\n'
    expect(documentHeadings(md).map((h) => h.anchor)).toEqual(['nueve'])
  })
  it('a table separator row ("|---|---|") is not a setext underline', () => {
    const md = '## 9. Slices\n\n| # | Slice |\n|---|---|\n| 1 | x |\n'
    expect(documentHeadings(md).map((h) => h.anchor)).toEqual(['9-slices'])
  })
})

describe('headingAbove — which heading a given line lives under', () => {
  const MD = [
    '# Plan',            // 0
    '',                  // 1
    '## 8. Contexto',    // 2
    '',                  // 3
    '## 9. Slices',      // 4
    '',                  // 5
    '| # | Slice |',     // 6
  ].join('\n')
  it('it returns the immediately preceding heading, not the first one of the document', () => {
    expect(headingAbove(MD, 6)).toEqual({ line: 4, text: '9. Slices', anchor: '9-slices' })
  })
  it('a line above every heading → null', () => {
    expect(headingAbove('| # | Slice |\n## 9. Slices\n', 0)).toBeNull()
  })
})

describe('analyzeSlicesTable — the report carries the real heading the §9 table lives under (F10)', () => {
  // The parser ALWAYS located the table by its column header, never by a
  // section number. What it was missing was knowing which heading it sat
  // under — the only way to build an anchor that exists.
  const SPEC = [
    '# Plan actual vs propuestas',
    '',
    '## 8. Contexto',
    '',
    'Texto.',
    '',
    '## 9. Slices',
    '',
    '| # | Slice | Dep |',
    '|---|---|---|',
    '| 1 | login | – |',
    '',
    '## 10. Riesgos',
  ].join('\n')

  it('it finds "9. Slices" and its real anchor "9-slices" (not "9")', () => {
    expect(analyzeSlicesTable(SPEC).sectionHeading).toEqual({ line: 6, text: '9. Slices', anchor: '9-slices' })
  })
  it('the heading does NOT have to be called "9" nor be the ninth: the table is located by its column header', () => {
    const other = SPEC.replace('## 9. Slices', '## Desglose en slices')
    expect(analyzeSlicesTable(other).sectionHeading.anchor).toBe('desglose-en-slices')
  })
  it('a table with no heading above it at all → sectionHeading null (no anchor is invented)', () => {
    const withoutHeading = '| # | Slice | Dep |\n|---|---|---|\n| 1 | login | – |\n'
    expect(analyzeSlicesTable(withoutHeading).sectionHeading).toBeNull()
  })
  it('a heading with no usable anchor ("## ...") → anchor is the empty string, never "#"', () => {
    const odd = SPEC.replace('## 9. Slices', '## ...')
    expect(analyzeSlicesTable(odd).sectionHeading).toEqual({ line: 6, text: '...', anchor: '' })
  })
  it('with no §9 table there is no heading to report', () => {
    expect(analyzeSlicesTable('# Solo prosa\n\nnada.').sectionHeading).toBeNull()
  })
})
