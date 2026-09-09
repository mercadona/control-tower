// ============================================================================
// PLAN-TASKS — the prescriptive plan read as an EXECUTABLE TASK LIST.
//
// `plan-contract.js` already says whether a plan is a plan: that the nine
// sections are there, that the tasks are numbered without gaps, that each one
// carries its five markers and that the code it quotes exists verbatim. What it
// does not say is what has to be EXECUTED to know whether a task came out green
// — and that is exactly what a conductor that does not reason needs from the
// plan.
//
// This module extracts, per task: the commands of its **Verification:**, the
// test names the task ADDS and the ones it REMOVES on purpose, the paths of
// **Files:**, the name of the test its **TDD:** declares, the path of every
// block carrying a role label and the literal text of its `Final text` blocks.
// With that, the program measures the task without asking the implementer
// whether it went well.
//
// PURE on purpose, like `plan-contract.js`: the markdown goes in, the list
// comes out. Not one import.
//
// ---------------------------------------------------------------------------
// WHAT THIS PARSER HAS MEASURED (and why validating it against the template is
// no good)
//
// Everything below came out of a REAL plan —the one of slice #5 of repo-pulse,
// 534 lines, 8 tasks, `__tests__/fixtures/plan-real-issue-5.md`— and not one of
// the three traps appears in `plan-template.md`. A parser validated against the
// template goes green and then breaks with the first real plan.
//
// 1. THE COMMANDS GO IN THE FENCED BLOCK, NOT ON THE LINE. On the line they
//    arrive mixed with prose ("→ exit 0.", "y después:", a `wc -l AGENTS.md`
//    inside an explanatory parenthesis) and there is no honest way to separate
//    the command from the comment. And it has to be the block IMMEDIATELY
//    after, not any block of the task: real tasks carry their own `Contract
//    (path):` and `Current state (path):` blocks, which are quoted code, not
//    commands.
//
//    The **Verification:** paragraph can span several lines (task 8 of the real
//    plan spans two) and can carry inline text BEFORE the block (task 1 says
//    "`npm install` y después:"). Both forms are accepted: what is looked at is
//    the first fence that opens after the paragraph.
//
// 2. PARENTHESES ARE SWEPT BY DEPTH. Test names live between single quotes,
//    sometimes wrapped in backticks, and carry explanatory parentheses behind
//    them that CONTAIN parentheses:
//
//      'a zero series sits on the baseline' (polylinePoints([0, 0], 1) es
//      '0.0,199.0 600.0,199.0')
//
//    A single-level sweep (/\([^()]*\)/g) does not match that parenthesis, so
//    `0.0,199.0 600.0,199.0` sneaks in as a test name, appears in no file and
//    BLOCKS THE TASK WITH A FALSE POSITIVE. With a sweep by depth, the eight
//    **Tests:** lines of the real plan extract their names and not one more.
//
// 3. THE REMOVAL MARKER HAS THREE FORMS: "removed on purpose:" (the template,
//    in English), "retira a propósito" and a bare "retira". Demanding the long
//    form leaves the task that uses the short one unsplit and puts its removed
//    test into the list of the ones that MUST EXIST: exactly the opposite of
//    what is right.
// ============================================================================

const TASK_HEADING = /^### Task (\d+) — (.*)$/
const VERIFICATION = '**Verification:**'
const TESTS = '**Tests:**'
const FILES = '**Files:**'
const TDD = '**TDD:**'

// Any other task marker cuts the paragraph: if after **Verification:** comes
// **Objective:** instead of a block, then there is no block, and saying so is
// better than going on searching to the end of the file.
const OTHER_MARKERS = ['**Objective:**', FILES, TDD, TESTS]

// The three forms of §2.5. The order matters: "retira a propósito" before
// "retira", or the short one eats the long one and splits in the wrong place.
const REMOVAL_MARKERS = ['removed on purpose:', 'retira a propósito', 'retira']

// Same fence parsing as `plan-contract.js`: a fence opens and closes with a
// line that STARTS with three backticks. It is repeated here and not imported
// because this module does not depend on that one and the duplication is eight
// lines.
function annotate(markdown) {
  const out = []
  let inFence = false
  for (const line of String(markdown).split('\n')) {
    if (line.startsWith('```')) {
      out.push({ line, structural: false, fence: true, opens: !inFence })
      inFence = !inFence
      continue
    }
    out.push({ line, structural: !inFence, fence: false, opens: false })
  }
  return out
}

