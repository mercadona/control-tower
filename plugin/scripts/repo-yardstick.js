// scripts/repo-yardstick.js
//
// §3.3 of the handoff (docs/prompt-juez-lo-que-queda.md): the plan is per
// slice, so `## 3. Reference patterns` was re-derived in every slice plan, and
// nothing guaranteed that slice 14 cited the same paths as slice 3 — re-derived
// work, and a possible inconsistency in the yardstick itself.
//
// This module is the REPO'S YARDSTICK crossing `ct-step`'s funnel WITH NO AGENT
// IN BETWEEN: `.agent/conventions.md` is seeded by `scripts/ct-init.sh`,
// confirmed by the human who runs `/ct-init` (the gate that already existed — a
// fourth one is not added), and `ct-step.mjs` reads it from disk and pastes it,
// verbatim, at the end of every task brief. The plan's
// `## 3. Reference patterns` still selects per slice; this file declares per
// repo. The judge measures against the UNION of the two (see
// `agents/ct-judge.md`, item `patrones`): if §3 omits a document the repo
// declares here, the yardstick arrives all the same.
//
// CAREFUL, DOCUMENTED TRAP — this is NOT `scripts/conventions.js` nor
// `conventions-io.js`. Those two files (785 lines) are about PROTOCOL
// COLLISIONS between the loop and the target repo (claim, worktrees, the state
// file) — a completely different subject, with its own
// `.agent/conventions-ack.md`. This module declares HOW CODE IS WRITTEN in this
// repo, not how the loop and the repo live together. Do not confuse it by the
// name.

// The path, relative to the repo's root. A single constant so that seeder,
// reader and the texts that explain it to agents and humans cannot diverge in
// silence — the same decoupling JUDGE_TOOLS and VERDICT_RULES already suffered
// in scripts/step-contracts.js. __tests__/repo-yardstick.test.js ties this constant to
// the six files that cite it.
export const CONVENTIONS_FILE = '.agent/conventions.md'

// yardstickSection: the section `ct-step.mjs` pastes at the end of every task
// brief, or `''` if there is nothing to inject.
//
// `content` is what is in `.agent/conventions.md` TODAY (or null/undefined if
// the caller never got to read it). A blank declaration (empty file or only
// whitespace) is not a yardstick — it is the same state as "the file does not
// exist": the caller writes nothing to the brief in that case, and the diff is
// measured only against ct's yardstick (agents/ct-judge.md, item `patrones`:
// that item is never `sin-vara`, because ct's travels with the plugin); the
// repo's, here, adds nothing (F14: absence is measured, not filled in).
export function yardstickSection(content) {
  if (content == null || content.trim() === '') return ''
  const body = content.endsWith('\n') ? content : `${content}\n`
  return `\n---\n\n> La vara del REPO, leída directo de \`.agent/conventions.md\` por el programa —\n> ningún agente la escribió en este brief y el plan no puede quitarla. Sus\n> documentos de reglas son vara igual que los de §3: si §3 omitió uno, se mide\n> también contra él.\n\n${body}`
}

// ============================================================================
// §3.12 of the handoff (docs/prompt-juez-lo-que-queda.md): `reference-paths`
// (scripts/plan-contract.js) proves that what §3 CITED exists — it hunts
// INVENTION. Nothing proved that §3 cited EVERYTHING relevant: a
// `docs/conventions/` that really is in the repo passed the validator clean by
// OMISSION, and that is the asymmetry what follows below closes.
//
// What follows is a deterministic, offline sweep (in the style of
// agentic-skills' `discover_conventions.py`) that PROPOSES candidates for this
// repo's yardstick. Its only consumer is `scripts/detect-yardstick.mjs`, invoked
// from `ct-init.sh` at the one moment when there is already a human in front of
// it. NOTHING in this code ever writes to `.agent/conventions.md`: that
// remains, without exception, the decision of the human who confirms. A
// candidate is a PROPOSAL, not a declaration — just as an amber light is not a
// crossing.
// ============================================================================

