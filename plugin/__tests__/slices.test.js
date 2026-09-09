import { describe, it, expect } from 'vitest'
import { parseSlices, analyzeSlicesTable } from '../scripts/slices.js'
import { REAL_FAILING_TABLE, REAL_DEP_TABLE, REAL_TABLE_WITH_HASH_FIXED } from './fixtures/slices-real-tables.js'

const SPEC = `# Spec X
## 9. Desglose en slices
| # | Slice (issue) | Tipo | Entrega | Dep | Acepta (AC) | Protegido |
|---|---|---|---|---|---|---|
| 1 | #— login model | backend | modelo User | – | AC-1.1, AC-1.2 | schema §6 |
| 2 | refresh token | backend | refresh flow | #1 | AC-2.1 | – |
| 3 | UI login | ui | pantalla | #1, #2 | AC-3.1 | design-system |
| 4 | #42 notifications | backend | notif engine | #1 | – | logging |
`

describe('parseSlices', () => {
  const s = parseSlices(SPEC)
  it('it extracts every data row (not the separator)', () => {
    expect(s).toHaveLength(4)
  })
  it('it types n, type, deps, ac', () => {
    expect(s[0]).toMatchObject({ n: 1, type: 'backend', deps: [], ac: ['AC-1.1', 'AC-1.2'], protected: 'schema §6' })
    expect(s[2].deps).toEqual([1, 2])
    expect(s[1].deps).toEqual([1])
  })
  it('empty deps/– → []', () => {
    expect(s[0].deps).toEqual([])
  })
  it('issue: it extracts #NN when there is one, null otherwise', () => {
    expect(s[0].issue).toEqual(null) // #— login model → does not match /#(\d+)/
    expect(s[1].issue).toEqual(null) // refresh token → no issue
    expect(s[3].issue).toEqual('#42') // #42 notifications → it extracts #42
  })
  it('entrega: it preserves the text of the cell', () => {
    expect(s[0].entrega).toEqual('modelo User')
    expect(s[1].entrega).toEqual('refresh flow')
    expect(s[2].entrega).toEqual('pantalla')
    expect(s[3].entrega).toEqual('notif engine')
  })
  it('ac: – and empty → []', () => {
    expect(s[3].ac).toEqual([]) // #42 notifications → AC is –
  })
  it('with no §9 table → []', () => {
    expect(parseSlices('# spec sin tabla')).toEqual([])
  })
  it('with no Área/Toca columns (old table) → area/touches default to []', () => {
    expect(s[0].area).toEqual([])
    expect(s[0].touches).toEqual([])
  })
})

const SPEC_AREA_TOUCHES = `# Spec Y
## 9. Desglose en slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|-------|------|---------|-----|--------|-----------|------|------|
| 1 | modelo | backend | tabla users | – | AC-1.1 | schema | api | db, migration |
| 2 | api | backend | endpoint | #1 | AC-2.1 | – | api | – |
| 3 | pantalla | ui | login UI | #1, #2 | AC-3.1 | – |  |  |
`

describe('parseSlices — the Área/Toca columns', () => {
  const s = parseSlices(SPEC_AREA_TOUCHES)
  it('it parses area/touches comma-separated', () => {
    expect(s[0].area).toEqual(['api'])
    expect(s[0].touches).toEqual(['db', 'migration'])
  })
  it('single area, no touches (–) → []', () => {
    expect(s[1].area).toEqual(['api'])
    expect(s[1].touches).toEqual([])
  })
  it('empty cells → []', () => {
    expect(s[2].area).toEqual([])
    expect(s[2].touches).toEqual([])
  })
})

describe('parseSlices — normalisation of Área/Toca tokens', () => {
  it('trim, lowercase, it collapses internal spaces', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – |  API  ,  Payments Core  | ci  pipeline |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['api', 'payments core'])
    expect(s[0].touches).toEqual(['ci pipeline'])
  })
  it('an "Area" header without the accent resolves the column too', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Area | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | api | – |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['api'])
  })
  it('characters that are invalid in a GitHub label are dropped from the token', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | ap:i "core" | – |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['api core'])
  })
  it('an "Área" header in NFD form (A + combining accent) resolves the column just like NFC', () => {
    // 'Á' here is DELIBERATELY 'A' (U+0041) + a combining acute accent
    // (U+0301), not the precomposed character 'Á' (U+00C1/00E1, NFC). Some
    // editors and environments (macOS in certain flows, for instance)
    // normalise to NFD on save. As a JS string, 'Área' is NOT === 'Área'
    // (NFC) and it does not contain the substring 'area' or 'área' under a
    // literal comparison — it has to be normalised before comparing, or this
    // header is lost in silence and the whole epic ends up with no
    // area:/touches: labels.
    const NFD_AREA_HEADER = 'A' + '\u0301' + 'rea' // 'Area' with A + a combining acute accent (U+0301) = 'Área' visually, NFD form
    expect(NFD_AREA_HEADER.normalize('NFC')).toBe('Área')
    expect(NFD_AREA_HEADER === 'Área').toBe(false)
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | ${NFD_AREA_HEADER} | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | api | db |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['api'])
    expect(s[0].touches).toEqual(['db'])
  })
})

