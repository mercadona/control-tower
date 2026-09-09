// ============================================================================
// closing-keywords.js — IS THIS COMMAND GOING TO PUT A CLOSING KEYWORD INTO A
// COMMIT MESSAGE?
//
// A PURE module: it does not read disk, does not launch processes, does not
// touch the network. Everything it needs travels in the command's string.
//
// It exists because GitHub closes an issue with a closing keyword that appears
// in ANY commit message reaching the default branch, and quotes do NOT protect:
// in a real repo, a documentation commit whose body MENTIONED the string
// `Closes #451` —inside a sentence explaining that the kickoff did not carry
// it— closed that issue.
//
// THIS MODULE'S EXPENSIVE RISK IS NOT DETECTING TOO LITTLE: IT IS DETECTING TOO
// MUCH. The loop's contract orders the closure to be put in the PR's BODY, so a
// detector that looked at the whole command would block `gh pr create --body
// "Closes #42"` — that is, it would turn the guardrail into a brick laid across
// the happy path. Hence the first thing this module does is CUT the command
// into independent sub-commands.
// ============================================================================

/**
 * tokenizeSegments: the shell line → an array of tokens for each independent
 * sub-command.
 *
 * It cuts on `&&`, `||`, `;`, `|`, `&` and newline. The cut is the function's
 * whole reason for being: without it, `git commit -m x && gh pr create --body y`
 * would be a single command and the `--body` would contaminate the commit's
 * record.
 *
 * It understands single quotes (nothing is interpreted inside), double quotes
 * (with escapes) and `\` outside quotes. What it deliberately does NOT
 * understand, because it is not needed to decide and would complicate the
 * module: command substitution (`$(…)`, backticks), subshells `( )`, variable
 * expansion and redirections — none of those characters gets special treatment,
 * they are copied as they are into the current token, like any other character.
 *
 * THE REAL PROPERTY, and why it is not the same as "it does not see command
 * substitution": this module resolves nothing, it only copies characters — so
 * it sees EVERYTHING that travels literally in the line, whether or not it is
 * inside a `$(…)`, and it does NOT see anything that does not travel there.
 * Claude Code's default form for a multiline message is
 * `-m "$(cat <<'EOF' ... EOF)"`, with the quoted heredoc INSIDE the `-m`'s own
 * double quotes: its whole body —the real text of the commit, keyword included
 * if it carries one— is part of the same token, and it IS seen. What really is
 * not seen is what is not here at all: a variable expansion (`-m "$MSG"`, the
 * value lives in the environment) or a `-m "$(cat fichero)"` whose content is
 * on disk. A future refactor that "simplifies" by treating any `$(…)` as a
 * blind spot would silently erase exactly the coverage of the case that
 * motivated this gate.
 */
export function tokenizeSegments(command) {
  const src = typeof command === 'string' ? command : ''
  const segments = []
  let tokens = []
  let cur = ''
  // `has` tells "quoted empty token" apart from "there is no token in
  // progress": without it, `-m ""` would lose its argument and the commit would
  // look as if it carried no message.
  let has = false
  const pushTok = () => { if (has) { tokens.push(cur); cur = ''; has = false } }
  const pushSeg = () => { pushTok(); if (tokens.length) segments.push(tokens); tokens = [] }

  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') { cur += src[i + 1] ?? ''; has = true; i += 2; continue }
    if (c === "'") {
      const end = src.indexOf("'", i + 1)
      // Unclosed quote: the rest is consumed instead of throwing. A malformed
      // command is not this module's business, and blowing up here would leave
      // the hook with no decision for a reason that is not its own.
      if (end === -1) { cur += src.slice(i + 1); has = true; break }
      cur += src.slice(i + 1, end); has = true; i = end + 1; continue
    }
    if (c === '"') {
      i++
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) { cur += src[i + 1]; i += 2; continue }
        cur += src[i]; i++
      }
      has = true; i++; continue
    }
    if (c === ' ' || c === '\t') { pushTok(); i++; continue }
    if (c === '\n' || c === ';') { pushSeg(); i++; continue }
    if (c === '&' || c === '|') { pushSeg(); i += src[i + 1] === c ? 2 : 1; continue }
    cur += c; has = true; i++
  }
  pushSeg()
  return segments
}

// GLOBAL git options (the ones that go BEFORE the subcommand) that consume the
// next token. Without this list, `git -C /tmp/repo commit -m x` would read
// `/tmp/repo` as the subcommand and the commit would go through unrecorded.
const GIT_GLOBAL_TAKES_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

const isGitBinary = (tok) => tok === 'git' || tok.endsWith('/git')

// Letters that, inside a single-dash cluster, eat EVERYTHING left behind them
// as their own value (mandatory or optional-attached): no later letter —not
// even an `m`— belongs to another option any more.
const CLUSTER_CONSUMES_REST = new Set(['F', 'C', 'c', 't', 'S', 'u'])

/**
 * messagesFromSegment: the messages of ONE sub-command, or `[]` if that
 * sub-command is not a `git commit` with an inline message.
 *
 * What it does NOT return, and deliberately so: a `git commit` with no `-m` (it
 * opens `$EDITOR`), a `-F <fichero>` (the text is on disk) and an `--amend
 * --no-edit` (it reuses a message that does not travel in the command). In
 * those three the message is not here, so asserting anything about it would be
 * inventing it.
 */
