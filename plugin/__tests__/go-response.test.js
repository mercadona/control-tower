// The "go" of the `plan` gate, read by a machine (scripts/go-response.js).
//
// Until now nobody read the «ok» the human wrote in the issue: the gate really
// closed when that person walked over to the cmux window and pushed the session
// by hand. This module is the half that decides; the one that talks to `gh` and
// to `cmux` is scripts/ct-watch-go.mjs.
import { describe, it, expect } from 'vitest'
import {
  hasGo, commentIds, GO_TOKEN, matchesGo, goBody, goCommitment, newGoNonce,
  failedGoAttempt, GO_FORMAT_REPLY,
} from '../scripts/go-response.js'

const comentario = (id, body) => ({ id, body })

// F38 — the go is no longer a constant: it is `-OK <nonce>`, with one nonce per
// dispatch that the agent cannot guess. These tests pin the nonce (the
// randomness is supplied by the caller, precisely for this) and the `GO` below
// is the exact body a person would type.
const NONCE = newGoNonce(Buffer.from([0x3f, 0x9a, 0x1c, 0x04]))
const HASH = goCommitment(NONCE)
const GO = goBody(NONCE)

describe('the token', () => {
  it('is `-OK`, and it is exported so that it is not typed in four places', () => {
    // It is named by whoever looks for it, by the gate's two texts and by these
    // tests. It is the decoupling this repo has already paid for three times,
    // and here the breakage would be silent.
    expect(GO_TOKEN).toBe('-OK')
  })
})

