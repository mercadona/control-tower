// ============================================================================
// F21 — THE HUMAN GATE AND THE TECHNICAL TYPE WERE THE SAME COLUMN.
//
// The finding, which came out of dispatching a real slice: the only human gate
// that existed in the whole plugin lived INSIDE the text string of the `ui`
// addendum (kickoff.js#ADDENDA). There was no other mechanism at all — not in
// slices.js, nor in groom.js, nor in the issue body, nor in the labels. That
// is: the `Tipo` column of the §9 table decided TWO things at once, which
// technical reminder the agent receives and whether there is a human gate, and
// those two axes do not always coincide. The real case: a `Tipo: backend`
// slice (a migration with a backfill) that the epic's spec explicitly marked as
// needing a visual gate because "la barra es lo más visible de todo el spec".
// It received the backend addendum and NO gate at all, and nothing flagged it.
//
// The layer of irony to understand before reading these tests: the epic's spec
// said "el gate visual no depende de esto: vive en §10 y en la REGLA #-2, que
// son más fuertes que un addendum". That is true for a HUMAN who reads the
// spec. The dispatched agent does NOT read the spec: it receives the kickoff
// and the issue body, and that section appears in neither of the two. A
// guarantee that lives only in a document its addressee never opens is not a
// guarantee — and that is the underlying property this round pursues:
//
//   NO DEMAND THE SPEC MAKES OF THE AGENT CAN DEPEND ON THE AGENT READING THE
//   SPEC.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir } from './fixtures/spec-repo.js'
import { renderKickoff, buildStateSeed, ADDENDA } from '../scripts/kickoff.js'
import { parseState } from '../scripts/state.js'
import { analyzeSlicesTable } from '../scripts/slices.js'
import { buildLabels, buildIssueBody, groomPlan } from '../scripts/groom.js'
import { mapGhIssue } from '../scripts/gh-issue-map.js'
import { GATES, TYPE_GATES, resolveGates, gatesForType, gatesFromLabels, GATE_LABEL_NONE } from '../scripts/gates.js'
import { GO_TOKEN } from '../scripts/go-response.js'

const here = dirname(fileURLToPath(import.meta.url))
const groomScript = join(here, '..', 'scripts', 'ct-groom.mjs')
const initScript = join(here, '..', 'scripts', 'ct-init.sh')
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']
const fakeGhDir = join(here, 'fixtures', 'fake-gh-bin')
const fakeEnv = (overrides = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...overrides })

const SLICE = { n: 7, name: 'barra de progreso', type: 'backend', ac: ['AC-7.1'], deps: [], issue: '#7' }