// The sweep of trap 2. It walks character by character counting depth instead
// of applying a regular expression, because a regular expression without
// recursion cannot count parentheses.
export function stripParenthesised(text) {
  let depth = 0
  let out = ''
  for (const ch of String(text)) {
    if (ch === '(') { depth++; continue }
    if (ch === ')') { if (depth > 0) depth--; continue }
    if (depth === 0) out += ch
  }
  return out
}

// Test names are what goes between single quotes once the parentheses have been
// swept. The backticks are dropped: they wrap both test names
// (`'lists the clones'`) and code identifiers (`window=all`), so they
// distinguish nothing and do get in the way.
function quotedNames(text) {
  const stripped = stripParenthesised(text).replace(/`/g, '')
  const names = []
  const re = /'([^']+)'/g
  let m
  while ((m = re.exec(stripped)) !== null) {
    const name = m[1].trim()
    if (name) names.push(name)
  }
  return names
}

// Splits the **Tests:** line into what the task adds and what it removes. With
// no removal marker, everything is an addition.
function splitTests(text) {
  const lower = text.toLowerCase()
  let cut = -1
  let marker = ''
  for (const m of REMOVAL_MARKERS) {
    const at = lower.indexOf(m)
    if (at !== -1 && (cut === -1 || at < cut)) { cut = at; marker = m }
  }
  if (cut === -1) return { added: quotedNames(text), removed: [] }
  return {
    added: quotedNames(text.slice(0, cut)),
    removed: quotedNames(text.slice(cut + marker.length)),
  }
}

// The only two actions the rest of the program knows how to interpret
// (`declaredScope`, in ct-step.mjs, only has branches for these). Just like
// "a path with no declared action is not checked against git, and that is not a
// problem of the plan", an action that is neither of the two is not one either:
// better to check nothing than to check with a value nobody declared.
const KNOWN_ACTIONS = ['create', 'modify']

// Splits the **Files:** paragraph into the paths it declares, with their
// action. Real format, measured in the plan of slice #5:
//   **Files:** `web/package.json` (modify), `web/src/testing/setup.ts` (create)
// The backticks are dropped; the action is optional (a path with no parenthesis
// behind it is left with action: null), and anything that is neither "create"
// nor "modify" is also left as null instead of sneaking through as it is.
export function splitFiles(text) {
  const paths = []
  const re = /`([^`]+)`(?:\s*\(([^)]+)\))?/g
  let m
  while ((m = re.exec(text)) !== null) {
    const path = m[1].trim()
    if (!path) continue
    const raw = m[2] ? m[2].trim() : null
    const action = KNOWN_ACTIONS.includes(raw) ? raw : null
    paths.push({ path, action })
  }
  return paths
}

// The four role labels of a block of the plan, with their path. Duplicated
// from `plan-contract.js` (constant `ROLE_LABELS`), for the same reason as
// `annotate`: this module does not depend on that one.
export const ROLES = ['Current state', 'Contract', 'Call site', 'Final text']

const ROLE_LABELS = [
  ['Current state', /^Current state \(([^),]+)(?:,[^)]*)?\):\s*$/],
  ['Contract', /^Contract \(([^),]+)(?:,[^)]*)?\):\s*$/],
  ['Call site', /^Call site \(([^),]+)(?:,[^)]*)?\):\s*$/],
  ['Final text', /^Final text \(([^),]+)(?:,[^)]*)?\):\s*$/],
]

function roleOf(line) {
  for (const [role, re] of ROLE_LABELS) {
    const m = re.exec(line)
    if (m) return { role, path: m[1].trim() }
  }
  return null
}

// The body of the fence that follows a line, skipping the blank lines before
// it. It is returned as it is, untrimmed: a `Final text` block is literal
// content, and what has to be checked is precisely what is not touched.
// Duplicated from `plan-contract.js`, for the same reason as `annotate`.
function fenceBodyAfter(lines, from) {
  let i = from
  while (i < lines.length && lines[i].line.trim() === '') i++
  if (i >= lines.length || !lines[i].fence || !lines[i].opens) return null
  const body = []
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].fence) return body.join('\n')
    body.push(lines[j].line)
  }
  return null
}