describe('analyzeSlicesTable — the enriched contract (F1)', () => {
  it('parseSlices(md) still returns a plain Slice[] (the contract is not broken)', () => {
    expect(Array.isArray(parseSlices(REAL_FAILING_TABLE))).toBe(true)
  })

  it('regression: the real table from the incident — header found, but both rows are reported as unparseable because of "#"', () => {
    const r = analyzeSlicesTable(REAL_FAILING_TABLE)
    expect(r.tableFound).toBe(true)
    expect(r.missingRequiredColumns).toEqual([]) // "Qué entrega (visible)" matches "entrega"
    expect(r.slices).toEqual([]) // no parseable row: 0 slices, and no longer in silence
    expect(r.skippedRows).toHaveLength(2)
    expect(r.skippedRows[0].value).toBe('**S1**')
    expect(r.skippedRows[1].value).toBe('**S2**')
  })

  it('with no §9 table → tableFound: false (not to be confused with "an empty table")', () => {
    const r = analyzeSlicesTable('# spec sin tabla')
    expect(r.tableFound).toBe(false)
    expect(r.slices).toEqual([])
  })

  it('an absent "#" column → missingRequiredColumns includes "#"', () => {
    const spec = `## 9. Slices
| Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|
| x | backend | y | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.tableFound).toBe(true)
    expect(r.missingRequiredColumns).toContain('#')
  })

  // F3: the issue title no longer comes from "Entrega" (it now comes from
  // "Slice", see below) — "Entrega" becomes an OPTIONAL column (it turns into
  // the body's "Descripción" section, see groom.js#buildIssueBody). This test
  // used to expect the absent column to abort (missingRequiredColumns); now it
  // must degrade like Tipo/Acepta/Protegido/Área/Toca: a warning is emitted
  // (missingOptionalColumns) and the table keeps being parsed.
  it('an absent "Entrega" column → missingOptionalColumns includes it (F3: it is no longer mandatory), and the row keeps being parsed', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Dep | Acepta | Protegido |
|---|---|---|---|---|---|
| 1 | x | backend | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.missingRequiredColumns).toEqual([])
    expect(r.missingOptionalColumns).toContain('Entrega')
    expect(r.slices).toHaveLength(1)
    expect(r.slices[0].entrega).toBe('')
  })

  it('absent Tipo/Acepta/Protegido/Área/Toca columns → missingOptionalColumns names them, but the slices keep being parsed', () => {
    const spec = `## 9. Slices
| # | Slice | Entrega | Dep |
|---|---|---|---|
| 1 | x | y | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.missingRequiredColumns).toEqual([])
    // Slice 10: "Señal" is optional-with-a-consequence too and this table does
    // not carry it — it goes into the list just like the others.
    expect(r.missingOptionalColumns.sort()).toEqual(['Acepta', 'Protegido', 'Señal', 'Tipo', 'Toca', 'Área'].sort())
    expect(r.slices).toHaveLength(1)
  })

  it('a row whose "#" is not a plain integer ("**1**", "S1") is reported in skippedRows with the offending value', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| **1** | x | backend | y | – | – | – |
| 2 | ok | backend | z | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.skippedRows).toHaveLength(1)
    expect(r.skippedRows[0].value).toBe('**1**')
    expect(r.slices).toHaveLength(1) // row 2, which is valid, does get parsed
    expect(r.slices[0].n).toBe(2)
  })

  it('a table with no data row at all → slices: [], skippedRows: [], totalDataRows: 0', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices).toEqual([])
    expect(r.skippedRows).toEqual([])
    expect(r.totalDataRows).toBe(0)
  })
})

