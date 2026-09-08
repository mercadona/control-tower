// scripts/repo-walk.js
//
// This repo has TWO deterministic, offline sweeps over the same file tree:
// `scripts/detect-conventions.mjs` (PROTOCOL collisions between the loop and
// the target repo — claim, worktrees, state file) and `scripts/detect-yardstick.mjs`
// (§3.12 of the handoff, docs/prompt-juez-lo-que-queda.md: candidates for the
// repo's CODE yardstick). They are different subjects, but they walk the same
// tree with the same bounds and the same exclusions — and if each carried its
// own copy of the walk, the bounds (`MAX_DEPTH`, `MAX_ENTRIES`), the exclusions
// (`SKIP_DIRS`) and the two odd rules below could diverge IN SILENCE between
// the two sweeps, exactly the kind of decoupling this repo already ties down
// with tests elsewhere (`CONVENTIONS_FILE`, `JUDGE_TOOLS`, `buildOptions`).
// This module is the ONLY walk: the two sweeps import it and carry no copy of
// their own.
//
// The code down here is the one that lived in `detect-conventions.mjs`
// (extracted, not rewritten) and the three rules that look odd are measured
// against a real repo, not simplified for elegance:
//   - `SKIP_DIRS` includes `.worktrees`: it belongs to the loop ITSELF, and
//     finding a `dispatch-check.sh` in there would be finding a copy of the
//     checkout, not a convention (or a yardstick candidate) of the target repo.
//   - NO directory symlink is followed: a link to `/` would turn the scan into
//     a walk of the whole disk.
//   - A directory called `worktrees` (with no dot — the one the target repo may
//     have on its own account) is RECORDED but not descended into: going down
//     duplicated every file of interest once per live worktree, and those
//     copies pushed the real file off the list — the warning stayed correct and
//     became illegible, which for practical purposes is the same as keeping
//     quiet. The directory itself, recorded above, is already the signal that
//     matters.
import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// Directories that are never conventions nor the repo's yardstick, or that
// would make the walk expensive while contributing nothing. See the
// `.worktrees` note above.
export const SKIP_DIRS = new Set([
  '.git', '.worktrees', 'node_modules', '.venv', 'venv', '__pycache__',
  'dist', 'build', 'target', 'vendor', 'Pods', '.next', '.ruff_cache',
  '.mypy_cache', '.pytest_cache', '.gradle', 'DerivedData',
])

// The walk's hard bound. A big repo cannot turn a `/ct-init` into a wait: it is
// cut short and it is SAID that it was cut short (an incomplete scan presented
// as complete is the same lie as silence).
export const MAX_DEPTH = 5
export const MAX_ENTRIES = 20000

// walkRepo: walks `target` and returns `{ entradas, truncated }`.
//   - `entradas`: paths relative to `target`, always with the `/` separator
//     (even when running on a platform with a different `path.sep`).
//     Directories carry a trailing `/` — today's contract, which
//     `conventions.js` depends on — and files do not.
//   - `truncated`: `true` if the walk was cut short by `maxEntries` before
//     finishing. The depth (`maxDepth`) cuts that branch off in silence: it is
//     not a truncation of the whole scan, it is the bound on how far down it
//     goes.
//
// It does not `statSync` the `target` nor validate that it is a directory: that
// is each wrapper's responsibility (`detect-conventions.mjs`,
// `detect-yardstick.mjs`), which need to decide the exact error message ON THEIR OWN
// — and that way neither of the two changes its text because of coming from
// here.
export function walkRepo(target, { maxDepth = MAX_DEPTH, maxEntries = MAX_ENTRIES } = {}) {
  const entradas = []
  let truncated = false
  let entries = 0

  const rel = (full) => relative(target, full).split(sep).join('/')

  function walk(dir, depth) {
    if (depth > maxDepth || truncated) return
    let items
    try {
      items = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // an unreadable subdirectory does not invalidate the rest of the walk
    }
    for (const item of items) {
      if (entries++ > maxEntries) { truncated = true; return }
      const full = join(dir, item.name)
      // `isDirectory()` on the Dirent (deliberately without following
      // symlinks: a link to `/` would turn the walk into the whole disk).
      if (item.isDirectory()) {
        if (SKIP_DIRS.has(item.name)) continue
        entradas.push(`${rel(full)}/`)
        // A foreign worktrees directory is NOT descended into — see the header
        // note. The directory itself is already recorded above.
        if (/^worktrees$/i.test(item.name)) continue
        walk(full, depth + 1)
      } else if (item.isFile()) {
        entradas.push(rel(full))
      }
    }
  }

  walk(target, 0)
  return { entradas, truncated }
}