// The test name of **TDD:** lives THE OTHER WAY ROUND than in **Tests:**: the
// quote is INSIDE the parenthesis of the call —`test('nombre')`—, not outside
// with a clarification behind it. Measured against task 1 of the real plan:
// applying quotedNames to the whole paragraph returns 'jsdom' (the quote of
// `environment: 'jsdom'`, further on in the same paragraph), because the sweep
// by depth eats the real name along with the parentheses of `test(...)`. That
// is why the inside of the first balanced parenthesis of the paragraph is
// isolated first, and ON THAT inside quotedNames does hold — and it is still
// the right sweep if the quoted name were to bring parentheses of its own.
function firstParenBody(text) {
  const start = text.indexOf('(')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) return text.slice(start + 1, i)
    }
  }
  return null
}

// "No TDD — <reason>" is a legitimate declaration: the task carries no
// behaviour to put in red, and declares no test.
const NO_TDD = /^No TDD\b/i

function tddNameOf(text) {
  if (NO_TDD.test(text)) return null
  const body = firstParenBody(text)
  const names = quotedNames(body === null ? text : body)
  return names[0] || null
}

// Joins up the paragraph that starts at `from`: the marker's line and its
// continuations, up to the first blank line, another marker, a fence or a
// heading. Returns the text without the marker and where it stopped.
function paragraphFrom(lines, from, marker) {
  const pieces = [lines[from].line.trim().slice(marker.length).trim()]
  let i = from + 1
  for (; i < lines.length; i++) {
    const l = lines[i]
    const t = l.line.trim()
    if (t === '' || l.fence || t.startsWith('#')) break
    if (OTHER_MARKERS.some((m) => t.startsWith(m)) || t.startsWith(VERIFICATION)) break
    pieces.push(t)
  }
  return { text: pieces.join(' ').trim(), end: i }
}

// The block of commands: the first fence that OPENS after the
// **Verification:** paragraph, skipping blank lines. If anything else at all
// appears before that fence, there is no block — and that is a plan that cannot
// be executed, not a formatting detail.
function commandsAfter(lines, from) {
  let i = from
  while (i < lines.length && lines[i].line.trim() === '') i++
  if (i >= lines.length || !lines[i].fence || !lines[i].opens) return null
  const commands = []
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].fence) return commands
    const t = lines[j].line.trim()
    if (t === '' || t.startsWith('#')) continue
    commands.push(t)
  }
  return null // an unclosed fence: there is no block worth anything
}

// ============================================================================
// THE YARDSTICK HAS TO BE ABLE TO MEASURE WHAT IT SAYS IT MEASURES
//
// `verification-block` closed "the verification is prose". This closes the hole
// right next to it, measured in jjponz/rust-monitoring#10: the verification IS
// an executable command, it lives in its block, and its exit code says the
// OPPOSITE of what its comment says it measures.
//
//   git diff HEAD -- AGENTS.md | grep -c 'ct-init:slices-contract'   # expected: 0
//
// `ct-step controls` scores ONLY by exit code, and `grep -c` exits with 1 when
// it finds nothing and with 0 when it finds something. Which means that check
// could only go green in the BAD case —the protected section touched— and
// failed always in the good one. No implementation could pass it, and even so
// it passed `--check-plan` and it passed the human gate of a human reading 246
// lines in 125 seconds. The comment told the truth; the exit code said the
// opposite, and the exit code is the one that rules.
//
// WHAT THIS RULE DOES NOT DO: read the `# expected:`. That is where it would
// start guessing —the comment is free prose and "exit 0, 1 passed" carries a
// number inside. What it looks at is the LAST STAGE of the pipeline, which is
// what decides `$?`, against a CLOSED list of commands whose exit code is
// demonstrably independent of what the plan claims. Every entry brings its
// evidence and its remedy; nothing else is touched.
//
// AND IT KEEPS QUIET WHEN IT CANNOT PROVE IT: faced with `&&`, `||` or `;` it
// does not pronounce, because then the exit code depends on what got to run. A
// false positive here blocks a correct plan at a gate, which is worse than the
// hole.