// specWith: the ten-column §9 table (the usual nine + `Gate`), with whatever
// rows it is given. It is written out whole here and not with a helper from the
// product on purpose: a test that composes the table with the same code that
// parses it checks nothing.
function specWith(rows) {
  return [
    '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices',
    '',
    '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

function dryRun(specText, extraArgs = []) {
  const dir = makeSpecDir('f21-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, specText)
  const res = spawnSync('node', [groomScript, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run', ...extraArgs], {
    encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv(),
  })
  rmSync(dir, { recursive: true, force: true })
  return res
}

// ============================================================================
// 1. The vocabulary of gates: closed, and derived from what ALREADY existed.
// ============================================================================
describe('F21 — the vocabulary of gates', () => {
  it('the gates that exist come out of the addenda that already imposed them, plus the deliberate addition of F-jjponz-1', () => {
    // `ui` imposed "gate de screenshot obligatorio"; `infra`, "apply solo tras
    // review". They are the two ONLY phrases of ADDENDA that demanded a human
    // act; the rest are technical reminders. `plan` (F-jjponz-1) is the first
    // gate ADDED through the route the doctrine of gates.js reserves for that:
    // a deliberate act, with its kickoff text and its issue text (see
    // gate-plan.test.js). No Tipo implies it. `e2e` (the "e2e al cierre del
    // slice" feature) is the second: also deliberate, with its two texts, and
    // no Tipo implies it either — it is DERIVED from the E2E column (see
    // gates.js#resolveGates), never from `Tipo`.
    expect(Object.keys(GATES).sort()).toEqual(['apply', 'e2e', 'plan', 'visual'])
    expect(TYPE_GATES.ui).toEqual(['visual'])
    expect(TYPE_GATES.infra).toEqual(['apply'])
    // D-14 retires F-jjponz-2's universal default: no `Tipo` implies `plan`
    // any more (gatesForType always returned it; now it returns exactly the
    // Tipo's own gates). A row still gets it by writing `plan` in its `Gate`
    // column, same as any gate no Tipo implies.
    expect(gatesForType('backend')).toEqual([])
    expect(gatesForType('')).toEqual([])
    expect(gatesForType(undefined)).toEqual([])
  })

  it('the addenda stop carrying a gate inside: what is left are TECHNICAL reminders and nothing more', () => {
    // It is the "separate the two axes" half of the fix. If the gate's phrase
    // also stayed inside the addendum, a `ui` slice that WAIVES the gate would
    // keep receiving it — the addendum would contradict the resolved gate.
    for (const [type, text] of Object.entries(ADDENDA)) {
      expect(text.toLowerCase(), type).not.toMatch(/screenshot|\bgate\b|tras review/)
    }
    // Check: the addenda still exist and are still technical.
    expect(ADDENDA.ui.toLowerCase()).toMatch(/design system/)
    expect(ADDENDA.infra.toLowerCase()).toMatch(/dry-run/)
  })
})

// ============================================================================
// 2. resolveGates: the two axes, separated at last.
// ============================================================================
describe('F21 — resolveGates(type, Gate cell)', () => {
  it('with no cell: the gates come out of the Tipo, with no universal default any more (D-14)', () => {
    expect(resolveGates('ui', '').gates).toEqual(['visual'])
    expect(resolveGates('ui', undefined).gates).toEqual(['visual'])
    expect(resolveGates('infra', '').gates).toEqual(['apply'])
    expect(resolveGates('backend', '').gates).toEqual([])
  })

  it('a "no value" marker in Gate means "I have declared nothing", NOT "I waive everything"', () => {
    // The same emptiness criterion as Dep/Acepta/Protegido/Área/Toca. An author
    // who fills the column with "–" because the rest of the row carries one is
    // not waiving the gate of their Tipo — reading it that way would be removing
    // a gate in silence, precisely the opposite of what this round asks for.
    for (const marker of ['-', '–', '—', '―', '−', '--']) {
      expect(resolveGates('ui', marker).gates, marker).toEqual(['visual'])
      expect(resolveGates('ui', marker).waived, marker).toEqual([])
    }
  })

  it('the case that motivates the round: a gate the Tipo does NOT imply is declared, and is marked as such', () => {
    const r = resolveGates('backend', 'visual')
    expect(r.gates).toEqual(['visual'])
    expect(r.added).toEqual(['visual']) // what has to be said out loud
    expect(r.implied).toEqual([])
  })

  it('waiving a gate implied by the Tipo is explicit (`!visual`) and is recorded', () => {
    const r = resolveGates('ui', '!visual')
    expect(r.gates).toEqual([])
    expect(r.waived).toEqual(['visual'])
  })

  it('waiving a gate the Tipo does not imply does nothing, and that is reported (not kept quiet)', () => {
    const r = resolveGates('backend', '!visual')
    expect(r.gates).toEqual([])
    expect(r.inertWaivers).toEqual(['visual'])
  })

  it('declaring a gate the Tipo already implies is redundant, not an error, and is reported', () => {
    const r = resolveGates('ui', 'visual')
    expect(r.gates).toEqual(['visual'])
    expect(r.redundant).toEqual(['visual'])
    expect(r.added).toEqual([])
  })

  it('asking for and waiving the same gate in the same cell is a contradiction, not a silent winner', () => {
    const r = resolveGates('ui', 'visual, !visual')
    expect(r.contradictions).toEqual(['visual'])
  })

  it('a token that is not in the vocabulary produces NO gate and is reported (a gate nobody knows how to check is never invented)', () => {
    const r = resolveGates('backend', 'seguridad')
    expect(r.gates).toEqual([])
    expect(r.unknown).toEqual(['seguridad'])
    expect(resolveGates('ui', '!seguridad').unknown).toEqual(['seguridad'])
  })

  it('"none" is not a valid token: waiving is per gate, by name, never wholesale', () => {
    expect(resolveGates('ui', 'none').unknown).toEqual(['none'])
    expect(resolveGates('ui', 'none').gates).toEqual(['visual']) // the gate of the Tipo still stands
  })

  it('it tolerates capitals and inline markup, just like the rest of the columns of the §9 table', () => {
    expect(resolveGates('backend', '`Visual`').gates).toEqual(['visual'])
    expect(resolveGates('ui', '**!visual**').gates).toEqual([])
    expect(resolveGates('ui', '! visual').gates).toEqual([])
  })

  it('the order of the resolved gates is deterministic, however the cell arrives', () => {
    expect(resolveGates('backend', 'apply, visual').gates).toEqual(resolveGates('backend', 'visual, apply').gates)
  })

  // ==========================================================================
  // Cases that were not in the errand, which came out of probing the parser.
  // ==========================================================================
  it('it tolerates the full label prefix ("gate:visual"), which is what the author sees in the GitHub UI', () => {
    // The same mistake, and the same remedy, as slices.js#stripColumnPrefix for
    // "area:x" inside the Área column. Without this, writing what you see in
    // GitHub fell into the abort of "gate desconocido".
    expect(resolveGates('backend', 'gate:visual').gates).toEqual(['visual'])
    expect(resolveGates('ui', '!gate:visual').gates).toEqual([])
  })

  it('a "!" with no gate behind it is reported, not discarded in silence', () => {
    // The cell was NOT empty: its author believes they declared something. It
    // is the smallest version of the failure this whole round pursues.
    expect(resolveGates('ui', '!').unknown).toEqual(['!'])
  })

  it('a token with spaces in it ("visual visual", with no comma) does not slip through as a gate', () => {
    expect(resolveGates('backend', 'visual visual').gates).toEqual([])
    expect(resolveGates('backend', 'visual visual').unknown).toEqual(['visual visual'])
  })

  it('declaring the same gate twice does not duplicate it in the output', () => {
    expect(resolveGates('backend', 'visual, visual').gates).toEqual(['visual'])
    expect(resolveGates('backend', 'visual, visual').added).toEqual(['visual'])
  })

  it('a Tipo that does not match exactly (capitals, a typo) implies NO technical gate — the /ct-groom warning is what says so', () => {
    // It is documented as behaviour, not "fixed" by making it
    // case-insensitive: ADDENDA compares just as exactly, and two different
    // criteria for the same column would be worse than one strict criterion
    // with a voice. With D-14, nothing implicit survives a typo any more: a
    // mismatched Tipo now implies exactly no gate at all.
    expect(gatesForType('UI')).toEqual([])
    expect(gatesForType('iu')).toEqual([])
  })
})

// ============================================================================
// 3. The `Gate` column of the §9 table.
// ============================================================================
describe('F21 — the Gate column in the §9 table', () => {
  it('it is parsed as a raw cell of the slice, and the report says the column exists', () => {
    const report = analyzeSlicesTable(specWith(['| 1 | barra | backend | tabla | – | AC-1.1 | – | med | db | visual |']))
    expect(report.slices[0].gate).toBe('visual')
    expect(report.gateColumnPresent).toBe(true)
  })

  it('a table WITH NO Gate column (every one that exists today) still works and does NOT generate an absent-column warning', () => {
    // Every absent optional column prints a warning today with its consequence.
    // The consequence of `Gate` being missing is… none: the gates are derived
    // from the Tipo exactly as before. A warning that comes out always and
    // describes no degradation is noise that trains you to ignore the rest.
    const md = [
      '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices', '',
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | pantalla | ui | alta | – | AC-1.1 | – | med | app |', '',
    ].join('\n')
    const report = analyzeSlicesTable(md)
    expect(report.gateColumnPresent).toBe(false)
    expect(report.missingOptionalColumns).not.toContain('Gate')
    expect(report.slices[0].gate).toBe('')
  })
})

// ============================================================================
// 4. The gate travels to the ISSUE: labels (machine) and body (human).
// ============================================================================
describe('F21 — the gate reaches GitHub, not just the kickoff', () => {
  const uiSlice = { n: 1, name: 'pantalla', type: 'ui', gate: '', ac: [], deps: [], area: [], touches: [] }
  const backendWithGate = { ...uiSlice, type: 'backend', gate: 'visual' }
  const bareBackend = { ...uiSlice, type: 'backend', gate: '' }

  it('a slice with a gate carries its gate:<token> label, in a deterministic position', () => {
    const labels = buildLabels(uiSlice)
    expect(labels).toContain('gate:visual')
    expect(labels.indexOf('gate:visual')).toBeLessThan(labels.indexOf('status:backlog'))
    expect(buildLabels(backendWithGate)).toContain('gate:visual')
  })

  it('a slice with no technical gates and no declared `plan` carries `gate:none`; a row that writes `plan` still gets `gate:plan`', () => {
    // D-14 retires the universal default: `bareBackend` (a `Tipo` with no
    // technical gate, and an empty `Gate` cell) now resolves to no gates at
    // all, exactly like the old `gate:none` case. `plan` has not left the
    // vocabulary — a row that writes it in its `Gate` column still gets it.
    expect(buildLabels(bareBackend)).toContain(GATE_LABEL_NONE)
    expect(buildLabels(bareBackend)).not.toContain('gate:plan')
    expect(buildLabels({ ...bareBackend, gate: 'plan' })).toContain('gate:plan')
    expect(buildLabels(uiSlice)).not.toContain(GATE_LABEL_NONE)
  })

  it('the issue body carries a gates section a human sees on opening the PR', () => {
    const body = buildIssueBody(uiSlice, {})
    expect(body).toContain('## Gates')
    expect(body.toLowerCase()).toMatch(/screenshot|captura/)
    expect(body.toLowerCase()).toMatch(/human/) // who closes it
  })

  it('the gates section ALWAYS exists, also when there is none (a declared absence, not silence)', () => {
    const body = buildIssueBody({ ...bareBackend, gate: '!plan' }, {})
    expect(body).toContain('## Gates')
    // The declared absence, spelled out. It used to be asserted as a loose
    // /ninguno/ over the WHOLE body, which the "Out of scope / Protected"
    // line's own "(ninguno declarado)" satisfied on its own — so the assertion
    // passed without the gates section saying anything. With D-14, a `Tipo`
    // with no technical gate and nothing declared is already the (none) case;
    // the `!plan` here is now an inert waiver over an already-empty set, and
    // the section still has to say "(none)" out loud rather than fall silent.
    expect(body).toContain('- (none) — this slice demands no human gate before merging.')
  })

  it('a WAIVER is written into the issue body, with the Tipo that implied it', () => {
    const body = buildIssueBody({ ...uiSlice, gate: '!visual' }, {})
    expect(body.toLowerCase()).toMatch(/waiver/)
    expect(body).toContain('visual')
    expect(body).toContain('`ui`')
  })

  it('groomPlan exposes the resolved gates as structured data', () => {
    const plan = groomPlan([backendWithGate], { milestone: 'Epic', specRef: {} })
    expect(plan.issues[0].gates).toEqual(['visual'])
  })
})

// ============================================================================
// 5. The gate SURVIVES the redispatch: it is read from the issue labels.
// ============================================================================
describe('F21 — gates read from the issue (survival of the redispatch)', () => {
  it('mapGhIssue extracts the gates from the labels', () => {
    const i = mapGhIssue({ number: 4, title: '#1 x', body: '', labels: [{ name: 'type:backend' }, { name: 'gate:visual' }] })
    expect(i.gates).toEqual(['visual'])
    expect(i.gatesDeclared).toBe(true)
  })

  it('`gate:none` is a declaration that there are no gates, not an absence of declaration', () => {
    const i = mapGhIssue({ number: 4, title: '#1 x', body: '', labels: [{ name: 'type:ui' }, { name: GATE_LABEL_NONE }] })
    expect(i.gates).toEqual([])
    expect(i.gatesDeclared).toBe(true)
  })

  it('an issue with NO gate: label at all (groomed before this round) declares nothing', () => {
    const i = mapGhIssue({ number: 4, title: '#1 x', body: '', labels: [{ name: 'type:ui' }] })
    expect(i.gatesDeclared).toBe(false)
  })

  it('a `gate:` label that is empty or only spaces counts neither as a gate nor as a declaration', () => {
    const i = mapGhIssue({ number: 4, title: '#1 x', body: '', labels: [{ name: 'gate:' }, { name: 'gate: ' }] })
    expect(i.gates).toEqual([])
    expect(i.gatesDeclared).toBe(false)
  })

  it('gatesFromLabels ignores tokens that are not in the vocabulary', () => {
    const r = gatesFromLabels(['gate:visual', 'gate:inventado'])
    expect(r.gates).toEqual(['visual'])
    expect(r.unknown).toEqual(['inventado'])
  })
})

// ============================================================================
// 6. The kickoff: the gate stops depending on the Tipo.
// ============================================================================
describe('F21 — renderKickoff', () => {
  it('a backend slice WITH a visual gate receives the gate (it was the real case that did not receive it)', () => {
    const k = renderKickoff({ ...SLICE, gates: ['visual'], gatesDeclared: true }, { repo: 'o/r' , conventionsDir: '/plugin/conventions' })
    expect(k.toLowerCase()).toMatch(/screenshot|captura/)
    expect(k.toLowerCase()).toMatch(/human/) // that a human closes it, not the agent
    expect(k.toLowerCase()).toMatch(/migraci|rollback/) // and it keeps its backend technical addendum
  })

  it('a ui slice that WAIVED the gate does not receive it', () => {
    const k = renderKickoff({ ...SLICE, type: 'ui', gates: [], gatesDeclared: true }, { repo: 'o/r' , conventionsDir: '/plugin/conventions' })
    expect(k.toLowerCase()).not.toMatch(/screenshot|captura/)
    expect(k.toLowerCase()).toMatch(/design system/) // the ui technical addendum is still there
  })

  it('an issue that predates the gates falls back to the Tipo: a `type:ui` with no gate: labels does NOT lose its gate', () => {
    // Without this fallback, the day this is deployed every `ui` issue already
    // groomed would lose its gate in silence — exactly the breakage this round
    // exists to close, in the other direction.
    const k = renderKickoff({ ...SLICE, type: 'ui', gatesDeclared: false }, { repo: 'o/r' , conventionsDir: '/plugin/conventions' })
    expect(k.toLowerCase()).toMatch(/screenshot|captura/)
  })

  it('the gate travels to the seeded .agent/STATE.md too, so as to survive a re-hydration', () => {
    // The same reason as the `role` field (F20) and as `blocked` (F7): what has
    // to survive a /clear is a FIELD, not a phrase inside a prompt that is lost
    // along with the session's context.
    const seed = buildStateSeed({ ...SLICE, gates: ['visual'], gatesDeclared: true }, { branch: 'feat/7', base: 'main' })
    const st = parseState(seed)
    expect(JSON.stringify(st.meta.gates)).toContain('visual')
  })

  it('the kickoff names the "Out of scope / Protected" section of the issue', () => {
    // The second finding through the same lens: the `Protegido` column DOES
    // reach the issue body, but the kickoff enumerates the acceptance criteria
    // one by one and never named what is left OUT of scope. "Hidrátate del
    // issue" is weaker than naming the section.
    const k = renderKickoff(SLICE, { repo: 'o/r' , conventionsDir: '/plugin/conventions' })
    expect(k).toContain('Out of scope / Protected')
  })
})

// ============================================================================
// 7. /ct-groom says it out loud.
// ============================================================================
describe('F21 — /ct-groom talks about the gates', () => {
  it('a gate the Tipo does NOT imply is announced on stderr (whoever grooms has to see it)', () => {
    const res = dryRun(specWith(['| 1 | barra | backend | tabla | – | AC-1.1 | – | med | db | visual |']))
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/gate/i)
    expect(res.stderr).toContain('visual')
    expect(res.stderr).toContain('backend')
    expect(res.stderr).toMatch(/does not imply|does not come from/i)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).toContain('gate:visual')
  })

  it('a WAIVER is announced on stderr, never in silence', () => {
    const res = dryRun(specWith(['| 1 | pantalla | ui | alta | – | AC-1.1 | – | med | app | !visual |']))
    expect(res.status).toBe(0)
    expect(res.stderr.toLowerCase()).toMatch(/waives/)
    expect(res.stderr).toContain('visual')
    const plan = JSON.parse(res.stdout)
    // D-14: nothing is implied any more once `visual` is waived, so the row
    // ends up with no gates at all — `gate:none`, not `gate:plan`.
    expect(plan.issues[0].labels).toContain(GATE_LABEL_NONE)
    expect(plan.issues[0].labels).not.toContain('gate:visual')
  })

  it('an unknown gate token ABORTS before writing anything, and says what the vocabulary is and how you waive', () => {
    // Narrowing what the system accepts creates a new category of refusal, and
    // that category needs a voice: "valor inválido" is not enough.
    const res = dryRun(specWith(['| 1 | barra | backend | tabla | – | AC-1.1 | – | med | db | seguridad |']))
    expect(res.status).toBe(2)
    expect(res.stderr).toContain('seguridad')
    expect(res.stderr).toContain('visual')
    expect(res.stderr).toContain('apply')
    expect(res.stderr).toContain('!')
    expect(res.stdout).toBe('') // neither a plan nor anything written
  })

  it('asking for and waiving the same gate aborts instead of picking a winner', () => {
    const res = dryRun(specWith(['| 1 | pantalla | ui | alta | – | AC-1.1 | – | med | app | visual, !visual |']))
    expect(res.status).toBe(2)
    expect(res.stderr).toContain('visual')
  })

  it('a waiver that waives nothing is warned about (it is neither kept quiet nor aborted)', () => {
    const res = dryRun(specWith(['| 1 | barra | backend | tabla | – | AC-1.1 | – | med | db | !visual |']))
    expect(res.status).toBe(0)
    expect(res.stderr.toLowerCase()).toMatch(/does not imply|does not have that gate|does nothing/)
  })

  it('a Tipo with a typo loses its GATES too, and the unknown-Tipo warning says so (not just the addendum)', () => {
    // A case that was not in the errand: `TYPE_GATES` compares exactly, just
    // like `ADDENDA`. A "UI" in capitals ends up with no addendum AND no gate —
    // the second half is the serious one, and until this round the warning did
    // not name it because gates did not exist as a concept.
    const res = dryRun(specWith(['| 1 | pantalla | UI | alta | – | AC-1.1 | – | med | app | – |']))
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/human gates/)
    expect(res.stderr).toContain('ui→visual')
    expect(res.stderr).toContain('"Gate" column') // the remedy, in the warning itself
    const plan = JSON.parse(res.stdout)
    // it loses the TECHNICAL gate of its Tipo (visual), and with D-14 there is
    // no universal default left to survive the typo either: the row ends up
    // with `gate:none`.
    expect(plan.issues[0].labels).toContain(GATE_LABEL_NONE)
    expect(plan.issues[0].labels).not.toContain('gate:visual')
  })

  it('the default case (Tipo ui, with no Gate column) still brings its gate without anyone declaring anything', () => {
    const md = [
      '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices', '',
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |',
      '|---|---|---|---|---|---|---|',
      '| 1 | pantalla | ui | alta | – | AC-1.1 | – |', '',
    ].join('\n')
    const res = dryRun(md)
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).toContain('gate:visual')
    expect(res.stderr).not.toMatch(/"Gate" column/)
  })
})