describe('parseSlices/analyzeSlicesTable — tolerance of the label prefix in Área/Toca (F1)', () => {
  it('Área accepts the bare token ("medicacion") and the prefixed one ("area:medicacion"), same result', () => {
    const spec = (val) => `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | ${val} | – |
`
    expect(parseSlices(spec('medicacion'))[0].area).toEqual(['medicacion'])
    expect(parseSlices(spec('area:medicacion'))[0].area).toEqual(['medicacion'])
  })

  it('Toca accepts the bare token ("pbxproj") and the prefixed one ("touches:pbxproj"), same result', () => {
    const spec = (val) => `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | – | ${val} |
`
    expect(parseSlices(spec('pbxproj'))[0].touches).toEqual(['pbxproj'])
    expect(parseSlices(spec('touches:pbxproj'))[0].touches).toEqual(['pbxproj'])
  })

  it('backticks around the prefixed value ("`area:medicacion`") do not duplicate the prefix', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | \`area:medicacion\` | \`touches:pbxproj\` |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion'])
    expect(s[0].touches).toEqual(['pbxproj'])
  })

  it('THE OTHER column\u2019s prefix ("area:x" inside Toca) is accepted (the value is not lost) but is reported as a warning', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | – | area:pbxproj |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].touches).toEqual(['pbxproj']) // the value is used, not discarded
    expect(r.prefixWarnings).toHaveLength(1)
    expect(r.prefixWarnings[0]).toMatchObject({ column: 'Toca', n: 1, raw: 'area:pbxproj' })
  })
})

// F2 — a gap the coordinator pointed at after verifying F1: a "Dep" cell with
// content (not "–"/"-"/empty) that matches NO "#N" at all produces deps: []
// in silence — the dependency graph disappears but groom exits 0 and creates
// the issues all the same. It is worse than the 0-slices case (F1, defect 1):
// that one did nothing; this one does damage (it breaks the merge-after order)
// while looking as if it worked. Same criterion as the other defects: report,
// do not lose in silence.
describe('analyzeSlicesTable — Dep with content but no recognisable #N reference at all (F2)', () => {
  it('regression: the coordinator\u2019s table — 2 rows with a malformed Dep ("S1", "S1, S2"), the row with "–" does not count', () => {
    const r = analyzeSlicesTable(REAL_DEP_TABLE)
    expect(r.tableFound).toBe(true)
    expect(r.slices).toHaveLength(3) // the "#" of all 3 rows is valid, only Dep is wrong
    expect(r.malformedDepRows).toHaveLength(2)
    expect(r.malformedDepRows[0]).toMatchObject({ n: 2, raw: 'S1' })
    expect(r.malformedDepRows[1]).toMatchObject({ n: 3, raw: 'S1, S2' })
  })

  it('"–"/"-"/empty in Dep is not malformed (it is the legitimate way of writing "no dependencies")', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | - | – | – |
| 3 | c | ui | z |  | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
  })

  it('legitimate text around a valid #N reference DOES pass (the trigger is "0 deps extracted", not "odd characters")', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #1 (tras el merge) | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
    expect(r.slices[1].deps).toEqual([1])
  })

  it('no table / no rows → malformedDepRows: []', () => {
    expect(analyzeSlicesTable('# sin tabla').malformedDepRows).toEqual([])
  })
})

// ============================================================================
// Review of F1/F2 — 2 Criticals + 4 silent paths found while reproducing the
// RED against the base code and while verifying the fix against the real spec.
// Each block below corresponds to one numbered point of that review.
// ============================================================================

// CRITICAL 1 — the em dash (—, U+2014) is how the REAL table from the incident
// writes "no dependencies" in row S1, and the set of "empty" markers only
// recognised the en dash (–) and the hyphen (-). Fixing the "#" column (as our
// own F1 message asks for) without touching anything else would make that very
// cell, which always meant "no dependencies" correctly, fire the "malformed
// Dep" abort.
describe('analyzeSlicesTable — the em dash (—) and long-dash variants in Dep/Acepta/Área/Toca mean "no value" (CRITICAL 1)', () => {
  it('an em dash (—) in Dep is not malformed — deps: []', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | — | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
    expect(r.slices[0].deps).toEqual([])
  })

  it('an em dash wrapped in NBSP (U+00A0) also counts as "no dependencies" (String#trim already strips NBSP, verified)', () => {
    const nbsp = ' '
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | ${nbsp}—${nbsp} | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
  })

  it('the EXACT regression of the sequence the coordinator described: REAL_FAILING_TABLE with "#" already fixed (1, 2) — row 1 (Dep "—") must not abort; row 2 (Dep "S1") must keep aborting', () => {
    const r = analyzeSlicesTable(REAL_TABLE_WITH_HASH_FIXED)
    expect(r.skippedRows).toEqual([]) // the "#" is already fixed
    expect(r.malformedDepRows).toHaveLength(1) // only row 2 (Dep "S1"), not row 1 (Dep "—")
    expect(r.malformedDepRows[0]).toMatchObject({ n: 2, raw: 'S1' })
    expect(r.slices[0].deps).toEqual([]) // row 1: "—" = no dependencies, correct
  })

  it('an em dash in Acepta also counts as "no AC" (same set of markers, coherent across columns)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | — | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].ac).toEqual([])
  })

  it('"ninguna"/"n/a" in Dep keep aborting (a defensible policy), but the message must say what to write — verified at CLI level', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | ninguna | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toHaveLength(1) // it is still malformed — it is not a recognised marker
  })
})

// CRITICAL 2 — markdown bold (**...**) is the real author's demonstrated habit
// (it is literally what produced the "#" defect: "**S1**"). stripColumnPrefix
// only unwrapped backticks; "**area:medicacion**" was not recognised as
// prefixed and the `:` was deleted just as in the original defect, producing
// "area:areamedicacion".
describe('parseSlices/analyzeSlicesTable — bold/italics around the prefixed value in Área/Toca (CRITICAL 2)', () => {
  it('bold (**area:medicacion**) does not duplicate the prefix, just like backticks', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | **area:medicacion** | **touches:pbxproj** |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion'])
    expect(s[0].touches).toEqual(['pbxproj'])
  })

  it('a single underscore (_area:medicacion_) does not duplicate the prefix either', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | _area:medicacion_ | – |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion'])
  })

  it('backticks + bold combined ("`**area:medicacion**`") do not duplicate the prefix either', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | x | backend | y | – | – | – | `**area:medicacion**` | – |\n'
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion'])
  })
})

// 3 — a blank line (or any line without "|") in the middle of the table made
// the row loop `break`: the rows after the gap disappeared in silence (half an
// epic created, exit 0, reported as a success). The fix scans the whole §9
// block (up to the next markdown heading "## N", which does mark the real end
// of the section) and reports the rows that appear after a gap instead of
// truncating.
describe('analyzeSlicesTable — a gap (a blank line, or one without "|") inside the table does not truncate in silence (3)', () => {
  it('a blank line between 2 data rows: both are parsed, and the row after the gap is reported in rowsAfterGap', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | primero | – | – | – |

| 2 | b | ui | segundo | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.totalDataRows).toBe(2) // it no longer truncates at 1
    expect(r.slices).toHaveLength(2)
    expect(r.slices.map((s) => s.n)).toEqual([1, 2])
    expect(r.rowsAfterGap).toHaveLength(1)
    expect(r.rowsAfterGap[0].raw).toContain('segundo')
  })

  it('with no gap at all → rowsAfterGap: []', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toEqual([])
  })

  it('a new markdown heading ("## 10. Otra sección") after the gap cuts the scan short — it does not drag in another section\u2019s table', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |

## 10. Otra sección

| Cosa | Valor |
|---|---|
| x | y |
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toEqual([])
    expect(r.slices).toHaveLength(1)
  })

  it('prose (not a table) after the table, with no further rows → rowsAfterGap: [] (it is not a false positive)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |

Texto normal después de la tabla, sin más filas.
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toEqual([])
    expect(r.slices).toHaveLength(1)
  })
})

// 4 — only the header was validated, never the cells: a row with the
// mandatory cell empty, or with fewer cells than the header (typically
// because that same row is missing its trailing cells), parsed all the same
// and produced an issue titled just "#N", with no AC and no deps, exit 0. The
// same observable result as "the whole column is missing" — only row by row.
// It is reported in `invalidRows` and the row is NOT added to `slices`.
//
// F3: the cell with mandatory content moved from "Entrega" to "Slice" (the
// issue title now comes from there) — an empty "Entrega" no longer invalidates
// anything (see the describe further up about F3), so this test is rewritten
// over "Slice" instead of "Entrega".
describe('analyzeSlicesTable — an empty "Slice" cell, or a row shorter than the header (4, updated by F3)', () => {
  it('an empty Slice cell is reported in invalidRows and does not slip into slices', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 |  | ui | y | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toHaveLength(1)
    expect(r.invalidRows[0].n).toBe(1)
    expect(r.slices).toEqual([])
  })

  it('a row with fewer cells than the header is reported in invalidRows and does not slip into slices', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui |
| 2 | b | ui | y | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toHaveLength(1)
    expect(r.invalidRows[0].n).toBe(1)
    expect(r.slices).toHaveLength(1) // row 2, which is complete, does get parsed
    expect(r.slices[0].n).toBe(2)
  })

  it('a complete and valid row does not show up in invalidRows', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toEqual([])
  })
})

// 5 — the deps were not checked against the slices that really exist in the
// table: "#99" in a table of 3 slices, or "#3" in slice 3 itself (a
// self-reference, never legitimate), parsed and would reach GitHub as
// `merge-after` — a wrong graph written into the issues, even though the
// dispatcher ends up reporting it as deps-unmet instead of failing entirely in
// silence.
describe('analyzeSlicesTable — Dep points at a slice that does not exist, or at itself (5)', () => {
  it('a self-reference (slice #3 depends on #3) is reported in invalidDepRefs', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #1 | – | – |
| 3 | c | ui | z | #3 | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidDepRefs).toHaveLength(1)
    expect(r.invalidDepRefs[0]).toMatchObject({ n: 3, dep: 3, reason: 'self' })
  })

  it('a reference to a "#" that does not exist in the table (3 slices, #99) is reported in invalidDepRefs', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #99 | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidDepRefs).toHaveLength(1)
    expect(r.invalidDepRefs[0]).toMatchObject({ n: 2, dep: 99, reason: 'unknown' })
  })

  it('valid deps (they point at existing slices, other than themselves) → invalidDepRefs: []', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #1 | – | – |
| 3 | c | ui | z | #1, #2 | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidDepRefs).toEqual([])
  })
})

// 6 — an Área/Toca cell that normalises to an empty string (say "area:" with
// nothing behind the prefix, or "???" with no label-safe character at all) was
// discarded with `.filter(Boolean)` without a warning. The ABSENT-column case
// does warn ("la maquinaria de colisión queda inerte"); the emptied-cell case
// produced the same inertia and kept quiet — incoherent with this change's own
// standard.
describe('analyzeSlicesTable — an Área/Toca token that normalises to empty is warned about (6)', () => {
  it('"area:" on its own (nothing after the prefix) → empty token, it does not slip into area[], it is warned about in emptyTokenWarnings', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | area: | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].area).toEqual([])
    expect(r.emptyTokenWarnings).toHaveLength(1)
    expect(r.emptyTokenWarnings[0]).toMatchObject({ column: 'Área', n: 1 })
  })

  it('"???" in Toca (with no label-safe character at all) → empty token, it is warned about', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | – | ??? |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].touches).toEqual([])
    expect(r.emptyTokenWarnings).toHaveLength(1)
    expect(r.emptyTokenWarnings[0]).toMatchObject({ column: 'Toca', n: 1 })
  })

  it('an empty cell or "–" (the legitimate way of writing "no value") does NOT count as an empty token', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | – |  |
`
    const r = analyzeSlicesTable(spec)
    expect(r.emptyTokenWarnings).toEqual([])
  })
})

