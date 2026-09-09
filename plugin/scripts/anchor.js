// Heading anchors exactly as GitHub generates them (F10).
//
// Why this file exists: until F10, the link to the spec that /ct-groom writes
// in the body of EVERY issue used as its anchor the section NUMBER that
// arrived through `--section` ("spec.md#9"). That anchor does not exist: the
// spec's real heading is "## 9. Slices" and the id GitHub generates for it is
// "9-slices". Verified against the REAL renderer, not deduced —
// `gh api repos/<o>/<r>/contents/<path> -H "Accept: application/vnd.github.html"`
// over a test file pushed to josemerca/ct-loop-sandbox returns
// `id="user-content-9-slices"` for that heading.
//
// Everything in here comes out of that same verification run (three test
// files, ~50 headings). Every rule carries its observed case beside it; not
// one of them is deduced from GitHub's documentation.
import { normalizeToLF } from './gh-issue-map.js'

// SLUG_DROP_RE: which characters do NOT survive the slug. Observed, one by one:
//   "a+b" -> "ab"      (+ out)            "a=b" -> "ab"   (= out)
//   "a~b" -> "ab"      (~ out)            "a·b" -> "ab"   (· out)
//   "a°b" -> "ab"      (° out)            "100%" -> "100" (% out)
//   "v1.2.3" -> "v123" (. out)            "$var" -> "var" ($ out)
//   "a's b" -> "as-b"  (' out)            "Slices §9" -> "slices-9"
//   "9 – Slices"/"9 — Slices" -> "9--slices" (en/em dash out, the space on
//     each side DOES leave its hyphen: that is why two come out)
//   "Emoji 🚀 en cabecera" -> "emoji--en-cabecera" (emoji out)
//   "9.&nbsp;Slices" -> "9slices" (U+00A0 out: it does NOT count as a space)
//   "a\tb" -> "ab" (tab out: it does not count as a space either)
// And what DOES survive:
//   unicode letters and digits of any alphabet — "日本語 セクション" ->
//     "日本語-セクション", "Sección с кириллицей" -> "sección-с-кириллицей",
//     "ñ Ñ Ü" -> "ñ-ñ-ü", "ªb" -> "ªb" (U+00AA is a letter, category Lo)
//   combining marks — a text in NFD ("e" + U+0301) keeps the U+0301 in the
//     id (checked byte by byte in the HTML GitHub returned), so this slug
//     does NOT normalise to NFC: doing so would produce an anchor different
//     from the document's own when the document is in NFD.
//   the underscore — "a_b c" -> "a_b-c"
//   the hyphen — "-leading hyphen" -> "-leading-hyphen",
//     "trailing hyphen -" -> "trailing-hyphen--"
//   the space, which becomes a hyphen (see SPACE_RE) — and is NOT collapsed:
//     "Sección con  dobles   espacios" -> "sección-con--dobles---espacios".
const SLUG_DROP_RE = /[^\p{L}\p{N}\p{M}_\- ]/gu
// SPACE_RE: only U+0020. Neither tab nor NBSP (both observed as "a character
// that falls out", not as a separator) — hence a literal and not `\s`.
const SPACE_RE = / /g

// githubSlug: text ALREADY rendered (with no inline markup) -> GitHub anchor.
// Returns '' when nothing is left — not a theoretical case: a heading
// "## ..." produces `id=""` and `href="#"` in GitHub, that is, NO usable
// anchor at all (observed). The caller has to treat '' as "this heading
// cannot be linked to", and never emit a bare "#".
export function githubSlug(renderedText) {
  return (renderedText || '').toLowerCase().replace(SLUG_DROP_RE, '').replace(SPACE_RE, '-')
}

// ---------------------------------------------------------------------------
// From inline markup to rendered text.
//
// The slug above works on the TEXT that GitHub ends up painting inside the
// <h2>, not on the raw markdown line. Most inline markup falls out by itself
// (asterisks, tildes and backticks do not survive SLUG_DROP_RE, so "`parseo`"
// already gives "parseo" without doing anything). Only four constructs change
// the RESULT if they are not handled — and all four are verified against
// GitHub:
//   1. images: "![img](url) alt heading" -> "-alt-heading". The alt does NOT
//      go in (an <img> contributes no text); without handling them, the slug
//      would swallow the whole URL.
//   2. links: "[link](https://example.com) heading" -> "link-heading" — the
//      text stays, the destination goes.
//   3. raw HTML: "<b>html</b> heading" -> "html-heading"; "a<br>b" ->
//      "ab" (the tag disappears WITHOUT leaving a space).
//   4. entities: "a &amp; b" -> "a--b" (the entity resolves to "&", which
//      then falls out, leaving the two spaces -> two hyphens).
// And a fifth one, the emphasis underscore, because `_` is one of the few
// punctuation characters that DOES survive the slug: "__x__" has to give
// "x", not "__x__".
// ---------------------------------------------------------------------------