export const CANDIDATOS_HEADER =
  'Candidatos a la vara de este repo (barrido determinista — PROPONE, no declara):'
export const MAX_CANDIDATOS = 40
export const MAX_PER_DIRECTORY = 12

// Repo guides, AT THE ROOT only: a `docs/AGENTS.md` is not the guide tools and
// humans look for by convention at the repo's root, so it does not match here
// (yardstickCandidates only applies this rule to paths with no `/`).
const ROOT_RE = /^(CLAUDE|AGENTS|CONTRIBUTING|CONVENTIONS)(\.md|\.markdown|\.rst|\.txt)?$/i
// Applied to the directory's BASENAME (without the trailing slash).
const DIR_RULES_RE = /(conventions?|convenciones|rules|reglas)/i
const PROJECT_SKILL_RE = /^\.claude\/skills\/[^/]+\/SKILL\.md$/
const TEXT_RE = /\.(md|markdown|mdc|rst|txt)$/i
// Nothing living under `.agent/` is a candidate: it is the loop's OWN ground
// (the declaration itself, `conventions.md`, and another subject's
// acknowledgement, `conventions-ack.md`) — proposing it would be the sweep
// citing itself.
const LOOP_OWN_RE = /^\.agent\//
// Deterministic and independent of the locale of the machine that runs it.
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// yardstickCandidates: takes the flat result of a walk over the repo
// (`entradas`, `repo-walk.js` format: directories with a trailing `/`) and the
// set of already declared paths (`declaredIn`), and returns
// `{ candidatos: [{ ruta, motivo }], omitidos }`.
//
// Three groups, each sorted with `order` so that the result is deterministic
// whatever happens to the order of the walk:
//   1. root guides (ROOT_RE);
//   2. text files inside a directory whose name matches
//      "convention(s)|convenciones|rules|reglas" (DIR_RULES_RE);
//   3. `SKILL.md` of project skills (PROJECT_SKILL_RE).
//
// `MAX_PER_DIRECTORY` caps each directory of group 2 separately —a
// `docs/conventions/` with a hundred files must not drown the other two
// groups—, and `MAX_CANDIDATOS` caps the whole list once grouped and sorted.
// Whatever does not fit under either cap counts in `omitidos`; whatever is
// discarded for being the loop's or for being declared already does NOT count
// there: it has not been kept quiet, it was simply not up for proposing.
export function yardstickCandidates({ entradas: entries = [], declaradas: declared = new Set() } = {}) {
  const seen = new Set()
  let omitted = 0

  const admits = (path) => {
    if (LOOP_OWN_RE.test(path)) return false
    if (declared.has(path)) return false
    if (seen.has(path)) return false
    return true
  }
  const mark = (path) => seen.add(path)

  const files = entries.filter((e) => !e.endsWith('/'))
  const directories = entries.filter((e) => e.endsWith('/'))

  // Group 1 — root guides.
  const rootGroup = files
    .filter((f) => !f.includes('/') && ROOT_RE.test(f))
    .sort(order)
    .filter((f) => admits(f))
    .map((path) => (mark(path), { ruta: path, motivo: 'guía del repo en la raíz' }))

  // Group 2 — text files inside directories that match "rules".
  const directoryGroup = []
  const matchingDirs = directories
    .filter((d) => DIR_RULES_RE.test(d.slice(0, -1).split('/').pop()))
    .sort(order)
  for (const dir of matchingDirs) {
    const dirCandidates = files
      .filter((f) => f.startsWith(dir) && TEXT_RE.test(f))
      .sort(order)
      .filter((f) => admits(f))
    const admitted = dirCandidates.slice(0, MAX_PER_DIRECTORY)
    omitted += Math.max(0, dirCandidates.length - MAX_PER_DIRECTORY)
    for (const path of admitted) {
      mark(path)
      directoryGroup.push({ ruta: path, motivo: `dentro de \`${dir}\`, que casa convention|rules` })
    }
  }

  // Group 3 — project skills.
  const skillGroup = files
    .filter((f) => PROJECT_SKILL_RE.test(f))
    .sort(order)
    .filter((f) => admits(f))
    .map((path) => (mark(path), {
      ruta: path,
      motivo: 'skill de proyecto (también se puede declarar por nombre en la lista `Skills`)',
    }))

  let candidates = [...rootGroup, ...directoryGroup, ...skillGroup]
  if (candidates.length > MAX_CANDIDATOS) {
    omitted += candidates.length - MAX_CANDIDATOS
    candidates = candidates.slice(0, MAX_CANDIDATOS)
  }
  return { candidatos: candidates, omitidos: omitted }
}