// "the §9 table was not found" had to tell "there is no markdown table at all"
// apart from "there are table rows, but no header with Slice/Dep" — the
// detector itself already knows which of the two happened.
describe('analyzeSlicesTable — it tells "there is no table" apart from "there is a table with no Slice/Dep header"', () => {
  it('with no "|" line at all in the spec → pipeRowsFound: false', () => {
    const r = analyzeSlicesTable('# spec sin tabla, solo prosa')
    expect(r.tableFound).toBe(false)
    expect(r.pipeRowsFound).toBe(false)
  })

  it('there are markdown table rows, but no header with "Slice"/"Dep" → pipeRowsFound: true', () => {
    const spec = `## 9. Algo\n| Foo | Bar |\n|---|---|\n| 1 | 2 |\n`
    const r = analyzeSlicesTable(spec)
    expect(r.tableFound).toBe(false)
    expect(r.pipeRowsFound).toBe(true)
  })
})

// ============================================================================
// Review round 2/5 — the prefix defect was still alive one layer below (the
// comma split happened before the markup was cleaned), the end-of-table
// heuristic aborted valid specs, and 3 more silent paths.
// ============================================================================

// CRITICAL — slices.js did the comma split BEFORE stripInlineMarkup, so markup
// wrapping the WHOLE CELL (rather than each token) survived. Comma-separated
// lists are the normal documented use (commands/ct-groom.md: "db, migration"),
// not an odd case — and an author who already demonstrated wrapping values in
// bold or backticks (F1: "**S1**") wraps a list's whole cell just as easily.
describe('parseSlices — markup wrapping the WHOLE CELL of a comma-separated list (review round 2, CRITICAL)', () => {
  it('bold wrapping the whole of "area:medicacion, area:otro" → both tokens with no duplicated prefix', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | **area:medicacion, area:otro** | – |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion', 'otro'])
  })

  it('backticks wrapping the whole of "touches:pbxproj, touches:otro" → both tokens with no duplicated prefix', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | x | backend | y | – | – | – | – | `touches:pbxproj, touches:otro` |\n'
    const s = parseSlices(spec)
    expect(s[0].touches).toEqual(['pbxproj', 'otro'])
  })

  it('the exact regression of the review\u2019s example: both columns wrapped at once, no label duplicates the prefix', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | x | backend | y | – | – | – | **area:medicacion, area:otro** | `touches:pbxproj, touches:otro` |\n'
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion', 'otro'])
    expect(s[0].touches).toEqual(['pbxproj', 'otro'])
    expect(s[0].area).not.toContain('areamedicacion')
    expect(s[0].touches).not.toContain('touchespbxproj')
  })

  it('with no markup wrapping the cell, ordinary comma-separated lists keep working (no regression of the documented use)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | modelo | backend | tabla users | – | AC-1.1 | schema | api | db, migration |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['api'])
    expect(s[0].touches).toEqual(['db', 'migration'])
  })
})

