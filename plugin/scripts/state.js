import { parse, stringify } from './vendor/yaml.js'
import { STATE_REL_PATH as COORD_REL_PATH, SLICE_REL_PATH } from './state-paths.js'
import { CtStepCommit } from './ct-step-commit.js'

// ===========================================================================
// F22 — `stateRel`: WHICH FILE THIS MODULE'S MESSAGES NAME.
//
// This module does not read files: it receives the text already read. Until
// F22 that did not matter, because the file was always `.agent/STATE.md` and
// the constant written by hand inside every sentence was always right. Since
// F22 there are TWO (see scripts/state-paths.js) and whoever reads already
// applies the precedence — so a constant inside the message no longer
// describes anything: it CLAIMS. In a slice's worktree it claimed
// `.agent/STATE.md`, which is the coordinator's TRACKED file, and the `Stop`
// hook's blocking reason comes out on every single turn.
//
// The mechanism is a `stateRel` option with a default value, not a mandatory
// parameter: the callers that do not tell the two apart (and the tests that
// exercise the functions on their own) go on seeing exactly the text of
// before. The path is RELATIVE on purpose — whoever reads the message is
// inside that directory.
//
// The default is the COORDINATOR's file because it is the only case in which
// "nobody told me which" has a right answer: a slice ALWAYS arrives through
// the hook, which does know which one it read.
// ===========================================================================

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseState(md) {
  const s = (md ?? '').replace(/^﻿/, '').trimStart()
  const m = s.match(FM)
  if (!m) return { meta: {}, body: s.trim() }
  return { meta: parse(m[1]) ?? {}, body: m[2].trim() }
}

// parseStateSafe: `parseState` THROWS if the frontmatter is not valid YAML
// (`yaml.parse` does, and it stays that way: whoever asks for the typed
// frontmatter has a right to find out that it is not). But the two hooks run
// at the start-up/closure of EVERY session of a bootstrapped repo: there an
// exception is not an informative error, it is a hook that blows up with a
// stack trace on stderr every turn, from which nobody deduces that the problem
// is their state file. This variant never throws and returns the error as a
// DATUM, so that whoever hydrates can SAY it instead of keeping quiet about it
// (see composeHydration: an unreadable frontmatter is the only case in which
// it really "is not known" whether the work is blocked, and it is announced as
// such).
export function parseStateSafe(md) {
  try {
    return { ...parseState(md), error: null }
  } catch (e) {
    const s = (md ?? '').replace(/^﻿/, '').trimStart()
    return { meta: {}, body: s.trim(), error: e?.message || String(e) }
  }
}

export function renderState({ meta, body }) {
  return `---\n${stringify(meta).trim()}\n---\n\n${(body ?? '').trim()}\n`
}

// ===========================================================================
// `blocked` — the field that tells "this is what comes next" apart from "this
// cannot be done", in a datum a program reads and not in prose inside another
// field.
//
// THE HOLE IT COVERS (a real case): a repo had
// `next_action: "Lanzar la corrida REAL de /ct-groom…"`. It was found out
// afterwards that that run would write false data, and it was left blocked.
// The SessionStart hook injects the whole STATE.md into EVERY new session of
// that repo (and of any worktree of it), and a fresh session reads
// `next_action` as the standing order: for a while, any new session would have
// launched the groom knowing nothing. The mitigation was to rewrite the field
// by hand with the word "BLOQUEADO" and the reasons in prose — that is, to
// trust whoever reads it to interpret free text correctly. That is not a
// mechanism.
//
// WHY A FIELD OF ITS OWN AND NOT `status: blocked`:
//   - `status` is the PROGRESS axis (`not_started` → `in_progress` → …), it is
//     seeded by `buildStateSeed` and moved by the work. "Blocked" is an
//     ORTHOGONAL axis: one can be blocked halfway through an `in_progress`.
//     Fusing them forces you to destroy the progress in order to block and to
//     remember to restore the previous value on unblocking — a round trip
//     nobody does right by hand.
//   - an enum has no room for the only thing that makes a block actionable:
//     WHY and WHAT WOULD BE NEEDED to lift it. `blocked` is a map
//     (`reason`/`since`/`unblock`) precisely so that those two things are
//     fields, not prose the reader has to guess at.
//
// SILENCE = NOT BLOCKED (a deliberate decision). A STATE.md with no such field
// reads as not blocked, not as "it is not known":
//   - EVERY STATE.md that exists today predates the field. With "silence = it
//     is not known", every hydration of every repo would open with a warning —
//     and a warning that always comes out is a warning nobody reads (the prose
//     warning of `commands/ct-init.md` already proved that prose that is
//     always there gets ignored).
//   - the failure we are fixing is a STALE POSITIVE (a `next_action` that must
//     not be executed), not an absent negative.
//   - the case in which it really IS NOT KNOWN does exist and does shout: a
//     frontmatter that cannot be parsed (see `parseStateSafe` and
//     `composeHydration`).
// ===========================================================================

// Values a human writes meaning "not blocked" and that a naive truthy-check
// would read as a block. Exact comparison (trim + lower case) over the WHOLE
// string, never by prefix: `blocked: "no puedo seguir hasta que…"` begins with
// "no" and is a real block. The dashes are the same "no value" markers the §9
// table's contract already accepts (ct-init.sh), for consistency of
// vocabulary.
const NOT_BLOCKED_WORDS = new Set([
  'no', 'false', 'none', 'null', 'nil', 'n', 'ninguno', 'ninguna', 'nada', 'n/a', 'na',
  '-', '–', '—', '―', '−', '--',
])

// The keys of the `blocked` map that get read. Any other one is ANNOUNCED with
// its value (see readBlocked): a `blocked: {razon: "…"}` cannot end up
// presented as "blocked and does not say why" while the file does say it.
const BLOCK_KEYS = ['reason', 'since', 'unblock']

