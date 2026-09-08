#!/usr/bin/env node
// ============================================================================
// CT-WATCH-GO — the watcher of the `-OK` of the `plan` gate.
//
// WHAT IT FIXES. The `plan` gate orders the agent to publish its plan as a
// comment on the issue and STOP. The human answers on GitHub, and until this
// round nobody read that answer: the work resumed when that same person went to
// the cmux window and pushed the session by hand. Two permissions for the same
// thing, and the one that counted was not the one left written on the issue.
//
// This process closes the gap: it polls the issue, and the moment it sees the
// `-OK` it types the line into the slice's session. A single go, on GitHub,
// with an author.
//
// THE COORDINATOR LAUNCHES IT, DETACHED. `ct-next` starts it with
// `spawn(..., { detached: true }).unref()` right after dispatching the slice,
// and only if that slice carries the `plan` gate AND counted as launched.
// Detached because it has to survive the coordinating session being closed: if
// it only lived while somebody was watching, it would be useless for the case
// that motivates all of this — the gate asked for at 01:00 waiting for somebody
// to wake up, which in the F33 measurement was 54% of an epic's clock.
//
// WHY NOT A CMUX WORKSPACE. It was considered, because that is the background
// this repository already knows, and it was rejected for a concrete reason:
// launching through cmux is TYPING A COMMAND INTO A PTY, and that is this
// plugin's fragile path. The whole of `launch-sentinel.js` exists because there
// was no way to know whether the command ever ran, and `ct-next` carries a
// resend loop because the shell prompt was eating characters. Paying all of
// that for a loop nobody is going to watch does not pay off: a `spawn` goes
// through no pty, through no quoting, and needs no sentinel.
//
// INHERITED LIMIT, SAID WITHOUT ORNAMENT: to DELIVER the line that fragile path
// IS used (`cmux send` + `send-key`), and here there is no sentinel proving the
// session received it. All that is known is that the two commands returned 0,
// and that is what the log says — not «the session has started». A real
// sentinel would require the agent to write something, that is, to depend on
// the agent being delivered to, which is exactly what this split avoids. That
// limit is accepted and not dressed up.
//
// WHAT IT DELIBERATELY DOES NOT HAVE, and it is not an oversight:
//
//   - NO PIDFILE AND NO LIVENESS CHECK. If you re-dispatch a slice, two watchers
//     are born: the second one pushes just the same and the first one expires.
//     The worst that happens is that the line gets typed twice into the session,
//     which is annoying and nothing more. Paying the whole "is it alive,
//     orphaned or hung?" problem —to which this repository already devotes three
//     files— to avoid that would be expensive and would buy nothing.
//   - NO CATEGORY FOR A MALFORMED ANSWER. See go-response.js: anything that is
//     not exactly `-OK` simply does not start anything, which is the prudent
//     side. It does not comment on the issue to explain formats.
//   - NO `-REVIEW`. Sending a correction by comment and having the plan redone
//     is another function; to ask for changes the terminal is still there.
//
// THIS PROCESS OPENS THE LOG, not whoever launches it, and it goes outside the
// repository (`~/.claude/control-tower/log/`). It is not a new decision: it is
// where run-metrics.js#metricsPath already puts its own, and for the reason
// already written there — «outside the repository, so that no git add of the
// slice puts it into the PR». A process that runs when you are not watching and
// leaves no trace anywhere is undebuggable. IT opens it because, when `ct-next`
// opened it, the suite ended up creating files in the real `$HOME` of whoever
// ran it — which is exactly what `__tests__/fixtures/hermetic-env.js` exists to
// prevent— and on top of that left one descriptor unclosed per slice.
// ============================================================================

import { execFileSync } from 'node:child_process'
import { hasGo, commentIds, failedGoAttempt, GO_FORMAT_REPLY, GO_TOKEN } from './go-response.js'
import { buildCmuxSendArgv, buildCmuxSendKeyArgv } from './dispatch.js'
import { findWorkspaceByTitle } from './cmux.js'
import { arg, sleep, plazo, abrirLog } from './watch-common.js'

