// cells.js — the CELL primitives of the §9 table ("Desglose en slices"),
// separated from the full parser (slices.js). It exists as a file of its own
// so that gates.js can split a cell (splitEscapedCommas) and recognise a "no
// value" marker (NO_VALUE_MARKERS/isNoValueCell) WITHOUT importing slices.js
// — the whole parser, which kickoff.js does not depend on today and must not
// start depending on (kickoff.js imports gates.js). That is why this module
// imports nothing: any import here would be exactly what gates.js needs not
// to drag along.
//
// isNoValueCell drags along with it cleanEmphasis/stripPairedUnderscore/their
// two regexes: they are its implementation, not separate primitives, and they
// cannot be separated from the function that uses them. stripPairedUnderscore
// is re-exported because slices.js also uses it on its own (Área/Toca),
// outside isNoValueCell.

// NO_VALUE_MARKERS: cell values that mean "empty"/"no value" — hyphen (-),
// en dash (–, U+2013) and em dash (—, U+2014) are reasonable typographic
// variants of the same intention that a text editor (Word, Notion, a phone
// with autocorrect…) can substitute without the author noticing. CRITICAL
// from the F1 review: the REAL table that gave rise to this feature
// DELIBERATELY uses an em dash in row S1 for "no dependencies" — recognising
// only "–"/"-" means that fixing the "#" column (as our own error message
// asks) makes that same cell, which always correctly meant "no dependencies",
// fire the "Dep malformado" abort, asking the author to write "#N" for a cell
// that needs no reference at all. A single criterion of "empty", shared
// between Dep/Acepta/Área/Toca (each field used to repeat its own comparison
// `!== '–' && !== '-'`, with the same gap four times over). An NBSP around the
// character (e.g. copied from an editor that inserts it automatically) is
// already removed natively by `String#trim()` — verified
// (`' — '.trim() === '—'`) — so it does not need separate handling here.
export const NO_VALUE_MARKERS = new Set(['-', '–', '—', '―', '−', '--'])
// isNoValueCell runs `cleanEmphasis` BEFORE comparing (review round 2, point
// c): wrapping the marker in inline markup ("`–`", "**–**") is the SAME shape
// as the em dash CRITICAL — an author who has already been shown to wrap
// values in bold/backticks (F1: "**S1**") wraps the "nothing" marker just as
// easily. Without this strip, `isNoValueCell` compared the raw cell against
// the Set and "`–`"/"**–**" matched nothing, so the author got "si no hay
// dependencias, escribe –" for having written exactly that, only wrapped. The
// set itself is widened too: the mathematical minus sign (−, U+2212) and the
// double hyphen ("--") are plausible autocorrect outputs, just like the em
// dash.
// Exported (besides being used internally above): groom.js#buildIssueBody
// needs it to treat "Protegido" with the same "no value" criterion
// Dep/Acepta/Área/Toca already use — see the corresponding fix in groom.js.
export function isNoValueCell(trimmedCell) {
  return NO_VALUE_MARKERS.has(cleanEmphasis(trimmedCell))
}

// EMPHASIS_CHARS_RE / PAIRED_UNDERSCORE_RE / cleanEmphasis (review round 4 —
// the second half of round 3's redesign, not a patch on top of it): round 3
// already inverted the approach for backtick/asterisk (strip them always,
// with no attempt to detect "pairs that wrap"), but for the underscore it
// kept `^_+`/`_+$` — an ASYMMETRIC removal that does not tell a real emphasis
// PAIR (`_x_`, `__x__`, where the closing is the SAME string as the opening)
// apart from a leading or trailing underscore with NO partner. And that is
// exactly how "_layout.tsx"/"_app.tsx" (Expo Router, Next.js) or
// "__init__.py" (Python) start, and how "trailing_" can end — perfectly
// ordinary file names in a "Toca" column. The token IS the collision key of
// claim.js#tokensOf (exact comparison): corrupting "_layout.tsx" into
// "layout.tsx" produces false collisions between slices that do not really
// collide.
//
// PAIRED_UNDERSCORE_RE demands that the closing be the SAME string as the
// opening (backreference `\1`) — verified explicitly character by character
// against the complete matrix before writing the fix:
// "_layout.tsx"/"_app.tsx"/"__init__.py"/"trailing_" do NOT match (they do
// not end in an underscore, or they have no symmetric partner) and are left
// intact; "_x_"/"__x__" DO match and are reduced to "x".
const PAIRED_UNDERSCORE_RE = /^(_{1,3})(.+?)\1$/
export function stripPairedUnderscore(s) {
  const m = PAIRED_UNDERSCORE_RE.exec(s)
  return m ? m[2] : s
}
// EMPHASIS_CHARS_RE: backtick/asterisk have no legitimate meaning inside a
// label token — they are stripped unconditionally.
const EMPHASIS_CHARS_RE = /[`*]/g
// cleanEmphasis: cleanup for the values of a SINGLE cell with no list
// structure (Dep/Acepta/Entrega, via isNoValueCell) — there is no comma split
// in between, so stripping backtick/asterisk from the whole cell and the
// underscore pair (if there is one) is safe and corrupts nothing.
function cleanEmphasis(raw) {
  const trimmed = raw.trim()
  const withoutPairedUnderscore = stripPairedUnderscore(trimmed)
  return withoutPairedUnderscore.replace(EMPHASIS_CHARS_RE, '').trim()
}

// splitEscapedCommas (F6, important 3): splits a cell on commas that are NOT
// escaped with a backslash (`\,`), and returns each piece with those escapes
// already resolved to a literal comma.
//
// The problem it closes: "Acepta" was split with a bare `String#split(',')`,
// so a comma INSIDE a criterion silently broke it in two — and the heading
// this very pipeline generates for that section is literally "Acceptance
// criteria (EARS, 1:1 con tests)": the EARS form ("Cuando <disparador>, el
// sistema debe <respuesta>") carries a comma nearly always. It was not a rare
// case: it was the natural way to fill in the column, and the author only
// discovered it by reading the issue once created.
//
// It is applied ONLY to "Acepta" (checked column by column): "Protegido" is
// not split on commas at all, "Dep" extracts its references with a `#N` regex
// (a comma inside changes nothing), and "Área"/"Toca" are split but their
// values are label tokens from which `normalizeToken` discards the comma
// anyway — an escape there would promise something the normalisation undoes
// immediately afterwards.
//
// A backslash that does NOT precede a comma is kept as-is (e.g. a Windows
// path in a criterion): only the exact sequence `\,` is an escape.
export function splitEscapedCommas(cell) {
  const parts = []
  let current = ''
  const src = cell || ''
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '\\' && src[i + 1] === ',') {
      current += ','
      i++
      continue
    }
    if (ch === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}