// IMPORTANT — HEADING_RE (ATX headings "## ..." only) is too narrow: a
// horizontal rule, a setext heading, a bold pseudo-heading, or a "##10."
// without a space, all of them ordinary markdown, made the post-gap scan drag
// in ANOTHER section's table and abort quoting an example from the wrong table.
// Cheap fix: after a gap, if the next row with "|" is immediately followed by a
// separator row (a new table's header + separator), the scan is cut short
// without counting it as a continuation — the 4 false positives all have that
// shape; the line break in the middle of THE SAME table (the real case) does
// not.
describe('analyzeSlicesTable — the post-gap scan does not drag in a foreign table (review round 2, IMPORTANT)', () => {
  it('a horizontal rule ("---") before an unrelated table, with NO markdown heading in between → it does not abort', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |

---

| Cosa | Valor |
|---|---|
| x | y |
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toEqual([])
    expect(r.skippedRows).toEqual([])
    expect(r.slices).toHaveLength(1)
  })

  it('a setext heading ("Riesgos" + the underline "-------") before a foreign table → it does not abort', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |

Riesgos
-------

| Cosa | Valor |
|---|---|
| x | y |
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toEqual([])
    expect(r.slices).toHaveLength(1)
  })

  it('a bold pseudo-heading ("**10. Riesgos**") before a foreign table → it does not abort', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |

**10. Riesgos**

| Cosa | Valor |
|---|---|
| x | y |
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toEqual([])
    expect(r.slices).toHaveLength(1)
  })

  it('"##10." with no space after the hashes before a foreign table → it does not abort', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |

##10.Riesgos

| Cosa | Valor |
|---|---|
| x | y |
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toEqual([])
    expect(r.slices).toHaveLength(1)
  })

  it('the REAL case (a blank line in the middle of THE SAME table) still fires rowsAfterGap — the true positive has not been lost', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | primero | – | – | – |

| 2 | b | ui | segundo | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toHaveLength(1)
    expect(r.rowsAfterGap[0].raw).toContain('segundo')
    expect(r.slices).toHaveLength(2)
  })
})

// a) A row LONGER than the header (an unescaped "|" inside a cell shifts the
// following columns in silence) — before, only "fewer cells" was checked, never
// "more".
describe('analyzeSlicesTable — a row with MORE cells than the header (column shift) (review round 2, a)', () => {
  it('a row with more cells than the header is reported in invalidRows, it does not slip into slices with shifted columns', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – | med | icacion | pbx |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toHaveLength(1)
    expect(r.invalidRows[0].n).toBe(1)
    expect(r.slices).toEqual([]) // it does not slip in with area:['med']/touches:['icacion'] and "pbx" lost
  })
})

// b) "Entrega" with a "nothing" marker (–, -, —, and so on) → an issue titled
// "#1 –", exit 0 — the one column where content is mandatory treated "there is
// nothing here" as if it were a valid title.
//
// F3: the title no longer comes from "Entrega" — it comes from "Slice" (see
// below). "Entrega" becomes optional (the body's Descripción), so a "no value"
// marker there NO longer invalidates the row: it means "no description",
// exactly as in Acepta/Protegido/Área/Toca. The same demand for real content
// moves to "Slice", which is where the title comes from now.
describe('analyzeSlicesTable — "Entrega" with a "no value" marker NO longer invalidates the row (F3: the mandatory content moved to "Slice")', () => {
  it('"Entrega" = "–" (with real content in Slice) no longer aborts the row — "no description", not "no title"', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | – | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toEqual([])
    expect(r.slices).toHaveLength(1)
    expect(r.slices[0].entrega).toBe('–')
  })

  it('"Slice" = "–" (a "no value" marker) DOES invalidate the row — that is where the title comes from now', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | – | ui | y | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toHaveLength(1)
    expect(r.slices).toEqual([])
  })
})

// c) A "nothing" marker WRAPPED in markup ("`–`", "**–**") in Dep — the same
// shape as the em dash CRITICAL: isNoValueCell ran over the raw cell, so the
// author who already demonstrated wrapping values in markup got the message "si
// no hay dependencias, escribe –" for writing EXACTLY that, only wrapped.
describe('analyzeSlicesTable — a "nothing" marker wrapped in markup (review round 2, c)', () => {
  it('"`–`" (backtick) in Dep is not malformed — deps: []', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |\n' +
      '|---|---|---|---|---|---|---|\n' +
      '| 1 | a | ui | x | `–` | – | – |\n'
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
    expect(r.slices[0].deps).toEqual([])
  })

  it('"**–**" (bold) in Dep is not malformed — deps: []', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | **–** | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
    expect(r.slices[0].deps).toEqual([])
  })

  it('"**–**" (bold) in Acepta also counts as "no AC" (the same shared isNoValueCell)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | **–** | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].ac).toEqual([])
  })
})