// `status: blocked` — the most likely writing mistake, and the one that CANNOT
// come out free. Deciding that the block lives in a field of its own (and not
// in `status`) creates exactly this category of the rejected: somebody who
// wants to block writes the first thing that sounds reasonable,
// `status: blocked`, and under a strict reading it would have no effect at all
// — a block written in good faith and swallowed in silence, which is worse
// than the original problem. It is resolved in the safe direction: it is
// treated as BLOCKED all the same, and it is said that the canonical field is
// another one (and why that matters: `status` has nowhere to put the reason or
// the unblocking).
const STATUS_BLOCKED_WORDS = new Set([
  'blocked', 'blocked_on', 'bloqueado', 'bloqueada', 'on_hold', 'on-hold', 'parado', 'parada',
])

const str = (v) => (v == null ? '' : String(v).trim())

/**
 * Reads the `blocked` field of an already parsed frontmatter.
 * Returns one of:
 *   { state: 'none' }                       → not blocked
 *   { state: 'blocked', reason, since, unblock, notes[] }
 *   { state: 'unreadable', why }            → the frontmatter is not a map
 * In case of doubt 'blocked' is ALWAYS chosen: a false positive costs a
 * question; a false negative is exactly the incident that gave rise to this.
 */
export function readBlocked(meta, { stateRel = COORD_REL_PATH } = {}) {
  if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) {
    return { state: 'unreadable', why: `el frontmatter de ${stateRel} no es un mapa de campos` }
  }
  const statusWord = str(meta.status).toLowerCase()
  const statusSaysBlocked = STATUS_BLOCKED_WORDS.has(statusWord)
  const declared = Object.prototype.hasOwnProperty.call(meta, 'blocked')

  // `blocked` absent or explicitly empty. It is the road of EVERY STATE.md
  // that predates this field: silence = not blocked (see this section's
  // header). The only exception is `status` saying otherwise.
  const v = declared ? meta.blocked : null
  if (!declared || v == null || v === false || v === 0 || (typeof v === 'string' && (!v.trim() || NOT_BLOCKED_WORDS.has(v.trim().toLowerCase())))) {
    if (!statusSaysBlocked) return { state: 'none' }
    return {
      state: 'blocked',
      reason: '',
      since: '',
      unblock: '',
      notes: [declared
        ? `contradicción en ${stateRel}: el campo \`blocked\` está vacío/\`null\` pero \`status: ${statusWord}\` dice que el trabajo está bloqueado. Se trata como BLOQUEADO por seguridad. Resuélvela: el bloqueo se declara en \`blocked: {reason: "…", unblock: "…"}\`.`
        : `\`status: ${statusWord}\` dice que el trabajo está bloqueado, pero el bloqueo NO se declara ahí: \`status\` es el eje de PROGRESO y no tiene dónde poner el motivo ni qué haría falta para levantarlo. Se trata como BLOQUEADO por seguridad; pásalo a \`blocked: {reason: "…", unblock: "…"}\` para que la próxima sesión sepa por qué.`],
    }
  }

  // A non-empty string that is not a negation (both things already filtered
  // above): it is taken as the REASON. It is what whoever blocks in a hurry
  // writes, and rejecting it for "the wrong shape" would throw away exactly
  // the information that makes the block actionable.
  if (typeof v === 'string') return { state: 'blocked', reason: v.trim(), since: '', unblock: '', notes: [] }

  if (v === true) {
    return { state: 'blocked', reason: '', since: '', unblock: '', notes: [] }
  }

  if (typeof v === 'object' && !Array.isArray(v)) {
    const notes = []
    const unknown = Object.keys(v).filter((k) => !BLOCK_KEYS.includes(k))
    if (unknown.length) {
      notes.push(
        `el campo \`blocked\` trae claves que no se leen (${unknown.map((k) => `\`${k}\``).join(', ')}); las que se leen son ` +
        `${BLOCK_KEYS.map((k) => `\`${k}\``).join(', ')}. Contenido de las que no se leen, para que no se pierda: ` +
        unknown.map((k) => `${k}: ${JSON.stringify(v[k])}`).join(' | '),
      )
    }
    return { state: 'blocked', reason: str(v.reason), since: str(v.since), unblock: str(v.unblock), notes }
  }

  // An array, a non-zero number, or any other shape: it is treated as BLOCKED
  // (the safe direction) and it is said that the shape is not recognised, with
  // the raw value up front so that nothing is lost.
  return {
    state: 'blocked',
    reason: '',
    since: '',
    unblock: '',
    notes: [`el campo \`blocked\` tiene una forma que no se reconoce (${Array.isArray(v) ? 'lista' : typeof v}): ${JSON.stringify(v)}. Se trata como BLOQUEADO por seguridad. La forma esperada es \`blocked: {reason: "…", unblock: "…", since: "…"}\`.`],
  }
}

