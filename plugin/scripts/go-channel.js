// ============================================================================
// GO-CHANNEL — WHICH WAY THE NONCE REACHES THE PERSON, and the limit that this
// has to say out loud.
//
// F38. The go of the `plan` gate is `-OK <nonce>`: the nonce is drawn at
// dispatch time and has to reach ONE person and nobody else. This file is that
// last leg, and it exists apart because two programs use it —/ct-next when
// dispatching and ct-go.mjs when re-issuing— and the text that dictates the go
// to the human cannot diverge between the two: the symptom of it diverging is a
// person typing a correct permission that opens nothing.
//
// THE DEFAULT'S DEFECT, said out loud: stdout is where whoever dispatched is
// looking… and when a Claude session runs /ct-next, stdout is ALSO that
// session's context. So the guardrail, in its default form, protects against
// the IMPLEMENTER agent —the one working in the worktree, the one whose verdict
// is at stake, the one with the incentive and the `gh`— and not against the
// coordinator, which is already trusted for everything else: it dispatches, it
// saves `.agent/STATE.md` and it merges. It is the right split for the failure
// mode seen in the field (an agent granting itself its own permission), and it
// is not the complete split.
//
// CT_GO_CHANNEL=notify, for whoever will not grant even that: the nonce goes
// out through a system notification (osascript) and nothing but the warning that
// it was sent goes to stdout. That way the nonce does not enter the context of
// ANY agent. It is not the default because it is a channel that may not exist
// —no GUI, over ssh, without notification permissions— and a go that never
// arrives leaves the slice stopped at the gate.
// ============================================================================

import { execFileSync } from 'node:child_process'
import { goBody } from './go-response.js'

export const GO_CHANNEL_ENV = 'CT_GO_CHANNEL'

// The line, in a single function: a person types it while reading it, so it
// states the EXACT body (goBody) instead of describing it.
export function goDictationLine(issue, nonce) {
  return `  GO de #${issue}: contesta exactamente \`${goBody(nonce)}\` en un comentario del issue.`
}

export function emitGoNonce(issue, nonce, { log = console.log, env = process.env, run = execFileSync } = {}) {
  const canal = String(env[GO_CHANNEL_ENV] || '').trim().toLowerCase()
  if (canal !== 'notify') return log(goDictationLine(issue, nonce))
  try {
    // The text goes in an ARGUMENT, not interpolated inside the AppleScript:
    // that way there is nothing to escape and no value can end up being
    // executed. `on run argv` is the standard hook for that.
    run('osascript', [
      '-e', 'on run argv\ndisplay notification (item 1 of argv) with title "Control Tower" subtitle "go del gate plan"\nend run',
      goBody(nonce),
    ], { stdio: 'ignore', timeout: 10_000 })
    log(`  GO de #${issue}: enviado por notificación del sistema (${GO_CHANNEL_ENV}=notify) — no se imprime aquí a propósito.`)
  } catch (e) {
    // Falls back to stdout SAYING SO. Staying quiet here would leave the gate
    // without a go; falling back without warning would be worse still: the
    // person would believe the nonce had not passed through any agent's context
    // when it has.
    log(`  aviso: la notificación del go de #${issue} falló (${e.message}) — va por aquí, o sea que el nonce SÍ entra en el contexto de esta sesión.`)
    log(goDictationLine(issue, nonce))
  }
}
