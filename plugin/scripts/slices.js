// Pure parsing of the §9 "Desglose en slices" table of a markdown spec.
// headingAbove (F10): this parser already located the table by its COLUMN
// HEADER ("Slice" + "Dep"), never by a section number — but it did not know
// which heading of the document it lived under, so the link to each issue's
// spec had to invent an anchor out of `--section` ("#9"), which does not exist
// on GitHub. The report now includes the real heading and its anchor.
import { headingAbove } from './anchor.js'
// isNoValueCell/splitEscapedCommas/stripPairedUnderscore live in cells.js (not
// here) so that gates.js can split a cell without importing this whole parser —
// see the header of cells.js. isNoValueCell and splitEscapedCommas are
// re-exported so that groom.js/ct-groom.mjs go on importing them from
// './slices.js' without changing a line.
import { isNoValueCell, splitEscapedCommas, stripPairedUnderscore } from './cells.js'
export { isNoValueCell, splitEscapedCommas }
const DEP_RE = /#(\d+)/g
// PLAIN_INT_RE: the `#` of each row must be a bare integer ("1", "23"), never
// "S1" (a human prefix letter), "**1**" (markdown bold) nor "1a" (trailing
// junk). A bare `parseInt` is far too permissive — it accepts "1abc" -> 1 and
// "S1" -> NaN inconsistently, and NaN was discarded in silence (F1, defect 1:
// the whole row vanished without a trace). With this regex, any "#" that is not
// pure digits is reported as an unparseable row instead of being lost. On
// purpose NO tolerance for inline markup is applied here (unlike Área/Toca, see
// EMPHASIS_CHARS_RE/cleanEmphasis, in cells.js): the original statement of this
// feature explicitly asks for "**1**" to be rejected and for the author to have
// to write a bare "1", so "#" forgives no bold and no backticks.
const PLAIN_INT_RE = /^\d+$/
// HEADING_RE: a markdown heading ("## 10. Otra sección") marks the real end of
// the §9 table's block (review of F1, point 3: before this, the row scan
// stopped at the first line that did not start with "|", treating a blank line
// in the middle of the table as "end of table" and silently truncating the rows
// that followed). Stopping at a new heading avoids dragging in a table from a
// completely different section further down the same document.
const HEADING_RE = /^#{1,6}\s/
// SEPARATOR_RE: the "|---|---|" row of a markdown table.
const SEPARATOR_RE = /^\s*\|[\s:|-]+\|\s*$/

function splitRow(line) {
  // "| a | b |" -> ["a","b"] (drops the borders and trims)
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
}

// ALNUM_RE: a unicode letter or digit — the criterion of "this is no longer
// wrapping junk, this is content" that stripColumnPrefix uses.
const ALNUM_RE = /[\p{L}\p{N}]/u

// stripColumnPrefix (F1, defect 2 — inverted in review round 4): what the
// Área/Toca column is being asked for is a token ("medicacion"), but the
// natural mistake of a human author is to write the full label
// ("area:medicacion") because that is what they see in GitHub's UI. Without
// this strip, normalizeToken merely deletes the `:` (not a "label-safe"
// character) and the result is "areamedicacion", which buildLabels (groom.js)
// prefixes again as "area:areamedicacion" — a duplicated prefix, a junk label
// really created in the repo (`gh label create --force` rejects nothing).
//
// Rounds F1/2/3 chased this wrapper by wrapper (backtick, then bold, then
// "whole cell vs. each piece", then underscore) and each one left gaps: ANY
// non-alphanumeric character before "area:" (`~~`, straight quotes,
// parentheses, a markdown link "[area:x](...)"...) reproduces the same defect,
// because the check demanded the marker at index 0 exactly. The list of
// possible wrappers is infinite; chasing it one by one never ends.
//
// Inverted approach: the leading NON-alphanumeric characters are SKIPPED ONLY
// to check whether the "area:"/"touches:" marker appears right after them —
// without mutating anything yet. If it does appear, it is removed from the
// start (the leading junk + the marker) and the rest is returned (which
// normalizeToken, further down, cleans of any junk left, before or after —
// backtick/asterisk/tilde/quotes/parentheses are already outside its permitted
// alphabet). If NO marker appears after skipping the leading junk, the ORIGINAL
// token is returned untouched — that way a value WITHOUT a prefix (the normal
// case, by far the most common) is never mutilated by this function: it is
// normalizeToken that decides, as always, what to do with its own
// punctuation.
function stripColumnPrefix(raw, ownPrefix, otherPrefix) {
  const lower = raw.toLowerCase()
  let i = 0
  while (i < lower.length && !ALNUM_RE.test(lower[i])) i++
  const ownMarker = `${ownPrefix}:`
  if (lower.startsWith(ownMarker, i)) {
    return { token: raw.slice(i + ownMarker.length), mismatched: false }
  }
  if (otherPrefix) {
    const otherMarker = `${otherPrefix}:`
    if (lower.startsWith(otherMarker, i)) {
      return { token: raw.slice(i + otherMarker.length), mismatched: true }
    }
  }
  return { token: raw, mismatched: false }
}