// The last stage of the pipeline, without its trailing comment. `null` = it is
// not analysed (there is chaining and the exit code is no longer that of a
// single command).
//
// It respects quotes and `$(...)`: without the second, the very FIX of the
// rust-monitoring check —`test "$(… | grep -c …)" -eq 0`— would read as a
// pipeline ending in `grep -c` and the rule would veto the correction instead
// of the defect.
export function lastPipelineStage(command) {
  let stage = ''
  let quote = null
  let depth = 0
  let piped = false
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) { stage += c; if (c === quote) quote = null; continue }
    if (c === "'" || c === '"' || c === '`') { quote = c; stage += c; continue }
    if (c === '$' && command[i + 1] === '(') { depth++; stage += '$('; i++; continue }
    if (c === ')' && depth > 0) { depth--; stage += c; continue }
    if (depth > 0) { stage += c; continue }
    if (c === '#' && (i === 0 || /\s/.test(command[i - 1]))) break
    if (c === ';') return null
    if (c === '&' && command[i + 1] === '&') return null
    if (c === '|') {
      if (command[i + 1] === '|') return null
      piped = true
      stage = ''
      continue
    }
    stage += c
  }
  return { stage: stage.trim(), piped }
}

// A short flag carrying the letter asked for (`-c`, `-rc`, `-ic`), or its long
// form. `--color` does not count: it starts with two hyphens and is not
// `--count`.
const shortFlagHas = (arg, letter) => /^-[A-Za-z]+$/.test(arg) && arg.includes(letter)

// «This is a `grep -c`» is ONE decision — which programs count matches and
// with which flag —, and it is asked from two places: the rule that rejects a
// bare `grep -c`, and the helper that counts its files. Living in two copies is
// what `conventions/decisions.md` forbids: adding `rg --count-matches` to one
// and not to the other would leave the other one none the wiser.
const isGrepCountInvocation = (words) => /^(grep|egrep|fgrep|rg)$/.test(words[0]) &&
  words.slice(1).some((a) => a === '--count' || shortFlagHas(a, 'c'))

// The closed list. `words` are the words of the last stage.
// THE PREDICATE THAT CANNOT MEASURE BECAUSE `grep -c` CHANGES SHAPE WITH TWO
// FILES. Measured in slice #35 of repo-pulse, which got blocked by this.
//
// `test "$(… | grep -c …)" -eq N` is the form this very vocabulary RECOMMENDS,
// and with a single stream it is correct: `grep -c` prints a number. With TWO
// OR MORE files as arguments it prints `file:count` for each one, so the
// substitution returns several lines, `test` receives a non-integer and exits
// with 2 —«integer expression expected»— whatever the code says. Red always,
// and no implementer can fix it from the code: what is broken is the yardstick.
//
// Why a rule was needed and the `grep -c` one was not enough: that one looks at
// the HEAD of the stage, and as soon as the count is wrapped in `test` the head
// is `test`. Which means the recommended form was also the one that stopped
// being inspected.
//
// IT ERRS TOWARD THE FALSE NEGATIVE BEFORE THE FALSE POSITIVE. A false negative
// lets through a check that will get blocked —which is what happens today—; a
// false positive brings down a valid plan and there is no way for its author to
// fix it. So it only accuses when two operands have been counted with
// certainty: quotes are respected, the argument of `-e`/`--regexp` is consumed,
// and anything it cannot split returns `null` and accuses nobody.
function splitRespectingQuotes(text) {
  const out = []
  let current = ''
  let quote = null
  for (const c of text) {
    if (quote) { current += c; if (c === quote) quote = null; continue }
    if (c === "'" || c === '"') { quote = c; current += c; continue }
    if (/\s/.test(c)) { if (current !== '') { out.push(current); current = '' } continue }
    current += c
  }
  if (current !== '') out.push(current)

  return out
}

// `-e`/`--regexp` is the only flag whose argument IS the pattern: consuming it
// closes `patternTaken` on purpose.
const PATTERN_FLAGS = new Set(['-e', '--regexp'])

// The rest of the flags that take an argument of their own behind them
// contribute neither the pattern nor a file — counting that argument as a file
// is the false positive measured on `-m 1`: without telling it apart from `-e`,
// the «1» of `-m 1` closed `patternTaken` and the real pattern, which came
// right after, was counted as the first file. It is consumed all the same, but
// WITHOUT touching `patternTaken`.
const VALUE_TAKING_FLAGS = new Set(['-m', '--max-count'])

// A shell redirection (`>`, `>>`, `<`, `2>`, `2>&1`…) is not an operand of
// grep — it is what comes AFTER the call. Measured: `grep -c 'x' a.ts
// 2>/dev/null` has a single real file and `2>/dev/null` was sneaking in as the
// second one. As soon as one appears, there is no longer any certainty about
// what follows, so it stops there — coherent with "it only accuses with two
// operands with certainty": here it does not even claim there are not two, it
// just stops counting.
const looksLikeRedirection = (word) => /^\d*&?[<>]/.test(word)

