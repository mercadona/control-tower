// ============================================================================
// GO-RESPONSE — the `plan` gate's "go", read by a machine.
//
// THE DEFECT IT CLOSES. The `plan` gate (scripts/gates.js) tells the agent:
// «publish it as an issue comment and STOP — do not implement anything until a
// human answers». The human answered on GitHub… and NOBODY READ IT: not one
// file of this plugin read issue comments. So GitHub's «ok» had no mechanical
// consequence at all —it was a record— and the go that really resumed the work
// was the one the person typed by hand into the cmux session. The same
// permission twice, and the one that counted was not the one left written down.
//
// Measured in jjponz/rust-monitoring#2: the plan was published at 15:31:48, the
// «ok» arrived at 15:33:53, and the first task did not appear committed until
// ~15:39 — the gap is a person going to the window to push the session along.
//
// WHY EXACT MATCH AND NOT «CONTAINS OK». Because the failure mode is not
// symmetric. A token that is not recognized leaves you waiting, and you notice
// it: you go and look. A token recognized too readily STARTS THE WORK, and «ok
// but change the name» would start exactly what the person wanted to stop. When
// in doubt, nothing starts: that is why `-OK` with anything behind it is NOT a
// go. There is no «malformed» category on purpose — it would be a third answer
// that somebody has to learn, and the one that exists already covers the case:
// if you write something that is not exactly `-OK`, nothing happens, and that
// is what you wanted.
//
// ---------------------------------------------------------------------------
// THE WINDOW IS THE SET OF COMMENTS THAT WERE ALREADY THERE, NOT A CUT-OFF
// DATE. And this is a correction, not a preference.
//
// The first version cut by time: comments whose `createdAt` was later than the
// watcher's start-up counted. It looked clean and it was broken, and an
// adversarial review caught it: `createdAt` is set by GitHub's server and the
// cut-off instant was set by this machine's `Date.now()`. They are TWO CLOCKS.
// With the local one fifteen minutes behind, an `-OK` inherited from an earlier
// dispatch fell inside the window and skipped the gate SILENTLY —precisely what
// the window existed to prevent—; with the local one ahead, a legitimate `-OK`
// written in the first few minutes fell outside and never came back in, because
// its `createdAt` does not change from one poll to the next.
//
// Now the window is IDENTIFIERS: the watcher photographs the `id`s of the
// comments that were there at start-up (`gh` gives them: `IC_kwDO…`), and
// counts as an answer any comment whose `id` was not in that photo. There is no
// clock involved at all, neither GitHub's nor ours, so there is no drift that
// can break it. And it is simpler: the whole `Date.parse` is gone.
//
// The property the window holds up is still the same, and it is the one that
// matters: an `-OK` from an EARLIER dispatch of the same issue starts nothing.
// Without it, re-dispatching a slice whose issue already had a go would inherit
// that go and skip the gate without anyone finding out.
// ---------------------------------------------------------------------------
//
// A PURE module: it does not talk to `gh`, it does not look at the clock (there
// is no clock any more), it does not launch processes. It receives the comments
// and the initial photo, and it answers. The one doing input and output is
// scripts/ct-watch-go.mjs.
//
// `node:crypto` does not break that purity: `createHash` is a deterministic
// function of its argument, with no disk, no network and no clock — the same as
// a more expensive `String.trim`. What this module still does NOT do is
// generate the randomness: the nonce comes in as a parameter (`newGoNonce`
// receives the bytes), precisely so that a test can fix it and so that the only
// place calling `randomBytes` is the process that is going to print it on the
// human's screen.
// ============================================================================
//
// ---------------------------------------------------------------------------
// F38 — THE GO THE AGENT CANNOT WRITE.
//
// THE DEFECT IT CLOSES. This very mechanism, as it came out of #32, gave
// mechanical consequence to a GitHub comment… and the agent has `gh`. Its own
// limit said so in commands/ct-next.md: «it does not stop the agent itself
// writing `-OK` on its own issue — it has `gh`, so it can». With the `plan`
// gate implied by default on EVERY slice (gates.js#gatesForType), that is not a
// pending hole: it is today's hole. And it is worse than having no gate at all,
// because it leaves the RECORD that there was human review where there was
// none.
//
// THE SHAPE. The go stops being a constant and becomes a constant PLUS A NONCE
// PER DISPATCH. The coordinator draws the nonce at dispatch time and prints it
// ONLY on the screen of whoever dispatches; what is left written anywhere the
// agent can read is its sha256 (the «commitment»). The human answers
// `-OK <nonce>`; whoever verifies hashes what they read and compares.
//
// WHY THIS CLOSES SOMETHING FOR REAL, and what it does not close. The agent can
// no longer MANUFACTURE the go: it cannot guess 32 bits that are not in its
// context, nor in the kickoff, nor in the issue, nor in its worktree, nor in
// the watcher's log. Forging it stops being «a `gh issue comment` on my own
// issue» —a command the agent already knows how to run, within its normal
// repertoire, and one that leaves a trace indistinguishable from the legitimate
// one— and comes to require manipulating the coordinator's private state
// outside the repo, or reading another session's pane. That is the line BEHIND
// WHICH ALL the other gates of this repo ALREADY ARE: none of them survives an
// agent that rewrites the plugin judging it. What this change does is take the
// go off the list of things you can skip without stepping off the script.
//
// And what it does NOT close, said here and in the README: the agent runs with
// the SAME uid as the coordinator on the SAME machine. None of this is
// cryptography against an adversary, it is a gate that no longer opens by
// accident or in passing. Really closing it requires the go to be verified by
// something that does not run under that uid —CI, or another identity— and that
// is named and unbuilt.
//
// AS A BONUS, A PIECE GOES AWAY: the nonce is per dispatch, so an `-OK` from an
// earlier dispatch NO LONGER FITS by construction. The photo of ids (the
// window) is still there because it protects the watcher from something else
// —counting as an answer something that was already there— but the property
// that justified it («an inherited go starts nothing») is now held up by the
// nonce itself, and that is why the `--release` gate, which looks at the whole
// issue with no window, is safe.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'

