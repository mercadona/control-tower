// ============================================================================
// F19/H1 — THE LAUNCH SENTINEL: THE ONLY PROOF THAT THE COMMAND RAN.
//
// THE FIELD FINDING (the loop's first real dispatch against production).
// `/ct-next --cap 1` exited 0, said «lanzados 1/1» and added «verificado: la
// sesión cmux está corriendo en ese directorio». The agent NEVER started. What
// was in that session's terminal:
//
//     [oh-my-zsh] Would you like to update? [Y/n] laude --dangerously-skip-…
//     zsh: command not found: laude
//
// The interactive shell printed oh-my-zsh's update prompt WHILE the command
// was arriving, its single-character `read` ate the `c`, and `claude` went in
// as `laude`. What was left was an idle shell, in the right directory, with
// the right title. Measured consequence: the issue sat at
// `status:in-progress` for twenty minutes claimed by nobody, holding on to its
// `area:` and the whole repo's serialising `pbxproj` lane; zero commits on the
// branch, zero PRs.
//
// WHY THE PREVIOUS VERIFICATION COULD NOT SEE IT. `verifyCmuxLaunch`
// (ct-next.mjs) checks that a cmux session EXISTS with the requested title and
// in the requested cwd. It did exist: the window is created by `cmux
// new-workspace`, which is the very same act that sends the command. What was
// being checked was the CONTAINER —a window the dispatcher itself had just
// opened— instead of the CONTENT —that the command got to run at all—. It is
// the same defect D5 fixed one level up (`launchedCount` counted the
// unverified as a success), reappearing one level down. The second layer of
// the deception, the one that fooled the humans too: the worktree's
// `.agent/STATE.md` showed up MODIFIED and was read as «the agent is working»
// — it was the dispatcher's own seed. The tool's own trace taken as proof of
// the effect.
//
// WHY IT HAPPENS, with evidence and not by supposition. The help text that the
// cmux binary installed on this machine carries embedded says, for
// `new-workspace` (read with `strings`, without running cmux):
//
//     --command <text>     Send text+Enter to the new workspace after creation
//
// `--command` is NOT an exec: they are KEYSTROKES sent to the freshly created
// pty. They travel towards an interactive login shell whose start-up may print
// prompts, ask for confirmations and consume input. Any `read` running in the
// user's rc while the text arrives eats part of the command — exactly what was
// observed. There is no way at all for the sender to know that happened:
// `new-workspace` returned 0 long before.
//
// WHAT IS DONE INSTEAD OF SUPPOSING. Two changes, and the split between them
// is deliberate:
//
//  1. THE SURFACE IS REDUCED. What gets typed stops being the whole `claude`
//     line with the full kickoff inside it (several KB of keystrokes) and
//     becomes ONE short line that does a `source` of a script this file
//     generates. The kickoff travels by disk, written by `writeFileSync`,
//     where no prompt can bite it. This does not remove the race with the rc —
//     nothing that gets typed can — but it takes everything but ~70 characters
//     out of the line of fire.
//
//     It does NOT switch to a non-interactive shell (`zsh -f -c`, `/bin/sh`),
//     and that is a decision, not an omission: `claude` may be an alias or a
//     function defined in the user's rc (ct-next.mjs already says so when it
//     looks it up on the PATH), and a shell with no rc would not find it.
//     `source` runs INSIDE the shell cmux opened, so the user's aliases,
//     functions and PATH keep holding exactly as they did before this change.
//
//  2. AN EFFECT IS OBSERVED, NOT A WINDOW. The FIRST thing the script does is
//     write a sentinel: a file that can only exist if the command really ran.
//     If the head of the line gets corrupted (the case that was lived), the
//     `source` does not run, the script does not run, and the sentinel does
//     NOT appear. The sentinel also carries two data that cannot be obtained
//     from outside:
//       - the REAL `$PWD` of the shell that is going to launch the agent (not
//         the one cmux says the window has);
//       - whether `claude` resolves IN THAT shell (`command -v`), which is the
//         only way to know: the PATH of the process running ct-next.mjs is not
//         that of the login shell cmux opens, and until now that could only be
//         warned about as «no concluyente».
//
// WHAT THIS SENTINEL DOES NOT PROVE, said here so that nobody reads more into
// it: it does not prove the agent is doing anything useful, nor that it is
// still alive a minute later. It proves the command ran, in which directory,
// and that the binary existed. It is a jump from «there is a window open» to
// «the order arrived and ran», not a jump to «the work is under way».
//
// This file is PURE logic (build text, parse text) on purpose: the IO and the
// waiting live in ct-next.mjs, and that way the sentinel's format can be
// attacked in a unit test without launching anything.
// ============================================================================