// Minor — the mathematical minus sign (−, U+2212) and the double hyphen ("--")
// are plausible outputs of keyboard or editor autocorrection, just like the em
// dash.
describe('analyzeSlicesTable — the minus sign (−, U+2212) and the double hyphen ("--") also mean "no value" (minor)', () => {
  it('a U+2212 minus sign in Dep is not malformed', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | − | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
  })

  it('a double hyphen "--" in Dep is not malformed', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | -- | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
  })
})

// ============================================================================
// Review round 3/5 — the prefix Critical, for the third time. The two previous
// rounds patched by LAYER (the borders of the whole cell, then the borders of
// each piece), and each patch covered one shape of markup and left another
// uncovered depending on which position it fell in. Reproduced by the
// coordinator on the first try with each token wrapped in ITS OWN backtick —
// the split broke it into "`area:hoy" and "area:web`" and neither of the two
// started and ended with the same backtick on its own, so the second token kept
// failing.
//
// A new approach: normalise in one go, not by layers. A backtick (`) and an
// asterisk (*) are NEVER legitimate inside a label token, so they are stripped
// GLOBALLY from the whole cell — in any position, with no attempt to detect
// "wrapping pairs" — before splitting on commas. An underscore (_) IS
// legitimate inside a token (normalizeToken already allows it, "mi_token" for
// instance), so THAT one is stripped only at the borders of each token, after
// the split, not globally.
describe('parseSlices — markup normalisation in a single pass, not by layers (review round 3)', () => {
  it('the coordinator\u2019s EXACT REPRODUCTION: each token wrapped in ITS OWN backtick — "`area:hoy`, `area:web`"', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | x | backend | y | – | – | – | `area:hoy`, `area:web` | – |\n'
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['hoy', 'web'])
    expect(s[0].area).not.toContain('areaweb')
  })

  it('the four shapes of markup, in the SAME table, all produce clean labels (it closes the class, not one case)', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | celda entera envuelta | backend | y | – | – | – | **area:medicacion, area:otro** | – |\n' +
      '| 2 | cada token envuelto | backend | y | – | – | – | `area:hoy`, `area:web` | – |\n' +
      '| 3 | mezcla | backend | y | – | – | – | **area:x**, `area:y` | – |\n' +
      '| 4 | envoltura anidada | backend | y | – | – | – | `**area:z**` | – |\n'
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion', 'otro']) // whole cell wrapped
    expect(s[1].area).toEqual(['hoy', 'web']) // each token wrapped
    expect(s[2].area).toEqual(['x', 'y']) // a mixture
    expect(s[3].area).toEqual(['z']) // nested wrapping
    for (const slice of s) {
      for (const token of slice.area) {
        expect(token).not.toMatch(/^area/) // none may keep the duplicated prefix ("areax", "areahoy", and so on)
      }
    }
  })

  it('negative control: "areas-comunes" (hyphen) and a token with an INTERNAL underscore ("mi_token") survive intact', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | areas-comunes | mi_token |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['areas-comunes'])
    expect(s[0].touches).toEqual(['mi_token'])
  })

  it('an emphasis underscore IS stripped at the token\u2019s borders ("_area:medicacion_"), without touching the internal one of another token in the same cell', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | _area:medicacion_, mi_token | – |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion', 'mi_token'])
  })

  it('a "no value" marker (Dep) wrapped in a backtick as a single token is still recognised (isNoValueCell with the same single-pass approach)', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |\n' +
      '|---|---|---|---|---|---|---|\n' +
      '| 1 | a | ui | x | `–` | – | – |\n'
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
    expect(r.slices[0].deps).toEqual([])
  })
})

// ============================================================================
// Review round 4/5 (the last one of F1) — two things that corrupt data:
//
// 1. A NEW REGRESSION from round 3: stripping the underscore by borders
//    (^_+ / _+$) does not tell an emphasis PAIR (_x_, __x__) apart from a
//    leading or trailing underscore with NO partner — which is exactly how
//    "_layout.tsx"/"_app.tsx" (Expo Router, Next.js) and "__init__.py"
//    (Python) begin, and how "trailing_" can end. The token IS the collision
//    key of claim.js#tokensOf (an exact comparison), so corrupting
//    "_layout.tsx" into "layout.tsx" produces false collisions.
//
// 2. The class of wrappers was wider than backtick/asterisk/underscore: any
//    non-alphanumeric character BEFORE "area:" (~~, straight quotes,
//    parentheses, markdown links…) reproduced the original defect, because
//    stripColumnPrefix demanded the prefix at index 0. Fix: invert the
//    approach — stripColumnPrefix skips the leading NON-alphanumeric
//    characters ONLY to detect the prefix (without mutating), and returns the
//    ORIGINAL string untouched if it finds no prefix there. That way it stops
//    depending on which wrapper the author uses, without destroying content
//    when there is no prefix.
// ============================================================================