function grepCountFileOperands(stage) {
  const words = splitRespectingQuotes(stage)
  if (!isGrepCountInvocation(words)) return null
  const operands = []
  let patternTaken = false
  for (let i = 1; i < words.length; i++) {
    const w = words[i]
    if (looksLikeRedirection(w)) break
    if (PATTERN_FLAGS.has(w)) { patternTaken = true; i++; continue }
    if (VALUE_TAKING_FLAGS.has(w)) { i++; continue }
    if (w.startsWith('-')) continue
    if (!patternTaken) { patternTaken = true; continue }
    operands.push(w)
  }

  return operands.length
}

// Inside SINGLE quotes the shell expands nothing: `'$(grep -c a b)'` is the
// literal text, those eight characters, not a substitution. Measured: `grep -Fq
// '$(grep -c mark a.ts b.ts)' incidencias.md` is a legitimate grep looking for
// that string, and without this outer sweep it read as a real substitution with
// two files. Inside DOUBLE quotes the shell DOES expand `$(...)`, so there the
// search goes on.
function substitutionsIn(stage) {
  const out = []
  let outerQuote = null
  for (let i = 0; i < stage.length; i++) {
    const c = stage[i]
    if (outerQuote === "'") { if (c === "'") outerQuote = null; continue }
    if (outerQuote === '"') {
      if (c === '"') outerQuote = null
      if (c !== '$' || stage[i + 1] !== '(') continue
    } else if (c === "'" || c === '"') {
      outerQuote = c; continue
    } else if (c !== '$' || stage[i + 1] !== '(') {
      continue
    }
    let depth = 1
    let j = i + 2
    let quote = null
    let inner = ''
    for (; j < stage.length && depth > 0; j++) {
      const cc = stage[j]
      if (quote) { inner += cc; if (cc === quote) quote = null; continue }
      if (cc === "'" || cc === '"') { quote = cc; inner += cc; continue }
      if (cc === '(') depth++
      if (cc === ')') { depth--; if (depth === 0) break }
      inner += cc
    }
    if (depth === 0) out.push(inner)
  }

  return out
}

function countsOverManyFiles(stage) {
  return substitutionsIn(stage).some((inner) => {
    const span = lastPipelineStage(inner)
    if (!span || !span.stage) return false

    return grepCountFileOperands(span.stage) > 1
  })
}

const NOT_A_PREDICATE = [
  {
    matches: (words) => isGrepCountInvocation(words),
    why: '`grep -c` exits with 0 if it finds AT LEAST ONE match and with 1 if it finds none: its exit code never says how many. A check that asserts a count is written as a predicate — `test "$(… | grep -c …)" -eq N` — and then the exit code IS the assertion. (`grep -q`, or a bare `grep`, do hold: there the exit code already is the assertion.)',
  },
  {
    matches: (words, piped, stage) => countsOverManyFiles(stage),
    why: '`grep -c` with two or more files prints `file:count` for each one, so the substitution returns several lines and `test` exits with 2 ("integer expression expected") whatever the code says: the check is red always and no implementer can fix it from the code. With a single file (or with a pipeline) `grep -c` does print a number. For "no occurrence is left in these files" the predicate is `test -z "$(grep -l ... file1 file2)"`, which lists names and whose empty list IS the assertion.',
  },
  {
    matches: (words) => words[0] === 'wc',
    why: '`wc` exits with 0 with twelve lines and with twelve thousand: what the plan asserts is the number, and the number travels on standard output, not through the exit code. Wrap it in a predicate: `test "$(wc -l < file)" -le 150`.',
  },
  {
    matches: (words, piped) => piped && /^(tail|head)$/.test(words[0]),
    why: 'closing a pipeline with `tail` or `head` throws away the exit code of the command that matters and leaves `tail`\'s, which is 0 almost always — `make check 2>&1 | tail -80` exits 0 even though `make check` failed. Leave the command on its own, or capture its code without a pipeline (`cmd > file 2>&1; echo $?`).',
  },
  {
    matches: (words) => words[0] === 'git' && words[1] === 'status',
    why: '`git status` exits with 0 with a dirty tree and with a clean tree, so as a check it measures nothing. For "nothing is left uncommitted" the predicate is `test -z "$(git status --porcelain)"`.',
  },
]