// Defensive trimming of the `next_action` quoted inside the warning: there it
// is quoted in order to NEUTRALISE it (the text in full is still further down,
// in the state injected as it stands). A mile-long next_action must not push
// the rest of the warning out of sight.
function quoteForNotice(s, max = 300) {
  const one = String(s).replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

const NOTICE_TOP = '=========== TRABAJO BLOQUEADO — LEE ESTO ANTES DE HACER NADA ==========='
const NOTICE_BOTTOM = '=========== fin del aviso de bloqueo ==========='

/**
 * The warning the SessionStart hook puts BEFORE the state, so that the session
 * cannot read `next_action` as a standing order. `stateRel` is the file that
 * hook really read (F22): in a slice's worktree, the warning that sends you to
 * `.agent/STATE.md` sends you to the coordinator's file.
 */
export function blockNotice(blocked, { nextAction = '', stateRel = COORD_REL_PATH } = {}) {
  if (!blocked || blocked.state !== 'blocked') return ''
  const lines = [NOTICE_TOP, '']
  lines.push(`\`${stateRel}\` declara este trabajo BLOQUEADO (campo \`blocked\`). Bloqueado NO es "pendiente": alguien decidió que esto no puede continuar tal cual.`)
  lines.push('')
  lines.push(blocked.reason
    ? `Motivo: ${blocked.reason}`
    // "el bloqueo está declarado", not "`blocked` está puesto": this very
    // warning is also fired by a `status: blocked` with no `blocked` field,
    // and saying that the field is set would be false in exactly that case.
    : 'Motivo: NO CONSTA — el bloqueo está declarado pero sin `reason`. No supongas cuál es ni lo deduzcas del resto del estado: pregunta antes de tocar nada.')
  if (blocked.since) lines.push(`Bloqueado desde: ${blocked.since}`)
  lines.push(blocked.unblock
    ? `Para desbloquear haría falta: ${blocked.unblock}`
    : `Para desbloquear: NO CONSTA — ${stateRel} no dice qué haría falta. Averígualo y escríbelo en \`blocked.unblock\` antes de que otra sesión se encuentre con lo mismo.`)
  for (const n of blocked.notes || []) lines.push(`Nota sobre cómo está escrito este bloqueo: ${n}`)
  lines.push('')
  if (nextAction) {
    lines.push(`\`next_action\` está SUSPENDIDO y NO es una orden vigente: «${quoteForNotice(nextAction)}». No lo ejecutes, no lo trates como "lo siguiente que había que hacer" y no lo uses para deducir qué se esperaba de esta sesión — aparece más abajo solo como contexto de lo que quedó a medias.`)
  } else {
    lines.push('`next_action` no dice nada, y con el trabajo bloqueado tampoco debes deducir uno del resto del estado.')
  }
  lines.push(`Levantar el bloqueo es una decisión humana y explícita: se borra el campo \`blocked\` de \`${stateRel}\` (o se pone a \`null\`). Si crees que ya no aplica, dilo y pídelo — no lo levantes por tu cuenta ni "de paso".`)
  lines.push(NOTICE_BOTTOM)
  return lines.join('\n')
}

/**
 * The warning for the only case in which it really IS NOT KNOWN whether there
 * is a block: the frontmatter cannot be read. An unreadable state is not "not
 * blocked".
 */
export function unreadableNotice(why, { stateRel = COORD_REL_PATH } = {}) {
  return [
    `=========== AVISO: \`${stateRel}\` NO SE PUDO LEER ENTERO ===========`,
    '',
    `No se ha podido interpretar el frontmatter YAML de \`${stateRel}\` (${why}).`,
    'Eso significa que NO se puede saber si el trabajo está BLOQUEADO (campo `blocked`): trátalo como posiblemente bloqueado.',
    'No ejecutes nada de lo que diga el estado de abajo sin confirmarlo antes, y arregla el frontmatter lo primero — mientras siga así, ninguna sesión de este repo podrá hidratarse bien.',
    '=========== fin del aviso ===========',
  ].join('\n')
}

// A reading guide for the fields that get read wrong cold. Only the lines
// that APPLY are emitted (a non-empty field): a guide that always comes out is
// noise one learns to skip.
//
// The `verify` case is real and from the same incident: it said «`gh issue
// list … --milestone 'Plan vs Propuestas'` devuelve 6 issues» when there was
// neither a milestone nor any issues. It was written as the check FOR
// AFTERWARDS, but read cold it is indistinguishable from the assertion of a
// fact. The field cannot carry the verb tense inside it (it is free text every
// session writes), so it is whoever presents it that puts it there.
export function fieldReadingGuide(meta, { blocked = false } = {}) {
  if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) return ''
  const lines = []
  if (str(meta.verify)) {
    lines.push('- `verify` es la comprobación PENDIENTE que valida este trabajo AL TERMINAR, no un hecho ya comprobado — aunque esté redactada en presente («… devuelve 6 issues»). Ejecútala antes de afirmar su resultado; si falla o no se puede ejecutar, dilo en vez de darla por buena.')
  }
  if (!blocked && str(meta.next_action)) {
    lines.push('- `next_action` es lo que apuntó la sesión ANTERIOR al cerrar, no una orden verificada hoy: puede haber caducado (ya hecho, revertido, descartado o bloqueado desde entonces). Contrástalo con el repo antes de ejecutarlo. Si ves que ya no aplica, dilo — y si el trabajo está bloqueado de verdad, se marca en el campo `blocked`, no reescribiendo este texto.')
  }
  if (!lines.length) return ''
  return `## Cómo leer estos campos\n${lines.join('\n')}`
}

// #95/H10 — the frontmatter's `#` comments do not travel in the hydration.
// The template carries ~1,200 B of comments that explain the fields to whoever
// EDITS the file; whoever gets hydrated has them explained by
// `fieldReadingGuide`, and only when they apply. The filter is by LINE and
// only inside the frontmatter: a `#` inside a value does not begin the line,
// and the body's markdown headings fall outside the block.
const YAML_COMMENT_LINE = /^\s*#/

function stripFrontmatterComments(stateText) {
  const s = stateText.replace(/^﻿/, '').trimStart()
  const m = s.match(FM)
  if (!m) return s
  const frontmatter = m[1].split(/\r?\n/).filter((line) => !YAML_COMMENT_LINE.test(line)).join('\n')
  return `---\n${frontmatter}\n---\n${m[2]}`
}