// The token, exact and on a single line. It is exported because it is named by
// the one that looks for it (this module), by the two texts that explain it to
// the agent and to the human (gates.js) and by their tests: a string typed in
// four places ends up diverging in one, which is the decoupling this repo
// already paid for with JUDGE_TOOLS, VERDICT_RULES and PACKAGE_SECTIONS. And
// here the failure would be mute: the token gets renamed, the texts go on
// saying what they said before, the person writes what they were told and the
// work never starts without anything failing.
export const GO_TOKEN = '-OK'

// THE EXACT BODY that counts as a go for one particular dispatch. A single
// function forms it, for the same reason GO_TOKEN is exported: the screen that
// dictates it to the human and the matcher that recognizes it cannot diverge by
// one space.
export function goBody(nonce) {
  return `${GO_TOKEN} ${nonce}`
}

// THE COMMITMENT. sha256 of the nonce in lowercase — of the NONCE and not of
// the whole body, so that the matcher can demand a literal `-OK` (uppercase
// included, as until today) and at the same time tolerate the nonce being
// retyped in uppercase.
//
// The hash is stored and never the nonce because the commitment DOES live in
// places the agent reads: the watcher's argv (`ps` shows it), its log file, the
// message of gate 9. A hash there is of no use to whoever reads it.
export function goCommitment(nonce) {
  return createHash('sha256').update(String(nonce).toLowerCase(), 'utf8').digest('hex')
}

// THE NONCE, out of bytes the caller supplies. 8 hex characters = 32 bits.
//
// Why 32 and not 16: a 4-hex nonce is 65,536 attempts, and «65,536 attempts are
// impossible to hide» is not a guardrail, it is a bet that somebody is watching
// the issue's comments. They cost the same to type. And why not 64: a person
// copies this from a screen into a comment, and a guardrail that becomes
// awkward switches itself off within a fortnight.
export function newGoNonce(bytes) {
  return Buffer.from(bytes).toString('hex').toLowerCase()
}

// THE MATCHER, in a single function because there are TWO that ask, and with
// different window criteria: the watcher (new comments only) and
// `dispatch-check --release` (the whole issue, with no window). If each one
// wrote its own expression, the day they diverged the symptom would be that the
// work starts and then cannot be delivered.
//
// `-OK` is LITERAL and case-sensitive, just as before. The nonce is compared by
// hash after lowering it to lowercase: accepting `-OK 3F9A1C04` opens nothing
// (the nonce is still needed) and avoids the worst moment of all, which is
// typing the correct permission and having nothing happen.
//
// With no readable commitment THERE IS NO GO. Not even yesterday's naked `-OK`:
// a way back to the fixed token would be a way that is activated by DELETING a
// file, which is to say exactly what this round takes out of the agent's
// repertoire.
export function matchesGo(body, commitment) {
  if (typeof commitment !== 'string' || !/^[0-9a-f]{64}$/.test(commitment)) return false
  const m = /^-OK[ \t]+([0-9a-fA-F]{2,64})$/.exec(String(body ?? '').trim())
  if (!m) return false
  return goCommitment(m[1]) === commitment
}

// The `id`s of the comments that were already there. A comment with no readable
// `id` does NOT enter the photo: that way, if it turned up later, it would
// count as new — which is the prudent side here, because the effect of counting
// it too readily is waiting (the token has to be exact anyway), and that of
// counting it too rarely would be honouring an old go.
export function commentIds(comentarios) {
  const ids = new Set()
  for (const c of comentarios || []) {
    if (typeof c?.id === 'string' && c.id !== '') ids.add(c.id)
  }
  return ids
}