describe('what counts as a go', () => {
  const nuevo = (body) => hasGo([comentario('IC_nuevo', body)], new Set(), HASH)

  it('a comment that is exactly the token and the nonce of this dispatch', () => {
    expect(nuevo(GO)).toBe(true)
  })

  it('with spaces or newlines around it, it still counts: the editor puts those there, not the person', () => {
    expect(nuevo(`  ${GO}\n`)).toBe(true)
  })

  it('the nonce in upper case counts: it is hex retyped off a screen', () => {
    // It opens nothing extra —the nonce is still needed— and it avoids the
    // worst possible moment, which is typing the right permission and having
    // nothing happen.
    expect(nuevo(`${GO_TOKEN} ${NONCE.toUpperCase()}`)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // F38 — THE BARE TOKEN IS NO LONGER A GO. It is the heart of the round: a
  // `-OK` with no nonce can be written by the agent itself with `gh` in a single
  // command, well within its normal repertoire and with a trace
  // indistinguishable from the legitimate one.
  // -------------------------------------------------------------------------
  it('the BARE token is not a go: it is the only thing the agent would know how to write', () => {
    expect(nuevo(GO_TOKEN)).toBe(false)
  })

  it('another nonce is not one either, nor one from another dispatch', () => {
    expect(nuevo(`${GO_TOKEN} deadbeef`)).toBe(false)
    expect(nuevo(goBody(newGoNonce(Buffer.from([1, 2, 3, 4]))))).toBe(false)
  })

  it('with no commitment NOTHING counts, not even the right go: there is no way back to the fixed token', () => {
    // A fallback to yesterday's `-OK` would be a door that opens by OMITTING an
    // argument (or by deleting a file), that is to say exactly what this round
    // takes out of the agent's repertoire.
    expect(hasGo([comentario('IC_nuevo', GO)], new Set())).toBe(false)
    expect(hasGo([comentario('IC_nuevo', GO)], new Set(), '')).toBe(false)
    expect(hasGo([comentario('IC_nuevo', GO)], new Set(), 'no-es-un-sha')).toBe(false)
  })

  // -------------------------------------------------------------------------
  // THE FAILURE MODE IS NOT SYMMETRIC, and that is the whole argument for the
  // exact match. A token that is not recognised leaves you waiting and you
  // notice. A token recognised too generously STARTS THE WORK — and «-OK pero
  // cambia el nombre» would start precisely what the person meant to stop.
  // -------------------------------------------------------------------------
  it('the go with something behind it is NOT a go: when in doubt, nothing starts', () => {
    expect(nuevo(`${GO} pero cambia el nombre`)).toBe(false)
    expect(nuevo('-OK pero cambia el nombre')).toBe(false)
  })

  it('a comment that only contains the go inside a sentence is not one either', () => {
    expect(nuevo(`me parece ${GO}`)).toBe(false)
  })

  it('ordinary prose is not a go, and there is no third category to learn', () => {
    expect(nuevo('ok, adelante')).toBe(false)
    expect(nuevo('lgtm')).toBe(false)
  })

  it('a body that is not text neither blows up nor counts', () => {
    expect(hasGo([{ id: 'IC_x', body: null }, { id: 'IC_y' }], new Set(), HASH)).toBe(false)
  })

  it('with no comments there is no go', () => {
    expect(hasGo([], new Set(), HASH)).toBe(false)
    expect(hasGo(null, new Set(), HASH)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// THE COMMITMENT. What gets stored anywhere the agent can read —the watcher's
// argv, which `ps` shows; the record on disk; the message of gate 9— is the
// sha256 of the nonce, never the nonce. A hash there is of no use at all to
// whoever reads it.
// ---------------------------------------------------------------------------
describe('the commitment', () => {
  it('is a hex sha256 and does not contain the nonce', () => {
    expect(HASH).toMatch(/^[0-9a-f]{64}$/)
    expect(HASH).not.toContain(NONCE)
  })

  it('does not depend on the case of the nonce, because the matcher does not either', () => {
    expect(goCommitment(NONCE.toUpperCase())).toBe(HASH)
  })

  it('the nonce is 8 hex characters —32 bits— out of the bytes the caller gives', () => {
    // 4 hex would be 65,536 attempts, and «65,536 attempts cannot be hidden» is
    // a bet on somebody watching the issue, not a guardrail.
    expect(NONCE).toBe('3f9a1c04')
    expect(GO).toBe('-OK 3f9a1c04')
  })

  it('matchesGo is the SAME function for the watcher and for --release', () => {
    // Two different expressions for the same thing would give the worst
    // possible symptom: the work starts with a go that then does not release.
    expect(matchesGo(GO, HASH)).toBe(true)
    expect(matchesGo(GO_TOKEN, HASH)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// THE WINDOW. Its reason to exist: a `-OK` from a PREVIOUS dispatch of the same
// issue cannot start anything. Without it, redispatching a slice whose issue
// already carried a go would inherit that go and the gate would be skipped IN
// SILENCE — the worst of the failures possible here.
//
// And it goes by IDENTIFIER, not by date, because the first version cut by time
// and it was broken: `createdAt` is put there by GitHub's server and the cut was
// put there by the machine's `Date.now()`. Two clocks. With the local one
// running slow, an inherited go fell inside the window; with the local one
// running fast, a legitimate go fell outside it forever. An adversarial review
// caught it.
// ---------------------------------------------------------------------------
describe('the window: only what was not in the initial snapshot', () => {
  it('a go that was already there starts nothing', () => {
    const viejos = [comentario('IC_viejo', GO)]
    expect(hasGo(viejos, commentIds(viejos), HASH)).toBe(false)
  })

  it('and a new one does, with the old one ahead of it', () => {
    const viejos = [comentario('IC_viejo', GO)]
    const ahora = [...viejos, comentario('IC_nuevo', GO)]
    expect(hasGo(ahora, commentIds(viejos), HASH)).toBe(true)
  })

  it('no clock takes part: the same comment decides the same way with any date', () => {
    // The regression this test prevents is going back to cutting by time. The
    // two comments carry absurd dates in opposite directions and nothing
    // changes, because nobody looks at them.
    const viejos = [{ id: 'IC_viejo', body: GO, createdAt: '2099-01-01T00:00:00Z' }]
    const ahora = [...viejos, { id: 'IC_nuevo', body: GO, createdAt: '1999-01-01T00:00:00Z' }]
    expect(hasGo(ahora, commentIds(viejos), HASH)).toBe(true)
    expect(hasGo(viejos, commentIds(viejos), HASH)).toBe(false)
  })

  it('accepts the snapshot as a list as well as a set', () => {
    expect(hasGo([comentario('IC_a', GO)], ['IC_a'], HASH)).toBe(false)
  })

  // F38 — THE WINDOW IS NO LONGER THE ONLY THING HOLDING THIS UP. A go from a
  // previous dispatch carries ANOTHER nonce, so it does not match even with no
  // window — which is exactly why `--release` can look at the whole issue.
  it('a go inherited from another dispatch does not match even looking at the whole issue', () => {
    const otroDespacho = goBody(newGoNonce(Buffer.from([9, 9, 9, 9])))
    expect(hasGo([comentario('IC_viejo', otroDespacho)], new Set(), HASH)).toBe(false)
  })
})

describe('the initial snapshot', () => {
  it('is the identifiers of what was already there', () => {
    expect(commentIds([comentario('IC_a', 'x'), comentario('IC_b', 'y')])).toEqual(new Set(['IC_a', 'IC_b']))
  })

  it('a comment with no readable identifier does NOT go into the snapshot', () => {
    // That way, if it turned up later, it would count as new. It is the prudent
    // side: the cost of counting it in too generously is waiting (the token has
    // to be exact anyway); the cost of counting it too sparingly would be
    // honouring an old go.
    expect(commentIds([{ body: 'x' }, { id: '', body: 'y' }, { id: 42, body: 'z' }])).toEqual(new Set())
  })

  it('with no comments the snapshot is empty', () => {
    expect(commentIds(null)).toEqual(new Set())
    expect(commentIds([])).toEqual(new Set())
  })
})

// The attempt that starts nothing. Measured in jjponz/rust-monitoring#7: a bare
// `-OK` at 10:50, silence, and the good go at 10:58. The silence in the face of
// a malformed go is deliberate and is not touched —the gate still opens only
// with `matchesGo`—; what was missing is telling the format to whoever has
// already shown they are trying.
describe('the go attempt that starts nothing', () => {
  const previos = commentIds([comentario('IC_viejo', 'el plan')])
  const conElViejo = (...nuevos) => [comentario('IC_viejo', 'el plan'), ...nuevos]

  it('recognises the measured case: the bare token, with no nonce', () => {
    expect(failedGoAttempt(conElViejo(comentario('IC_a', GO_TOKEN)), previos, HASH)).toBe('IC_a')
  })

  it('recognises the token in lower case, which is exactly the mistake that needs explaining', () => {
    expect(failedGoAttempt(conElViejo(comentario('IC_b', `-ok ${NONCE}`)), previos, HASH)).toBe('IC_b')
  })

  it('recognises the wrong nonce', () => {
    expect(failedGoAttempt(conElViejo(comentario('IC_c', `${GO_TOKEN} deadbeef`)), previos, HASH)).toBe('IC_c')
  })

  it('a VALID go is not a failed attempt: the opposite would be answering back to whoever got it right', () => {
    expect(failedGoAttempt(conElViejo(comentario('IC_d', GO)), previos, HASH)).toBeNull()
  })

  it('a comment that does not start with the token is not an attempt: nobody was giving the go', () => {
    expect(failedGoAttempt(conElViejo(comentario('IC_e', 'me parece bien el plan')), previos, HASH)).toBeNull()
    expect(failedGoAttempt(conElViejo(comentario('IC_f', 'ok')), previos, HASH)).toBeNull()
  })

  it('an attempt that was already in the initial snapshot gets no answer: it is from a previous dispatch', () => {
    const viejos = [comentario('IC_viejo', GO_TOKEN)]
    expect(failedGoAttempt(viejos, commentIds(viejos), HASH)).toBeNull()
  })

  it('with no comments, or with rubbish for comments, there is no attempt', () => {
    expect(failedGoAttempt([], previos, HASH)).toBeNull()
    expect(failedGoAttempt(null, previos, HASH)).toBeNull()
    expect(failedGoAttempt([null, undefined], previos, HASH)).toBeNull()
  })

  it('returns the LAST attempt when there are several, just as hasGo walks backwards', () => {
    const comentarios = conElViejo(comentario('IC_x', GO_TOKEN), comentario('IC_y', `${GO_TOKEN} nope`))
    expect(failedGoAttempt(comentarios, previos, HASH)).toBe('IC_y')
  })
})

describe('el texto con el que se contesta al intento', () => {
  // Este texto se publica en el issue y el agente LEE el issue, así que el
  // nonce es lo único que no puede decir. Asertar `not.toContain(NONCE)` sobre
  // la constante no valdría: la constante no tiene el nonce en su alcance, así
  // que esa aserción no puede fallar nunca por el motivo que su nombre da — es
  // el defecto que conventions/testing.md manda cazar mutando, y mutando salió.
  // Lo que SÍ puede pasar es que alguien escriba un ejemplo («por ejemplo `-OK
  // 3f9a1c2b`»), y eso es lo que esto caza: ningún token con forma de nonce.
  // Quien comprueba lo otro —que el vigilante publique el texto y no otra cosa
  // con el nonce interpolado— es ct-watch-go.test.js, que sí lo tiene en la mano.
  it('no lleva ningún token con forma de nonce, ni de ejemplo', () => {
    expect(GO_FORMAT_REPLY).not.toMatch(/\b(?=[0-9a-f]{4,64}\b)[0-9a-f]*\d[0-9a-f]*\b/i)
  })

  it('dice el formato exacto, con el token en su caja', () => {
    expect(GO_FORMAT_REPLY).toContain(`\`${GO_TOKEN} <nonce>\``)
  })

  it('dice de dónde sale el nonce y cómo se recupera si se perdió', () => {
    expect(GO_FORMAT_REPLY).toContain('/ct-next')
    expect(GO_FORMAT_REPLY).toContain('scripts/ct-go.mjs')
  })

  it('dice que el silencio es deliberado, para que no se lea como una avería', () => {
    expect(GO_FORMAT_REPLY).toContain('deliberado')
  })
})