// 30 seconds, the same tick with which agentic-skills polls a person. And an
// 8 hour deadline, which is its `person_wait_seconds`: the number comes from the
// real case being a gate asked for at night, so the deadline has to cover
// sleeping.
//
// The cost is measured and it is roomy: 8 h at one poll every 30 s is ~960 calls
// to `gh` per slice; with three slices in flight, ~360 an hour against a limit
// of 5000.
const DEFAULT_POLL_MS = 30_000
const DEFAULT_TIMEOUT_MS = 8 * 60 * 60 * 1000
const GH_TIMEOUT_MS = 30_000
const CMUX_TIMEOUT_MS = 10_000

const issue = arg(process.argv, '--issue')
const repo = arg(process.argv, '--repo')
const sesion = arg(process.argv, '--session')
const logPath = arg(process.argv, '--log')
// THE COMMITMENT COMES IN THROUGH ARGV, AND THE NONCE NEVER DOES (F38). This
// process runs detached and `ps` shows its argv to any process of the same uid
// —the agent included—, just as its log is a readable file. So what travels
// this far is the sha256 of the go, which is of no use to whoever reads it: the
// nonce only exists on the screen of whoever dispatched and in the head of
// whoever types it.
//
// WITHOUT A COMMITMENT THERE IS NO WATCHING. It exits with 2 instead of falling
// back to yesterday's bare `-OK`: a watcher that recognised the fixed token
// would be a door that opens by OMITTING an argument, and the agent that wanted
// to skip the gate would only have to relaunch the watcher itself. A watcher
// that does not start is noticed by the person waiting —they go and look—; one
// that starts with the old door is noticed by nobody.
const goHash = (arg(process.argv, '--go-hash') || '').trim().toLowerCase()
if (!issue || !repo || !sesion) {
  process.stderr.write('uso: ct-watch-go.mjs --issue N --repo owner/name --session "<título de la workspace>" --go-hash <sha256 del go> [--log <ruta>]\n')
  process.exit(2)
}
if (!/^[0-9a-f]{64}$/.test(goHash)) {
  process.stderr.write(`--go-hash inválido o ausente${goHash ? `: "${goHash}"` : ''} — debe ser el sha256 hex (64 caracteres) del go de ESTE despacho, el que /ct-next registró al lanzar. Sin él este vigilante no sabría qué reconocer, y NO cae al \`${GO_TOKEN}\` sin nonce a propósito: esa puerta la abriría el propio agente.\n`)
  process.exit(2)
}

const { log, terminar } = abrirLog(logPath)
const pollMs = plazo('CT_WATCH_GO_POLL_MS', DEFAULT_POLL_MS)
const timeoutMs = plazo('CT_WATCH_GO_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)

function leerComentarios() {
  try {
    const raw = execFileSync('gh', ['issue', 'view', String(issue), '--repo', repo, '--json', 'comments'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, killSignal: 'SIGKILL',
    })
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.comments) ? parsed.comments : []
  } catch (e) {
    // A failure of `gh` does NOT end the watch: the network goes down, the
    // token expires and is renewed, GitHub returns a 502. What cannot happen is
    // for a transient failure to be read as "there is no go" permanently, so it
    // gets noted down and tried again on the next tick.
    log(`aviso: no se pudo leer el issue (${String(e.message).trim()}) — se reintenta en el próximo tick`)
    return null
  }
}