export function composeHydration(stateText, gitLog, { stateRel = COORD_REL_PATH } = {}) {
  if (!stateText || !stateText.trim()) return ''
  const { meta, error } = parseStateSafe(stateText)
  const blocked = error ? { state: 'unreadable', why: error } : readBlocked(meta, { stateRel })

  const parts = []
  if (blocked.state === 'unreadable') parts.push(unreadableNotice(error || blocked.why, { stateRel }))
  else if (blocked.state === 'blocked') parts.push(blockNotice(blocked, { nextAction: meta?.next_action, stateRel }))

  // F22: the header is derived from `stateRel`, which is the file the caller
  // has just resolved. It said "Estado del slice" ALWAYS, so the coordinator
  // session —whose `.agent/STATE.md` talks about the epic and not about any
  // slice— opened every hydration with a false label: exactly the confusion of
  // files this round fixes, the other way round.
  const titulo = stateRel === SLICE_REL_PATH ? 'Estado del slice' : 'Estado del repo'
  parts.push(`# ${titulo} (hidratación automática)\n\n${stripFrontmatterComments(stateText).trim()}`)

  const guide = fieldReadingGuide(meta, { blocked: blocked.state === 'blocked' })
  if (guide) parts.push(guide)

  const log = (gitLog || '').trim()
  if (log) parts.push(`## Últimos commits\n${log}`)
  return parts.join('\n\n')
}

// ===========================================================================
// The turn-closing guard: `last_commit` vs `HEAD`.
//
// WHAT IT USED TO DO (and why it was a lie): it compared the two SHAs by
// strict equality and, if they did not match, it blocked the closure saying
// «Hay commits más nuevos que el `last_commit` de .agent/STATE.md». "Newer" is
// an assertion of ANCESTRY, and equality does not check it at any point.
//
// THE REAL CASE: a repo with two live lines of work. A session on the
// `polish-v2-geometria` branch (in another worktree) wrote a `last_commit` of
// that branch into the root's STATE.md. That SHA DOES RESOLVE from the main
// checkout —worktrees share the object store— but it is never going to be
// equal to `main`'s HEAD. Result: the block fired on every turn accusing of
// newer commits that did not exist, and the only way to shut it up was to
// repoint `last_commit` at `main`, deleting the other session's handoff —
// which repointed it back on the following turn. A guard that can only be
// satisfied by destroying information is not a guard, it is a wall.
//
// WHAT IT DOES NOW: ask git for the relation the message was asserting, and
// tell the truth of each case separately. It only BLOCKS when the guard can
// prove what it says and the action it asks for is constructive:
//
//   behind       `last_commit` is an ancestor of HEAD → there really are newer
//                commits, and they are countable. It is the case it was
//                designed for. BLOCKS.
//   unresolvable the value is no commit of this repo at all (filler, a SHA
//                from another repo, a commit that no longer exists). The state
//                cannot be contrasted with anything. BLOCKS (it is fixed by
//                putting a SHA in).
//   same         nothing to say.
//   unset        with no `last_commit` there is nothing to compare (as
//                before).
//   ahead        HEAD is an ancestor of `last_commit` → the state is AHEAD. It
//                DOES NOT BLOCK: everything there is in HEAD is gathered into
//                that commit, so this session left nothing unrecorded, and the
//                only action that would "satisfy" the block (repointing at
//                HEAD) would move the handoff backwards.
//   diverged     there is no ancestry → two different lines of work. It DOES
//                NOT BLOCK: comparing the two SHAs does not say whether this
//                session left anything unrecorded, and the way out of the
//                block would be trampling somebody else's handoff. It is the
//                real case above.
//   orphan       `ahead` or `diverged` AND contained by NO branch, neither
//                local nor remote → the commit is not reachable from any ref.
//                It is not "the state is ahead": it is that the state points
//                at work that stopped existing (a `reset --hard`, almost
//                always). The same family of defect as all of this —the state
//                asserts something that stopped being true— but it DOES NOT
//                BLOCK: a block does not bring an orphaned commit back to
//                life, it would be another unsatisfiable guard. It is said,
//                and that is that.
//   unknown      git could not answer. It DOES NOT BLOCK: nothing can be
//                asserted.
//
// The four cases that stop blocking DO NOT go mute: they come out through
// `systemMessage` (a field common to the hooks' JSON output, non-blocking,
// shown to the user). Ceasing to block is not ceasing to speak; what is
// withdrawn is the ORDER, not the WARNING.
// ===========================================================================

// A reminder of F7, common to every block: the closing of the turn is the
// moment at which a block gets recorded, and `blocked` is the field it goes
// in.
const STOP_TAIL =
  'Y si el trabajo NO puede continuar (bloqueado por una decisión, un dato falso, una dependencia externa…), ' +
  'no lo escribas en prosa dentro de next_action: ponlo en el campo `blocked` (`blocked: {reason: "…", unblock: "…"}`), ' +
  'que es lo que el hook de SessionStart anuncia y lo que suspende el next_action en la siguiente sesión.'

const shortSha = (s) => (typeof s === 'string' && /^[0-9a-f]{7,40}$/i.test(s) ? s.slice(0, 12) : String(s ?? ''))

// A `last_commit` beginning with `-` would be read by git as an OPTION, not
// as a revision; and one with spaces or newlines is not a rev in any case.
// They are rejected before reaching git instead of trusting git to reject
// them.
const REV_SHAPE = /^[^\s-][^\s]*$/

/**
 * Asks git what relation there is between `HEAD` and the state's
 * `last_commit`. It decides nothing: it only describes.
 *
 * @param headSha    HEAD's SHA (already resolved by the caller).
 * @param lastCommit the frontmatter's raw value (it can be anything).
 * @param git        runner `(args) => { status, stdout }` that NEVER throws.
 * @param branch     the checkout's branch ('' if HEAD is detached).
 */
