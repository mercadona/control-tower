#!/usr/bin/env node
// ============================================================================
// commit-keyword-guard.js — THE DOOR: A COMMIT DOES NOT RUN OVER AN ISSUE BY
// MENTIONING A CLOSING KEYWORD.
//
// GitHub closes an issue on a closing keyword appearing in ANY commit message
// that reaches the default branch, and quotes do NOT protect. In a real
// repository, a DOCUMENTATION commit whose body mentioned `Closes #451`
// —inside a sentence explaining that the kickoff did not carry it— closed that
// issue. Nobody meant to close anything.
//
// IT IS A DOOR AND NOT A WARNING, on purpose: a check whose result cannot stop
// the next action is decoration. And no legitimate case is lost — the loop's
// contract sends the closure to the PR BODY, never to a commit message.
//
// AND IT IS STILL A DOOR UNDER `--dangerously-skip-permissions`, which is the
// flag ALL dispatched agents start with. The two decisions it emits were
// measured by EFFECT —a `touch CENTINELA.txt` and then the question of whether
// the file exists—, not by exit code, and with the `permission_mode` the hook
// receives written to a file so as not to assume it from the flag:
//   `deny` (governed repo)      the sentinel was not created  — F27, spec §2.2
//   `ask`  (could not look)     the sentinel was not created  — F28, `bypassPermissions`
// The control —the same set-up with no hook at all— DOES create the file, so
// the absence measures the block and not a model that never tried. The
// escalation to `ask` is what holds up the claim that this door never degrades
// into silence, and that property is measured, not assumed.
//
// What those two measurements do NOT say: whether the door COVERS a dispatched
// agent still depends on the plugin being installed under the account that
// agent starts with (`resolveAccount`, scripts/dispatch.js). And they were
// measured under `-p`, with no human to ask, so the `ask` resolved by
// BLOCKING; in an interactive session what to expect is that it asks and stays
// stopped. Both things are «not silence»; they are not the same thing.
//
// THE EVALUATION ORDER OF `decide` IS NOT COSMETIC. This hook runs on EVERY
// Bash command of EVERY session with the plugin loaded. The first two
// questions are pure parsing, without a single read from disk; only the
// command that already turned out to be a commit WITH a keyword pays the I/O
// of finding out whether the repository is governed. `decide` is a PURE
// function that does not touch disk by itself — the only possible I/O is
// whatever the `probe` it receives does, and it is only called at that third
// step — precisely so that this property can be measured without file
// permission tricks: a spy `probe` that counts its invocations is enough.
//
// WHAT IT DOES NOT SEE, and the principle the whole list comes out of: this
// hook hooks into the `Bash` tool, so it covers what CLAUDE executes and never
// what the human types. Not in their terminal, and not with the `!` prefix of
// Claude's own session — a `!` never reaches the tool, so no `PreToolUse` sees
// it. Measured in a governed repository with the SAME message: `deny` from the
// `Bash` tool, clean with `!`. That asymmetry matters more than it looks,
// because the commit that gave rise to this door was launched by the
// COORDINATOR, and `!` is precisely their most comfortable route.
//
// And within what Claude does execute, it also does not see: a `git commit`
// without `-m` (it opens the editor), a `-F <file>`, an `--amend --no-edit`,
// `eval "..."`, `bash -c "..."` and a subshell `( ... )`. Nor a WRAPPED
// invocation where `git` stops being the first token — `sudo git commit`,
// `env FOO=1 git commit`, `command git commit` — because then step (1) does
// not even recognise the `git commit` behind it.
//
// WITH `-C <path>` OR `cd <path> && git commit` THERE IS NO BLINDNESS, THERE
// IS A WRONG REPOSITORY: step (3) judges the repository of the SESSION's
// `cwd`, never the one `<path>` points at, and that cuts both ways — measured
// in both directions. With the session inside a governed repository and
// `<path>` pointing at one that is not, an excess `deny` over a commit that is
// none of its business. With the session outside every governed repository and
// `<path>` pointing at one that is governed, no protection at all over the
// commit that was its business.
//
// What it DOES see, and must not be confused with the above: closing-keywords.js
// does not interpret `$(...)` or backticks, it only copies characters — so a
// message built with `-m "$MSG"` (variable expansion) or
// `-m "$(cat file)"` (content on disk) is invisible, BUT the heredoc quoted
// inside the `-m`'s own quotes —
// `-m "$(cat <<'EOF' ... EOF)"`, Claude Code's default multiline form— travels
// whole, keyword included, in the same token, and IS seen.
//
// For everything that genuinely escapes, /ct-next's warning about issues closed
// by a stray commit is still there: this catches the CAUSE, that one the
// EFFECT, and neither of the two claims to be complete.
// ============================================================================
import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { extractCommitMessages, findClosingKeywords } from '../scripts/closing-keywords.js'
import { probeGovernedRepo } from '../scripts/governed-repo.js'