// ============================================================================
// `## 8. Global verification` BELONGS TO THE PROGRAM, NOT TO PROSE (§3.7-A of
// the handoff docs/prompt-juez-lo-que-queda.md).
//
// The plan declares the end-to-end validation for when every task is
// committed, and until this slice no program ran it: `ct-step controls` only
// measures the **Verification:** block OF EACH TASK — zero references to §8 in
// the whole file. It is the same trap of §2.5 that `verification-block` already
// closed for the tasks —prose is not executable— and the same remedy: the
// commands go in a fenced block, with the declarable escape "N/A — <reason>"
// for the slice that genuinely has no end-to-end to run (documentation, pure
// configuration). Demanding a command from that slice would be the impossible
// guard of F14 all over again, only applied to §8.
//
// Unlike the per-task block, here prose IS allowed before AND AFTER the fence:
// §8 also carries the "what to look at" for the `visual` human gate (start the
// servers, open the URL, check three things by eye), and that prose is not the
// object of this rule — only the block of commands is. That is why the search
// for the fence does not demand that it be the first one after the heading (as
// `commandsAfter` does demand for **Verification:**): it walks the whole
// stretch of §8 and keeps the FIRST one that opens.
//
// It reuses `lastPipelineStage` and `NOT_A_PREDICATE`: the yardstick that stops
// a check from measuring backwards is the same for the per-task block and for
// the §8 block — the inverted `grep -c` of rust-monitoring#10 is the same
// defect here as there.
// ============================================================================
const GLOBAL_HEADING = /^## 8\. Global verification\b/
const GLOBAL_NA = /^N\/A\b/i