// The branches that contain a commit, LOCAL ones first and remote ones only
// if no local one contains it. The order matters: `origin/*` is noise when you
// already have a local branch that answers the question, and it is the only
// possible answer when you do not. `containersKnown: false` means git did not
// answer — which is not the same as "no branch contains it", and whether the
// commit gets declared orphaned depends on that difference.
function branchesContaining(git, stateSha, currentBranch) {
  const ask = (args) => {
    const r = git(args)
    if (r.status !== 0) return null
    return String(r.stdout || '')
      .split('\n').map((s) => s.trim()).filter(Boolean)
      // `git branch -r` also lists the `origin/HEAD` symref, which is not a
      // branch where anything lives: it is an alias of another that already
      // shows up in the list.
      .filter((b) => b !== currentBranch && !b.endsWith('/HEAD') && !b.includes(' -> '))
  }
  const local = ask(['branch', '--contains', stateSha, '--format=%(refname:short)'])
  if (local === null) return { containers: [], containersKnown: false }
  if (local.length) return { containers: local.slice(0, 5), containersKnown: true }
  const remote = ask(['branch', '-r', '--contains', stateSha, '--format=%(refname:short)'])
  if (remote === null) return { containers: [], containersKnown: false }
  return { containers: remote.slice(0, 5), containersKnown: true }
}

// ===========================================================================
// F15/H4 — THE FRESHNESS GUARD WAS UNSATISFIABLE BY CONSTRUCTION.
//
// `behind` blocked the closing of the turn when `last_commit` had fallen below
// HEAD. But the commit that updates `STATE.md` INCLUDES `STATE.md`: you write
// `last_commit: <HEAD>`, you commit it, and the act of committing it creates a
// new SHA — so the file is "1 commit behind" again at the exact instant you
// fix it. Committing again generates the commit that invalidates it again.
// Infinite regression.
//
// Reproduced against dac5326's `dist/stop.js`, two rounds in a row:
//   HEAD=2926a17 last_commit=192baa2 → block "hay 1 commit … por encima"
//   HEAD=3346b8e last_commit=2926a17 → block "hay 1 commit … por encima"
// It is the brother of the case F12 fixed (`diverged`): there the block was
// unsatisfiable because the only way out was to trample another session's
// handoff; here it is because the very act of obeying it reintroduces it. F12
// covered `diverged`, `ahead`, `orphan` and `unresolvable`, and left `behind`
// blocking always — correct for real work, and exactly what fails here.
//
// THE FIX: `last_commit` is understood as the slice's last WORK commit, not
// the entry's. A commit that touches EXCLUSIVELY `.agent/STATE.md` does not
// count towards the count of "you have fallen behind".
//
// WHY THIS WAY AND NOT "do not block if the gap is 1": a gap of 1 is a
// symptom, not the condition. A slice can accumulate two entries in a row (the
// `next_action` is corrected and committed again) and still have nothing of
// its work pending registration; and the other way round, ONE single code
// commit left unregistered has to block all the same. What tells the two cases
// apart is WHAT the commits touch, not how many they are.
//
// FAIL CLOSED, THREE TIMES. Every doubt is resolved by BLOCKING, because the
// expensive failure here is letting real work through unregistered:
//   1. a commit that touches `.agent/STATE.md` AND ALSO anything else counts
//      as work — otherwise it would be enough to slip the code inside the
//      entry's commit to skip the whole guard;
//   2. a commit of which git lists NO file at all (a merge, an empty commit)
//      counts as work. `git log --name-only` lists no files for a merge, and a
//      merge can indeed bring real work;
//   3. if the query to git fails, the total count of always is used and it
//      blocks just as it did before this change.
// Only `.agent/STATE.md`, not the whole of `.agent/`: `conventions-ack.md` is
// a record of decisions, not bookkeeping, and it deserves to block if it is
// not registered.
//
// F22 — THIS CONSTANT IS NOT PARAMETERISED, AND THAT IS NOT AN OVERSIGHT.
// Everything else in this module moved on to naming the file that was really
// read (see `stateRel`, above), and this did NOT, because here no message is
// composed: what is measured are COMMITS. The only state file that ever gets
// committed is the coordinator's — `.agent/SLICE.md` is outside git by
// construction (the dispatcher writes the ignore rule and aborts the dispatch
// if git still sees it), so NO commit ever touches it and there is nothing to
// exempt. Changing this for the resolved path would leave the coordinator's
// entries without their exemption, and would bring back exactly the infinite
// regression above.
// ===========================================================================
const STATE_REL_PATH = '.agent/STATE.md'

// countWorkCommits: of the commits in `stateSha..headSha`, how many touch
// something other than STATE.md itself. `known: false` = git did not answer,
// and the caller falls back to the total count (blocking).
// The cap on the detailed analysis. The git runner of hooks/stop.js uses
// `spawnSync` with no `maxBuffer`, that is, Node's default (1 MiB): a range
// with hundreds of commits and many files overflows it, and then the runner
// returns status -1 and we fall back to the total count anyway. The cap only
// makes that limit DETERMINISTIC instead of leaving it to the size of the
// output — and above it "you have fallen a long way behind" is true either
// way.
const WORK_SCAN_MAX = 200