// A code span is processed SEPARATELY and its content is protected from the
// rest of the transformations (CommonMark: inside a code span there are no
// links, no HTML and no entities). Without that protection, "`<b>`" would
// lose its "b" going through the sweep of HTML tags.
const CODE_SPAN_RE = /(`+)([\s\S]*?)\1/g
// PLACEHOLDER_OPEN/CLOSE: substitution markers for the content of the code
// spans while the rest of the transformations are applied. NUL and SOH
// cannot appear in a real markdown heading, and even if they did the slug
// would drop them anyway: no collision with the author's text is possible.
const PLACEHOLDER_OPEN = '\u0000'
const PLACEHOLDER_CLOSE = '\u0001'

const IMAGE_RE = /!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/g
const LINK_RE = /\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/g
const HTML_TAG_RE = /<\/?[A-Za-z][^>]*>|<!--[\s\S]*?-->/g
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const ENTITY_RE = /&(#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g
// UNDERSCORE_EMPHASIS_RE: `_x_` / `__x__` where the delimiters are NOT
// inside a word — CommonMark's "intraword" restriction for the underscore is
// exactly what keeps "__init__.py" literal while "__bold__" is emphasis. It
// is the same distinction cells.js#PAIRED_UNDERSCORE_RE makes for the label
// tokens, for the same reason (`_layout.tsx`, `__init__.py` are ordinary
// file names).
const UNDERSCORE_EMPHASIS_RE = /(^|[^\p{L}\p{N}_])(_{1,3})(?!\s)([\s\S]+?)(?<!\s)\2(?![\p{L}\p{N}_])/gu

function decodeEntity(_match, body) {
  if (body[0] === '#') {
    const code = body[1] === 'x' || body[1] === 'X'
      ? parseInt(body.slice(2), 16)
      : parseInt(body.slice(1), 10)
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return _match
    try { return String.fromCodePoint(code) } catch { return _match }
  }
  const named = NAMED_ENTITIES[body]
  return named === undefined ? _match : named
}

// inlineText: content line of a heading (inline markdown) -> the text that
// GitHub paints inside the <h2>.
export function inlineText(md) {
  const src = md || ''
  // 1. code spans out of the reach of the rest (restored at the end).
  const codes = []
  let out = src.replace(CODE_SPAN_RE, (_m, _ticks, body) => {
    codes.push(body.trim())
    return `${PLACEHOLDER_OPEN}${codes.length - 1}${PLACEHOLDER_CLOSE}`
  })
  // 2. images BEFORE links: "![a](b)" also matches LINK_RE if it is done the
  //    other way round, and would leave a stray "!" with the alt inside.
  out = out.replace(IMAGE_RE, '')
  // 3. links: the text stays. Two passes for links nested one level deep
  //    (e.g. a link whose text already came from another substitution).
  out = out.replace(LINK_RE, '$1').replace(LINK_RE, '$1')
  // 4. raw HTML (tags and comments) out, without leaving a gap.
  out = out.replace(HTML_TAG_RE, '')
  // 5. entities resolved to their character.
  out = out.replace(ENTITY_RE, decodeEntity)
  // 6. underscore emphasis (the other emphasis markers do not survive the
  //    slug, so there is no need to touch them).
  out = out.replace(UNDERSCORE_EMPHASIS_RE, '$1$3').replace(UNDERSCORE_EMPHASIS_RE, '$1$3')
  // 7. code spans back.
  out = out.replace(new RegExp(`${PLACEHOLDER_OPEN}(\\d+)${PLACEHOLDER_CLOSE}`, 'g'), (_m, i) => codes[Number(i)])
  return out
}

// ---------------------------------------------------------------------------
// Locating the headings in the document.
// ---------------------------------------------------------------------------

// ATX_RE: CommonMark. Up to 3 spaces of indentation ("   ## Indentada tres
// espacios" -> "indentada-tres-espacios", observed), 1-6 hashes, and either
// end of line or at least one space/tab before the content ("##foo" is NOT a
// heading). Trailing spaces fall out ("## Con trailing espacios   " ->
// "con-trailing-espacios", observed).
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/
// ATX_CLOSING_RE: the optional closing sequence ("## 9. Slices ##" ->
// "9-slices", observed — the trailing "##" does not go into the anchor).
const ATX_CLOSING_RE = /(?:^|[ \t])#+$/
// SETEXT_UNDERLINE_RE: the underline of a setext heading. NOT theoretical:
// "Setext nueve. Slices" underlined with hyphens produced
// `id="user-content-setext-nueve-slices"` in that same test file. A spec
// written that way, without this case, would make the search for "the heading
// that sits above the table" skip the real heading and take the PREVIOUS one
// — a valid anchor pointing at the wrong place, which is exactly the failure
// mode F10 comes to eliminate.
const SETEXT_UNDERLINE_RE = /^ {0,3}(?:=+|-+)[ \t]*$/
// A line that CANNOT be the text of a setext heading: blank, already an ATX
// heading, another underline, or opening a block with a meaning of its own
// (quote, table, list item). Conservative on purpose: a false positive here
// shifts the duplicate counter of the WHOLE document (see dedupe further
// down).
const NOT_SETEXT_TEXT_RE = /^\s*$|^ {0,3}#{1,6}([ \t]|$)|^\s*[|>]|^ {0,3}([-*+]|\d+[.)])[ \t]/

const FENCE_DELIM_RE = /^ {0,3}(`{3,}|~{3,})/

