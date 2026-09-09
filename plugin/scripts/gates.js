// ============================================================================
// F21 — HUMAN GATES, SEPARATED FROM THE SLICE'S TECHNICAL TYPE.
//
// THE DEFECT THIS FILE CLOSES. Up to here, the only human gate in the whole
// plugin lived INSIDE a text string: the one in the `ui` addendum
// (kickoff.js#ADDENDA, "gate de screenshot obligatorio y respeta el design
// system…"). There was no other mechanism — not in slices.js, not in groom.js,
// not in the issue body, not in the labels. Consequence: the `Tipo` column of
// the §9 table decided TWO things at once —which TECHNICAL reminder the agent
// receives, and whether there is a HUMAN GATE— and those two axes do not
// always coincide.
//
// The real case that exposed it: a slice whose `Tipo` is `backend` (a
// migration with a backfill) that the epic's spec explicitly marked as needing
// a visual gate, because "la barra es lo más visible de todo el spec". It is
// backend on the inside and visible on the outside. The kickoff gave it the
// backend addendum and NO gate at all, and nothing flagged it.
//
// And the layer of irony, which is the one that fixes the design criterion for
// all of this: the epic's spec said "el gate visual no depende de esto: vive
// en §10 y en la REGLA #-2, que son más fuertes que un addendum". That is true
// for a HUMAN who reads the spec. The dispatched agent does NOT read the spec
// (the §9 contract says so in as many words: "no recibe el spec: se hidrata
// del issue"). A guarantee that lives only in a document the addressee never
// opens is not a guarantee. Hence the underlying property:
//
//   NO DEMAND THE SPEC MAKES OF THE AGENT MAY DEPEND ON THE AGENT READING THE
//   SPEC.
//
// WHY A CLOSED VOCABULARY. Every gate has to be EXPLAINABLE to the agent (a
// sentence in the kickoff) and to the human who opens the PR (a line in the
// issue body). An open vocabulary would produce `gate:whatever`: a label
// nobody knows how to close, and therefore a gate that exists on the tag and
// not in practice — the same failure we are fixing, in different clothes. A
// token outside this map is rejected by /ct-groom before it writes anything
// (see the validation in ct-groom.mjs), and the message names the whole
// vocabulary: narrowing what the system accepts creates a new category of
// refusal, and that category needs a voice of its own.
//
// WHY THESE TWO GATES AND NOT OTHERS. They were not invented: they were
// EXTRACTED from the only two sentences in ADDENDA that demanded a human act
// —"gate de screenshot obligatorio" (`ui`) and "apply solo tras review"
// (`infra`)—. The rest of each addendum is a technical reminder and there it
// stays. Adding a new gate here is a deliberate act with its own kickoff and
// issue text; there is no way to create one "in passing" from a spec.
// ============================================================================

// splitEscapedCommas / NO_VALUE_MARKERS are imported from cells.js —and not
// from slices.js— so that gates.js can split a cell without dragging in the
// whole parser: gates.js has to be usable from kickoff.js, which does not
// depend on slices.js and must not start doing so. See the header of cells.js
// for the full reason. splitEscapedCommas is used here because the E2E column
// is split EXACTLY like `Acepta`, and for the same reason: a run almost
// always carries commas.
import { splitEscapedCommas, NO_VALUE_MARKERS } from './cells.js'

// GATE_LABEL_PREFIX / GATE_LABEL_NONE: the channel through which the gate
// SURVIVES. A kickoff is ephemeral (it is lost with its session's context); a
// GitHub label is not. `/ct-next` rebuilds the slice it dispatches out of the
// ISSUE (gh-issue-map.js#mapGhIssue), so a gate written into a label comes
// back intact on a redispatch, on a `--reopen`, and on the screen of the human
// who opens the PR.
export const GATE_LABEL_PREFIX = 'gate:'
// GATE_LABEL_NONE — why a label exists to say "none". Without it, "this issue
// has no gate: label at all" would mean two incompatible things at once: (a)
// this slice demands no gate, and (b) this issue was groomed BEFORE the gates
// existed, so its gate (if it had one) is written nowhere. The dispatcher has
// to tell them apart: in (a) it must respect the "none"; in (b) it must fall
// back to the `Tipo`, or every already-groomed `ui` issue would lose its
// screenshot gate the day this is deployed — the same breakage this round
// closes, in the other direction.
export const GATE_LABEL_NONE = 'gate:none'