// normalizeToken: raw token (already free of inline markup / column prefix) ->
// "label-safe" token for composing `area:<token>`/`touches:<token>` (T14/W-A).
// Normalisation decision (documented in the task's report): trim + lowercase +
// silently discard every character that is not a unicode letter/digit, space,
// hyphen, underscore, `/`, `.` or `+` — in particular `:` (the `area:`/
// `touches:` prefix separator that buildLabels uses in groom.js) and `,` (the
// token separator inside the cell itself, see parseTokenList) are deleted
// rather than escaped, so that the resulting token can never reintroduce
// ambiguity into either of the two parses that consume it. Spaces ARE
// preserved (GitHub allows labels with spaces, e.g. "good first issue"), only
// internal runs are collapsed to one.
function normalizeToken(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_/.+]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// parseTokenList: Área/Toca cell -> normalised string[]. Same criterion of
// "empty" that Dep/Acepta use (see NO_VALUE_MARKERS/isNoValueCell).
// Column-aware (F1): with `ownPrefix`/`otherPrefix` it tolerates a cell
// carrying the full label prefix instead of the bare token (see
// stripColumnPrefix). When the prefix found is the other column's, it pushes a
// record into `warnings` (mutated in place by the caller) instead of throwing
// or discarding the value.
//
// Point 6 of the review of F1: a token with real content that, after stripping
// prefix/markup and normalising, comes out empty (e.g. "area:" with nothing
// behind it, or "???" with no label-safe character at all) was discarded with
// `.filter(Boolean)` without saying anything — the same collision/serialisation
// inertia already reported when the whole COLUMN is missing, but kept quiet
// when it is only the CELL that comes out empty. It is reported in
// `emptyWarnings` (mutated in place, just like `warnings`).
function parseTokenList(cell, opts = {}) {
  const { ownPrefix, otherPrefix, columnLabel, n, warnings, emptyWarnings } = opts
  const raw = (cell || '').trim()
  if (!raw || isNoValueCell(raw)) return []
  // Review round 4: it is NO longer necessary to clean backtick/asterisk off
  // the whole cell before the split (as round 3 did) — the inverted
  // `stripColumnPrefix` (see above) detects the prefix by skipping leading junk
  // PIECE BY PIECE, so it does not matter where the split falls with respect to
  // the markup: each resulting piece cleans itself.
  return raw
    .split(',')
    .map((piece) => {
      const trimmedPiece = piece.trim()
      // A genuinely empty cell between commas (e.g. "api,,db", the middle
      // piece): there never was content to report, so no warning is given.
      if (!trimmedPiece) return ''
      // A SYMMETRICALLY paired underscore (`_x_`, `__x__`) is markdown
      // emphasis and is stripped; an UNpaired one ("_layout.tsx",
      // "__init__.py", "trailing_") is legitimate content — see
      // PAIRED_UNDERSCORE_RE. `stripPairedUnderscore` of a non-empty input
      // ALWAYS returns something non-empty (the captured group demands at least
      // 1 character), so a second "did it come out empty?" check is not needed
      // here — deliberate: review round 3 had an `if (!trimmed) return ''` right
      // after its underscore step that skipped the "empty token" warning (a
      // cell of nothing but underscores vanished with no warning, unlike "???",
      // which did warn). With no second early return point, EVERY path towards
      // an empty token goes through the single check further down
      // (`if (!token && emptyWarnings)`), whatever the reason.
      const afterUnderscore = stripPairedUnderscore(trimmedPiece)
      let token
      if (!ownPrefix) {
        token = normalizeToken(afterUnderscore)
      } else {
        const { token: t, mismatched } = stripColumnPrefix(afterUnderscore, ownPrefix, otherPrefix)
        if (mismatched && warnings) {
          warnings.push({ column: columnLabel, n, raw: afterUnderscore, otherPrefix })
        }
        token = normalizeToken(t)
      }
      if (!token && emptyWarnings) {
        emptyWarnings.push({ column: columnLabel, n, raw: afterUnderscore })
      }
      return token
    })
    .filter(Boolean)
}