// Magic and format version. They go INSIDE the file and are not implicit in
// its name because the file is written by a foreign shell: if the script ever
// changes, an old sentinel lying around in /tmp has to be able to recognise
// itself as old instead of being mis-parsed in silence.
export const SENTINEL_MAGIC = 'ct-next-launch'
export const SENTINEL_FORMAT_VERSION = '1'

// Names inside each slice's start-up directory. Two files and not one: we
// write the script, the shell writes the sentinel — confusing them would be,
// once again, taking our own trace for somebody else's evidence.
export const LAUNCHER_FILENAME = 'launch.sh'
export const SENTINEL_FILENAME = 'started'

// buildTypedCommand: the ONLY thing that gets typed into the pty. `.` and not
// `source`: `source` is a bash/zsh builtin, `.` is POSIX and works in both —
// and the user's login shell may be either of them.
export function buildTypedCommand(launcherPath, shQuote) {
  return `. ${shQuote(launcherPath)}`
}

// buildLauncherScript: the script that gets sourced. The order of the lines IS
// the design:
//
//   1. resolve `claude` BEFORE writing anything (if the sentinel were written
//      first, it could not carry the datum);
//   2. write the sentinel — in a single `printf` call, not several, so that it
//      cannot be left half-written;
//   3. and only then launch the agent.
//
// The sentinel is written BEFORE `claude` on purpose: if it were written
// afterwards, it would only appear once the agent FINISHED, which is precisely
// what cannot be waited for. What is being proven is that the order ran, not
// that the agent got to the end.
//
// `$PWD` is the LAST field because it is the only one that can contain a tab
// (a pathological path, but a possible one): that way the parser can gather
// everything that comes after the third tab without splitting it.
//
// ===========================================================================
// F20/H1 — THE IDEMPOTENCE GUARD, AND WHY IT IS THE PIECE THAT HOLDS UP
// EVERYTHING ELSE.
//
// F20 measured, against the cmux installed on this machine, what F19 could
// only reason about: `--command` types, `--layout` with a `command` surface
// ALSO types (measured: the text comes out ECHOED in that very session's
// prompt, and the process hangs off a login `-/bin/zsh`; and on top of that
// `--cwd` is ignored in that mode), and there is no exec route at all in that
// version. Which is to say: the typing cannot be taken away, so it has to be
// possible to REPEAT it.
//
// Repeating the typing without a guard would be worse than the problem: two
// lines that DO arrive start TWO agents on the same worktree. The guard makes
// the second sourcing an observable no-op — and it can, because the sentinel
// is written BEFORE launching the agent: if it exists, the agent already
// started (or is starting) and there is nothing to repeat.
//
// The case this really covers, and which was reproduced in the laboratory: the
// first typing arrives late (a slow shell) and the dispatcher has already
// resent the line. Both arrive. Without a guard: two `claude`. With a guard:
// one.
//
// `[ -e ]` and not `[ -f ]`: what matters is that the path is occupied, not
// what type it is. A `-f` would let the relaunch through if somebody put a
// directory or a broken symlink there.
// ===========================================================================
//
// F29 — `agentBin` is NOT cosmetic, and that is why it is mandatory instead of
// having a default: it is what gets checked with `command -v`, and that datum
// decides, up there in ct-next.mjs, whether the worktree and the claim are
// UNDONE (`no-claude` → cleanupOrphanedWorktree). Checking `claude` while what
// gets typed is `claude-personal` would give the verdict on the wrong binary
// in both directions: an `ok` that precedes a «command not found», or a
// worktree deleted over a binary that was not the one about to be used.
export function buildLauncherScript({ sentinelPath, agentCommand, agentBin, issue, worktree }, shQuote) {
  const q = shQuote
  if (!agentBin) throw new Error('buildLauncherScript: falta agentBin — es el nombre que se comprueba con `command -v` dentro del shell de login, y de su resultado depende que ct-next.mjs deshaga o no el worktree y el claim')
  return `#!/bin/sh
# Generated by /ct-next (control-tower-loop plugin) for issue #${issue}.
# DO NOT edit it: it is rewritten on every dispatch. See scripts/launch-sentinel.js.
#
# This script is SOURCED in the login shell cmux opens (it never runs as a
# subprocess), so that the user's aliases, functions and PATH —which is where
# \`${agentBin}\` itself may come from— keep holding.
#
# It can be sourced MORE THAN ONCE: /ct-next resends the line if the sentinel
# does not show up (the pty can eat it). The guard below makes only the first
# sourcing that arrives launch the agent.
#
# Expected worktree: ${worktree}
if [ -e ${q(sentinelPath)} ]; then
  printf '%s\\n' 'ct-next: el agente de #${issue} ya arrancó (centinela presente); este sourceo NO relanza nada.'
else
  if command -v ${agentBin} >/dev/null 2>&1; then ct_next_claude=ok; else ct_next_claude=missing; fi
  printf '%s\\t%s\\t%s\\t%s\\n' ${q(SENTINEL_MAGIC)} ${q(SENTINEL_FORMAT_VERSION)} "$ct_next_claude" "$PWD" > ${q(sentinelPath)}
  unset ct_next_claude
${agentCommand}
fi
`
}

