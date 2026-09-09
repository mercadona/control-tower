// Pure grooming logic: from Slice[] (T1) to a plan of GitHub operations.
import { isNoValueCell } from './slices.js'
import { resolveGates, resolveE2e, gateLabels, renderGatesIssueContent } from './gates.js'
import { locateSection, unterminatedDelimiter, normalizeToLF, SENAL_HEADING, E2E_HEADING } from './gh-issue-map.js'
import { STATUS_LADDER } from './harvest.js'

// SENAL_HEADING (Slice 10) is born in gh-issue-map.js (the lower layer: this
// file already imports from there and mapGhIssue needs it too — here it would
// create a circular import) and is re-exported so that groom's consumers do
// not have to know where it was born — the same treatment as its sibling
// headings GATES_HEADING/EPIC_CONTEXT_HEADING, which were born here.
export { SENAL_HEADING }

// GATES_HEADING (F21): the gates section of the issue's body. An exported
// constant because THREE places name it (this file when writing it,
// reconcile.js when comparing it, and their tests), and a heading hand-written
// in three places is a heading that ends up diverging in one.
export const GATES_HEADING = '## Gates'

// E2E_HEADING (TAREA 9): it is NO longer defined here — it lives in
// gh-issue-map.js, next to AC_HEADING_FORMS/DEPS_HEADING, because that file is
// the one that already centralises the headings shared between whoever WRITES
// them (buildIssueBody, in this file) and whoever READS them (mapGhIssue, the
// real dispatcher). Defining it here and importing it from there would have
// closed a groom.js<->gh-issue-map.js cycle over a text constant; it is
// imported and RE-EXPORTED so that reconcile.js and its tests, which ask for
// it `from './groom.js'`, do not have to change their import.
export { E2E_HEADING }

// renderE2eContent: the runs, one per line and VERBATIM. Verbatim because the
// release gate demands that the title of each report entry cite the run exactly
// as it is: if this function reformatted (capitalising, dropping a final full
// stop), the agent would cite what it sees and the comparison would fail over a
// character nobody wrote.
export function renderE2eContent(slice) {
  return resolveE2e(slice.e2e).runs.map((r) => `- ${r}`).join('\n')
}

// The TWO context sections of an issue's body, with different owners and
// therefore with different rules:
//
//   EPIC_CONTEXT_HEADING      /ct-groom writes it from the spec, identical in
//                             every issue of the epic.
//   INHERITED_CONTEXT_HEADING the coordinator session writes it. The plugin
//                             emits it empty when creating the issue and never
//                             touches it again: it neither compares it, nor
//                             rewrites it, nor inserts it, nor deletes it.
//
// They are exported constants for the same reason as GATES_HEADING: whoever
// writes them, whoever compares them and their tests all name them, and a
// heading typed in three places ends up diverging in one. The first is, on top
// of that, the SAME string in the spec file and in the issue's body: only one
// to learn.
export const EPIC_CONTEXT_HEADING = '## Contexto del epic'
export const INHERITED_CONTEXT_HEADING = '## Contexto heredado'

// FROZEN_DECISIONS_HEADING: the spec's frozen-decisions section, which groom
// projects into the body of every issue of the epic. The same treatment as
// EPIC_CONTEXT_HEADING (from the spec, identical in every issue, reconciled),
// with a single difference: when projecting, each line's provenance is removed
// (see readFrozenDecisions). An exported constant for the same reason as the
// ones beside it: whoever writes it, whoever compares it and their tests all
// name it. It is the SAME string in the spec file and in the issue's body.
export const FROZEN_DECISIONS_HEADING = '## Decisiones congeladas'

// The placeholder asserts two things a human needs to read right there: who
// fills the section in, and that nobody is going to overwrite what they write.
// An empty section without that second sentence is an invitation not to use
// it.
export const INHERITED_CONTEXT_PLACEHOLDER =
  '_(vacía — la rellena la sesión coordinadora cuando algo ya mergeado condiciona a este slice. `/ct-groom` no escribe aquí ni reescribe lo que escribas.)_'

// EPIC_CONTEXT_REASONS (final branch review, I1): why readEpicContext returns
// no text. It is not message decoration: it decides whether `--reconcile` may
// WITHDRAW the section from the body of the issues that already carry it.
//
//   ABSENT / EMPTY  the epic has no common context, and the spec says so. The
//                   section must not exist in any body: withdrawing it is the
//                   correct reconciliation (§3.1 of the design: a section that
//                   is present but empty counts as absent).
//   MALFORMED       the spec DOES have an opinion, but no valid text could be
//                   read. That authorises touching nothing: deleting the
//                   section from the N issues because somebody put in one
//                   `###` too many would be destroying good text in exchange
//                   for a formatting error. A warning is issued and the body
//                   is left as it is.
export const EPIC_CONTEXT_REASONS = { ABSENT: 'ausente', EMPTY: 'vacia', MALFORMED: 'malformada' }

// The sentence that closes the MALFORMED-section warnings. It is in a constant
// because the two warnings of that class share it and it has to say exactly
// the same in both: what a reader needs to know is that their formatting error
// has deleted nothing of theirs.
const MALFORMED_KEEPS_WHAT_IS_THERE = 'Mientras esté así, no se toca ni se borra el contexto que ya tengan los issues de este epic: sin texto válido, el spec no tiene ninguna opinión que aplicar.'