// analyzeSlicesTable: the real parse, with an enriched report of everything
// that used to be lost in silence (F1/F2 and the later review of both). Shape
// of the report:
//   - tableFound: a §9 table header was located.
//   - pipeRowsFound: there was at least one markdown table line ("|...") in the
//     document, whether or not it matched as a slices header — it allows "there
//     is no table at all in the spec" to be told apart from "there is a
//     table (or several), but none with a Slice/Dep header" (different error
//     messages).
//   - missingRequiredColumns / missingOptionalColumns: columns absent from the
//     HEADER (see the detail in the code further down).
//   - totalDataRows: data rows seen (not the separator), across the whole block
//     of the table (including the ones appearing after a gap).
//   - rowsAfterGap: data rows appearing after a line with no "|" (blank or some
//     other text) inside the table's block — this used to be truncated there in
//     silence (review of F1, point 3).
//   - skippedRows: rows whose "#" is not a bare integer.
//   - invalidRows: rows with an empty "Slice" cell (or with a "no value" marker
//     such as "–", or carrying only a "#N" reference with no name around it),
//     or with a number of cells different from the header's (fewer or more — an
//     unescaped "|" shifts columns) — the same observable result as "the Slice
//     column is missing", but per row (review of F1, point 4; review round 2,
//     points a/b). They are not added to `slices`. F3: the mandatory content
//     moved from "Entrega" to "Slice" — the issue's title now comes out of
//     "Slice" (`groom.js#buildIssueTitle`), and "Entrega" became optional (it
//     turns into a description inside the issue's body).
//   - malformedDepRows: rows whose "Dep" cell has real content (not "empty"
//     according to isNoValueCell) but from which no "#N" reference was
//     extracted (F2).
//   - invalidDepRefs: "#N" references in Dep pointing at a slice that does not
//     exist in the table, or at the slice itself (self-reference, never
//     legitimate) — review of F1, point 5.
//   - prefixWarnings: Área/Toca values carrying THE OTHER column's prefix — the
//     value was used, but it is flagged for review.
//   - emptyTokenWarnings: Área/Toca values that, once normalised, come out
//     empty — they are discarded, but a warning is given (review of F1, point
//     6).
//   - slices: Slice[] — the same array `parseSlices` used to return.
export function analyzeSlicesTable(specMd) {
  const lines = (specMd || '').split('\n')
  // locate the table's header: the row with cells that include "Slice" and "Dep"
  let headerIdx = -1
  let pipeRowsFound = false
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('|')) continue
    pipeRowsFound = true
    const cells = splitRow(lines[i]).map((c) => c.toLowerCase())
    if (cells.some((c) => c.includes('slice')) && cells.some((c) => c === 'dep' || c.includes('dep'))) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) {
    return {
      tableFound: false,
      pipeRowsFound,
      sectionHeading: null,
      missingRequiredColumns: [],
      missingOptionalColumns: [],
      gateColumnPresent: false,
      // e2eColumnPresent: same reason as gateColumnPresent, and not derivable
      // from the cells — a column that is present with everything "–" is
      // indistinguishable from an absent column if only the values are looked
      // at. The next step of this feature consumes it to decide whether it
      // demands an e2e decision per row.
      e2eColumnPresent: false,
      totalDataRows: 0,
      rowsAfterGap: [],
      skippedRows: [],
      invalidRows: [],
      prefixWarnings: [],
      malformedDepRows: [],
      invalidDepRefs: [],
      emptyTokenWarnings: [],
      slices: [],
    }
  }
  // .normalize('NFC') BEFORE comparing: a header with accents written/saved in
  // NFD form (e.g. "Área" as 'A' + combining acute accent U+0301, instead of
  // the precomposed character 'Á' U+00C1) is a JS string different byte for
  // byte from the NFC form — neither of colAny()'s two `.includes()` (which
  // compares against this file's NFC literals 'área'/'area') would match, and
  // the Área column would be lost in silence: exactly the silent failure mode
  // this feature (T14/W-A) comes to eliminate. NFC is the form this source
  // file's literals use, so we normalise the header towards it (not the other
  // way round).
  const header = splitRow(lines[headerIdx]).map((c) => c.normalize('NFC').toLowerCase())
  const col = (needle) => header.findIndex((c) => c.includes(needle))
  // colAny: like col(), but it accepts several spellings of the same heading.
  // "Área" is the spec's "canonical" spelling, but a human author may type the
  // accentless variant "Area" — both must resolve to the same column. It does
  // not collide with any other existing heading: "area"/"área" is not a
  // substring of slice/tipo/entrega/dep/acepta/protegido/toca, and none of
  // those is a substring of "área"/"area" either.
  const colAny = (...needles) => header.findIndex((c) => needles.some((n) => c.includes(n)))
  // iSlice (formerly "iIssue"): renamed in F3 because this column no longer
  // only feeds `slice.issue` (the "#NN" it may carry) — it now also feeds
  // `slice.name`, the text that composes the issue's TITLE.
  const iN = col('#'), iSlice = col('slice'), iType = col('tipo'), iEntrega = col('entrega'),
        iDep = col('dep'), iAc = col('acepta'), iProt = col('protegido'),
        iArea = colAny('área', 'area'), iToca = colAny('toca'),
        // iGate (F21): the column that separates "what this slice technically
        // is" from "which human gates it demands before merging". It does not
        // collide with any existing heading: "gate" is not a substring of
        // #/slice/tipo/entrega/dep/acepta/protegido/área/toca, nor is any of
        // those a substring of "gate".
        iGate = col('gate'),
        // iSenal (Slice 10): the observability signal the slice promises. Same
        // treatment of the accent as Área/Area (the human author types both
        // spellings); neither of the two is a substring of another heading nor
        // the other way round — verified against
        // #/slice/tipo/entrega/dep/acepta/protegido/área/area/toca/gate/e2e.
        iSenal = colAny('señal', 'senal'),
        // iE2e: the column that declares WHAT is traversed in this slice, kept
        // separate from `Acepta` on purpose. The first version of the design
        // marked criteria INSIDE `Acepta` with an `[e2e]` prefix, and it fell
        // apart when applied to the real case: of the four `Acepta` of
        // mo-monitoring's slice #5, 1 and 2 talk about the response of the same
        // router and no criterion separates them. Two people freezing the same
        // spec would mark different things — and that mark was the only barrier
        // against the agent inventing a flow. With a column of its own, a text
        // that already existed is not classified after the fact: it is decided
        // as it is written, and which column it is written in IS the decision.
        //
        // It does not collide with any existing heading (the same check F21 left
        // noted for `gate`): "e2e" is not a substring of
        // #/slice/tipo/entrega/dep/acepta/protegido/área/toca/gate/señal/senal,
        // nor is any of those a substring of "e2e".
        iE2e = col('e2e')

  const missingRequiredColumns = []
  if (iN === -1) missingRequiredColumns.push('#')
  // F3: "Entrega" stops being a mandatory column — the issue's title now comes
  // out of "Slice", not out of "Entrega" (see the row validation block further
  // down). "Slice" itself cannot be missing as a COLUMN: the header locator
  // above already demands a cell containing "slice" to recognise this block as
  // the §9 table — getting here with `iSlice === -1` is structurally
  // impossible, so no new column check is needed here. What does change is the
  // demand at CELL level (see `sliceEmpty` further down).

  const missingOptionalColumns = []
  if (iType === -1) missingOptionalColumns.push('Tipo')
  if (iEntrega === -1) missingOptionalColumns.push('Entrega')
  if (iAc === -1) missingOptionalColumns.push('Acepta')
  if (iProt === -1) missingOptionalColumns.push('Protegido')
  if (iArea === -1) missingOptionalColumns.push('Área')
  if (iToca === -1) missingOptionalColumns.push('Toca')
  // "Señal" DOES go into missingOptionalColumns, unlike "Gate" (see the
  // comment below): the consequence of the column being missing is MEASURABLE —
  // the slice judge measures its `observabilidad` item as sin-vara in every
  // slice of the epic — so ct-groom.mjs's consequence-based warning describes a
  // real degradation, not noise that trains people to ignore the other
  // warnings.
  if (iSenal === -1) missingOptionalColumns.push('Señal')
  // "Gate" does NOT go into missingOptionalColumns, and that is not an
  // oversight (F21). Every entry of that list produces, in ct-groom.mjs, a
  // warning on stderr with the CONSEQUENCE of the column being missing ("the
  // issues will be created with no type: label", "the collision machinery is
  // left inert"…). The consequence of `Gate` being missing is: none. The gates
  // are derived from the `Tipo` exactly as they were before this column existed
  // (gates.js#TYPE_GATES), so EVERY §9 table that exists today goes on
  // producing the same gates without a single letter changing. A warning that
  // comes out on every run of every spec and describes no degradation is noise
  // that trains people to ignore the other warnings — the same criterion with
  // which F14/F19 attacked the unsatisfiable warnings and the ones repeated
  // with nothing new. What is exposed instead is the raw fact
  // (`gateColumnPresent`), because ct-groom.mjs needs it to decide whether the
  // spec has any opinion at all about an issue's `gate:` labels.
  //
  // "E2E" does not go into missingOptionalColumns either, for the SAME reason
  // as "Gate" (above): every entry of that list produces a warning with the
  // CONSEQUENCE of the column being missing, and the consequence of "E2E" being
  // missing is that no slice of the epic has an e2e — which is exactly the
  // behaviour before this round. Warning about it in every repo that does not
  // use the feature is pure noise.

  const slices = []
  const skippedRows = []
  const invalidRows = []
  const prefixWarnings = []
  const malformedDepRows = []
  const emptyTokenWarnings = []
  const rowsAfterGap = []
  let totalDataRows = 0
  let hitGap = false
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()
    if (HEADING_RE.test(trimmed)) break // a new markdown section: the real end of the table's block
    if (!trimmed.startsWith('|')) {
      // A blank line (or some other text) inside the table's block: it does
      // NOT cut the scan (review of F1, point 3) — it only marks that, if more
      // data rows appear after it, that has to be reported.
      hitGap = true
      continue
    }
    if (SEPARATOR_RE.test(raw)) continue // the |---| separator row

    // IMPORTANT (review round 2): HEADING_RE (only ATX headings "## ...") is
    // far too narrow to decide "end of the §9 table's block" — a horizontal
    // rule ("---"), a setext heading ("Riesgos" + the underline "-------"), a
    // bold pseudo-heading ("**10. Riesgos**") or a "##10." with no space are
    // perfectly ordinary markdown and none of them matches HEADING_RE; without
    // this check, the post-gap scan would treat them as more gap lines and
    // would end up dragging in ANOTHER section's table, aborting with an
    // example from the wrong row and a piece of advice ("join the rows into a
    // single block") that does not apply. A cheap fix that keeps the true
    // positive: after a gap, if this row with a "|" is IMMEDIATELY followed by
    // a separator row, it is the header of a NEW table (every valid markdown
    // table has its separator right after its header) — the scan is cut here
    // without counting anything from this row onwards. A continuation row of
    // THE SAME table (the real case) is never followed by a new separator.
    if (hitGap && SEPARATOR_RE.test(lines[i + 1] ?? '')) break

    // From here on: a real data row.
    totalDataRows++
    if (hitGap) rowsAfterGap.push({ raw: trimmed })
    const cells = splitRow(raw)
    const nCellRaw = iN === -1 ? '' : (cells[iN] || '').trim()
    if (!PLAIN_INT_RE.test(nCellRaw)) {
      skippedRows.push({ raw: trimmed, value: nCellRaw })
      continue
    }
    const n = parseInt(nCellRaw, 10)

    // Point 4 of the review of F1: before, only the HEADER was validated,
    // never the cells. A row with fewer cells than the header (typically
    // because it is missing trailing cells), or with "Slice" empty, produces
    // exactly the same observable result as "the whole Slice column is
    // missing" (an issue titled a bare "#N", with no name) — only per row. It
    // is reported and NOT added to `slices`: there is no reliable issue title
    // to build out of this row. (F3: this demand lived in "Entrega"; it moved
    // to "Slice" because the issue's title now comes out of there — see
    // `buildIssueTitle` in groom.js.)
    //
    // Point (a) of review round 2: a row with MORE cells than the header
    // (typically an unescaped "|" inside a cell) shifts the following columns
    // in silence — "med | icacion | pbx" over a 9-column header produces
    // area:['med'], touches:['icacion'], and "pbx" is lost without anybody
    // noticing. Before, only `cells.length < header.length` was checked; now
    // any discrepancy (`!==`) is treated the same.
    const rowLengthMismatch = cells.length !== header.length

    // F3: "Slice" feeds TWO things at once out of the same cell — `issue` (the
    // "#NN" reference it may already carry, e.g. an issue created by hand
    // before running `/ct-groom`) and `name` (the text that composes the
    // issue's title, `#N <name>`). They are extracted together, here, because
    // they are the two halves of the same regex over the same cell — splitting
    // them across two files (slices.js for `issue`, groom.js for cleaning
    // `name`) would duplicate the `#\d+` pattern and risk the two diverging
    // over time.
    const sliceCellRaw = iSlice === -1 ? undefined : cells[iSlice]
    const sliceCellTrimmed = sliceCellRaw === undefined ? '' : sliceCellRaw.trim()
    const issueMatch = sliceCellTrimmed.match(/#(\d+)/)
    // name: the text of "Slice" already cleaned of any "#NN" reference (the
    // one just captured above in `issueMatch`) — that way the title never drags
    // along a dangling hash ("#3 #12 login model") when the Slice cell itself
    // carries, at the same time, a name AND an issue reference. It collapses
    // the gap the removed "#NN" leaves so as not to leave double spaces.
    const name = sliceCellTrimmed.replace(/#\d+/g, '').replace(/\s+/g, ' ').trim()
    // Point (b) of review round 2 (adapted to F3): a "Slice" with a "no value"
    // marker (–, -, —, etc. — see isNoValueCell, already used in
    // Dep/Acepta/Área/Toca) would produce an issue titled "#1 –", exit 0.
    // "Slice" is now the only column where content is mandatory (without it
    // there is no issue title); treating "there is nothing here" as if it were
    // a valid title would be the same unjustified exception already corrected
    // for "Entrega". A cell carrying ONLY a "#NN" reference (with no name
    // around it) falls into the same case: `name` comes out empty once the hash
    // is removed, and there is no reliable title to build.
    const sliceEmpty = sliceCellTrimmed === '' || isNoValueCell(sliceCellTrimmed) || name === ''
    if (rowLengthMismatch || sliceEmpty) {
      invalidRows.push({
        n,
        reason: rowLengthMismatch
          ? `la fila tiene ${cells.length} celda(s), la cabecera tiene ${header.length}` +
            (cells.length > header.length ? ' (revisa si hay un "|" sin escapar dentro de una celda)' : '')
          : 'la columna "Slice" está vacía (o trae un marcador de "sin valor" como "–", o solo una referencia "#N" sin ningún nombre)',
      })
      continue
    }

    const depCell = (cells[iDep] || '').trim()
    const deps = []
    let m
    DEP_RE.lastIndex = 0
    while ((m = DEP_RE.exec(depCell)) !== null) deps.push(parseInt(m[1], 10))
    // F2: a "Dep" with real content (not a "no value" marker — see
    // isNoValueCell/NO_VALUE_MARKERS, which now includes the em dash) from
    // which no "#N" was extracted — e.g. "S1" instead of "#1" — is a malformed
    // cell, not a row with no dependencies. The trigger is "0 deps extracted
    // from a cell with content": legitimate text around a valid reference (e.g.
    // "#1 (tras el merge)") still extracts its "#1" and does NOT count as
    // malformed.
    if (depCell && !isNoValueCell(depCell) && deps.length === 0) {
      malformedDepRows.push({ n, raw: depCell })
    }
    const acCell = (cells[iAc] || '').trim()
    // F6, important 3: a bare `split(',')` silently broke any criterion with
    // an internal comma — see splitEscapedCommas further up for why, and for
    // why only this column needs it.
    const ac = acCell && !isNoValueCell(acCell) ? splitEscapedCommas(acCell).map((x) => x.trim()).filter(Boolean) : []
    slices.push({
      n,
      issue: issueMatch ? `#${issueMatch[1]}` : null,
      name,
      type: (cells[iType] || '').trim(),
      // entrega (F3): it no longer feeds the title — it is an OPTIONAL
      // description that groom.js#buildIssueBody renders in the issue's body
      // (same "no value" criterion as Protegido: isNoValueCell decides there
      // whether there is real content to show).
      entrega: (cells[iEntrega] || '').trim(),
      // gate (F21): the RAW cell, unresolved. The resolution (which gates the
      // `Tipo` implies, what this cell adds or removes, what has to be said out
      // loud) lives entirely in gates.js#resolveGates — this parser knows
      // nothing about gates, just as it knows nothing about labels or addenda:
      // its job is to turn a markdown table into reliable cells.
      gate: (cells[iGate] || '').trim(),
      // senal (Slice 10): the RAW cell, unresolved — the mirror of `gate`. The
      // resolution (a declared signal, a reasoned exemption `N/A — <razón>`, an
      // exemption with no reason, nothing) lives entirely in
      // groom.js#parseSignalCell: this parser knows nothing about signals, its
      // job is to deliver reliable cells.
      senal: (cells[iSenal] || '').trim(),
      // e2e: the RAW cell, unresolved — the same contract as `gate`, and for
      // the same reason. The three states of this cell (journeys / the `no`
      // token / not declared) are resolved by gates.js#resolveE2e; this parser
      // knows nothing about e2e just as it knows nothing about gates.
      e2e: (cells[iE2e] || '').trim(),
      deps,
      ac,
      protected: (cells[iProt] || '').trim(),
      area: parseTokenList(cells[iArea], { ownPrefix: 'area', otherPrefix: 'touches', columnLabel: 'Área', n, warnings: prefixWarnings, emptyWarnings: emptyTokenWarnings }),
      touches: parseTokenList(cells[iToca], { ownPrefix: 'touches', otherPrefix: 'area', columnLabel: 'Toca', n, warnings: prefixWarnings, emptyWarnings: emptyTokenWarnings }),
    })
  }

  // Point 5 of the review of F1: the deps were not contrasted against the
  // slices that really exist. "#99" in a table of 2 slices, or "#3" in slice 3
  // itself (self-reference, never legitimate), parsed with no trouble and would
  // reach GitHub as `merge-after` — a wrong graph written into the issues. It
  // is validated here, once the complete set of orders `n` that did parse is
  // known.
  const knownOrders = new Set(slices.map((s) => s.n))
  const invalidDepRefs = []
  for (const s of slices) {
    for (const d of s.deps) {
      if (d === s.n) invalidDepRefs.push({ n: s.n, dep: d, reason: 'self' })
      else if (!knownOrders.has(d)) invalidDepRefs.push({ n: s.n, dep: d, reason: 'unknown' })
    }
  }

  return {
    tableFound: true,
    pipeRowsFound,
    // sectionHeading (F10): the heading the table lives under, with its GitHub
    // anchor — `{ line, text, anchor }` or null if the table sits above every
    // heading of the document. It is what lets the issues' link to the spec
    // point at the real section instead of at a "#9" that does not exist.
    // `anchor` can be '' (a heading with no usable anchor, e.g. "## ..."): the
    // consumer treats it as "there is no anchor", it never emits a bare "#" —
    // see scripts/spec-link.js.
    sectionHeading: headingAbove(specMd, headerIdx),
    missingRequiredColumns,
    missingOptionalColumns,
    // gateColumnPresent (F21): exposed apart from missingOptionalColumns (see
    // why, above). ct-groom.mjs uses it to decide whether the spec is the
    // authority over the `gate:` labels of an issue that already exists.
    gateColumnPresent: iGate !== -1,
    // e2eColumnPresent: same reason as gateColumnPresent (see the early return
    // further up) — it cannot be derived from the cells, because a column that
    // is present with everything "–" is indistinguishable from an absent
    // column.
    e2eColumnPresent: iE2e !== -1,
    totalDataRows,
    rowsAfterGap,
    skippedRows,
    invalidRows,
    prefixWarnings,
    malformedDepRows,
    invalidDepRefs,
    emptyTokenWarnings,
    slices,
  }
}

// parseSlices: the old contract preserved (md) -> Slice[]. It is kept only for
// contract compatibility (several tests, and at the time other modules,
// depended on this exact signature); as of today it has no caller in
// production — ct-groom.mjs uses `analyzeSlicesTable` so that it can validate
// before touching GitHub. Whoever needs the validation report (discarded rows,
// absent columns, prefix/empty-token warnings, invalid Dep references, gaps in
// the table) uses `analyzeSlicesTable` instead.
export function parseSlices(specMd) {
  return analyzeSlicesTable(specMd).slices
}
