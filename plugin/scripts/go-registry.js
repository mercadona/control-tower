// ============================================================================
// GO-REGISTRY — WHERE THE GO'S COMMITMENT LIVES, and why not on GitHub.
//
// F38. The `plan` gate's go is `-OK <nonce>` (go-response.js): the coordinator
// draws the nonce when dispatching and prints it only on her own screen;
// whoever verifies keeps its sha256. This file is the place where that sha256
// is kept, and the two functions that write it and read it.
//
// WHY NOT IN THE ISSUE, NOR IN A LABEL, NOR IN THE PR's BODY. Because the agent
// has `gh`: everything that lives on GitHub is writable by it. A commitment in
// a label turns this into a one-move game — the agent draws its own nonce,
// writes ITS hash into the label, comments its own `-OK <nonce>` and gate 9
// takes it as good. The commitment has to live in the one place in the system
// the agent does not touch by script: the coordinator session's private state,
// outside the repo and outside the worktree.
//
// AND THE LIMIT, said here because here is where it is decided: the agent runs
// under the same uid on the same machine, so it CAN write this file. What this
// path buys is not impossibility, it is that forging the go leaves the agent's
// normal repertoire (a comment on its own issue, with `gh`, which the kickoff
// already tells it to use) and becomes tampering with the coordinator's state —
// the same class of act as rewriting the plugin that judges it, which is the
// line behind which ALL the gates of this repo already stand. Really closing
// this demands a verifier that does not run under that uid (CI, or another
// identity); it is named in the README and not built.
//
// ONE FILE PER ISSUE AND NOT AN INDEX. A single index gets rewritten by two
// dispatches at once —/ct-next dispatches batches— and one lost write leaves a
// slice unable to release. One file per issue does not have that race, and as a
// bonus deleting one does not drag the others down with it.
// ============================================================================

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { controlTowerDir } from './run-metrics.js'

// The file name: `<owner>__<repo>-<issue>.json`. The repo goes into the name
// because the same issue number exists in every repo in the world and this
// folder belongs to the MACHINE, not to a repo: without it, dispatching #7 in a
// second repo would trample the go of #7 of the first. It is sanitised down to
// `[A-Za-z0-9._-]` because this ends up being a path, and a `..` or a `/` in a
// repo's name would write outside the folder.
export function goFileName(repo, issue) {
  const slug = String(repo ?? '').replace(/\//g, '__').replace(/[^A-Za-z0-9._-]/g, '_')
  const n = String(issue ?? '').replace(/[^0-9]/g, '')
  return `${slug || 'sin-repo'}-${n || '0'}.json`
}

export function goDir(opts = {}) {
  return join(controlTowerDir(opts), 'go')
}

// THE PATH HAS TO BE ABSOLUTE, and if it is not, this writes NOTHING.
//
// `controlTowerDir` falls back to `homedir()` when there is no
// `CLAUDE_CONFIG_DIR`, and with an empty `HOME` that resolves to the empty
// string: the path comes out RELATIVE and the commitment would end up in the
// caller's cwd —inside the slice's repo, in the normal case. Verified by
// construction: a test in the suite that runs with `HOME=''` left a
// `.claude/control-tower/go/o__r-90.json` in the checkout.
//
// And the failure mode is one of the bad ones: it gets written where nobody is
// going to read it, so the watcher starts, the person gives the go… and
// `--release` refuses because it looks for the commitment in the real place. A
// stuck slice with nothing having failed. Better not to register and to say so:
// the caller turns that into a warning carrying the remedy (`ct-go`), and gate
// 9 into a «no se ha podido comprobar».
function requireAbsolutePath(dir) {
  if (!isAbsolute(dir)) {
    throw new Error(`el directorio del registro del go no resuelve a una ruta absoluta ("${dir}") — con CLAUDE_CONFIG_DIR y HOME sin valor no se sabe DÓNDE vive el estado de la coordinadora, y escribirlo en el cwd lo dejaría donde nadie lo lee`)
  }
  return dir
}

export function goPath({ repo, issue, configDir = null, home = null } = {}) {
  return join(goDir({ configDir, home }), goFileName(repo, issue))
}

// THE WRITE. A restrictive `mode` on the file and on the folder: it does not
// protect against a process with the same uid (see the limit above), but it
// does against any other one —and a wide permission on a file that exists to
// authorise reads as carelessness when somebody audits it. `writeFileSync` with
// `flag: 'w'` on purpose: rewriting is the NORMAL case (redispatching a slice
// draws a new nonce, and the old one has to stop being valid in the same act).
export function writeGoCommitment({ repo, issue, commitment, configDir = null, home = null }) {
  const dir = requireAbsolutePath(goDir({ configDir, home }))
  const path = goPath({ repo, issue, configDir, home })
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const body = JSON.stringify({ repo: String(repo ?? ''), issue: Number(issue), commitment: String(commitment) }, null, 2)
  writeFileSync(path, `${body}\n`, { encoding: 'utf8', mode: 0o600, flag: 'w' })
  return path
}

// THE READ, with THREE answers and not two. `{ commitment }` is "there is a go
// registered"; `{ missing: true }` is "this dispatch registered none"; and
// `{ error }` is "there is something and it could not be read". The third one
// exists because of this repo's doctrine: what could not be looked at is not
// declared clean. The caller tells them apart because they mean different
// things to the human — one is fixed with `ct-go`, the other with a `chmod` or
// a `cat`.
export function readGoCommitment({ repo, issue, configDir = null, home = null } = {}) {
  const path = goPath({ repo, issue, configDir, home })
  try {
    requireAbsolutePath(goDir({ configDir, home }))
  } catch (e) {
    // "It could not be checked", never "there is no go": a relative path points
    // at a different place depending on where it is invoked from, so its absence
    // says nothing.
    return { error: e.message, path }
  }
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (e) {
    if (e && e.code === 'ENOENT') return { missing: true, path }
    return { error: e.message, path }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { error: `no es JSON legible (${e.message})`, path }
  }
  const commitment = typeof parsed?.commitment === 'string' ? parsed.commitment.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(commitment)) {
    return { error: 'el campo `commitment` no es un sha256 hex de 64 caracteres', path }
  }
  return { commitment, path }
}
