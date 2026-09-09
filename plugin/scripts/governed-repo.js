// ============================================================================
// governed-repo.js — DOES THIS LOOP RUN IN THE REPO OF THIS cwd?
//
// It is the only place in the closing-keywords gate that touches the disk, and
// that is why it lives apart from closing-keywords.js, which is pure and is
// tested without files.
//
// The signal is the marker /ct-init seeds into the repo's AGENTS.md: if it is
// there, this repo has the loop's contract and the loop governs its issues.
// `git rev-parse` is not used: walking up with `fs` does not depend on `git`
// being in the PATH, nor does it pay for a subprocess.
// ============================================================================
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const CONTRACT_MARKER = '<!-- ct-init:slices-contract -->'
// #93 — the contract moved out of AGENTS.md into its own file, and in its place
// the loop's short section stayed, with ITS marker. The signal for «the loop
// governs this repo» becomes either of the two, not one: with only the new one,
// every repo bootstrapped up to today would stop being governed and the
// closing-keywords gate would switch off in them with nobody asking for it;
// with only the old one, it would switch off in every repo bootstrapped from
// now on.
export const LOOP_MARKER = '<!-- ct-init:loop -->'
export const GOVERNED_MARKERS = [CONTRACT_MARKER, LOOP_MARKER]

const AGENTS = 'AGENTS.md'

// Describes a value for an error message without risking a throw: an invalid
// `cwd` arrives from outside and may carry a `toString` that throws, or be
// circular. `String(...)` already avoids `JSON.stringify`'s problem with
// cycles, but a hostile `toString` can still throw, so it is caught.
function describeValue(v) {
  try { return String(v) } catch { return '<no se pudo describir>' }
}

// `.git` can be a DIRECTORY (a normal checkout) or a FILE with a `gitdir:`
// inside it (a worktree). Dispatched agents ALWAYS work in a worktree, so
// looking only at directories would leave out half of the gate's coverage, and
// silently.
function isRepoRoot(dir) {
  try { statSync(join(dir, '.git')); return true } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return false
    throw e
  }
}

/**
 * probeGovernedRepo: `{ governed }` when it can be asserted, `{ error }` when
 * it could not be looked at.
 *
 * The distinction is what matters: the caller has to be able to treat «I don't
 * know» differently from «no». A `{ governed: false }` invented on top of a
 * read that failed would let through exactly the commit this gate exists to
 * stop.
 */
export function probeGovernedRepo(cwd) {
  // A `cwd` that is not a string cannot be coerced silently: `String(cwd ||
  // '')` over `undefined`, `null` or `''` falls back to the PROCESS's cwd, and
  // would answer about a directory the caller never named. That is worse than
  // inventing a `false`: it is answering a different question.
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return { error: `cwd invalido: se esperaba una cadena no vacia y llego ${typeof cwd} (${describeValue(cwd)})` }
  }
  let dir
  try { dir = resolve(cwd) } catch (e) { return { error: `cwd invalido: ${e.message}` } }
  try {
    statSync(dir)
  } catch (e) {
    return { error: `no se ha podido leer el directorio de trabajo (${e.code || e.message})` }
  }
  try {
    for (;;) {
      if (isRepoRoot(dir)) {
        let text
        try {
          text = readFileSync(join(dir, AGENTS), 'utf8')
        } catch (e) {
          // AGENTS.md NOT BEING THERE is an answer: this repo does not carry
          // the contract. Not being able to READ it is not.
          if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return { governed: false }
          return { error: `no se ha podido leer ${AGENTS} (${e.code || e.message})` }
        }
        return { governed: GOVERNED_MARKERS.some((m) => text.includes(m)) }
      }
      const parent = dirname(dir)
      if (parent === dir) return { governed: false }
      dir = parent
    }
  } catch (e) {
    return { error: `no se ha podido determinar la raiz del repo (${e.code || e.message})` }
  }
}