// THE ATTEMPT THAT STARTS NOTHING, AND WHY IT IS NOW ANSWERED.
//
// This module's header argues that there is no «malformed» category on purpose:
// «if you write something that is not exactly `-OK`, nothing happens, and that
// is what you wanted», because a token recognized too readily would start what
// the person wanted to stop. That argument STANDS WHOLE and this does not touch
// it: the gate is opened only by `matchesGo`, and nothing below here changes
// that.
//
// What the argument took for granted is the other half: «a token that is not
// recognized leaves you waiting, and you notice it: you go and look». Measured
// in jjponz/rust-monitoring#7: the person wrote a bare `-OK` at 10:50, nothing
// happened, and the good go did not arrive until 10:58. They did look — and
// they had nothing to look at. The format is written in the issue's BODY
// (scripts/gates.js) and whoever answers is reading the plan's comment, which
// is somewhere else.
//
// So what is missing is not a third answer from the machine: it is telling the
// format to somebody who has already demonstrated that they are trying. An
// attempt is a new comment that begins with the token —in any case, because
// writing `-ok` is exactly the kind of mistake this exists to explain— and that
// `matchesGo` does not recognize.
//
// THE BODY IS NOT RETURNED, only the `id`. An attempt may carry a mistyped
// nonce, and repeating it in a public comment would publish almost the whole
// permission. Whoever answers explains the format and does not quote what was
// written.
// THE TENSION WITH `conventions/defects.md`, DECLARED AND NOT RESOLVED IN
// SILENCE. Its first rule says that an answer carries the vocabulary and not a
// boolean derived from it, and here the answer to the gate is three states
// —there is nothing, there is a go, there is an attempt that is not one—
// served by a boolean `hasGo` plus this nullable identifier. The conforming
// design would be a function with a closed vocabulary of three members.
//
// It is not done, and the reason is the half of the rule that is not met here:
// «a boolean collapses states that are fixed differently, and its consumer
// cannot separate them again». The consumer CAN — it calls this function— so
// the damage the rule names does not happen. And against it there is a real
// cost: `hasGo` is the gate's only door, and its narrowness is the security
// property this module's header defends. Fusing it with «explaining the format
// to whoever got it wrong» would couple a security decision to a convenience
// one, and the day somebody audits what opens the gate they would have to read
// both.
//
// What is closed off is the invalid state: a VALID go cannot come out of here
// as a failed attempt, because `matchesGo` discards it inside. Without that the
// watcher would deliver and explain at the same time.
export function failedGoAttempt(comentarios, idsPrevios, commitment) {
  const previos = idsPrevios instanceof Set ? idsPrevios : new Set(idsPrevios || [])
  for (const comentario of [...(comentarios || [])].reverse()) {
    const id = typeof comentario?.id === 'string' ? comentario.id : ''
    if (id !== '' && previos.has(id)) continue
    const cuerpo = String(comentario?.body ?? '').trim()
    if (!cuerpo.toUpperCase().startsWith(GO_TOKEN)) continue
    if (matchesGo(cuerpo, commitment)) continue
    return id === '' ? null : id
  }
  return null
}

// The text with which an attempt is answered. It lives here and not in the
// watcher because it is content, not input and output, and because a test has
// to be able to check that it does NOT carry the nonce: that is the one thing
// this comment cannot say, since the agent reads the issue.
export const GO_FORMAT_REPLY = [
  `El go de este gate es exactamente \`${GO_TOKEN} <nonce>\`: el token en mayúsculas, un espacio, y el nonce que \`/ct-next\` imprimió al despachar este slice.`,
  '',
  `Lo que se escribió no lo arranca, y eso es deliberado: \`${GO_TOKEN}\` a secas o con cualquier otra cosa detrás no abre el gate, para que un "ok, pero cambia el nombre" no eche a andar justo lo que se quería frenar.`,
  '',
  'El nonce **no está escrito en este issue** a propósito, porque el agente lee el issue: es la parte del permiso que él no puede fabricar. Si se ha perdido, quien despachó lo reemite con `scripts/ct-go.mjs`.',
].join('\n')

// Is there a go among the comments that were NOT in the initial photo?
//
// It is walked BACKWARDS and answered with the first one recognized, which is
// to say the last of the list. Today there is only one recognizable answer, so
// this comes to the same as looking for «any» — and it implements no «I take it
// back»: an `-OK` followed by «wait, no» is still a go, because the only thing
// this module recognizes is the token. It is walked this way because it is what
// stays correct the day there is a second answer, and because the cost is zero.
export function hasGo(comentarios, idsPrevios, commitment) {
  const previos = idsPrevios instanceof Set ? idsPrevios : new Set(idsPrevios || [])
  for (const comentario of [...(comentarios || [])].reverse()) {
    const id = typeof comentario?.id === 'string' ? comentario.id : ''
    if (id !== '' && previos.has(id)) continue
    if (matchesGo(comentario?.body, commitment)) return true
  }
  return false
}