// parseSentinel: `null` if the content is not a sentinel of this format (a
// half-written file, a future version, garbage) — it is never guessed. An
// unreadable sentinel is NOT an absent sentinel and the caller has to be able
// to tell the two apart, so the `null` travels accompanied by the raw text
// from ct-next.mjs.
export function parseSentinel(text) {
  const line = String(text ?? '').split('\n').find((l) => l.trim().length > 0)
  if (!line) return null
  const parts = line.replace(/\r$/, '').split('\t')
  if (parts.length < 4) return null
  const [magic, version, claude] = parts
  if (magic !== SENTINEL_MAGIC) return null
  if (version !== SENTINEL_FORMAT_VERSION) return null
  if (claude !== 'ok' && claude !== 'missing') return null
  // The rest (whether it carries tabs or not) is the path.
  const cwd = parts.slice(3).join('\t')
  if (!cwd) return null
  return { version, claudeResolved: claude === 'ok', cwd }
}

// sameDir: a directory comparison TOLERANT of symlinks, and why that matters:
// on macOS `/tmp` is a symlink to `/private/tmp` and `$TMPDIR` hangs off
// `/var/folders/…` (which is `/private/var/folders/…`). The shell sets `$PWD`
// to the LOGICAL path it came in by, so comparing plain strings would declare
// «directorio equivocado» on perfectly correct dispatches — exactly the false
// alarm D5 fixed for cmux's `current_directory` field, and one we are not
// going to reintroduce through the side door.
//
// `realpathOf` is injected (instead of importing `node:fs` here) so that this
// file stays pure and testable without disk.
export function sameDir(a, b, realpathOf) {
  if (a === b) return true
  if (!a || !b) return false
  const ra = realpathOf(a)
  const rb = realpathOf(b)
  if (ra === null || rb === null) return false
  return ra === rb
}