function messagesFromSegment(tokens) {
  if (!tokens.length || !isGitBinary(tokens[0])) return []
  let i = 1
  while (i < tokens.length && tokens[i].startsWith('-')) {
    const t = tokens[i]
    if (t.includes('=')) { i += 1; continue }
    i += GIT_GLOBAL_TAKES_VALUE.has(t) ? 2 : 1
  }
  if (tokens[i] !== 'commit') return []
  i += 1

  const out = []
  for (; i < tokens.length; i++) {
    const t = tokens[i]
    // Everything behind `--` is pathspec, never a message.
    if (t === '--') break
    if (t === '--message') { if (i + 1 < tokens.length) out.push(tokens[++i]); continue }
    if (t.startsWith('--message=')) { out.push(t.slice('--message='.length)); continue }
    // A SINGLE-dash cluster (getopt, which is what git uses): several short
    // flags stuck together like `-am`. It is walked character by character
    // because a flag before the `m` can eat the rest of the cluster as ITS own
    // value — `-Fmensaje.txt` has no message: the `F` eats `mensaje.txt`
    // whole, and the `m` a blind search would turn up is only the first letter
    // of that filename, not a message. When in doubt, do not extract: a false
    // negative here is covered by another detector of the plugin; a false
    // positive blocks legitimate work.
    if (t.startsWith('-') && !t.startsWith('--')) {
      const cluster = t.slice(1)
      let valor = null
      for (let j = 0; j < cluster.length; j++) {
        const ch = cluster[j]
        if (ch === 'm') {
          const pegado = cluster.slice(j + 1)
          valor = pegado.length > 0 ? pegado : (i + 1 < tokens.length ? tokens[++i] : null)
          break
        }
        if (CLUSTER_CONSUMES_REST.has(ch)) break // the rest is somebody else's value, not a message
        // any other letter is a boolean flag: keep looking
      }
      if (valor !== null) out.push(valor)
      continue
    }
  }
  return out
}

/**
 * extractCommitMessages: out of a whole shell line, ONLY the pieces that are
 * going to end up as a commit message. Everything else in the command
 * —including the `--body` of a `gh pr create`, which the loop's contract
 * DEMANDS carry the closure— is left out by construction.
 */
export function extractCommitMessages(command) {
  return tokenizeSegments(command).flatMap(messagesFromSegment)
}

// The closing keywords GitHub recognises, verbatim from its documentation. No
// form that is not there is added: one keyword too many here is a block on a
// legitimate commit.
export const CLOSING_KEYWORDS = [
  'close', 'closes', 'closed',
  'fix', 'fixes', 'fixed',
  'resolve', 'resolves', 'resolved',
]

// `\b` on both sides: without it, `prefix #42` and `foreclosed #42` would
// fire. The colon is optional because GitHub accepts `Closes: #10` just as it
// accepts `Closes #10`. The reference is `#N` or `owner/repo#N`.
//
// The spacing between the keyword and the reference is BOUNDED to 10 characters
// on each side of the optional `:`, and that is not cosmetic: two unbounded
// `\s*`, separated by a `:?` that may or may not consume anything, leave the
// regex engine free to split ANY amount of whitespace between the two groups in
// different ways, and when in the end there is no reference to match it tries
// all of those ways before giving up — quadratic in the number of spaces.
// Measured: `closes` followed by 120,000 spaces takes more than 10 s, exceeds
// the hook's `timeout: 5`, and the hook dies with no decision — the gate
// switches itself off in silence, exactly the failure mode this branch exists
// to fight. The bound is asymmetric and has to be read as it literally is, not
// as "20 spaces of slack between keyword and reference": it is 10 characters ON
// EACH SIDE of the `:` as it actually appears in the text, not 20 to be spread
// wherever it suits. With no colon, the engine can indeed spread those 20
// between the two groups by backtracking; with a colon, the real position of
// the `:` fixes how many go to each side and neither group can borrow from the
// other — `Closes:` followed by 11 spaces and `#10` no longer matches, while 20
// consecutive spaces WITHOUT a colon does. That combination does not appear in
// a real commit message (`Closes #10`, `Closes: #10`), but the bound itself is
// not "any real spacing passes"; it is the figure above, measured per side and
// not on the total.
const CLOSING_RE = new RegExp(
  String.raw`\b(${CLOSING_KEYWORDS.join('|')})\b\s{0,10}:?\s{0,10}(#\d+|[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#\d+)`,
  'gi',
)

/**
 * findClosingKeywords: the (keyword, reference) pairs GitHub would read as an
 * order to close.
 *
 * It returns the keyword AS IT IS WRITTEN, not normalised: the gate's message
 * quotes the user's text, and «CLOSES» quoted as «closes» reads as if the
 * warning were talking about something else.
 */
export function findClosingKeywords(text) {
  const src = typeof text === 'string' ? text : ''
  const out = []
  for (const m of src.matchAll(CLOSING_RE)) out.push({ keyword: m[1], ref: m[2] })
  return out
}
