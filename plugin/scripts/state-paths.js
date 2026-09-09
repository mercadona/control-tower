// ============================================================================
// F22 — WHERE A SESSION'S STATE LIVES, AND WHY THERE ARE TWO FILES.
//
// A slice's worktree has TWO state files:
//
//   .agent/STATE.md  TRACKED. The coordinator session's one, exactly as it came
//                    in the base the worktree was cut from. AT ZERO DIFF: the
//                    dispatcher no longer touches it.
//   .agent/SLICE.md  IGNORED. The slice's state, seeded by /ct-next.
//
// The precedence below is structural, not a convenience. Without it, an agent
// that re-hydrates after a /clear would read the worktree's tracked STATE.md
// —which is not its seed but the COORDINATOR's state frozen in the base: the
// epic, not the slice— and would hydrate itself believing it is the
// coordinator. It is the same defect this round fixes, with the vector
// inverted.
//
// And the presence of the file IS the signal for "I am in a slice worktree":
// no environment variable is needed, nor looking at whether the cwd hangs off
// .worktrees/, nor asking git whether this is a linked worktree. A slice
// worktree always has SLICE.md because the dispatcher seeds it; the
// coordinator's checkout never has it.
//
// A MODULE OF ITS OWN AND WITH NO DEPENDENCIES, on purpose: it is consumed by
// the two hooks (which are bundled into dist/), ct-next.mjs and
// dispatch-check.mjs. The latter does NOT import state.js, and doing so just
// for one path constant would drag `yaml` into its dependency graph in exchange
// for nothing.
// ============================================================================
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const STATE_REL_PATH = '.agent/STATE.md'
export const SLICE_REL_PATH = '.agent/SLICE.md'

// The two paths a slice's PR can NEVER introduce. It is NOT the whole
// `.agent/`: `conventions-ack.md` lives there and is a record of decisions that
// can legitimately change inside a slice.
export const NEVER_IN_A_SLICE_PR = [STATE_REL_PATH, SLICE_REL_PATH]

/**
 * `rel` is the SAME path as `path`, but relative — and it is not an ornament: it
 * is what the messages have to name. Whoever reads them (an agent, or a person)
 * is INSIDE that directory, so a 90-character absolute carrying the machine's
 * tmpdir does not tell them which file to open better than `.agent/SLICE.md`.
 * It is returned from here instead of letting each hook derive it from `kind`:
 * two derivations are two places where they can diverge, and they are exactly
 * the two hooks that have to say the same thing.
 *
 * @param {string} cwd
 * @returns {{ path: string|null, kind: 'slice'|'coordinator'|'none', rel: string|null }}
 */
export function resolveStatePath(cwd) {
  const slice = join(cwd, SLICE_REL_PATH)
  if (existsSync(slice)) return { path: slice, kind: 'slice', rel: SLICE_REL_PATH }
  const state = join(cwd, STATE_REL_PATH)
  if (existsSync(state)) return { path: state, kind: 'coordinator', rel: STATE_REL_PATH }
  return { path: null, kind: 'none', rel: null }
}

/**
 * Appends `rule` to the content of an exclusion file, exactly once.
 *
 * Idempotent by exact line (compared without the surrounding whitespace), the
 * same criterion as the `.worktrees/` block of ct-init.sh. And it normalises the
 * trailing newline BEFORE concatenating: if the file exists and does not end in
 * `\n`, an append would glue the new rule onto the user's last line and corrupt
 * them both —the previous rule would stop applying and ours would not exist
 * either—. It is the same bug ct-init.sh avoids in the `.gitignore`.
 *
 * @param {string} current
 * @param {string} rule
 * @returns {{ content: string, added: boolean }}
 */
export function excludeContentWith(current, rule) {
  const text = current || ''
  if (text.split('\n').some((l) => l.trim() === rule)) return { content: text, added: false }
  const sep = text === '' || text.endsWith('\n') ? '' : '\n'
  return { content: `${text}${sep}${rule}\n`, added: true }
}
