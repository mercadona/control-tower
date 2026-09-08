// POSIX escaping of a value so it can be used as ONE single argument inside a
// command line that a shell (`sh`, `bash`, …) is going to parse — the case of
// cmux's `--command`, which runs the string through a shell instead of
// receiving it as an already-split argv. `JSON.stringify` is JSON escaping, not
// shell escaping: a `$`, a backtick or a `\` survive inside double quotes and
// the shell interprets them all the same. POSIX single quotes are the only form
// that interprets NOTHING inside (not `$`, not backticks, not `\`, not
// newlines) — the only exception is the single quote itself, which has to be
// closed, escaped, and reopened: `'\''`.
export function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}