// declaredIn: the set of paths `.agent/conventions.md` ALREADY declares
// today — everything appearing between single backticks, normalised (no leading
// `./` and no trailing `/`).
//
// The seed `ct-init.sh` sows carries no backtick at all, so a freshly
// bootstrapped repo returns the empty set and `yardstickCandidates` proposes
// EVERYTHING it finds — that is the intended behaviour (F14: absence is
// measured, not filled in; here, "nothing declared" must not be read as
// "nothing to propose"). And a declared DIRECTORY (e.g. `docs/conventions/`)
// does not suppress its files: a path ending in `/` is not a readable path, so
// going on proposing the files inside is the correct thing, not the noise — the
// human will decide whether that declaration already covers the directory or
// whether the files need declaring one by one.
export function declaredIn(content) {
  const out = new Set()
  for (const m of String(content ?? '').matchAll(/`([^`\n]+)`/g)) {
    let token = m[1].trim()
    if (!token) continue
    if (token.startsWith('./')) token = token.slice(2)
    token = token.replace(/\/+$/, '')
    if (token) out.add(token)
  }
  return out
}

// The same markers `scripts/ct-init.sh` uses to delimit the "Formato de la
// tabla de slices" block it injects into AGENTS.md itself. They are duplicated
// here as a literal, just as `scripts/conventions.js`
// (CONTRACT_MARKER_OPEN/CLOSE) and `scripts/governed-repo.js`
// (CONTRACT_MARKER) already do independently — every module that needs to
// recognise this block carries its own copy of the literal instead of importing
// between modules about different subjects (conventions.js is ANOTHER subject:
// protocol collisions, not the code yardstick).
//
// Why it is needed here: the AGENTS.md `ct-init.sh` CREATES from scratch does
// not stay at "headings only" — the script itself ALWAYS adds this process
// section to it (the slices-table contract with `/ct-groom`, hundreds of lines
// of real prose). That section is real substance, but it is not a CODE
// CONVENTION: it is the format `/ct-groom` consumes, not a style rule of the
// repo. Without discounting it, `pareceEsqueleto` would see substance to spare
// and would never flag the freshly created AGENTS.md — which is exactly the
// case that motivates this function.
//
// And the same reasoning, word for word, holds for the SECOND block
// `ct-init.sh` injects since the e2e-at-slice-closure feature: the section
// "Cómo se atraviesa este repo (e2e)". It is seeded as a TEMPLATE with its
// fields empty (`Levantar:`, `Listo cuando:`…), which are half a dozen lines
// with formal substance and zero real content — without discounting it, the
// freshly created AGENTS.md would stop looking like a skeleton because of some
// fields nobody has filled in yet. It is not a code convention either: it is
// how the repo is brought up, which is what `ct-step`'s `e2e` step consumes.
// And the same reasoning again for the THIRD block, the one #93 put in the spot
// the contract left behind: the loop's short section. It is the plugin's prose,
// not a code convention of this repo — and its gaps (the build/test/lint
// commands) are filled in by the user, so without discounting it a freshly
// created AGENTS.md would stop looking like a skeleton because of a text nobody
// from here wrote.
const CT_INIT_BLOCKS = [
  ['<!-- ct-init:slices-contract -->', '<!-- /ct-init:slices-contract -->'],
  ['<!-- ct-init:e2e-howto -->', '<!-- /ct-init:e2e-howto -->'],
  ['<!-- ct-init:loop -->', '<!-- /ct-init:loop -->'],
]

function withoutCtInitBlocks(content) {
  const lines = String(content ?? '').split('\n')
  const out = []
  let expectedClosing = null
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (expectedClosing === null) {
      const block = CT_INIT_BLOCKS.find(([opening]) => line === opening)
      if (block) { expectedClosing = block[1]; continue }
      out.push(raw)
      continue
    }
    if (line === expectedClosing) expectedClosing = null
  }
  return out.join('\n')
}

// pareceEsqueleto: a deliberate approximation, not a markdown parser — it
// counts lines "with substance" (non-empty, not starting with `#` and not a
// single-line HTML comment), FIRST DISCOUNTING the slices-contract block
// `ct-init.sh` injects (see above), and says skeleton if there are FEWER than
// 3.
//
// It serves the one thing it has to serve: telling the headings-only
// `AGENTS.md` that `ct-init` has just created (a real candidate, but with no
// rule inside) apart from a document with real rules — and SAYING SO, not
// filtering it out. Declaring the skeleton as a yardstick sets the judge to
// measure against an empty document and to return `conforme` without being so:
// it is F14's impossible guard under another name. A multiline HTML comment
// counts on the inside (its inner lines neither start with `<!--` nor end with
// `-->`) — accepted: this is an approximation, not a formal proof.
export function pareceEsqueleto(content) {
  const lines = withoutCtInitBlocks(content).split('\n')
  let substance = 0
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith('#')) continue
    if (t.startsWith('<!--') || t.endsWith('-->')) continue
    substance++
  }
  return substance < 3
}