// GATES: the vocabulary. `kickoff` is what the AGENT reads; `issue`, what the
// HUMAN who opens the issue or the PR reads. The two texts say the same thing
// from the two sides of the gate on purpose: the agent has to know that it can
// NOT close it itself, and the human has to know what is expected of them.
export const GATES = {
  visual: {
    kickoff: 'GATE HUMANO `visual` (lo pide el spec para ESTE slice, esté o no en su `Tipo`): antes de que este PR se pueda mergear, un humano tiene que ver el cambio. Adjunta al PR una captura (o un vídeo corto) del estado ANTES y DESPUÉS, di desde qué pantalla/ruta se llega, y NO des el gate por cumplido tú: no lo cierras tú, lo cierra quien revisa.',
    issue: '**`visual`** — antes de mergear, un humano tiene que VER el cambio: el PR debe traer captura (o vídeo) del antes/después y la ruta para reproducirlo. El agente no puede darlo por cumplido.',
  },
  apply: {
    // The text deliberately avoids the words
    // "migración"/"rollback"/"contrato": the kickoff.js tests check that one
    // `Tipo`'s addendum does not leak into another's by using those words as
    // markers, and a gate that repeated them would make that guard give a
    // false positive (an `infra` slice "would contain backend markers"). The
    // gate explains itself just as well without them.
    kickoff: 'GATE HUMANO `apply` (lo pide el spec para ESTE slice, esté o no en su `Tipo`): no apliques nada contra un entorno real (`apply`, `deploy`, un script ejecutado sobre datos de verdad) por tu cuenta. Deja el plan/dry-run en el PR y PARA: el apply lo autoriza un humano después de revisarlo.',
    issue: '**`apply`** — nada se aplica contra un entorno real hasta que un humano revise el plan/dry-run que trae el PR. El agente deja el plan y para.',
  },
  plan: {
    // The only gate that cuts in BEFORE implementing, not before merging: its
    // value is in stopping while throwing the work away still costs nothing.
    // That is why the text asks for the plan to be published as a COMMENT on
    // the issue — the PR may not exist yet. F-jjponz-2: it is implied BY
    // DEFAULT in every slice (see gatesForType, below) — it does not live in
    // TYPE_GATES because it is not a technical axis; the per-row waiver is
    // `!plan`, noisy like all of them.
    kickoff: 'GATE HUMANO `plan` (implicado por defecto en TODO slice, salvo renuncia `!plan` en el spec): con el plan del slice escrito, validado con --check-plan y commiteado, publícalo como comentario del issue y PARA — no implementes nada hasta que un humano conteste el go en un comentario de ese issue. El go es `-OK <nonce>`, y el nonce lo sorteó la coordinadora al despacharte: vive fuera de este kickoff, del issue y de tu worktree, y por eso es un permiso que sólo un humano puede darte: no puedes fabricarlo, y `dispatch-check --release` se niega (exit 9) sin un go válido, así que saltarte este gate no te deja entregar, sólo te deja rehacer el trabajo. Un vigilante que lanzó la coordinadora está mirando el issue y te teclea la línea cuando el go llegue, así que PARAR de verdad es lo correcto: no sondees tú el issue ni te des el gate por cumplido. En el comentario que publicas, di que el go es `-OK` seguido del nonce que `/ct-next` imprimió al despachar, y que si se perdió lo reemite quien despachó: escrito así, quien lo lea sabe de dónde sacar el nonce — con el literal `<nonce>` como formato entero acabaría probando el `-OK` pelado, que no arranca nada. No lo cierras tú: lo cierra quien revisa el plan.',
    issue: '**`plan`** — antes de implementar, un humano tiene que revisar el PLAN del slice: el agente lo publica como comentario de este issue y se detiene. Para darle el go, contesta con un comentario que sea exactamente `-OK <nonce>`, con el nonce que /ct-next imprimió al despachar este slice (sin nada más: cualquier otra cosa no arranca nada, a propósito). Ese nonce no está escrito en este issue porque el agente lee el issue: es la parte del permiso que él no puede fabricar, y sin él `--release` se niega. Si se ha perdido, quien despachó lo reemite con `scripts/ct-go.mjs`. Quien vigila el issue es un proceso que la coordinadora lanzó al despachar y que espera unas horas: si contestas mucho más tarde puede haber caducado, y entonces hay que empujar la sesión a mano. El agente no puede darlo por cumplido.',
  },
  e2e: {
    // The only gate whose CONTENT travels in a column of its own: the other
    // three are a token that explains itself, and this one needs to say WHAT
    // to walk through. That is why the text sends the agent to the issue's
    // section instead of describing a run: the run was written by a human when
    // freezing it, and it cannot be reproduced here without duplicating it.
    //
    // And that is why the kickoff names AGENTS.md: the script travels frozen
    // from the spec, but HOW this repo is brought up is not something the
    // plugin can know — the target repo declares it. Without that section, the
    // outcome is "could not be checked", never a red and never an improvised
    // journey.
    kickoff: 'GATE HUMANO `e2e` (lo pide el spec para ESTE slice, en la columna `E2E` de su fila): antes de abrir el PR, atraviesa los recorridos que trae la sección `## E2E` de tu issue — ésos y sólo ésos, no añadas ni quites ninguno. Cómo se levanta este repo lo dice la sección `## Cómo se atraviesa este repo (e2e)` de `AGENTS.md`: si no está rellenada, el veredicto es `no-verificado` con ese motivo, NUNCA rojo y nunca inventarse cómo arrancarlo. Escribe el informe en `docs/superpowers/e2e/<issue>.md` con el comando literal y su salida real por cada recorrido, commitéalo, y pégalo como comentario del PR. Si algún recorrido sale ROJO, PARA sin liberar. No lo cierras tú: lo cierra quien revisa.',
    issue: '**`e2e`** — este slice declara recorridos en la columna `E2E` de su fila: el PR debe traer el informe de haberlos atravesado (`docs/superpowers/e2e/<issue>.md`, commiteado y pegado como comentario) con el comando y su salida por cada uno. Un recorrido en rojo impide el `--release`; uno que no se pudo comprobar libera, pero lo dice. El agente no puede darlo por cumplido.',
  },
}