// truncationLine: the line that truncated the section, if it turns out that
// locateSection cut before an H1/H2 heading or before the end of the file.
// `locateSection` ends the section when it finds a heading of ANY level, or a
// self-contained HTML comment (one that opens and closes on the same line —
// see gh-issue-map.js#locateSection). Ending on a heading is legitimate if it
// is H1 or H2 (they only end the section normally), but if it is H3+ (an epic
// subheading), or if it is the self-contained comment, there is a truncation
// that loses content. This function returns that offending line, or null if
// there is none.
//
// The H1/H2 heading regex here must be coherent with ATX_HEADING_RE in
// gh-issue-map.js — both govern what `locateSection` sees as a heading. If
// they diverge, we will emit false truncation warnings over healthy sections.
//
// `contentEnd` points at the '\n' that precedes the terminating line (or at
// the end of the text if there is none), so the first non-empty line from
// there on is that terminating line.
function truncationLine(specMd, loc) {
  const rest = (specMd || '').slice(loc.contentEnd)
  const line = rest.split('\n').find((l) => l.trim() !== '')
  if (!line) return null // End of the file, there is no truncation

  // An H1 or H2 heading: it ends the section normally. The regex is coherent
  // with ATX_HEADING_RE in gh-issue-map.js: it accepts # or ## followed by a
  // space, a tab, or the end of the line. A bare heading (e.g. "##" with no
  // text) is valid too and ends the section without truncation.
  if (/^ {0,3}#{1,2}([ \t]|$)/.test(line)) return null

  // Anything else: it is a truncation
  return line.trim()
}

// ============================================================================
// F32 — THE FREEZE GATE (§4.1 of the F32 handoff). Groom gains ONE check,
// pre-registered as "two greps in the pass groom already makes": the spec does
// not get in if it has an unresolved `[NEEDS CLARIFICATION` or if
// `## Hipótesis` is missing or empty. Without a falsifiable bet it is not an
// epic (José's decision, 2026-08-07); the QUALITY of the hypothesis is judged
// by the human at the freeze — here only PRESENCE is looked at.
//
// It deliberately does NOT reuse locateSection: that is an extractor with the
// semantics of fences and hidden comments, because its text travels to the body
// of the issues. This is a presence detector, and a detector cleverer than its
// pre-registration is a different instrument from the one frozen in §6. The
// only refinement over the bare grep: an HTML comment left over from the
// template does not count as content of the hypothesis — leaving the
// placeholder in place is exactly the "filler" the gate exists to keep from
// getting through in silence.
export const HYPOTHESIS_HEADING = '## Hipótesis'
export const NEEDS_CLARIFICATION_MARKER = '[NEEDS CLARIFICATION'
export const HYPOTHESIS_REASONS = { OK: 'ok', ABSENT: 'ausente', EMPTY: 'vacia' }

export function analyzeSpecFreeze(specMd) {
  const lines = normalizeToLF(specMd || '').split('\n')
  const clarifications = []
  lines.forEach((raw, i) => {
    if (raw.includes(NEEDS_CLARIFICATION_MARKER)) clarifications.push({ line: i + 1, raw: raw.trim() })
  })
  // A heading of exactly level 2 whose text STARTS with "Hipótesis" — it
  // covers "## Hipótesis" and "## Hipótesis del experimento" (the template). A
  // "### Hipótesis" does not count: the pre-registered grep is "## Hipótesis".
  const at = lines.findIndex((l) => /^ {0,3}##[ \t]+Hipótesis(\b|$)/.test(l))
  if (at === -1) return { hypothesis: HYPOTHESIS_REASONS.ABSENT, clarifications }
  const body = []
  for (let i = at + 1; i < lines.length; i++) {
    if (/^ {0,3}#{1,6}([ \t]|$)/.test(lines[i])) break
    body.push(lines[i])
  }
  const content = body.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim()
  return { hypothesis: content ? HYPOTHESIS_REASONS.OK : HYPOTHESIS_REASONS.EMPTY, clarifications }
}

// readEpicContext: reads from the spec file the text that is going to travel,
// identical, to the body of every issue of the epic.
//
// The section is located BY THE TEXT OF ITS HEADING, never by a section number
// — the same criterion analyzeSlicesTable uses to locate the slices table by
// its columns: a spec's section numbers move the moment somebody inserts
// something ahead of them.
//
// It returns `content: null` in the four cases where there is nothing to emit
// (absent, empty, with an unclosed delimiter inside, or with a truncation
// inside), each with its own warning: the four are fixed in different ways and
// a single message would force you to guess which one happened. A spec without
// this section is a VALID spec — hence this warns and never throws.
//
// `reason` (final branch review, I1) is what stops those four cases from being
// confused downstream. All four produce the same `content: null`, but they do
// NOT mean the same, and `buildReconcileBody` reads `null` as WITHDRAW THE
// WHOLE SECTION: without the reason, adding one `###` too many to the spec
// deleted the context of the epic's N issues on the next --reconcile. "The epic
// has no context" (absent/empty) authorises withdrawal; "I could not read valid
// text" (malformed) authorises nothing — see EPIC_CONTEXT_REASONS.
// readSpecSection: the pure reader readEpicContext and readFrozenDecisions
// share. It locates the section by heading TEXT (never by number), applies the
// guardrails (unclosed delimiter, truncation by an inner heading) and returns
// the usual contract: { content, reason, warnings }. The four reasons live in
// EPIC_CONTEXT_REASONS because they are section-agnostic. `opts.strip`
// (optional) is a RegExp that is trimmed from each line of the ALREADY
// validated content; `opts.stripLabel` is the word whose survival after the
// trim betrays a cleaning failure (it is warned about, B2).
export function readSpecSection(specMd, heading, opts = {}) {
  const warnings = []
  // `noun` keeps each client's warnings byte-identical: the epic says "lleva
  // contexto común", the decisions "lleva decisiones congeladas". Without it,
  // extracting the reader would change the text readEpicContext prints today.
  const noun = opts.noun || 'esta sección'
  // CRLF (final branch review, I2). It is normalised HERE, before locating
  // anything, and for two different reasons:
  //
  //   1. What this function returns travels to the BODY of the issues, and it
  //      is the first multi-line value derived from the spec that does so (the
  //      cells of the §9 table all go through `trim`, which eats the `\r`). An
  //      `\r` inside the body cannot be seen, but diffIssue and
  //      buildReconcileBody always compare text normalised to LF: against a
  //      value with a `\r` they can NEVER match — a `nota:` on every run and,
  //      since the C1 fix, a write on every run, for ever.
  //   2. `locateSection` (and with it the whole guardrail) looks at the lines
  //      with ATX_HEADING_RE, which does not recognise "##\r" as a heading: in
  //      a CRLF spec, a bare heading stops ending the section and the section
  //      swallows the rest of the file. That failure is fixed here, at the
  //      cause, and not by touching truncationLine's regex — that regex is
  //      right, and in fact it agrees with ATX_HEADING_RE in rejecting "##\r";
  //      what was wrong was the text the two of them were given.
  const src = normalizeToLF(specMd || '')
  const loc = locateSection(src, heading)
  if (!loc) {
    warnings.push(`aviso: el spec no trae la sección "${heading}" — ningún issue de este epic lleva ${noun} (ni el que se cree ahora, ni el que ya exista: con --reconcile la sección se retira del cuerpo). Si lo quieres, añade esa sección al spec, fuera de la tabla de slices, y vuelve a correr.`)
    return { content: null, reason: EPIC_CONTEXT_REASONS.ABSENT, warnings }
  }
  // An unclosed delimiter (final branch review, C3). It goes BEFORE the
  // truncation because it is the OPPOSITE failure and it hides it:
  // `truncationLine` only sees terminators that cut the section too early, and
  // an unclosed fence (or comment) hides every following line, so there stops
  // being a terminator at all and `loc.content` swallows the rest of the spec
  // —the slices table included— with nothing to warn about. It is checked with
  // the SAME scanner that locates the section
  // (gh-issue-map.js#unterminatedDelimiter), not with a new one.
  const abierto = unterminatedDelimiter(loc.content)
  if (abierto) {
    const que = abierto === 'valla' ? 'una valla de código (```) sin cerrar' : 'un comentario HTML (<!--) sin cerrar'
    warnings.push(`aviso: la sección "${heading}" del spec contiene ${que} y por eso NO se emite en ningún issue. Sin el cierre, la sección no termina donde parece: se traga todo lo que venga detrás en el spec (la tabla de slices incluida) y ese texto acabaría en el cuerpo de todos los issues. Cierra el delimitador y vuelve a correr. ${MALFORMED_KEEPS_WHAT_IS_THERE}`)
    return { content: null, reason: EPIC_CONTEXT_REASONS.MALFORMED, warnings }
  }

  const truncating = truncationLine(src, loc)
  if (truncating) {
    warnings.push(`aviso: la sección "${heading}" del spec contiene ("${truncating}") y por eso NO se emite en ningún issue. La sección se reescribe entera desde el spec: el reemplazo termina en la primera cosa que corta la sección (cabecera de cualquier nivel, comentario HTML, etc.), así que nada que corte puede vivir dentro. ${MALFORMED_KEEPS_WHAT_IS_THERE}`)
    return { content: null, reason: EPIC_CONTEXT_REASONS.MALFORMED, warnings }
  }
  const content = loc.content.trim()
  if (!content) {
    warnings.push(`aviso: la sección "${heading}" del spec está presente pero sin contenido — se trata igual que si no estuviera, o sea que ningún issue lleva ${noun} (y con --reconcile la sección se retira del cuerpo de los que ya la tengan). Escribe algo debajo de la cabecera, o quítala.`)
    return { content: null, reason: EPIC_CONTEXT_REASONS.EMPTY, warnings }
  }
  let out = content
  if (opts.strip) {
    // Best-effort trimming of the suffix (see PROCEDENCIA_SUFFIX_RE). It is
    // done over the ALREADY validated content: the guardrails look at the raw
    // section; the trim only affects what is projected into the body.
    out = content.split('\n').map((l) => l.replace(opts.strip, '')).join('\n')
    // B2: the cleaning is best-effort over an external format. If a MARKER
    // SURVIVES the trim (a suffix on another line, or a second inner marker
    // the tempered trim does not touch), it does NOT keep quiet: the text is
    // projected all the same, but with a warning naming each line that is
    // still dirty. "Not being able to check is NOT being clean" (scope.js):
    // the failure has to be visible. The MARKER is what is checked
    // (opts.survives), not the loose word — "Procedencia" in legitimate prose
    // is not a failure (DeepSeek #2).
    if (opts.survives) {
      for (const l of out.split('\n')) {
        if (opts.survives.test(l)) {
          warnings.push(`aviso: en la sección "${heading}" del spec, esta línea conserva un marcador "${opts.stripLabel}" tras limpiar el sufijo y por eso viaja tal cual al cuerpo de los issues: "${l}". Revisa que cada decisión lleve como mucho un sufijo "*(Procedencia: …)*", en una sola línea, o quítalo a mano.`)
        }
      }
    }
  }
  return { content: out, reason: null, warnings }
}

// readEpicContext: the epic's common context. A wrapper of readSpecSection
// with no strip — its content travels verbatim (I1: it used to be the body
// that now lives in readSpecSection; the signature and the tests that already
// cover it are preserved).
export function readEpicContext(specMd) {
  return readSpecSection(specMd, EPIC_CONTEXT_HEADING, { noun: 'contexto común' })
}

// PROCEDENCIA_SUFFIX_RE: the "*(Procedencia: …)*" suffix that the decisions
// template (_TEMPLATE-execution-spec.md, the core) writes at the end of each
// line, with a format verified against docs/loop/loop.body.html. It is meta for
// whoever FREEZES (spoken | deduced | proposed), not for whoever EXECUTES: the
// agent does not care about the origin — the decision binds it just the same —,
// so it is removed when projecting. It is not a parser: it only trims the
// suffix. `[^\n]` (not `.`) so as not to cross line breaks: if the suffix was
// wrapped onto two lines, it does not match, and the cleaning betrays it
// through B2 instead of breaking the markdown. And the content is TEMPERED with
// `(?!\*\(Procedencia:)` so as not to cross a SECOND marker: without that, a
// line with two markers matched from the first one all the way to the final
// `)*` and silently deleted everything in between (DeepSeek #1). This way only
// the final suffix is trimmed; the inner marker survives and B2 warns about it.
const PROCEDENCIA_SUFFIX_RE = /\s*\*\(Procedencia:(?:(?!\*\(Procedencia:)[^\n])*?\)\*\s*$/i

// PROCEDENCIA_MARKER_RE: detects a provenance marker that SURVIVED the trim
// (for the B2 warning). It looks at the MARKER —an opening parenthesis followed
// by "Procedencia:"— and not at the loose word: "Procedencia" in legitimate
// prose ("revisar la Procedencia en el acta") is not a cleaning failure
// (DeepSeek #2). Case-insensitive like the trim; it covers `*(`, `_(` and `(`.
const PROCEDENCIA_MARKER_RE = /\(Procedencia:/i

// readFrozenDecisions: the mirror of readEpicContext, both on top of
// readSpecSection. The ONLY difference is the provenance strip (and its
// observable warning if a marker survives the trim, B2).
export function readFrozenDecisions(specMd) {
  return readSpecSection(specMd, FROZEN_DECISIONS_HEADING, { noun: 'decisiones congeladas', strip: PROCEDENCIA_SUFFIX_RE, survives: PROCEDENCIA_MARKER_RE, stripLabel: 'Procedencia' })
}

// gatesOf: a slice's gate resolution, in a single place. buildLabels and
// buildIssueBody call it separately (it is pure and cheap) instead of passing
// the result around, so that neither of the two can be left holding a stale
// resolution if the shape of the slice changes tomorrow.
export function gatesOf(slice) {
  return resolveGates(slice.type, slice.gate, slice.e2e)
}

// F3: the title comes from `slice.name` (the "Slice" column of the spec's §9),
// not from `slice.entrega` (the "Entrega" column) — it used to compose
// "#N <Entrega>" while the text of "Slice" was discarded except for a possible
// "#NN", so an author who writes the natural thing (a short name in Slice, a
// description of what it delivers in Entrega) got a whole paragraph as the
// issue's title. `slice.name` already arrives clean of any "#NN" reference (see
// slices.js#analyzeSlicesTable) — buildIssueTitle does not need, and
// deliberately does not repeat, that cleaning here.
export function buildIssueTitle(slice) {
  return `#${slice.n} ${slice.name}`.trim()
}

// LOOP_STATUS_LABELS — the `status:` vocabulary the loop WRITES, and which
// therefore has to EXIST in the repo before anyone writes it.
//
// It is not the same as "the labels buildLabels applies". An issue is born with
// ONE (`status:backlog`, below); the other three are written LATER, and none of
// those writes can create them: `gh issue edit --add-label` resolves name -> id
// for the GraphQL mutation `addLabelsToLabelable`, which takes ids. A
// non-existent name resolves to `null` and the command fails (verified against
// the API). The three call sites that suffered from it:
//   - the human promotion step to `status:ready` that the AGENTS.md contract
//     orders to be run after the groom;
//   - the claim (`status:in-progress`), dispatch-check.mjs#setStatus, which
//     dies in dieErr(…, 3) — and /ct-next reports «an infrastructure failure,
//     retry later», advice that can never work against a missing label;
//   - the delivery (`status:in-review`) and the steps back.
//
// It is DERIVED from STATUS_LADDER (harvest.js), the ladder that was already
// the source of truth of the vocabulary: two lists of the same vocabulary
// diverge the moment somebody touches only one.
//
// THERE ARE FOUR, NOT SEVEN, on purpose. `status:blocked`, `status:paused` and
// `status:rejected` appear in comments and docs but the plugin never writes
// them: gh-issue-map.js treats them as «custom labels» that gate nothing, and
// dispatch-check.mjs documents why `status:rejected` was discarded as a design.
// Creating them would be seeding into the user's repo a vocabulary this plugin
// decided not to have.
export const LOOP_STATUS_LABELS = STATUS_LADDER.map((s) => `status:${s}`)

export function buildLabels(slice) {
  const labels = []
  // Omit empty type to avoid emitting garbage literal "type:" to GitHub.
  // F3's review, finding 1: a "no value" marker ("–", "-", "—", etc. — the
  // same criterion Dep/Acepta/Área/Toca already use, and which buildIssueBody
  // already applies to Protegido) is TRUTHY in JS, so a bare
  // `if (slice.type)` treated it as a real type and emitted the literal label
  // "type:–" — which `gh label create --force` would really create in the
  // user's repo. The same "area:areamedicacion" bug through another door: a
  // marker the contract itself teaches you to use in every other column was
  // producing junk in this one. isNoValueCell unifies the criterion: an empty
  // cell and a cell with a marker produce the SAME output (no "type:" label
  // at all).
  if (slice.type && !isNoValueCell(slice.type)) labels.push(`type:${slice.type}`)
  // area/touches (T14/W-A): they feed directly into claim.js#tokensOf's
  // collision machinery and dispatch.js#SERIALIZING_TOUCHES' serialisation,
  // which until now sat inert because /ct-groom never emitted these labels. A
  // fixed order (type → area → touches → status) so that the output is
  // deterministic: same slice, same array of labels, always — the key to the
  // tests and the `gh label`/dry-run diffs being stable. When the slice does
  // not carry area/touches (an old spec without those columns, or empty
  // arrays) this produces exactly the output of before.
  for (const a of slice.area || []) labels.push(`area:${a}`)
  for (const t of slice.touches || []) labels.push(`touches:${t}`)
  // gate: (F21) — the channel through which the human gate SURVIVES the
  // dispatch. Until this round, the plugin's only gate lived inside the `ui`
  // addendum, that is to say inside a KICKOFF: a prompt that is lost along with
  // its session's context. A redispatch, a `--reopen` or a `/clear` erased it,
  // and the human who opened the PR had nowhere to see that a gate was still
  // pending. A GitHub label survives all three things and everybody sees it.
  // `gateLabels` ALWAYS returns at least one (`gate:none` when there is none)
  // — see gates.js#GATE_LABEL_NONE for why silence cannot mean two different
  // things here.
  //
  // It goes after area/touches and before status for the same reason as the
  // rest: a fixed order = deterministic output for tests, dry-run and diffs.
  for (const g of gateLabels(gatesOf(slice).gates)) labels.push(g)
  labels.push('status:backlog')
  return labels
}

// renderDescripcion / renderProtectedLine (F5): extracted from buildIssueBody
// to be the ONLY source of truth for "what each of these two sections should
// say" — both when CREATING the issue (buildIssueBody, below) and when
// COMPARING it afterwards against an existing issue
// (scripts/reconcile.js#diffIssue). Without this, "what gets written" and
// "what gets compared" would be two implementations of the same "no value"
// criterion that could diverge over time — the same reason ADDENDA
// (kickoff.js) is the single source of truth of KNOWN_TYPES in ct-groom.mjs.
//
// renderDescripcion returns `null` (not an empty string) when there is no real
// "Entrega": `null` means "the ## Descripción section should not exist at
// all", which differs from "it exists but it is empty" — an existing issue
// that DOES have the section when the spec says `null` is a real divergence
// (the spec stopped asking for a description), not the same as "they agree
// that there is nothing".
export function renderDescripcion(slice) {
  return (slice.entrega && !isNoValueCell(slice.entrega)) ? slice.entrega : null
}

// renderProtectedLine: unlike Descripción, this section ALWAYS exists in the
// body (buildIssueBody emits it unconditionally) — that is why this function
// never returns `null`, always one of the two possible lines.
export function renderProtectedLine(slice) {
  // A review fix (F2): it used to treat only the literal em dash ('–',
  // U+2013) as "no value" — the other variants isNoValueCell already accepts
  // in EVERY other column (Dep/Acepta/Área/Toca: '-', '—', '―', '−', '--')
  // slipped through as if they were real content, producing a junk bullet
  // ("- 🚫 -") in the body of EVERY issue with that variant. The same "no
  // value" criterion as the other columns, without exception.
  return (slice.protected && !isNoValueCell(slice.protected)) ? `- 🚫 ${slice.protected}` : '- (ninguno declarado)'
}

// renderGatesContent (F21): like renderDescripcion/renderProtectedLine/
// renderSpecLink, the ONLY source of truth for "what the gates section should
// say" — shared between creating the issue (buildIssueBody) and comparing it
// afterwards (reconcile.js#diffIssue). It NEVER returns null (unlike
// renderDescripcion): the section is always emitted, because "this slice
// demands no gate" is an assertion a human needs to be able to read in the
// issue; its absence would only say "nobody thought about it here".
export function renderGatesContent(slice) {
  return renderGatesIssueContent(gatesOf(slice), slice.type)
}

// parseSenalCell (Slice 10): THE classifier of the `Señal` cell — a single
// one, reused by groom (validation in ct-groom.mjs + render here), by kickoff
// (the dispatch's conditional line) and, in prose, by the slice judge's rubric.
// The cell is free text in ONE piece (the comma does not separate, as in
// `Protegido`), and the reasoned exemption is written `N/A — <razón>`: the
// language the repo already has for "does not apply, and here is why" (§8 of a
// slice plan and a task's `**Tests:** N/A`). It returns `{ kind, text }`:
//
//   ninguna             an empty cell, null, or one with a "no value" marker
//                       (dashes) — NOT DECLARED, never an exemption.
//   senal               free text with content: the signal, trimmed verbatim.
//   exencion            `N/A — <razón>` with a non-empty reason; `text` is the
//                       trimmed cell VERBATIM (with its `N/A —` inside it) —
//                       the consumer tells it apart by its prefix alone,
//                       without re-parsing or re-rendering anything.
//   exencion-sin-razon  the N/A family with no legible reason behind it — the
//                       wrapper turns it into a hardError (exit 2): an
//                       exemption nobody can read is an undeclared signal
//                       disguised as a decision.
//
// The detection of the N/A family is /^n\/a(\b|$)/i, with NO tolerance for
// emphasis (the same stance as the `#` column: "**N/A**" is not forgiven its
// bold); the reason is what is left after removing `N/A` and the leading
// separators (—/–/-/: and spaces).
export function parseSenalCell(raw) {
  const trimmed = (raw ?? '').trim()
  if (!trimmed || isNoValueCell(trimmed)) return { kind: 'ninguna', text: null }
  if (/^n\/a(\b|$)/i.test(trimmed)) {
    const razon = trimmed.replace(/^n\/a/i, '').replace(/^[\s—–\-:]+/, '').trim()
    if (!razon) return { kind: 'exencion-sin-razon', text: null }
    return { kind: 'exencion', text: trimmed }
  }
  return { kind: 'senal', text: trimmed }
}

// renderSenalContent (Slice 10): what the `## Señal de observabilidad` section
// should say — the same single source of truth as renderDescripcion/
// renderProtectedLine, shared between creating the issue (buildIssueBody) and
// comparing it afterwards (reconcile.js#diffIssue). `null` means "the section
// should not exist": with nothing declared there is nothing to emit (unlike
// `## Gates`, here there is no fallback to tell apart, and a section that
// always comes out is the warning-that-always-comes-out that trains people to
// ignore it). With an exemption that has no reason it also returns `null` —
// this function is pure and does not throw: the wrapper (ct-groom.mjs) aborts
// with a hardError BEFORE reaching any render.
export function renderSenalContent(slice) {
  const { kind, text } = parseSenalCell(slice.senal)
  return (kind === 'senal' || kind === 'exencion') ? text : null
}

// renderSpecLink (F5 review round 3, importante 5): the spec-link line IS
// content the spec really owns — it is not bookkeeping like the `ct-order`
// marker. Extracted for the same reason as renderDescripcion/
// renderProtectedLine: a single source of truth for "what it should say",
// shared between creating the issue (buildIssueBody) and comparing it
// afterwards (scripts/reconcile.js#diffIssue).
//
// F6 (grave 1): the slice's order goes between backticks (inline code) — a
// BARE "#N" in an issue's body is autolinked by GitHub to issue N of that
// repo. Verified against the real GitHub, not deduced: the real `body_html` of
// issue #4 of josemerca/ct-loop-sandbox (`gh api ... -H "Accept:
// application/vnd.github.html+json"`) carries this very line with the "#3"
// (which is the slice's ORDER) turned into `<a href=".../issues/3">` — issue
// #3 of that repo is, in fact, slice 2. With inline code it does not autolink
// (checked in the same run with the /markdown API: ``#2`` comes out as
// `<code>#2</code>`, while a bare `#2` comes out as `<a …>`).
//
// F10: the line stops being composed of `--section` + the path exactly as it
// came in argv (which produced "[docs/x.md#9](docs/x.md#9)": relative, and
// therefore a 404 from an issue's page, against an anchor that does not exist
// either). It now receives `specRef` — the result of
// scripts/spec-link.js#resolveSpecRef — which already carries either an
// absolute URL VERIFIED against GitHub, or `reason`: why there is none. This
// function only decides how those two cases are written; it never invents a
// link.
//
// specRef = { path, heading, url, reason }
//   path    the spec's path relative to the repo root (or as it arrived, if
//           the repo could not be determined)
//   heading the rendered text of §9's heading ("9. Slices"), or null
//   url     the verified absolute link, or null
//   reason  the reason there is no url (a fixed string, see SPEC_REF_REASONS)
export function renderSpecLink(slice, specRef) {
  const head = `> Slice \`#${slice.n}\` del epic. Spec: `
  const { path, heading, url, reason } = specRef || {}
  if (url) {
    // The link's text CAN carry a "#N" from the heading itself without risk:
    // it has been verified against GitHub that a "#3" (an issue that really
    // exists in that repo) INSIDE a link's text does not autolink, while the
    // same "#3" in plain text does. What does have to be escaped are the
    // square brackets, which would cut the link dead.
    return `${head}[${escapeLinkText(labelOf(path, heading))}](${url})`
  }
  // With no link: an honest reference, without a `[...]( ... )` of any kind.
  // The path and the heading go in inline code because HERE they really are
  // plain text and a "#N" from the heading would autolink to issue N of the
  // repo.
  const headingPart = heading ? ` § ${inlineCode(heading)}` : ''
  return `${head}${inlineCode(path)}${headingPart} — sin enlace: ${reason}`
}

function labelOf(path, heading) {
  return heading ? `${path} § ${heading}` : String(path)
}

// escapeLinkText: `\` first (otherwise the escapes just put in would be
// escaped themselves), then the square brackets. Verified against GitHub:
// "[a \[b\] c](url)" comes out as a single link with the text "a [b] c".
function escapeLinkText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/([[\]])/g, '\\$1')
}

// inlineCode: wraps the content in the SHORTEST backtick fence the content
// cannot close — the same rule as CommonMark and as gh-issue-map.js's fence
// scanner. A heading with backticks inside it ("## Slices `parseo`") arrives
// here already without them (anchor.js#inlineText resolves the code span), but
// a PATH with a backtick is possible in a real filesystem, and a single-
// backtick fence would break it, leaving the "#N" of the text itself outside
// all inline code — that is, autolinked.
function inlineCode(text) {
  const s = String(text)
  let longest = 0
  for (const run of s.match(/`+/g) || []) longest = Math.max(longest, run.length)
  const fence = '`'.repeat(longest + 1)
  const pad = (s.startsWith('`') || s.endsWith('`')) ? ' ' : ''
  return `${fence}${pad}${s}${pad}${fence}`
}

// DEPS_ORDER_NOTE / renderDepsContent / renderAcContent (F6): the CONTENT of
// the two sections the dispatcher really obeys. Like renderDescripcion/
// renderProtectedLine/renderSpecLink, they are the ONLY source of truth for
// "what each section should say" — until F6,
// scripts/reconcile.js#buildReconcileBody had its OWN copy of the format
// (`renderAcContent`/`renderDepsContent` over there), so a format change here
// left the reconciler writing the old format on top of a new issue. Now
// reconcile.js imports these two.
//
// DEPS_ORDER_NOTE: the "legible and true for a human" half of the autolink fix.
// The backticks prevent the false link, but on their own they do not explain
// what that number is — a human who opens the issue still cannot tell "slice
// order" from "issue number". The note says so, and it also says who
// translates it. It CANNOT contain any "#<digits>": it would be another false
// autolink, and on top of that `gh-issue-map.js#extractDepsInSection` would
// read it as a reference not captured by `merge-after` and would mark the
// section as `malformed` (fail-closed, the slice would stop being
// dispatched).
export const DEPS_ORDER_NOTE = '*(cada `#N` de esta sección es el ORDEN del slice en la tabla §9 del spec, NO un número de issue de GitHub — `/ct-next` lo traduce por el marcador `ct-order` de cada issue)*'
export function renderDepsContent(deps) {
  return [DEPS_ORDER_NOTE, ...(deps || []).map((d) => `- merge-after \`#${d}\``)].join('\n')
}
export function renderAcContent(ac) {
  return (ac && ac.length) ? ac.map((a) => `- ${a}`).join('\n') : '- (rellenar desde el spec)'
}

export function buildIssueBody(slice, specRef, epicContext = null, frozenDecisions = null) {
  const lines = []
  lines.push(renderSpecLink(slice, specRef))
  lines.push('')
  // F3: "Entrega" no longer feeds the title (see buildIssueTitle) — it
  // becomes an OPTIONAL description in the body. It goes here, right below the
  // spec link and BEFORE "Acceptance criteria": whoever opens the issue reads
  // first WHAT the slice delivers, and only afterwards its acceptance criteria
  // — the natural reading order (what, then how it is verified).
  const descripcion = renderDescripcion(slice)
  if (descripcion) {
    lines.push('## Descripción')
    lines.push(descripcion)
    lines.push('')
  }
  // The two context sections go AFTER the description and BEFORE the
  // acceptance criteria: they are the context those criteria are interpreted
  // with, and behind them they would be read too late.
  //
  // The epic's context is only emitted if the spec carries real text — without
  // it, the spec has no opinion, and an empty section would assert that it does
  // have one and that it is blank. The inherited one is emitted ALWAYS, even if
  // nobody has written anything yet: a section that only exists when somebody
  // remembered to create it is a section nobody creates when it is needed, and
  // without a fixed place everyone invents their own — with which no kickoff
  // can name it.
  if (epicContext) {
    lines.push(EPIC_CONTEXT_HEADING)
    lines.push(epicContext)
    lines.push('')
  }
  // Frozen decisions: the same treatment as the epic's context (from the spec,
  // reconciled) and that is why it is emitted right here, just behind it. Its
  // own section —not inside "## Contexto del epic"— and only if there is
  // content. With this the body's order becomes epic → decisions → inherited →
  // criteria.
  if (frozenDecisions) {
    lines.push(FROZEN_DECISIONS_HEADING)
    lines.push(frozenDecisions)
    lines.push('')
  }
  lines.push(INHERITED_CONTEXT_HEADING)
  lines.push(INHERITED_CONTEXT_PLACEHOLDER)
  lines.push('')
  lines.push('## Acceptance criteria (EARS, 1:1 con tests)')
  lines.push(renderAcContent(slice.ac))
  lines.push('')
  // Slice 10: the observability signal goes after the AC and BEFORE
  // "## Dependencias" — it closes the reader's "how it is verified → what must
  // be observed" area without touching any of --reconcile's insertion anchors
  // (the epic's context is inserted before "## Contexto heredado"/the AC; the
  // deps are anchored at "## Out of scope / Protected"). It is only emitted
  // when there is content (a signal or a reasoned exemption, VERBATIM from the
  // cell): with nothing declared, silence — both cases are sin-vara for the
  // judge, and a section that came out in every issue of every epic that does
  // not use the column would be the warning-that-always-comes-out that trains
  // people to ignore it.
  const senal = renderSenalContent(slice)
  if (senal) {
    lines.push(SENAL_HEADING)
    lines.push(senal)
    lines.push('')
  }
  const deps = slice.deps || []
  if (deps.length) {
    lines.push('## Dependencias')
    lines.push(renderDepsContent(deps))
    lines.push('')
  }
  // F21: the gates go right after the acceptance criteria (and after the
  // dependencies, if there are any) and BEFORE "Out of scope / Protected" —
  // the reading order of whoever opens the issue or the PR is "what it
  // delivers → how it is verified → what is missing before it can be merged →
  // what is left out". It is emitted ALWAYS, also when there is no gate at
  // all: see renderGatesContent.
  lines.push(GATES_HEADING)
  lines.push(renderGatesContent(slice))
  lines.push('')
  // The section is emitted ONLY if there are runs — unlike "## Gates", which
  // is always emitted. That one's reason ("«this slice has no gates» is an
  // assertion a human who opens the PR needs to be able to read") does not
  // apply here: the absence of the section already says so, and emitting it
  // empty in three quarters of the issues is noise. Measured on mo-monitoring
  // v1: 6 out of 8 rows have no run.
  const e2eContent = renderE2eContent(slice)
  if (e2eContent) {
    lines.push(E2E_HEADING)
    lines.push(e2eContent)
    lines.push('')
  }
  lines.push('## Out of scope / Protected')
  lines.push(renderProtectedLine(slice))
  lines.push('')
  lines.push(`<!-- ct-order:${slice.n} -->`) // a greppable order marker for the dispatcher
  return lines.join('\n')
}

// findDuplicateOrders: the slice numbers (the `#` of the §9 table) are the
// only key buildOrderIndex (scripts/gh-issue-map.js) uses to map "order ->
// GitHub issue number" inside an epic. Since D1 that function does not resolve
// a collision blindly: the first issue seen keeps the slot and the whole gap
// accumulates in `collisions`, which makes buildDispatchInput EXCLUDE the
// affected epic from the batch. Even so, a duplicate at the SOURCE (two rows of
// the §9 table with the same `#`) is still an error that has to be cut here and
// not there: letting it through turns a whole epic undispatchable. It is cut at
// the producer (here) instead of leaving the consumer to defend itself.
function findDuplicateOrders(slices) {
  const seen = new Set()
  const dupes = new Set()
  for (const s of slices || []) {
    if (seen.has(s.n)) dupes.add(s.n)
    seen.add(s.n)
  }
  return [...dupes].sort((a, b) => a - b)
}

export function groomPlan(slices, { milestone, specRef, epicContext = null, epicContextReason = null, frozenDecisions = null, frozenDecisionsReason = null }) {
  // epicContextUnknown (I1): "I could not read valid text" is NOT "the epic
  // has no context". Without this distinction, `epicContext: null` travelled
  // the same in both cases and buildReconcileBody always read it as "withdraw
  // the section". It is the only thing reconcile.js needs to know of the
  // reason: the rest of the detail lives in the warning, which the wrapper has
  // already printed.
  const epicContextUnknown = epicContextReason === EPIC_CONTEXT_REASONS.MALFORMED
  // frozenDecisionsUnknown (the mirror of epicContextUnknown): "valid text
  // could not be read" is NOT "the epic has no decisions". Without this
  // distinction, frozenDecisions: null would travel the same in both cases and
  // buildReconcileBody would always read it as "withdraw the section".
  const frozenDecisionsUnknown = frozenDecisionsReason === EPIC_CONTEXT_REASONS.MALFORMED
  const dupes = findDuplicateOrders(slices)
  if (dupes.length) {
    throw new Error(`groomPlan: orden(es) de slice duplicado(s) en la tabla §9: ${dupes.join(', ')}`)
  }
  return {
    milestone,
    issues: slices.map((s) => ({
      order: s.n,
      title: buildIssueTitle(s),
      body: buildIssueBody(s, specRef, epicContext, frozenDecisions),
      labels: buildLabels(s),
      deps: s.deps,
      // F5: besides the already rendered body (above), the plan carries the
      // STRUCTURED values that feed it — scripts/reconcile.js needs them to
      // compare against an existing issue without having to re-parse the body
      // it has just generated itself (it avoids two implementations of the
      // same criterion that could diverge).
      ac: s.ac || [],
      descripcion: renderDescripcion(s),
      protectedLine: renderProtectedLine(s),
      // Slice 10: the structured signal travels alongside descripcion/
      // protectedLine and for the same reason — reconcile compares against an
      // existing issue without re-parsing the body this plan has just
      // generated.
      senal: renderSenalContent(s),
      specLink: renderSpecLink(s, specRef),
      // F21: the RESOLVED gates (not the raw cell) travel in the plan for the
      // same reason as ac/descripcion/protectedLine — reconcile.js and the
      // dry-run need them without resolving them again, and whoever reads the
      // `--dry-run` JSON has to be able to see which gates will come out
      // without reproducing the resolution in their head.
      gates: gatesOf(s).gates,
      gatesContent: renderGatesContent(s),
      // e2eContent (unlike gatesContent): `null` when there are no runs, not
      // `''` — reconcile.js#diffIssue needs to tell "this section should not
      // exist" (null on both sides is agreement) from "it exists but it is
      // empty", just as it already does with `descripcion`. See
      // buildIssueBody: the section itself is only written if there is
      // content.
      e2eContent: renderE2eContent(s) || null,
      // The epic's text travels in the plan, not only inside the already
      // rendered body, for the same reason as ac/descripcion/protectedLine: so
      // that comparing this slice against an existing issue does not force a
      // re-parse of the body just generated. Meanwhile, whoever reads the
      // --dry-run JSON has to be able to see what is going to come out without
      // reproducing the reading of the spec.
      epicContext,
      epicContextUnknown,
      // The decisions travel in the plan, not only inside the already
      // rendered body, for the same reason as epicContext: so that comparing
      // this slice against an existing issue does not force a re-parse of the
      // body just generated, and so that the --dry-run JSON shows them.
      frozenDecisions,
      frozenDecisionsUnknown,
    })),
  }
}