/**
 * decide: the whole logic of the door, as a PURE function.
 *
 * It does no I/O by itself, and it does not read ambient state either: the
 * only possible I/O is whatever `probe` does (it receives the `cwd` EXACTLY AS
 * IT ARRIVED in the payload and returns `{governed}` or `{error}`), and
 * `probe` is only invoked at step (3), once the command has already turned out
 * to be a commit WITH a closing keyword. That is the property this door cares
 * about, and because `decide` is pure it can be checked by passing it a spy
 * `probe`, without needing any unreadable directory.
 *
 * Returns `null` when there is no decision to emit, or the hook's complete
 * output object.
 */
export function decide(input, probe) {
  if (input?.hook_event_name !== 'PreToolUse') return null
  if (input?.tool_name !== 'Bash') return null
  const command = input?.tool_input?.command
  if (typeof command !== 'string' || !command) return null

  // (1) and (2): pure parsing, zero I/O.
  const messages = extractCommitMessages(command)
  if (!messages.length) return null
  const findings = messages.flatMap(findClosingKeywords)
  if (!findings.length) return null

  // (3): the only read from disk, and only for a command that is already
  // dangerous. `input.cwd` travels AS IS, without substituting the hook
  // PROCESS's cwd when it is missing: that would answer about a directory the
  // caller never named, and `probeGovernedRepo` already knows how to turn an
  // absent/null/empty cwd into `{error}` instead of inventing an answer.
  const probeResult = probe(input.cwd)

  const output = (permissionDecision, permissionDecisionReason) => ({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason },
  })

  const cited = findings.map((h) => `\`${h.keyword} ${h.ref}\``).join(', ')

  if (probeResult.error) {
    return output('ask', `This commit message carries ${cited}, and it could NOT be checked whether the Control Tower loop governs the issues of this repo: ${probeResult.error}. If it does, that commit will close ${findings.length > 1 ? 'those issues' : 'that issue'} when it reaches the default branch, without anyone reviewing or merging anything. You decide: reword the sentence so that it does not carry the literal string, or carry on if you know this repo is not governed.`)
  }

  if (!probeResult.governed) return null

  return output(
    'deny',
    `This commit message carries ${cited}. GitHub applies the closing keywords of ANY commit message that reaches the default branch, and QUOTES DO NOT PROTECT: a documentation commit that only MENTIONED the string closed the issue in a real repo. In this repo the Control Tower loop governs the issues, so closing it like that would give it up as delivered without anybody having reviewed or merged anything, and would release its dependencies over work that may not exist.\n\n` +
    `The slice's closing goes in the BODY OF THE PR, not in the commit message.\n\n` +
    `What to do: reword the sentence without the literal string (for example «the kickoff does not carry the closing keyword» instead of naming it). If you really do want to close the issue, make it explicit: \`gh issue close <n> --reason completed\`.`,
  )
}

// The executable body only runs when the file is invoked as a script
// (`node hooks/commit-keyword-guard.js`), not when a test imports `decide`: a
// `readFileSync(0, ...)` without a real stdin would block the module from
// loading.
//
// `realpathSync` is NOT cosmetic: `process.argv[1]` keeps the path EXACTLY AS
// IT WAS INVOKED, whereas `import.meta.url` arrives with symlinks ALREADY
// RESOLVED. Without resolving `argv[1]` too, invoking this hook through a
// directory symlink (or with the file itself being a symlink) makes the
// comparison fail wide open: the body does not run, `exit 0`, empty `stdout` —
// indistinguishable from «there was nothing to deny». The
// `process.argv[1] &&` guard is not defensive excess: under `node -e` that
// value is `undefined`, and `realpathSync(undefined)` would throw instead of,
// simply, not running the body.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // A stdin that is not JSON does not even allow knowing which command it is.
  // Exiting in silence is the only honest thing: blocking every Bash over a
  // parse failure would leave the session useless for a reason that is not
  // this door's.
  let input
  try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }

  const result = decide(input, probeGovernedRepo)
  // The `exit` waits for `write`'s callback: without it, a large message can
  // be left half written into a pipe (a pipe's default buffer is around 64 KB)
  // and the host receives a truncated JSON that it discards instead of a
  // `deny` — the very silence this door exists to prevent.
  if (result) process.stdout.write(JSON.stringify(result), () => process.exit(0))
  else process.exit(0)
}