// GATE_ORDER: canonical output order (labels, issue body, kickoff), so that
// the same slice ALWAYS produces the same sequence — just as
// groom.js#buildLabels fixes type → area → touches → status. An order that
// depended on how the cell was written would make the `gh label` diffs, the
// dry-run and the drift detection unstable.
const GATE_ORDER = Object.keys(GATES)
const inGateOrder = (tokens) => GATE_ORDER.filter((g) => tokens.includes(g))

// TYPE_GATES: which gates each `Tipo` implies, and therefore THE DEFAULT CASE
// — a `Tipo: ui` still brings its screenshot gate along without anyone writing
// anything new in the spec. This table is the "compatible" half of the fix;
// the `Gate` column is the half that allows departing from it in both
// directions.
export const TYPE_GATES = {
  ui: ['visual'],
  infra: ['apply'],
}

export function gatesForType(type) {
  const typed = TYPE_GATES[typeof type === 'string' ? type.trim() : ''] ?? []
  // F-jjponz-2 — `plan` is implied in EVERY slice, whatever the Tipo may be:
  // the slice's plan always passes through human review before implementing,
  // barring an EXPLICIT per-row waiver (`!plan` in the Gate column, with the
  // same noise as any waiver). It lives here and not in TYPE_GATES on
  // purpose: TYPE_GATES maps the TECHNICAL axis (ui→visual, infra→apply) and
  // this default cuts across every type — putting it in each entry of the map
  // would make it depend on the Tipo existing in the map, and a `Tipo:
  // backend` (with no entry) would lose it.
  return [...typed, 'plan']
}