// ===========================================================================
// #95/H5 — WHO MADE THE COMMITS THAT SIT ABOVE.
//
// On the `ct-step` road it is the PROGRAM that commits, not the agent. The
// agent did not touch `last_commit` because it made no commit, and the guard
// blocked its turn asking it to copy by hand a value the hook already has
// resolved (`headSha`) — the same family of defect F15 fixed for the entries:
// an order to the model where a mechanism of the program's would fit.
//
// THE TRAILER IS WHAT GETS ASKED ABOUT, NOT THE MESSAGE. `%(trailers:key=…)`
// is a field git parses itself, so there is no need to slice up the commit's
// body and no message that happens to contain the phrase can pass itself off
// as one of ct-step's. The mark is declared by `ct-step-commit.js`, which is
// also the one that WRITES it (step-contracts.js composes it from there): a
// single source for the two halves.
//
// FAIL CLOSED, the same as the work count: if git does not answer, or if ONE
// single commit of the range does not carry the mark, nothing is attributed
// and the block is kept whole. Attributing too much would be letting work
// through unregistered.
// ===========================================================================
function allWorkCommittedByCtStep(git, stateSha, headSha) {
  const r = git(['log', `--format=%H ${CtStepCommit.TRAILER_FORMAT}`, '--no-merges', `${stateSha}..${headSha}`])
  if (r.status !== 0) return false
  const lines = String(r.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean)
  return CtStepCommit.wroteAllOf(lines.map((l) => l.slice(l.indexOf(' ') + 1)))
}