// stripFrontMatter: returns the index of the first line of CONTENT. A YAML
// front matter block ("---" on line 0, up to the closing "---"/"...") is not
// markdown: GitHub paints it as metadata, not as body. Without skipping it,
// its closing "---" line would look like the setext underline of the last
// line of the YAML and would be counted as a heading that does not exist.
function frontMatterEnd(lines) {
  if (lines[0] !== '---') return 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '...') return i + 1
  }
  return 0 // no closing: it was not front matter, nothing is skipped
}

// documentHeadings: ALL the visible headings of the document, in order, with
// the anchor GitHub would assign them — collision suffix included.
//
// The suffix is NOT a detail: observed inside one same document, "## 9.
// Slices", "### 9. Slices" and "#### 9. Slices" produce "9-slices",
// "9-slices-1" and "9-slices-2". The counter belongs to the DOCUMENT and is
// shared by every level, so there is no way to know the anchor of "section
// §9" without walking the whole document from the beginning. Also observed:
// a heading inside a code fence, or inside an HTML comment, generates NO
// anchor NOR consumes a collision number — which is why this scanner drags
// along the same fence/comment state the scanner of issue bodies uses
// (gh-issue-map.js#stepLine).
//
// Returns [{ line, text, anchor }] — `anchor` is '' when the heading has no
// usable anchor (see githubSlug).
export function documentHeadings(specMd) {
  const lines = normalizeToLF(specMd || '').split('\n')
  const start = frontMatterEnd(lines)
  const headings = []
  const seen = new Map()
  let inFence = false
  let fenceChar = null
  let fenceLen = 0
  let inComment = false
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    if (inComment) {
      if (line.includes('-->')) inComment = false
      continue
    }
    const fenceMatch = FENCE_DELIM_RE.exec(line)
    if (inFence) {
      if (fenceMatch && fenceMatch[1][0] === fenceChar && fenceMatch[1].length >= fenceLen &&
          /^\s*$/.test(line.slice(fenceMatch.index + fenceMatch[0].length))) {
        inFence = false; fenceChar = null; fenceLen = 0
      }
      continue
    }
    if (fenceMatch) {
      inFence = true; fenceChar = fenceMatch[1][0]; fenceLen = fenceMatch[1].length
      continue
    }
    const openIdx = line.indexOf('<!--')
    if (openIdx !== -1 && line.indexOf('-->', openIdx + 4) === -1) { inComment = true; continue }

    let headingLine = -1
    let raw = null
    const atx = ATX_RE.exec(line)
    if (atx) {
      headingLine = i
      raw = (atx[2] || '').replace(ATX_CLOSING_RE, '').trim()
    } else if (SETEXT_UNDERLINE_RE.test(line) && i > start) {
      const prev = lines[i - 1]
      if (!NOT_SETEXT_TEXT_RE.test(prev) && !FENCE_DELIM_RE.test(prev) && !SETEXT_UNDERLINE_RE.test(prev)) {
        headingLine = i - 1
        raw = prev.trim()
      }
    }
    if (headingLine === -1) continue

    // MIND the trim: the trimming is done on the RAW markdown (above, when
    // extracting the content of the ATX/setext heading), NEVER on the already
    // rendered text. Verified against GitHub: "## ![img](url) alt heading"
    // produces `id="-alt-heading"` — with a leading hyphen — because the
    // image contributes no text and the space it leaves in front DOES count
    // for the slug. The first version of this function did `.trim()` here and
    // was the only one of the ~50 headings of the verification run that came
    // out different ("alt-heading" instead of "-alt-heading"): a non-existent
    // anchor, that is, the same defect F10 fixes, reintroduced by one trim
    // too many.
    const rendered = inlineText(raw)
    const base = githubSlug(rendered)
    const text = rendered.trim()
    let anchor = base
    if (base) {
      const n = seen.get(base) || 0
      seen.set(base, n + 1)
      if (n > 0) anchor = `${base}-${n}`
    }
    headings.push({ line: headingLine, text, anchor })
  }
  return headings
}

// headingAbove: the heading under which the line `lineIndex` lives — or null
// if that line sits above every heading of the document. It is what turns
// "the §9 table is on line 42" into "that table lives under `## 9. Slices`,
// whose anchor is `9-slices`".
export function headingAbove(specMd, lineIndex) {
  const headings = documentHeadings(specMd)
  let found = null
  for (const h of headings) {
    if (h.line < lineIndex) found = h
    else break
  }
  return found
}