// ============================================================================
// 8. The §9 contract that /ct-init seeds.
// ============================================================================
describe('F21 — the §9 contract documents the gates and the invariant', () => {
  it('the seeded section explains the Gate column, the waiver with `!` and the vocabulary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'f21-init-'))
    execFileSync('bash', [initScript, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'docs', 'superpowers', 'SLICES-CONTRACT.md'), 'utf8')
    expect(agents).toContain('**Gate**')
    expect(agents).toContain('`!visual`')
    // Task 5 of "e2e al cierre del slice" closed the temporary debt this test
    // carried: contract v20 already documents `e2e` (the `E2E` column + a
    // derived gate), so the guard covers the WHOLE vocabulary again, with no
    // exception.
    for (const g of Object.keys(GATES)) expect(agents, g).toContain(`\`${g}\``)
    expect(agents).toContain('gate:none')
    rmSync(dir, { recursive: true, force: true })
  })

  it('the seeded section says out loud that what does not reach the issue does not reach the agent', () => {
    // It is the lesson of the real case: the spec relied on a §10 and a "REGLA
    // #-2" that the dispatched agent never opens.
    const dir = mkdtempSync(join(tmpdir(), 'f21-init-'))
    execFileSync('bash', [initScript, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'docs', 'superpowers', 'SLICES-CONTRACT.md'), 'utf8')
    // F30: the section stopped being called "§9". What this test defends is the
    // PHRASE, not the name — so it anchors on what is invariant ("fuera de la
    // tabla … no llega al agente") and not on whatever the table is called that
    // month.
    expect(agents).toMatch(/outside the slices table[^\n]*does not reach the agent/i)
    expect(agents).not.toMatch(/§9/)
    rmSync(dir, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// THE TOKEN OF THE GO, TIED TO THE TWO TEXTS THAT EXPLAIN IT.
//
// Ever since a program reads the answer of the `plan` gate
// (scripts/go-response.js + scripts/ct-watch-go.mjs), the token stopped being
// prose: an exact `-OK` starts the work and anything else does not. Which is to
// say that the gate's two texts —the one the AGENT reads and the one the HUMAN
// reads— have to name the real token.
//
// Without this test the failure is the worst possible one and a silent one: the
// token gets renamed in the code, the texts keep saying what they said before,
// the person writes what they were told, and the work never starts without
// anything failing.
// ---------------------------------------------------------------------------
describe('the token of the go travels in both texts of the `plan` gate', () => {
  it('the kickoff of the agent names it', () => {
    expect(GATES.plan.kickoff).toContain(GO_TOKEN)
  })

  it('the issue text names it, which is the one read by whoever has to write it', () => {
    expect(GATES.plan.issue).toContain(GO_TOKEN)
  })

  it('and the kickoff says the agent must NOT poll the issue itself: that belongs to the watcher', () => {
    // An agent that started looking at the issue on its own account would be
    // watching its own gate, which is precisely what this division avoids.
    expect(GATES.plan.kickoff).toMatch(/no sondees/i)
  })
})