describe('parseSlices — the underscore is stripped ONLY if it is symmetrically paired (review round 4, issue 1: a regression)', () => {
  it('a negative control of file names: they survive INTACT (it fails if the asymmetric ^_+/_+$ comes back)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | backend | y | – | – | – | – | _layout.tsx |
| 2 | b | backend | y | – | – | – | – | _app.tsx |
| 3 | c | backend | y | – | – | – | – | __init__.py |
| 4 | d | backend | y | – | – | – | – | trailing_ |
| 5 | e | backend | y | – | – | – | – | mi_token_largo |
| 6 | f | backend | y | – | – | – | areas-comunes | – |
`
    const s = parseSlices(spec)
    expect(s[0].touches).toEqual(['_layout.tsx'])
    expect(s[1].touches).toEqual(['_app.tsx'])
    expect(s[2].touches).toEqual(['__init__.py']) // the telltale signal: NEVER "init__.py"
    expect(s[3].touches).toEqual(['trailing_'])
    expect(s[4].touches).toEqual(['mi_token_largo'])
    expect(s[5].area).toEqual(['areas-comunes'])
  })

  it('a symmetrically paired underscore (_x_, __x__) IS stripped — real markdown emphasis', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | backend | y | – | – | – | _area:medicacion_ | __touches:pbxproj__ |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion'])
    expect(s[0].touches).toEqual(['pbxproj'])
  })

  it('"___" (underscores only, an odd number) no longer disappears in silence: it survives as content, with no warning (nothing to warn about)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | backend | y | – | – | – | ___ | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].area).toEqual(['_'])
    expect(r.emptyTokenWarnings).toEqual([])
  })
})

describe('parseSlices — stripColumnPrefix inverted: it detects the prefix by skipping leading junk, without destroying anything when there is no prefix (review round 4, issue 2)', () => {
  it('the matrix of wrappers (backtick, asterisk, paired underscore, ~~, straight quotes, parentheses, nested ones) — they all produce clean labels, with no duplicated prefix, in the SAME table', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | backtick | backend | y | – | – | – | `area:med` | – |\n' +
      '| 2 | asterisco | backend | y | – | – | – | **area:med** | – |\n' +
      '| 3 | guion bajo | backend | y | – | – | – | _area:med_ | – |\n' +
      '| 4 | tachado | backend | y | – | – | – | ~~area:med~~ | – |\n' +
      '| 5 | comillas rectas | backend | y | – | – | – | "area:med" | – |\n' +
      '| 6 | parentesis | backend | y | – | – | – | (area:med) | – |\n' +
      '| 7 | anidado | backend | y | – | – | – | `**area:med**` | – |\n'
    const s = parseSlices(spec)
    for (const slice of s) {
      expect(slice.area).toEqual(['med'])
    }
  })

  it('a negative control of the inverted version itself: "areas-comunes" (it starts like "area" but is not the "area:" marker) is not mutilated', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | backend | y | – | – | – | areas-comunes | – |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['areas-comunes'])
  })

  it('the coordinator\u2019s reproduction (round 3, already closed): each token in its own backtick still works with the new inverted approach', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | x | backend | y | – | – | – | `area:hoy`, `area:web` | – |\n'
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['hoy', 'web'])
  })
})

describe('analyzeSlicesTable — a token that legitimately ends up empty always warns, even going through the underscore pass (review round 4, issue 3)', () => {
  it('"_~~_" (an underscore pair wrapping only a strikethrough, with no label-safe character at all) ends up empty and DOES warn — F1\u2019s guarantee holds after the underscore pass', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | backend | y | – | – | – | _~~_ | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].area).toEqual([])
    expect(r.emptyTokenWarnings).toHaveLength(1)
    expect(r.emptyTokenWarnings[0]).toMatchObject({ column: 'Área', n: 1 })
  })
})

// ============================================================================
// F3 — the issue title comes from the wrong cell. buildIssueTitle (groom.js)
// composed "#N <Entrega>" while the text of "Slice" was discarded (only a
// "#NN" was extracted from it into `slice.issue`) — an author who writes the
// natural thing (a short name in Slice, a description in Entrega) got a whole
// paragraph as the issue title. Decision: the title comes from "Slice"
// (`#N <Slice>`); "Slice" becomes MANDATORY CONTENT (as mandatory as "Entrega"
// was before); "Entrega" becomes optional and turns into a description inside
// the body (see groom.test.js). `slice.name` is the text of "Slice" already
// cleaned of any "#NN" reference (which is still extracted, separately, into
// `slice.issue` as always) — that way the title never drags a dangling hash
// along when the Slice cell carries BOTH things (a name and an issue
// reference) at once.
// ============================================================================

describe('analyzeSlicesTable/parseSlices — "Slice" feeds slice.name (the issue title) (F3)', () => {
  it('a Slice with no "#NN" at all → name is the text as it stands, issue null', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login model | backend | modelo de sesión | – | – | – |
`
    const s = parseSlices(spec)
    expect(s[0].name).toBe('login model')
    expect(s[0].issue).toBeNull()
  })

  it('a Slice with a name and a "#NN" reference at once → issue extracts "#NN", name is left WITHOUT that reference (no dangling hash in the title)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | #42 notifications | backend | motor de notificaciones | – | – | – |
`
    const s = parseSlices(spec)
    expect(s[0].issue).toBe('#42')
    expect(s[0].name).toBe('notifications')
    expect(s[0].name).not.toMatch(/#/)
  })

  it('a Slice with the "#NN" reference in the middle of the text → only the hash is removed, the rest of the name survives with no double spaces', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login #7 model | backend | y | – | – | – |
`
    const s = parseSlices(spec)
    expect(s[0].issue).toBe('#7')
    expect(s[0].name).toBe('login model')
  })

  it('the "Slice" cell still recognises the "no value" marker (–) as empty (it invalidates the row)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | – | ui | y | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toHaveLength(1)
    expect(r.slices).toEqual([])
  })

  it('a Slice carrying ONLY "#7" (with no name around it) → name is left empty after removing the hash → an invalid row (there is no reliable title)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | #7 | ui | y | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toHaveLength(1)
    expect(r.invalidRows[0].reason).toMatch(/Slice/)
    expect(r.slices).toEqual([])
  })

  it('a valid row (a Slice with content) does not show up in invalidRows, and "entrega" keeps being populated from the Entrega column, unchanged', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo de sesión | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toEqual([])
    expect(r.slices[0].name).toBe('login')
    expect(r.slices[0].entrega).toBe('modelo de sesión')
  })
})

// F6, important 3: the contract says "Acepta: criterios coma-separados" and
// does not warn that a comma INSIDE a criterion chops it up in silence. And the
// heading of the section it generates is literally "Acceptance criteria
// (EARS, 1:1 con tests)": EARS syntax ("Cuando <trigger>, el sistema debe
// <respuesta>") carries a comma almost always, so it is not an odd case — it is
// the natural way of writing this column. An escape (`\,`) is supported and
// declared in the contract (ct-init.sh).
describe('analyzeSlicesTable — "Acepta": an escaped comma (\\,) does NOT chop the criterion up (F6, important 3)', () => {
  it('an escaped comma is kept as part of the criterion, and does not count as a separator', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | x | – | Cuando el token caduca\\, el sistema pide login | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].ac).toEqual(['Cuando el token caduca, el sistema pide login'])
  })
  it('an UNescaped comma keeps separating criteria (the behaviour it always had)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | x | – | AC-1.1, AC-1.2 | – |
`
    expect(analyzeSlicesTable(spec).slices[0].ac).toEqual(['AC-1.1', 'AC-1.2'])
  })
  it('a mixture: real separators + an escaped comma inside a criterion', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | x | – | AC-1.1, Cuando A\\, entonces B, AC-1.3 | – |
`
    expect(analyzeSlicesTable(spec).slices[0].ac).toEqual(['AC-1.1', 'Cuando A, entonces B', 'AC-1.3'])
  })
  it('a backslash that does not precede a comma is kept as it stands (it does not eat anyone else\u2019s escape)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | x | – | ruta C:\\Users existe | – |
`
    expect(analyzeSlicesTable(spec).slices[0].ac).toEqual(['ruta C:\\Users existe'])
  })
  // The OTHER cells the contract calls "coma-separadas" (checked column by
  // column, F6): "Protegido" is NOT chopped up by commas at all (it is free
  // text of a single piece), "Dep" is not chopped up either (the "#N"
  // references are extracted with a regex, so a comma inside changes nothing),
  // and "Área"/"Toca" ARE chopped up but their values are label tokens where
  // the comma is discarded on normalising anyway — so an escape there would
  // mean nothing. Only "Acepta" had the problem.
  it('"Protegido" is not chopped up by commas (free text of a single piece)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | x | – | AC-1.1 | schema, migraciones y CI |
`
    expect(analyzeSlicesTable(spec).slices[0].protected).toBe('schema, migraciones y CI')
  })
  it('"Dep" with commas between references does not depend on the split: the #N are extracted all the same', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | backend | x | – | – | – |
| 2 | b | backend | x | – | – | – |
| 3 | c | backend | x | #1 (tras el merge), #2 | – | – |
`
    expect(analyzeSlicesTable(spec).slices[2].deps).toEqual([1, 2])
  })
})