function extractGlobal(lines, push) {
  const from = lines.findIndex((l) => l.structural && GLOBAL_HEADING.test(l.line))
  if (from === -1) {
    push(0, 'global-verification-block', 'the plan does not declare "## 8. Global verification": an end-to-end validation cannot be run by a program that does not know where to look for it.')
    return { commands: [] }
  }
  let to = lines.findIndex((l, i) => i > from && l.structural && /^## /.test(l.line))
  if (to === -1) to = lines.length
  const body = lines.slice(from + 1, to)

  // The escape: "N/A — <reason>" as the first non-blank line of the stretch
  // declares that this slice has no end-to-end to run, and that is not a
  // problem.
  const firstNonBlank = body.find((l) => l.structural && l.line.trim() !== '')
  if (firstNonBlank && GLOBAL_NA.test(firstNonBlank.line.trim())) return { commands: [] }

  const opensAt = body.findIndex((l) => l.fence && l.opens)
  let commands = null
  if (opensAt !== -1) {
    commands = []
    for (let j = opensAt + 1; j < body.length; j++) {
      if (body[j].fence) break
      const t = body[j].line.trim()
      if (t === '' || t.startsWith('#')) continue
      commands.push(t)
    }
    // An unclosed fence: no block worth anything, just as in `commandsAfter`.
    if (!body.slice(opensAt + 1).some((l) => l.fence)) commands = null
  }

  if (commands === null || commands.length === 0) {
    push(0, 'global-verification-block', 'la "## 8. Global verification" del plan declara la validación de punta a punta en prosa, y un programa no ejecuta prosa. Los comandos van en un bloque cercado bajo "## 8. Global verification", o la línea exacta "N/A — <razón>".')
    return { commands: [] }
  }

  for (const command of commands) {
    const span = lastPipelineStage(command)
    if (!span || !span.stage) continue
    const words = splitRespectingQuotes(span.stage)
    const broken = NOT_A_PREDICATE.find((r) => r.matches(words, span.piped, span.stage))
    if (broken) {
      push(0, 'global-verification-predicate', `la "## 8. Global verification" verifica con \`${command}\`, y su código de salida no puede afirmar lo que el control dice medir: ${broken.why}`)
    }
  }

  return { commands }
}

// ============================================================================
// THE PUBLIC ENTRY POINT
//
// Returns `{ tasks, problems, global }`. `problems` is not empty when the plan
// is not executable, and its presence is what the conductor translates into its
// exit code 6: "fix the plan", which is not the same as "the work is wrong".
// `global` is what has to be executed after the last task is committed
// (§3.7-A): `{ commands }`, empty when §8 declares "N/A" or when the plan does
// not bring it executable (and then there is a `problem` that explains it).
// ============================================================================
export function extractTasks(markdown) {
  const lines = annotate(markdown)
  const problems = []
  const push = (task, rule, detail) => problems.push({ task, rule, detail })

  // The task headings, with the piece of the file that falls to each one.
  const heads = []
  lines.forEach((l, i) => {
    if (!l.structural) return
    const m = TASK_HEADING.exec(l.line)
    if (m) heads.push({ n: Number(m[1]), name: m[2].trim(), at: i })
  })

  const tasks = heads.map((h, k) => {
    const to = k + 1 < heads.length ? heads[k + 1].at : lines.length
    const body = lines.slice(h.at, to)

    let commands = null
    let added = []
    let removed = []
    let testsDeclared = false
    let files = []
    let filesDeclared = false
    let tddDeclared = false
    let tddName = null
    const blockPaths = []
    const finalTexts = []

    body.forEach((l, i) => {
      if (!l.structural) return
      const t = l.line.trim()
      if (t.startsWith(VERIFICATION) && commands === null) {
        const { end } = paragraphFrom(body, i, VERIFICATION)
        commands = commandsAfter(body, end)
      }
      if (t.startsWith(TESTS) && !testsDeclared) {
        testsDeclared = true
        const { text } = paragraphFrom(body, i, TESTS)
        // "N/A — <reason>" is a legitimate declaration: the task adds no
        // behaviour and the existing suite must stay green.
        if (!/^N\/A\b/i.test(text)) {
          const split = splitTests(text)
          added = split.added
          removed = split.removed
        }
      }
      if (t.startsWith(FILES) && !filesDeclared) {
        filesDeclared = true
        const { text } = paragraphFrom(body, i, FILES)
        files = splitFiles(text)
        // There is text and not one path came out: almost always because the
        // paths do not go between backticks, which is the only thing
        // `splitFiles` recognises. Without this warning, `declaredScope`
        // (in ct-step.mjs) sees `files: []` and reports EVERYTHING touched as
        // out of scope, with a message that does not mention the format — it
        // fails on the safe side, but blindly.
        if (text.trim() !== '' && files.length === 0) {
          push(h.n, 'files-line', `task ${h.n} declares "${FILES}" but not one path was extracted: paths go between backticks, for example \`path/to/file.ext\` (create).`)
        }
      }
      if (t.startsWith(TDD) && !tddDeclared) {
        tddDeclared = true
        const { text } = paragraphFrom(body, i, TDD)
        tddName = tddNameOf(text)
      }
      const role = roleOf(l.line)
      if (role) {
        blockPaths.push(role)
        if (role.role === 'Final text') {
          const blockText = fenceBodyAfter(body, i + 1)
          if (blockText !== null) finalTexts.push({ path: role.path, text: blockText })
        }
      }
    })

    if (commands === null) {
      push(h.n, 'verification-block', `la tarea ${h.n} no trae bloque de comandos detrás de "${VERIFICATION}": su verificación es prosa, y un programa no ejecuta prosa.`)
    } else if (commands.length === 0) {
      push(h.n, 'verification-block', `task ${h.n} brings an empty command block behind "${VERIFICATION}".`)
    } else {
      for (const command of commands) {
        const span = lastPipelineStage(command)
        if (!span || !span.stage) continue
        const words = splitRespectingQuotes(span.stage)
        const broken = NOT_A_PREDICATE.find((r) => r.matches(words, span.piped, span.stage))
        if (broken) {
          push(h.n, 'verification-predicate', `la tarea ${h.n} verifica con \`${command}\`, y su código de salida no puede afirmar lo que el control dice medir: ${broken.why}`)
        }
      }
    }
    if (!testsDeclared) {
      push(h.n, 'tests-line', `task ${h.n} does not declare "${TESTS}".`)
    }

    return {
      n: h.n,
      name: h.name,
      commands: commands || [],
      testsAdded: added,
      testsRemoved: removed,
      files,
      tddName,
      blockPaths,
      finalTexts,
    }
  })

  if (!tasks.length) push(0, 'tasks', 'the plan declares no task at all ("### Task N — ...").')

  // The extraction of §8 runs over the COMPLETE `lines`, not over the `cuerpo`
  // of any task: with no tasks following it, the §8 of a real plan falls inside
  // the stretch of the LAST task (which is harmless for the loop above, that
  // only reacts to markers), but here the whole file is needed to find its own
  // "## 8." heading.
  const global = extractGlobal(lines, push)

  return { tasks, problems, global }
}