// cleanGateToken: the same criterion of tolerance to inline markup as the rest
// of the §9 table (cells.js#cleanEmphasis) — an author who has already shown
// they write "**S1**" and "`–`" will write "`visual`" just as easily, and a
// new column cannot be fussier than the eight that already exist. The waiver
// `!` is stripped BEFORE cleaning (and a space behind it is tolerated: "!
// visual") so that "**!visual**" means the same as "!visual".
//
// Nothing is normalised beyond this (no discarding of stray characters the way
// slices.js#normalizeToken does): the result is compared against a CLOSED
// vocabulary, so any leftover rubbish makes the token fail to match and get
// reported as unknown — which is exactly what we want. Normalising any further
// would turn "vi sual" into a valid gate.
function cleanGateToken(raw) {
  const cleaned = String(raw).replace(/[`*_~]/g, '').trim().toLowerCase()
  // The `gate:` prefix is tolerated, for the SAME reason (and with the same
  // precedent) that slices.js#stripColumnPrefix tolerates `area:`/`touches:`
  // inside their columns: the author is asked for the bare token, but what
  // they see in GitHub's UI is the whole label, so writing `Gate: gate:visual`
  // is the natural mistake. Without this strip it would end up in the "unknown
  // gate" abort for having written, in different clothes, exactly what was
  // asked of them.
  return cleaned.startsWith(`${GATE_LABEL_PREFIX}`) ? cleaned.slice(GATE_LABEL_PREFIX.length).trim() : cleaned
}

// NO_VALUE: the list of characters comes from cells.js (the same set
// slices.js uses), and the empty string `''` is ADDED here on purpose, without
// unifying the two sets. The reason is that "no value" means different things
// in each place: slices.js needs to tell "empty cell" (a column not filled in
// yet, F1) from "cell with a dash" (an explicit filling-in of "nothing"), so
// NO_VALUE_MARKERS does not include `''`. gates.js has no such distinction to
// make — an empty `Gate` cell and one with "–" mean exactly the same thing
// here: "I have declared nothing" — so treating them alike loses no
// information in this file. Unifying the two sets would silently change how
// slices.js classifies an empty cell.
const NO_VALUE = new Set([...NO_VALUE_MARKERS, ''])

// parseGateCell: raw `Gate` cell -> { add, waive, unknown }.
//
// SYNTAX: comma-separated tokens. `visual` ADDS the gate; `!visual` WAIVES the
// one the `Tipo` implies. `!` was chosen and not `-` because `-` is one of the
// "no value" markers of every other column: "-visual" and "-" two characters
// apart meaning opposite things is exactly the kind of trap this parser has
// spent five rounds removing.
//
// A CELL WITH A "NO VALUE" MARKER IS NOT A WAIVER. "–" means "I have declared
// nothing here" (just as in Dep/Acepta/Protegido/Área/Toca), so the `Tipo`'s
// gates still stand. Reading it as "I waive everything" would make filling the
// column with dashes —which everybody does when the rest of the row carries
// them— remove gates silently.
export function parseGateCell(cell) {
  const raw = String(cell ?? '').trim()
  const add = []
  const waive = []
  const unknown = []
  if (NO_VALUE.has(cleanGateToken(raw))) return { add, waive, unknown }
  for (const piece of raw.split(',')) {
    const trimmed = piece.trim()
    if (!trimmed) continue // empty cell between commas: there was never anything to report
    const isWaiver = /^\s*[`*_~]*\s*!/.test(trimmed)
    const token = cleanGateToken(trimmed.replace(/^[`*_~\s]*!\s*/, ''))
    // A "!" with no gate behind it names nothing — but the cell was NOT
    // empty, so its author believes they declared something. It is reported as
    // unknown (with the raw text) instead of being discarded: silently
    // discarding a badly written waiver is exactly the shape of failure this
    // round is after, in its smallest version.
    if (!token) { unknown.push(trimmed); continue }
    if (!Object.hasOwn(GATES, token)) { unknown.push(token); continue }
    ;(isWaiver ? waive : add).push(token)
  }
  return { add, waive, unknown }
}

// E2E_NONE_TOKENS: the POSITIVE declaration that this slice has nothing to
// walk through. It exists for the same reason as GATE_LABEL_NONE (above):
// without it, an empty cell would mean both "it was thought about and there is
// none" and "nobody filled the column in", and with the second the feature
// ends up inert without anyone noticing. The difference from GATE_LABEL_NONE
// is that that one is DERIVED by the plugin and this one cannot be derived:
// only whoever writes the spec knows it.
export const E2E_NONE_TOKENS = new Set(['no', 'n/a'])

// resolveE2e: raw cell -> { runs, declared, none, contradiction }.
//
// THE TOKEN COMPARISON IS OVER THE WHOLE CELL, NEVER BY PREFIX. A perfectly
// legitimate run can start with "no" ("no se puede acceder a /metrics sin
// levantar el server"), and reading it as the token would turn a declaration
// of work into a waiver — silently, which is the worst way. It is the same
// criterion state.js applies to the `blocked` field ("over the WHOLE string,
// never by prefix") and for the same reason.
//
// A "NO VALUE" MARKER IS NOT A `no`. "–" means "I have declared nothing here"
// — the meaning parseGateCell already gives it, and which is NOT reinterpreted
// here: it is taken literally and produces `declared: false`, which is what
// /ct-groom turns into an abort. Reinterpreting it as "not applicable" would
// bring back the ambiguity this token exists to remove.
export function resolveE2e(cell) {
  const raw = String(cell ?? '').trim()
  if (NO_VALUE.has(cleanGateToken(raw))) return { runs: [], declared: false, none: false, contradiction: false }
  const pieces = splitEscapedCommas(raw).map((x) => x.trim()).filter(Boolean)
  const none = pieces.some((p) => E2E_NONE_TOKENS.has(cleanGateToken(p)))
  const runs = pieces.filter((p) => !E2E_NONE_TOKENS.has(cleanGateToken(p)))
  return { runs, declared: true, none, contradiction: none && runs.length > 0 }
}

// resolveGates: the two axes, resolved in a single place. Besides the final
// set, it returns EVERYTHING /ct-groom needs in order to speak out loud —
// because the brief is not just "that it can be declared", it is "that the
// system says so":
//   - gates        the final set, in canonical order
//   - implied      the ones that come from the `Tipo` and still stand
//   - added        gates the `Tipo` does NOT imply → THE CASE THAT MOTIVATES
//                  THE ROUND: whoever grooms has to see it
//   - waived       gates of the `Tipo` the spec explicitly WAIVES → noisy
//                  always, never a silence
//   - redundant    declared and already implied by the `Tipo` (harmless, said)
//   - inertWaivers waivers of a gate the `Tipo` did not imply (they do
//                  nothing; keeping quiet would leave the author believing
//                  they removed something)
//   - unknown      tokens outside the vocabulary (ct-groom.mjs rejects them)
//   - contradictions  the same gate both asked for and waived in one cell
export function resolveGates(type, cell, e2eCell) {
  const { add, waive, unknown } = parseGateCell(cell)
  // The `e2e` gate does NOT come out of the `Gate` column: it is DERIVED from
  // the `E2E` column carrying some run. Written by hand there would be two
  // places saying the same thing, and two places drift; derived, there is no
  // way to ask for an e2e without saying what to walk through. That `e2e` is
  // in the GATES vocabulary all the same is not contradictory: it is there so
  // that a hand-written `Gate: e2e` can be REJECTED (ct-groom.mjs) and so that
  // it has its two texts, not in order to produce it.
  const derived = resolveE2e(e2eCell).runs.length > 0 ? ['e2e'] : []
  const implied = [...gatesForType(type), ...derived]
  const contradictions = inGateOrder(add.filter((g) => waive.includes(g)))
  // A contradiction is NOT resolved here by picking a winner: ct-groom.mjs
  // aborts on it. It is left out of the final set for the safety of the pure
  // function (someone calling resolveGates without going through ct-groom does
  // not receive a half-made gate), but the set that matters is the report.
  const waiveSet = new Set(waive)
  const addSet = new Set(add.filter((g) => !waiveSet.has(g)))
  const gates = inGateOrder([...new Set([...implied.filter((g) => !waiveSet.has(g)), ...addSet])])
  return {
    gates,
    implied: inGateOrder(implied.filter((g) => gates.includes(g))),
    added: inGateOrder([...addSet].filter((g) => !implied.includes(g))),
    waived: inGateOrder(waive.filter((g) => implied.includes(g))),
    redundant: inGateOrder(add.filter((g) => implied.includes(g) && !waiveSet.has(g))),
    inertWaivers: inGateOrder(waive.filter((g) => !implied.includes(g))),
    unknown,
    contradictions,
  }
}

// gateLabels: the resolved set -> labels. It ALWAYS returns at least one (see
// GATE_LABEL_NONE, above).
export function gateLabels(gates) {
  const list = inGateOrder(gates || [])
  return list.length ? list.map((g) => `${GATE_LABEL_PREFIX}${g}`) : [GATE_LABEL_NONE]
}

// gatesFromLabels: the way back — from a real issue's labels to the set of
// gates. `declared` is the bit that tells "no gate" from "no declaration" (see
// GATE_LABEL_NONE).
//
// A `gate:` label WITHOUT a value (the colon present and nothing behind it, or
// only spaces: created by accident in GitHub's editor) counts neither as a
// gate nor as a declaration — the same criterion and the same reason
// gh-issue-map.js#mapGhIssue applies to empty `area:`/`touches:`. `.trim()`
// before looking at the length, so that "gate: " does not sneak through for
// having one character.
export function gatesFromLabels(labels) {
  const values = (labels || [])
    .filter((l) => typeof l === 'string' && l.startsWith(GATE_LABEL_PREFIX))
    .map((l) => l.slice(GATE_LABEL_PREFIX.length).trim().toLowerCase())
    .filter((v) => v.length > 0)
  const declared = values.length > 0
  const known = values.filter((v) => v !== 'none' && Object.hasOwn(GATES, v))
  const unknown = values.filter((v) => v !== 'none' && !Object.hasOwn(GATES, v))
  return { gates: inGateOrder(known), declared, unknown }
}

// resolveGatesForAgent: which gates the dispatched agent receives.
//
// The rule —and its only exception— in a single place, because it is the one
// that decides whether a slice goes out with a gate or without one: if the
// issue DECLARES its gates (it has some `gate:` label, `gate:none` included),
// that declaration rules and is not completed with anything. If it declares
// nothing, it is an issue older than this round: it falls back to the `Tipo`,
// which is exactly what the plugin did before. The alternative —always joining
// declaration and `Tipo`— would resurrect any gate the spec had waived.
export function resolveGatesForAgent(slice) {
  if (slice && slice.gatesDeclared) return inGateOrder(slice.gates || [])
  return gatesForType(slice && slice.type)
}

// renderGateKickoffLines / renderGatesIssueContent: the two texts, each for
// its own reader. They live here and not in kickoff.js/groom.js for the same
// reason as groom.js#renderDepsContent: a single source of truth of "what it
// ought to say", shared by whoever writes it and whoever compares it later.
export function renderGateKickoffLines(gates) {
  return inGateOrder(gates || []).map((g) => GATES[g].kickoff)
}

// renderGatesIssueContent: the body of the issue's "## Gates" section. It
// ALWAYS returns content (never null, unlike groom.js#renderDescription): the
// section is always emitted, including when there is no gate at all. "This
// slice has no gates" is a statement a human who opens the PR needs to be able
// to read; its absence would only say "this issue is old, or nobody thought
// about it".
export function renderGatesIssueContent(resolution, type) {
  const lines = []
  const gates = inGateOrder(resolution.gates || [])
  if (gates.length) {
    lines.push('Antes de mergear, estos gates los cierra un HUMANO — el agente que implementa el slice no puede darlos por cumplidos:')
    for (const g of gates) lines.push(`- ${GATES[g].issue}`)
  } else {
    lines.push('- (ninguno) — este slice no exige ningún gate humano antes de mergear.')
  }
  for (const g of resolution.added || []) {
    lines.push(`- ⚠️ el gate \`${g}\` lo pide el spec para ESTE slice: no viene de su \`Tipo\`${type ? ` (\`${type}\`)` : ''}.`)
  }
  for (const g of resolution.waived || []) {
    lines.push(`- ⚠️ RENUNCIA explícita: el gate \`${g}\`, que implica el \`Tipo\` de este slice (\`${type}\`), se ha retirado a propósito en la tabla §9 del spec (\`Gate: !${g}\`). Nadie lo comprobará antes de mergear.`)
  }
  return lines.join('\n')
}