// Slice 10 — the `Señal` column: the observability signal the slice promises.
// Like `Gate`, the parser hands over the RAW cell (trimmed) without resolving
// anything: telling "a declared signal" apart from "a reasoned exemption
// N/A — <reason>" and from "not declared" is groom.js#parseSignalCell's business
// — this parser knows nothing about signals, just as it knows nothing about
// gates or labels. Unlike `Gate`, the column's absence DOES go into
// missingOptionalColumns: its consequence is measurable (the slice judge
// measures its `observabilidad` item as without-a-yardstick across the whole
// epic).
describe('analyzeSlicesTable — the Señal column (Slice 10)', () => {
  const SPEC_SIGNAL = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Señal |
|---|-------|------|---------|-----|--------|-----------|------|------|------|-------|
| 1 | modelo | backend | tabla | – | AC-1.1 | schema | api | db | – | – |
| 2 | barra | backend | backfill | #1 | AC-2.1 | – | api | db | – | métrica \`backfill_progress\` con label \`estado\` |
| 3 | pantalla | ui | alta | #2 | AC-3.1 | – | api | app | – | N/A — pantalla sin telemetría nueva que prometer |
`
  it('the raw cell arrives in slice.senal, unresolved', () => {
    const r = analyzeSlicesTable(SPEC_SIGNAL)
    expect(r.missingOptionalColumns).not.toContain('Señal')
    // The cell arrives VERBATIM (only trimmed): the "no value" marker and the
    // N/A exemption arrive as they stand — the classification lives in
    // groom.js.
    expect(r.slices[0].senal).toBe('–')
    expect(r.slices[1].senal).toBe('métrica `backfill_progress` con label `estado`')
    expect(r.slices[2].senal).toBe('N/A — pantalla sin telemetría nueva que prometer')
  })
  it('the spelling "Senal" without the accent resolves to the same column', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Senal |
|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | métrica viva |
`
    const r = analyzeSlicesTable(spec)
    expect(r.missingOptionalColumns).not.toContain('Señal')
    expect(r.slices[0].senal).toBe('métrica viva')
  })
  it('with no Señal column, it goes into missingOptionalColumns and the slices carry an empty senal', () => {
    const r = analyzeSlicesTable(SPEC_AREA_TOUCHES)
    expect(r.missingOptionalColumns).toContain('Señal')
    for (const s of r.slices) expect(s.senal).toBe('')
  })
})