// Returns `{ consultado, ref }`. The distinction between "cmux answered and the
// session is NOT there" (`consultado: true, ref: null`) and "it could not be
// asked" (`consultado: false`) is the same one ct-next.mjs holds so carefully in
// `queryAllCmuxWorkspaces`, and for the same reason: something different
// follows from each. That it is not there means there is nobody to deliver
// anything to; not being able to ask means nothing and can only be retried.
//
// BOTH ARE USED, and in both places. The first version of this file
// distinguished the two here and then threw `consultado` away on the DELIVERY
// path: a cmux timeout right on the tick the `-OK` arrived killed the eight-hour
// watch at the one instant that mattered, and on top of that diagnosed "the
// session was not found" when the session was right there. An adversarial
// review caught it.
//
// THE LOOKUP LIVES IN scripts/cmux.js as of this round, and with it comes a
// guard this file did not have: if cmux renamed `custom_title`, the raw read of
// before matched nothing, returned `consultado: true, ref: null` — «cmux
// answered and the session is not there»— and this watcher shut down with exit
// 4 declaring dead a session that was right in front of it, throwing away that
// person's go. `ct-next.mjs` had already fought with this (D5, finding B) and
// its conclusion is the one that now applies here too: a field whose schema we
// do not recognise degrades to NOT CONCLUSIVE, never to "verified not there".
function consultarSesion() {
  const r = findWorkspaceByTitle(sesion, { timeoutMs: CMUX_TIMEOUT_MS })
  if (!r.consultado) log('aviso: no se pudo consultar cmux (o su respuesta no trae el campo del título que este plugin sabe leer)')
  return r
}

// The line that gets typed into the slice's session. `send` does not add Enter:
// it has to be sent separately, measured in F20/H1.
const LINEA = `El humano ha respondido ${GO_TOKEN} en el issue #${issue}: el gate \`plan\` queda cerrado. Continúa con ct-step next.`

log(`vigilando el ${GO_TOKEN} de ${repo}#${issue} para la sesión "${sesion}" — tick ${pollMs} ms, plazo ${timeoutMs} ms, go ${goHash.slice(0, 12)}…`)

// ---------------------------------------------------------------------------
// THE INITIAL SNAPSHOT. The window is the comments that were ALREADY THERE (see
// go-response.js), so it has to be taken before looking for anything — and it
// has to be TAKEN FOR REAL: if the first read fails and were taken as empty, an
// `-OK` inherited from an earlier dispatch would count as new and would open the
// gate in silence, which is exactly what the window exists to prevent. So it is
// retried until it succeeds, within the same deadline.
// ---------------------------------------------------------------------------
const arrancadoEn = Date.now()
const limite = arrancadoEn + timeoutMs
let previos = null
while (previos === null) {
  const iniciales = leerComentarios()
  if (iniciales !== null) { previos = commentIds(iniciales); break }
  if (Date.now() >= limite) {
    log(`plazo agotado sin poder leer ni una vez los comentarios de ${repo}#${issue}: no se puede distinguir un go nuevo de uno heredado, así que no se entrega nada. Empuja la sesión a mano tras dar el go.`)
    terminar(3)
  }
  await sleep(Math.min(pollMs, Math.max(0, limite - Date.now())))
}
log(`foto inicial: ${previos.size} comentario(s) ya presentes, que no cuentan como respuesta`)

// ONCE per watch, and once only. The format does not change between one attempt
// and the next, so answering each one would be noise on the issue of somebody
// who already knows what we told them. And if the process restarts, answering
// becomes possible again, which is right: whoever relaunched it may not have
// seen the first one.
let intentoContestado = false

function explicarElFormato(idDelIntento) {
  try {
    execFileSync('gh', ['issue', 'comment', String(issue), '--repo', repo, '--body', GO_FORMAT_REPLY], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, killSignal: 'SIGKILL',
    })
    intentoContestado = true
    log(`intento de go que no arranca nada (${idDelIntento}): publicado el formato en ${repo}#${issue}`)
  } catch (e) {
    // It is neither retried nor marked as answered: the next tick sees it again
    // and tries again. Failing to publish an explanation cannot cost the watch,
    // which is the only thing this process exists to do.
    log(`aviso: se vio un intento de go (${idDelIntento}) y no se pudo publicar el formato (${String(e.message).trim()}) — se reintenta en el próximo tick`)
  }
}