// formatCandidatos: the block of text ready for `ct-init.sh`'s stdout, or `''`
// if there is nothing to propose (silence = nothing to propose; see the comment
// on `declaredIn` about why that is benign).
//
// Two-space indentation in the detail, just like `formatFindings` in
// `conventions.js`. Deliberately WITHOUT the words "aviso", "ATENCIÓN" or
// "unblock": this is not an alarm about a conflict (that is
// `detect-conventions.mjs`), it is material for a decision — and
// `__tests__/ct-init.test.js` demands that the second run of a bootstrapped
// repo carry no word "aviso" on stderr, a run in which this block DOES have a
// candidate (the `AGENTS.md` `ct-init` has just created).
export function formatCandidatos(candidates, { omitidos: omitted = 0, truncated = false } = {}) {
  if (!candidates || candidates.length === 0) return ''
  const out = [CANDIDATOS_HEADER]
  let hasSkeleton = false
  for (const c of candidates) {
    const mark = c.esqueleto ? ' [esqueleto: sólo encabezados]' : ''
    if (c.esqueleto) hasSkeleton = true
    out.push(`  · \`${c.ruta}\` — ${c.motivo}${mark}`)
  }
  out.push(
    '  Nada de esto se ha escrito por ti: el barrido PROPONE y el humano DECLARA. ' +
      `Enséñaselos al usuario y escribe en \`${CONVENTIONS_FILE}\` SOLO los que confirme.`
  )
  if (hasSkeleton) {
    out.push(
      '  Los marcados `[esqueleto: sólo encabezados]` no traen reglas todavía: declararlos hoy ' +
        'es peor que no declararlos, porque le da al juez un documento vacío que SÍ cuenta como ' +
        'vara del repo, en vez de dejar que el diff se mida sólo contra la de ct.'
    )
  }
  if (omitted > 0) {
    out.push(`  (+${omitted} candidatos más, no listados: la lista es para que la filtre una persona.)`)
  }
  if (truncated) {
    out.push(
      '  nota: el recorrido del repo se cortó por sus cotas, así que puede haber candidatos que no ' +
        'se hayan mirado. Ausencia aquí no es prueba de ausencia.'
    )
  }
  return out.join('\n')
}