// The frontmatter's `last_commit` line, rewritten in place. The YAML is NOT
// re-serialised (`parseState` + `renderState`) on purpose: that would sweep
// away the file's comments, the order of the keys and any field this module
// does not know about — and there is other work in flight adding new fields to
// the frontmatter. ONE line is touched and the rest of the file comes out byte
// for byte as it went in.
//
// `updated: false` when there is no line to rewrite: the caller keeps the
// block instead of inventing where the field goes.
const LAST_COMMIT_LINE = /^([ \t]*last_commit[ \t]*:[ \t]*)(['"]?)([^'"\r\n]*)(\2)([ \t]*)$/m

export function withLastCommit(stateText, sha) {
  const s = stateText ?? ''
  const m = s.match(FM)
  if (!m) return { text: s, updated: false }
  const frontmatter = m[1]
  if (!LAST_COMMIT_LINE.test(frontmatter)) return { text: s, updated: false }
  const nuevo = frontmatter.replace(LAST_COMMIT_LINE, (_, prefijo, comilla, __, cierre, cola) => `${prefijo}${comilla}${sha}${cierre}${cola}`)
  return { text: s.replace(frontmatter, nuevo), updated: true }
}

function countWorkCommits(git, stateSha, headSha, total) {
  if (!(total > 0) || total > WORK_SCAN_MAX) return { work: total, bookkeeping: 0, known: false }
  // A sentinel of its own (`commit:<sha>`) instead of trusting the default
  // format: `--name-only` with no `--format` interleaves the commit's message,
  // and a message that contained a line looking like a path would break the
  // parsing. With `--format=commit:%H` the only things printed are the sha and
  // the files.
  const r = git(['log', '--format=commit:%H', '--name-only', '--no-renames', `${stateSha}..${headSha}`])
  if (r.status !== 0) return { work: total, bookkeeping: 0, known: false }
  let work = 0
  let bookkeeping = 0
  let files = null // null = we have not seen any commit yet
  const cerrar = () => {
    if (files === null) return
    // With no files listed (a merge, an empty commit) → it counts as work.
    if (files.length > 0 && files.every((f) => f === STATE_REL_PATH)) bookkeeping++
    else work++
  }
  for (const line of String(r.stdout || '').split('\n')) {
    if (line.startsWith('commit:')) { cerrar(); files = []; continue }
    const f = line.trim()
    if (f && files !== null) files.push(f)
  }
  cerrar()
  // Sanity check: if the parsing did not see the same commits as
  // `rev-list --count`, we do not trust it.
  if (work + bookkeeping !== total) return { work: total, bookkeeping: 0, known: false }
  return { work, bookkeeping, known: true }
}

export function describeStopRelation({ headSha, lastCommit, git, branch = '' }) {
  const raw = lastCommit == null ? '' : String(lastCommit).trim()
  const base = { raw, headSha, branch, stateSha: '', count: 0, mergeBase: '', containers: [], containersKnown: false }
  if (!raw) return { ...base, kind: 'unset' }
  if (!REV_SHAPE.test(raw)) return { ...base, kind: 'unresolvable' }

  const rp = git(['rev-parse', '--verify', '--quiet', `${raw}^{commit}`])
  const stateSha = rp.status === 0 ? String(rp.stdout || '').trim() : ''
  if (!stateSha) return { ...base, kind: 'unresolvable' }

  const out = { ...base, stateSha }
  if (stateSha === headSha) return { ...out, kind: 'same' }

  // `merge-base --is-ancestor` answers through its exit code: 0 yes, 1 no,
  // anything else is a failure of git (and then it is not known).
  const stateIsAncestor = git(['merge-base', '--is-ancestor', stateSha, headSha]).status
  if (stateIsAncestor !== 0 && stateIsAncestor !== 1) return { ...out, kind: 'unknown' }

  if (stateIsAncestor === 0) {
    const c = git(['rev-list', '--count', `${stateSha}..${headSha}`])
    const n = c.status === 0 ? Number.parseInt(String(c.stdout || '').trim(), 10) : NaN
    const total = Number.isFinite(n) ? n : 0
    // F15/H4: of those commits, how many are WORK and how many are the
    // state's own entry. See countWorkCommits for the why.
    const { work, bookkeeping, known } = countWorkCommits(git, stateSha, headSha, total)
    if (known && work === 0 && bookkeeping > 0) {
      return { ...out, kind: 'behind-bookkeeping', count: 0, bookkeeping, total }
    }
    // #95/H5: there is work above, and the program committed it. The sha the
    // guard asks for is already resolved, so there is nothing to order anybody
    // to do.
    if (allWorkCommittedByCtStep(git, stateSha, headSha)) {
      return { ...out, kind: 'behind-ct-step', count: known ? work : total, bookkeeping: known ? bookkeeping : 0, total }
    }
    return { ...out, kind: 'behind', count: known ? work : total, bookkeeping: known ? bookkeeping : 0, total }
  }

  const headIsAncestor = git(['merge-base', '--is-ancestor', headSha, stateSha]).status
  if (headIsAncestor !== 0 && headIsAncestor !== 1) return { ...out, kind: 'unknown' }

  // The branches that DO contain that commit: it is what turns "it is not in
  // your history" into "it is on `polish-v2-geometria`".
  const { containers, containersKnown } = branchesContaining(git, stateSha, branch)

  // Neither `ahead` nor `diverged` is reachable from HEAD (in both cases HEAD
  // is NOT a descendant of the commit), so if on top of that no branch
  // contains it —neither local nor remote— there is no stable ref that reaches
  // it: it is an ORPHANED commit. It is a different thing from "the state is
  // ahead": the state points at work that stopped existing. It is only
  // declared if git answered both questions; a failure of git is not a
  // negative answer.
  if (containersKnown && containers.length === 0) {
    return { ...out, kind: 'orphan', containers, containersKnown, fromKind: headIsAncestor === 0 ? 'ahead' : 'diverged' }
  }

  if (headIsAncestor === 0) return { ...out, kind: 'ahead', containers, containersKnown }

  const mb = git(['merge-base', stateSha, headSha])
  return { ...out, kind: 'diverged', containers, containersKnown, mergeBase: mb.status === 0 ? String(mb.stdout || '').trim() : '' }
}

// ===========================================================================
// #95/H8 — A WARNING THAT ALWAYS COMES OUT IS A WARNING NOBODY READS.
//
// The four non-blocking warnings (`ahead`, `diverged`, `orphan`, `unknown`)
// came out at EVERY closing of a turn for as long as the anomaly lasted. The
// insistence was deliberate —a structural condition somebody has to resolve—
// and the price was paid in brevity. But the sentence that dismantles it was
// already written in this very module, in `blocked`'s header: prose that is
// always there gets ignored, so a divergence's fortieth turn informs of
// nothing, it only costs.
//
// WHAT IS PRESERVED: the anomaly is not made invisible. The warning comes back
// once the period is up, and ANY change of the relation brings it out again
// without waiting — because then it is something else that has to be told.
//
// THE RELATION IS THE PAIR (kind, the state's commit), not the kind on its
// own: going from diverging against one branch to diverging against another is
// a different anomaly even though both are called `diverged`.
//
// FAIL OPEN, the other way round from the freshness guard, and the asymmetry
// is on purpose: here the expensive failure is KEEPING QUIET. A marker that
// cannot be read, that brings another shape or that could not be written is
// resolved by warning.
// ===========================================================================
export const NOTICE_REPEAT_EVERY_TURNS = 10

export const STOP_NOTICE_REL_NAME = 'stop-notice.json'

export function noticeDecision({ relation, previous }) {
  const next = (turns) => ({ kind: relation.kind, stateSha: relation.stateSha || '', turns })
  const misma = previous
    && typeof previous === 'object'
    && !Array.isArray(previous)
    && previous.kind === relation.kind
    && (previous.stateSha || '') === (relation.stateSha || '')
    && Number.isInteger(previous.turns)
    && previous.turns > 0
  if (!misma) return { emit: true, next: next(1) }
  const turns = previous.turns + 1
  if (turns > NOTICE_REPEAT_EVERY_TURNS) return { emit: true, next: next(1) }
  return { emit: false, next: next(turns) }
}

const whereAmI = (rel) => (rel.branch ? `la rama \`${rel.branch}\`` : `HEAD (desprendido en ${shortSha(rel.headSha)})`)
const livesIn = (rel) => (rel.containers?.length ? rel.containers.map((b) => `\`${b}\``).join(', ') : '')

/**
 * Decides, from the relation, whether the closure is blocked and what is said.
 * @returns { block, kind, reason, systemMessage }
 */
export function classifyStopState({ relation, stopHookActive, stateRel = COORD_REL_PATH }) {
  const none = { block: false, kind: relation?.kind || 'unset', reason: '', systemMessage: '' }
  if (!relation) return none
  // `stop_hook_active`: we are already inside a continuation caused by a
  // closing hook. Neither a block nor a warning — the warning already came out
  // on the previous round and repeating it only adds noise to a turn that is
  // already under way.
  if (stopHookActive) return none
  const rel = relation

  if (rel.kind === 'unset' || rel.kind === 'same') return none

  // F15/H4: the state is only behind ENTRY commits (the ones that touch
  // exclusively `.agent/STATE.md`). There is no work left unregistered, and it
  // is the NORMAL state in which any COORDINATOR turn that updates and commits
  // its STATE.md is left: the commit that fixes it leaves it, by construction,
  // one commit behind. (A slice never comes through here — its state is
  // outside git and no commit touches it.)
  // It neither blocks nor warns — a warning at every closing of a turn would
  // be pure noise, and `last_commit` pointing at the last WORK commit is
  // besides the most useful reading of that field, not a degradation.
  if (rel.kind === 'behind-bookkeeping') return { ...none, kind: 'behind-bookkeeping' }

  // #95/H5: all the work above was committed by ct-step. Neither a block nor
  // a warning: the hook updates `last_commit` itself with the sha it already
  // has. It goes as a field of the decision, and not as a write in here,
  // because this module does not touch files — whoever resolved the path is
  // the one that writes.
  if (rel.kind === 'behind-ct-step') {
    return { ...none, kind: 'behind-ct-step', updateLastCommitTo: rel.headSha }
  }

  if (rel.kind === 'behind') {
    const n = rel.count
    const cuantos = n === 1 ? '1 commit' : n > 1 ? `${n} commits` : 'commits'
    // If there are entries in between as well, it is said: otherwise the
    // count does not square with what `git log` shows and it looks like a
    // failure of the guard.
    const b = rel.bookkeeping || 0
    // This note is NOT parameterised, and that is not an oversight: it talks
    // about COMMITS, and the path `countWorkCommits` exempts is literally
    // `.agent/STATE.md` (see that block's constant). Replacing it with the
    // resolved path would describe an exemption that does not exist.
    const nota = b > 0
      ? ` (más ${b === 1 ? '1 commit que solo toca' : `${b} commits que solo tocan`} \`.agent/STATE.md\`, que no cuenta${b === 1 ? '' : 'n'}: un apunte no es trabajo sin registrar)`
      : ''
    // Same reason, and that is why the sentence is CONDITIONAL instead of
    // interpolated: the regression that reassures (you commit the entry and
    // you are behind again) can only happen to the file that gets committed. A
    // slice's state is outside git —the dispatcher excludes it BEFORE seeding
    // it and aborts the dispatch if git still sees it—, so there no entry
    // commit exists and therefore none is exempt. Interpolating `stateRel`
    // into the sentence above would have told two lies in one: that that
    // commit exists and that it does not count.
    const apunte = stateRel === COORD_REL_PATH
      ? 'Commitear ese cambio NO te vuelve a dejar atrás: un commit que solo toca `.agent/STATE.md` no cuenta. '
      : `No lo commitees: \`${stateRel}\` está fuera de git a propósito y no entra en el PR de este slice; basta con dejarlo al día en disco. `
    return {
      block: true,
      kind: 'behind',
      reason:
        `\`${stateRel}\` se ha quedado atrás: hay ${cuantos} de trabajo${nota} en ${whereAmI(rel)} por encima de su \`last_commit\` ` +
        `(${shortSha(rel.stateSha)}), que sí es un ancestro de HEAD (${shortSha(rel.headSha)}). ` +
        `Actualiza \`${stateRel}\` (you_are_here, next_action, tasks[], last_commit) antes de cerrar el turno, para que la próxima sesión se hidrate correcta. ` +
        apunte +
        STOP_TAIL,
      systemMessage: '',
    }
  }

  if (rel.kind === 'unresolvable') {
    return {
      block: true,
      kind: 'unresolvable',
      reason:
        `El \`last_commit\` de \`${stateRel}\` («${quoteForNotice(rel.raw || '(vacío)', 120)}») no es ningún commit de este repositorio: ` +
        '`git rev-parse` no lo resuelve. Puede ser un valor de relleno, un SHA de otro repo, o un commit que aquí ya no existe. ' +
        'Mientras siga así NADIE puede contrastar el estado con el repo — ni este guard ni la próxima sesión. ' +
        `Ponle el SHA real del último commit de este trabajo (\`git rev-parse HEAD\`) y actualiza el resto de \`${stateRel}\` ` +
        '(you_are_here, next_action, tasks[]) antes de cerrar el turno. ' +
        STOP_TAIL,
      systemMessage: '',
    }
  }

  // The non-blocking warnings come out on EVERY turn for as long as the
  // anomaly lasts, and that insistence is deliberate: a single state for two
  // lines of work is a structural condition somebody has to resolve, and
  // silencing it with a persistent marker would make it invisible instead of
  // resolved. That is why the price is paid in the other currency: as SHORT as
  // possible. Only what can change a decision of whoever reads it goes in —
  // the explanation of why the guard behaves this way lives in the comment
  // above, not in the warning.
  if (rel.kind === 'ahead') {
    return {
      block: false,
      kind: 'ahead',
      reason: '',
      systemMessage:
        `Guard de cierre: el \`last_commit\` de \`${stateRel}\` (${shortSha(rel.stateSha)}) es un descendiente de HEAD ` +
        `(${shortSha(rel.headSha)})${livesIn(rel) ? ` y vive en ${livesIn(rel)}` : ''}: el estado va por delante de ${whereAmI(rel)}, no por detrás. ` +
        'No lo reapuntes a HEAD — movería el handoff hacia atrás.',
    }
  }

  if (rel.kind === 'diverged') {
    return {
      block: false,
      kind: 'diverged',
      reason: '',
      systemMessage:
        `Guard de cierre: el \`last_commit\` de \`${stateRel}\` (${shortSha(rel.stateSha)}) ` +
        `${livesIn(rel) ? `vive en ${livesIn(rel)}, no en` : 'no está en'} la historia de ${whereAmI(rel)}: dos líneas de trabajo divergentes` +
        `${rel.mergeBase ? ` desde ${shortSha(rel.mergeBase)}` : ''}. ` +
        'Uno solo no puede ser el handoff de las dos (cada worktree de `/ct-next` lleva el suyo); ' +
        'si lo reapuntas a HEAD, sustituyes el de la otra.',
    }
  }

  // The state points at work that no longer exists in any ref. It is the same
  // family as always —the state asserts something that stopped being true—
  // but blocking the closure does not recover an orphaned commit: it would be
  // another unsatisfiable guard.
  if (rel.kind === 'orphan') {
    return {
      block: false,
      kind: 'orphan',
      reason: '',
      systemMessage:
        `Guard de cierre: al \`last_commit\` de \`${stateRel}\` (${shortSha(rel.stateSha)}) no llega ninguna rama, ni local ni remota: ` +
        'es un commit huérfano (lo típico, un `reset --hard` que se lo llevó por delante). ' +
        'El handoff que describe puede haber dejado de existir: compruébalo antes de fiarte, porque `git gc` puede borrar el commit para siempre.',
    }
  }

  return {
    block: false,
    kind: 'unknown',
    reason: '',
    systemMessage:
      `Guard de cierre: git no ha podido determinar la relación entre HEAD (${shortSha(rel.headSha)}) y el \`last_commit\` de ` +
      `\`${stateRel}\` (${shortSha(rel.stateSha)}). No se bloquea el cierre porque no hay nada que se pueda afirmar; ` +
      'comprueba a mano si el estado está al día antes de fiarte de él.',
  }
}
