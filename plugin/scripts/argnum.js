// STRICT parsing of numeric command-line arguments (D4, defect 2). It exists
// as a module of its own, and not duplicated inside every wrapper, because
// the bug it fixes is exactly that of two places interpreting the SAME kind
// of value by different criteria: `ct-next.mjs --cap` and the positional
// `<issue#>` of `dispatch-check.mjs` both used `parseInt(x, 10)`, which is a
// TOLERANT parser — it swallows the numeric prefix and silently discards the
// rest:
//
//   parseInt('1e3', 10)     === 1     (the user asked for 1000)
//   parseInt('3perros', 10) === 3
//   parseInt('2.9', 10)     === 2
//   parseInt(' 3', 10)      === 3
//   parseInt('+2', 10)      === 2
//
// Verified by construction against the unfixed code: `--cap 1e3` dispatched
// ONE slice, `--cap 3perros` dispatched THREE, and `--cap 2.9` dispatched
// TWO — without a single line of warning in any of the three cases. A
// silently LOWER cap reads as "the dispatcher finds no work"; a higher one
// launches surplus agents. In dispatch-check.mjs the same pattern is worse:
// `dispatch-check.mjs 42x` would claim issue 42 — mutating a REAL issue the
// user never named.
//
// `Number(x)` is no use as it stands either: it is faithful about trailing
// garbage (`Number('3perros')` is NaN) but it accepts shapes that an integer
// CLI argument should not accept and that change the value in a non-obvious
// way — `Number('1e3')` is 1000 (correct, but nobody writes that on purpose
// in a --cap), `Number('0x10')` is 16, `Number(' 3 ')` is 3, and `Number('')`
// is 0. The rule here is the narrowest one possible: ONLY decimal digits, no
// sign, no spaces, no exponent, no point, no alternative base. Anything else
// is `null` — never a number that merely "looks like" it.
//
// D5, finding I — WHY THE SIGN IS REJECTED TOO (the regex used to be
// `/^[+-]?\d+$/`). D4 accepted `+2` on purpose, on the criterion "does the
// value diverge from what the user wrote?" — and `+2` is faithfully 2, so it
// did not diverge. But the THREE call sites of this module promise, in the
// text of their own error, "dígitos decimales a secas" / "dígitos a secas":
// ct-next.mjs's `--cap`, ct-groom.mjs's `--project` and dispatch-check.mjs's
// `<issue#>`. `+2` is not that, and it was accepted all the same — that is,
// the message asserted one rule and the code applied another, which is
// exactly the family of defects this batch of work is after. Verified by
// construction before the change: `--cap +2` exited 0 and dispatched with cap
// 2, and `--project +7` passed validation.
//
// The sign is rejected IN FULL, not just the `+`: a `-1` is not "dígitos
// decimales a secas" either, and none of the three call sites admits a
// negative value (all three demand >= 1). Deliberate consequence: `--cap -1`
// stops giving the RANGE message ("debe ser >= 1") and starts giving the
// SHAPE one — `0`, which is a valid shape out of range, still gives the range
// one, so the distinction between the two messages (which D4 introduced on
// purpose) is preserved where it really means something.
//
// The range (>= 1, etc.) is deliberately NOT decided here: a well-formed but
// out-of-range value deserves a different message ("debe ser >= 1") from that
// of a value that is not even a number ("no es un entero"), and only the call
// site knows its own range.
const STRICT_INT_RE = /^\d+$/

export function parseStrictInt(raw) {
  if (typeof raw !== 'string') return null
  if (!STRICT_INT_RE.test(raw)) return null
  const n = Number(raw)
  // Number.isSafeInteger (not just Number.isInteger): '99999999999999999999'
  // passes the regex and `Number(...)` rounds it to 100000000000000000000 — a
  // value DIFFERENT from the one the user wrote, which is precisely the class
  // of silent divergence this module exists to prevent.
  if (!Number.isSafeInteger(n)) return null
  return n
}
