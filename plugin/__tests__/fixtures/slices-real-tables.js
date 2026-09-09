// Fixtures shared between __tests__/slices.test.js (the pure parser) and
// __tests__/ct-groom-dryrun.test.js (the end-to-end CLI). Their entire value as
// a regression is being byte-exact to the real tables that triggered each
// incident — they used to live duplicated literally in both files, which
// guarantees they would diverge over time (someone tweaks one copy to make a
// new test pass and the other is left paraphrased without anyone noticing). One
// single source of truth.
//
// The table contents below are NOT translated and are not to be paraphrased:
// they are the exact rows of the incident reports, and the moment they are
// reworded they stop testing what they exist to test.

// F1 — the real table that triggered the original incident: someone who had
// not read commands/ct-groom.md wrote "#" as "**S1**"/"**S2**" (numbering with
// a letter prefix and markdown bold instead of a plain integer), S1's Dep as an
// em dash "—" (which DOES mean "no dependencies", see CRITICAL 1 of the F1
// review) and S2's as "S1" (without "#"), and the value of Area/Touches as the
// label's full name ("`area:medicacion`"/"`touches:pbxproj`", with backticks)
// instead of the bare token. With the old parser this produced
// `parseSlices() -> []` in complete silence. Not paraphrased: these are the
// exact rows of the incident report.
export const REAL_FAILING_TABLE = [
  '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices',
  '| # | Slice | Qué entrega (visible) | Área | Toca | Depende de |',
  '|---|---|---|---|---|---|',
  '| **S1** | Segmented control + "Plan actual" | La pestaña se parte en dos… | `area:medicacion` | `touches:pbxproj` | — |',
  '| **S2** | Objetivo semanal y cumplimiento | La barra: % de la semana… | `area:medicacion` | `touches:migration` | S1 |',
  '',
].join('\n')

// F2 — the table the coordinator verified the F1 fix with, and where they found
// the adjacent gap: with "#" already corrected (1, 2, 3), "Dep" still uses
// "S1"/"S2" instead of "#1"/"#2" — deps: [] in silence, exit 0, dependency
// graph erased.
export const REAL_DEP_TABLE = [
  '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices',
  '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |',
  '|---|---|---|---|---|---|---|',
  '| 1 | a | ui | primero | – | – | – |',
  '| 2 | b | ui | segundo | S1 | – | – |',
  '| 3 | c | ui | tercero | S1, S2 | – | – |',
  '',
].join('\n')

// F1 CRITICAL 1 (review) — REAL_FAILING_TABLE with "#" already corrected to a
// plain integer (1, 2), exactly as our own error message asks, without touching
// anything else. Row 1 still uses the em dash "—" in Dep (which always
// correctly meant "no dependencies") and row 2 still uses "S1" (which really is
// still a malformed Dep). The fix has to let row 1 through without aborting on
// Dep and go on aborting on row 2 — the exact reproduction of the sequence the
// coordinator described: "the menoplus session fixes the # column exactly as we
// tell them to, runs again → aborts on a cell that correctly means «no
// dependencies»".
export const REAL_TABLE_WITH_HASH_FIXED = [
  '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices',
  '| # | Slice | Qué entrega (visible) | Área | Toca | Depende de |',
  '|---|---|---|---|---|---|',
  '| 1 | Segmented control + "Plan actual" | La pestaña se parte en dos… | `area:medicacion` | `touches:pbxproj` | — |',
  '| 2 | Objetivo semanal y cumplimiento | La barra: % de la semana… | `area:medicacion` | `touches:migration` | S1 |',
  '',
].join('\n')