for (;;) {
  const comentarios = leerComentarios()
  if (comentarios && hasGo(comentarios, previos, goHash)) {
    log(`${GO_TOKEN} visto en ${repo}#${issue}`)
    const { consultado, ref } = consultarSesion()
    if (ref) {
      try {
        execFileSync('cmux', buildCmuxSendArgv({ workspace: ref, text: LINEA }), {
          stdio: ['ignore', 'ignore', 'pipe'], timeout: CMUX_TIMEOUT_MS, killSignal: 'SIGKILL',
        })
      } catch (e) {
        log(`ERROR: el go se vio y el texto no se pudo escribir en "${sesion}" (${ref}): ${String(e.message).trim()}. Empuja la sesión a mano.`)
        terminar(1)
      }
      try {
        execFileSync('cmux', buildCmuxSendKeyArgv({ workspace: ref }), {
          stdio: ['ignore', 'ignore', 'pipe'], timeout: CMUX_TIMEOUT_MS, killSignal: 'SIGKILL',
        })
      } catch (e) {
        // `send` without `send-key` leaves the text on the edit line WITHOUT
        // executing it (measured in F20/H1), so that is what has to be said and
        // not "it could not be typed": whoever reads it is going to find the
        // line written in the window and has to know all it is missing is the
        // Enter.
        log(`ERROR: el texto quedó escrito en la línea de edición de "${sesion}" (${ref}) pero el Enter falló: ${String(e.message).trim()}. Ve a esa ventana y pulsa Enter, o empuja la sesión a mano.`)
        terminar(1)
      }
      // What is known is this and no more: the two commands returned 0. There is
      // no sentinel proving the session received it and acted (see the header),
      // so the message does not claim that it has started.
      log(`línea enviada a "${sesion}" (${ref}): \`cmux send\` y \`send-key Enter\` devolvieron 0. No hay forma de comprobar desde aquí que la sesión la haya procesado. Vigilancia terminada.`)
      terminar(0)
    }
    if (consultado) {
      log(`ERROR: el go se vio, pero cmux dice que no existe ninguna sesión "${sesion}", así que no hay a quién entregárselo. Empuja la sesión a mano.`)
      terminar(1)
    }
    // The session could not be ASKED about. Nothing follows from that, least of
    // all with the go already in hand: it is retried on the next tick.
    log(`el go está visto pero no se pudo consultar cmux para localizar la sesión — se reintenta la entrega en el próximo tick`)
  } else if (comentarios && !intentoContestado) {
    // Somebody is trying to give the go and their comment does not open it. The
    // gate does NOT move because of this —the only thing that opens it is still
    // `matchesGo`—: all that happens is that whoever is trying finds out the
    // format in the place where they are looking.
    const intento = failedGoAttempt(comentarios, previos, goHash)
    if (intento) explicarElFormato(intento)
  }
  // ---------------------------------------------------------------------------
  // WITH NO SESSION THERE IS NOTHING TO WATCH, AND THAT IS A REAL BOUND.
  //
  // The eight-hour deadline covers the person being asleep. What it does not
  // cover —and this showed up on the very first try— is the slice's session
  // disappearing: then the watcher goes on polling GitHub for hours to deliver a
  // line to something that no longer exists. Measured: the first run of the full
  // suite left 42 processes like that.
  //
  // It holds just the same in production, and that is the underlying reason: you
  // close the slice's window, or the agent dies, and its watcher shuts itself
  // down. A live process watching a session that is not there is worse than its
  // absence, because it looks as though the gate is still covered.
  //
  // It only dies if cmux ANSWERED that it is not there.
  // ---------------------------------------------------------------------------
  const sesionAhora = consultarSesion()
  if (sesionAhora.consultado && !sesionAhora.ref) {
    log(`la sesión "${sesion}" ya no existe, así que no hay a quién entregarle el go. Vigilancia terminada.`)
    terminar(4)
  }
  if (Date.now() >= limite) {
    log(`plazo agotado sin ver ningún ${GO_TOKEN} válido en ${repo}#${issue}. La sesión sigue parada en el gate: dale el go en el issue y empújala a mano, o vuelve a lanzar este vigilante.`)
    terminar(3)
  }
  await sleep(Math.min(pollMs, Math.max(0, limite - Date.now())))
}
