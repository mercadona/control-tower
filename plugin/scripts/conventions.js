// Detection of the target repo's OWN conventions on the ground the loop
// occupies (claim, worktrees, state). Pure logic: no IO, no subprocesses —
// the one that reads the disk is scripts/conventions-io.js (used by
// scripts/detect-conventions.mjs and by ct-next.mjs).
//
// THE REAL CASE (F11, part B). In an already bootstrapped repo (menoplus),
// BEFORE the plugin arrived there already were:
//   - `scripts/dispatch-check.sh`, a claim script of the repo's own, and a
//     line in AGENTS.md ordering it to be run before implementing and with
//     `--release` when opening a PR;
//   - a worktree convention `git worktree add .claude/worktrees/<slug>`, with
//     a hook watching over it.
// The plugin brings ITS OWN `dispatch-check.mjs` and uses `.worktrees/<n>` +
// `feat/<n>`, and `ct-init` wrote its contract block right beside the one that
// was already there, without looking. Result: an AGENTS.md that contradicts
// itself, and TWO claim protocols operating over the same label space with
// nobody arbitrating.
//
// DESIGN CRITERION — F14 CORRECTS F11'S. F11 was built on a single criterion:
// «warning about a suspicion is worth more than keeping quiet». Out came a
// sensitive detector... and a guard THAT COULD NOT BE SATISFIED. Verified in
// the field against the real repo: the repo followed the detector's own advice
// (it decided the plugin's claim rules and rewrote its guides to say so) and
// the detector went on flagging it, because it searched for substrings and
// matched against
//   - the `scripts/` line of a directory tree inside a code block;
//   - the NEW sentences explaining that the agent no longer does the claim;
//   - the deliberate documentation of the script's manual use outside the loop;
//   - the factual descriptions of the hooks in an inventory table.
// The only way to make it green was to delete correct documentation. A guard
// that can only be satisfied by destroying work is not a guard, it is a wall:
// whoever obeys it ends up worse off, and whoever does not gets used to
// ignoring the warning.
//
// The property this file holds now is: **from any state the detector flags
// there is a path that leaves it green without making the repo worse.**
// It rests on TWO pieces, and the split between them is deliberate:
//
//  1. EXPLICIT ACKNOWLEDGEMENT (`.agent/conventions-ack.md`) — the guarantee.
//     Deterministic, per signal (`claim` / `worktrees` / `estado`), with a date
//     and a reason. Whoever already took the decision writes it ONCE and that
//     signal —only that one— stops warning. The guarantee CANNOT depend on text
//     heuristics: that is why what holds it up is this, a file that either is
//     there or is not.
//  2. MANDATE vs MENTION — the ergonomics. STRUCTURAL rules (is this a command
//     invocation or the name of a file in a list?) plus a NARROW set of scope
//     marks («fuera del loop», «no lo corras», «lo hace /ct-next») evaluated
//     over the line and over the bullets/heading that contain it. It brings the
//     noise down; the guarantee is not entrusted to it, because a text
//     heuristic can always be wrong.
//
// The cost of (2) is false negatives, and it is measured, not assumed: see the
// F14 report. The rule that bounds them is that the scope marks are few and NOT
// ambiguous — «a mano» on its own does NOT silence (a guide can perfectly well
// order «reclama a mano con tu script», and that is the deadlock); only the ones
// that explicitly take the order out of the loop, or forbid it, do.

export const CONTRACT_MARKER_OPEN = '<!-- ct-init:slices-contract -->'
export const CONTRACT_MARKER_CLOSE = '<!-- /ct-init:slices-contract -->'
// #93 — the short section the contract left in place inside AGENTS.md. It is
// pruned for the same reason as the contract: it is PLUGIN text, and it talks
// about the ground this scanner watches over (the claim, `.worktrees/<n>`, the
// state file). Without pruning it, `/ct-init` and `/ct-next` would denounce
// themselves on every run of a freshly bootstrapped repo.
export const LOOP_MARKER_OPEN = '<!-- ct-init:loop -->'
export const LOOP_MARKER_CLOSE = '<!-- /ct-init:loop -->'
const OWN_BLOCKS = [
  [CONTRACT_MARKER_OPEN, CONTRACT_MARKER_CLOSE],
  [LOOP_MARKER_OPEN, LOOP_MARKER_CLOSE],
]

// Paths and names the plugin's dispatcher occupies. They are cited in the
// messages so that the decision to be taken is concrete, not "review your
// setup".
export const LOOP_WORKTREE_DIR = '.worktrees'
export const LOOP_BRANCH_PREFIX = 'feat/'

// Where the acknowledgement is written. Relative to the target repo's root. It
// lives under `.agent/` (the space the loop already occupies) and not inside
// AGENTS.md, for two reasons: it is ONE known path that both consumers read
// without scanning, and a signal whose evidence is a FILE
// (`scripts/dispatch-check.sh`) has no line of AGENTS.md beside which to put
// it.
export const ACK_PATH = '.agent/conventions-ack.md'

// ============================================================================
// F19/H2 — AN ACKNOWLEDGEMENT THAT SILENCES NOT A SIGNAL, BUT A FEW CONCRETE
// CASES.
//
// THE PROBLEM IT CLOSES. F18 added an aggregate warning about CLOSED issues
// that keep a live `status:` label. The shape is the right one —one paragraph,
// not ten lines, grouped by status— and even so anybody is going to skip it
// from the third run on, and not because of how it is written: because it is
// STATIC. Those ten cases do not change on their own, so the warning prints the
// same paragraph on every run until somebody cleans up. A warning that does not
// change stops being read — and then, the day a new one shows up in the list,
// it is not seen. It is a third way for a warning to stop being of use,
// distinct from the unsatisfiable wall (F14) and from noise by volume (F16):
// REPETITION WITH NO NOVELTY.
//
// `residuo-status` is F14's very same tool —a file that either is there or is
// not, deterministic, with a date and a reason— applied one level finer:
// instead of keeping quiet about a whole SIGNAL, it keeps quiet about a few
// concrete NUMBERS and goes on warning about the ones that are not in the list.
// It is literally the sentence "I have seen and decided this, shut up about
// these numbers and go on warning me about the new ones".
//
// TWO DIFFERENCES in behaviour from the per-signal acknowledgements, and both
// are deliberate:
//
//   1. It ACCUMULATES across lines (`ACK_SET_IDS`). For a signal, two lines
//      with the same id are a redundancy and are reported as such. For a
//      per-case acknowledgement NOT so: the natural use is to add a new line
//      every time a batch is reviewed ("2026-07-01 — #101", "2026-07-28 —
//      #102"), and forcing the old line to be edited would turn the mechanism
//      into a nuisance nobody would use. The sets are unioned and the date of
//      the LAST one is kept.
//   2. An acknowledgement WITH NO numbers silences nothing and is REPORTED as a
//      problem. It is the same criterion that governs this whole parser: the
//      failure mode we cannot afford is somebody believing they have kept
//      something quiet when they have not. There is no wildcard for "all", on
//      purpose — a wildcard would give back exactly the static silence this
//      acknowledgement comes to break.
export const ACK_IDS = ['claim', 'worktrees', 'estado', 'residuo-status']
// Ids whose acknowledgement is a SET of cases (issue numbers) instead of a
// per-signal switch.
export const ACK_SET_IDS = ['residuo-status']
// ============================================================================

// The block ct-init ITSELF seeds is PRUNED before scanning (`docLines`,
// below). Indispensable since F11: that block talks about `dispatch-check`,
// about `.worktrees/<n>`, about `status:in-progress` and about `cmux` — without
// the pruning, the SECOND run of ct-init over any repo would denounce itself
// and the warning would die of noise. It tolerates CRLF (same reason as
// ct-init.sh: an AGENTS.md edited on Windows carries a `\r` stuck to every
// marker and no whole-line comparison found it).

// shape: the MARKDOWN form of a line — nesting level, whether it is a bullet,
// whether it is a heading. It is computed after removing the quote markers
// (`> `), because a policy written inside a blockquote is still a policy (real
// case: the «🛑 Política de aislamiento de ramas» block of menoplus's CLAUDE.md
// orders its `git worktree add` from inside a quote).
function shape(raw) {
  let t = raw
  const quote = t.match(/^(\s*(?:>\s?)+)/)
  if (quote) t = t.slice(quote[0].length)
  const indent = (t.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '  ').length
  const isList = /^[ \t]*(?:[-*+]|\d+[.)])\s+/.test(t)
  const isHeading = /^[ \t]*#{1,6}\s+/.test(t)
  return { indent, isList, isHeading }
}

// docLines: numbered lines (1-based) of a document, already without the own
// block and without `\r`. The numbering is the ORIGINAL file's — the one the
// human is going to open — not that of the pruned text: citing "AGENTS.md:84"
// and it not being line 84 would be worse than citing nothing at all.
export function docLines(content) {
  const original = String(content ?? '').split('\n')
  const stripped = new Set()
  let expectedClosing = null
  original.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '')
    if (expectedClosing === null) {
      const block = OWN_BLOCKS.find(([opening]) => line === opening)
      if (block) { expectedClosing = block[1]; stripped.add(i) }
      return
    }
    stripped.add(i)
    if (line === expectedClosing) expectedClosing = null
  })
  const inside = expectedClosing !== null
  const build = (raw, i) => {
    const text = raw.replace(/\r$/, '')
    return { n: i + 1, text, ...shape(text) }
  }
  // A block OPENED and never closed (somebody deleted the closing marker — a
  // real case: ct-init has a guard dedicated to partial traces). Pruning "from
  // the opening to the end" would throw overboard EVERYTHING underneath, the
  // repo's own conventions included, and the warning would keep quiet because
  // of an orphan marker. When in doubt nothing is pruned: at worst the block
  // denounces itself, and that costs one line of reading.
  if (inside) return original.map(build)
  return original.map(build).filter((_, i) => !stripped.has(i))
}

// --- MANDATE vs MENTION, piece 1: which chunk of the line is "command" ------
//
// `commandCandidates` splits a markdown line into the chunks where an
// executable ORDER can live:
//   - the content of each code span (`` `...` ``), and
//   - the prose that is left once those spans are removed.
// Both, not one: looking only at the spans loses `corre ./x.sh <n> y luego `git
// commit`` (the order is in the prose), and looking only at the whole line is
// what F11 did — that is why `bloquea \`git worktree add\` con dirty tree` (a
// description of a hook in an inventory table) counted as if the repo ordered
// worktrees to be created there.
// A line WITHOUT backticks (typical inside a ```…``` block, like the directory
// tree or the blockquote's command example) gives a single candidate: itself,
// without the `>` of the quote nor the bullet's dash.
export function commandCandidates(text) {
  const bare = String(text ?? '')
    .replace(/^(\s*(?:>\s?)+)/, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])\s+/, '')
  if (!bare.includes('`')) return [bare]
  const spans = []
  for (const m of bare.matchAll(/`+([^`]*)`+/g)) spans.push(m[1])
  const prose = bare.replace(/`+[^`]*`+/g, ' ')
  return [...spans, prose]
}

// stripMarkup: for the SEMANTIC questions (does this line take the order out of
// the loop?) the emphasis gets in the way. Real case: AGENTS.md says «trabajar
// un issue **fuera** del loop» — with the asterisks inside, no expression
// looking for "fuera del loop" found it.
function stripMarkup(text) {
  return String(text ?? '').replace(/[*_`]/g, '').replace(/\s+/g, ' ')
}

// --- MANDATE vs MENTION, piece 2: SCOPE marks ------------------------------
//
// A short and deliberately NON-ambiguous list. Every entry has to mean «this is
// not an order for the loop's agent», not merely «something else is being
// talked about here». What is NOT here, and it is the important omission: «a
// mano» / «manualmente» on their own. A guide can perfectly well say «reclama
// el issue a mano con ./scripts/dispatch-check.sh» — that is exactly the
// deadlock, and silencing it would be the expensive false negative. It only
// counts when the sentence takes the order out of the loop («a mano, FUERA DEL
// LOOP») or forbids it.
const SCOPE_OUT_RES = [
  /fuera del loop/i,
  /outside (?:the )?(?:loop|control tower)/i,
  /sin (?:usar |pasar por )?\/?ct-next/i,
  /without \/?ct-next/i,
  /no (?:lo |la |los |las )?(?:corras|ejecutes|reclames|invoques|uses|lances)\b/i,
  /nunca (?:lo |la )?(?:corras|ejecutes|reclames|invoques)\b/i,
  /do ?n[o']?t run|do not run|never run/i,
  // «ya no ES» on its own is left OUT on purpose: «ya no es opcional: corre
  // ./scripts/dispatch-check.sh» is a perfectly normal sentence and silencing
  // it would be exactly the expensive false negative. Only the forms that say
  // the thing has stopped being done.
  /ya no (?:se usa|se usan|se corre|lo hace|lo hacen|aplica|aplican|hace falta|es necesario|es obligatorio)/i,
  /no longer/i,
  /deprecad|obsolet/i,
  // «el claim lo hace /ct-next, no tú» and variants: the sentence with which a
  // repo declares that the old order has stopped being addressed to the agent.
  /(?:lo hace|lo pone|lo hará) (?:el |la )?(?:dispatcher|\/ct-next|ct-next)/i,
  /el agente no (?:reclama|lo reclama|hace el claim)/i,
  /no (?:lo )?reclames? (?:nada |el issue )?a mano/i,
]

function scopedOut(text) {
  const t = stripMarkup(text)
  return SCOPE_OUT_RES.some((re) => re.test(t))
}

// ancestorTexts: the bullets that CONTAIN this line (going up by nesting) plus
// the nearest heading. The scope of an order is almost never on its own line.
// Real case, `docs/agentic-workflow.md`:
//
//     - **A mano, fuera del loop:** entonces sí, lo aplicas tú con `…`      ← scope
//       - **Claim:** `./scripts/dispatch-check.sh <issue#>` → …            ← the order
//
// The order's line, read on its own, is indistinguishable from the OLD version
// that did order the agent to claim. What separates them sits one level up.
// Bounded window (40 lines, 4 ancestors): a long document cannot make an order
// inherit the scope of something that was left half a page back.
function ancestorTexts(lines, i) {
  const out = []
  let need = lines[i].indent
  for (let j = i - 1; j >= 0 && i - j <= 40 && out.length < 4; j--) {
    const L = lines[j]
    if (!L.text.trim()) continue
    if (L.isHeading) { out.push(L.text); break }
    if (L.indent < need && L.isList) { out.push(L.text); need = L.indent }
  }
  return out
}

// evidenceFromDocs: walks the documents and applies `predicate(candidates,
// line)`. Before accepting a line it checks the scope: if the line itself or
// one of its ancestors takes it out of the loop, it is not an order the
// dispatched agent is going to obey.
function evidenceFromDocs(docs, predicate) {
  const out = []
  for (const doc of docs || []) {
    const lines = docLines(doc.content)
    lines.forEach((line, i) => {
      if (!predicate(commandCandidates(line.text), line.text)) return
      if (scopedOut(line.text)) return
      if (ancestorTexts(lines, i).some(scopedOut)) return
      out.push({ path: doc.path, line: line.n, text: line.text.trim(), via: doc.via || null })
    })
  }
  return out
}

// normalizePath: separators to `/` and with no leading `./`, so that the path
// rules do not depend on how the caller happened to build them.
function normalizePath(p) {
  return String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
}

// `files` mixes files and directories; the directories carry a trailing `/`
// (that is how detect-conventions.mjs emits them). A directory called
// `worktrees` is a signal in itself — it does not need to have anything inside,
// and in fact it is not descended into.
const isDir = (p) => p.endsWith('/')

// Paths that are not LIVE conventions of the repo: what is archived and what is
// the test of something else. Real case: the detector flagged
// `docs/archive/planning-gsd/STATE.md` (a historical state, explicitly
// archived) and `scripts/tests/dispatch-check.test.sh` (the script's test, not
// a second protocol). Neither of the two can be "resolved": deleting a
// historical archive or a script's test is exactly the "making the repo worse"
// this file can no longer ask for.
const ARCHIVED_PATH_RE = /(^|\/)(archive|archives|archived|archivo|historico|historicos|histórico|históricos|old|deprecated|attic|backup|backups|\.trash)\//i
const TEST_PATH_RE = /(^|\/)(tests?|__tests__|spec|specs)\/|(^|\/)[^/]*[._-](test|spec)\.[^/]*$/i
const isLivePath = (p) => !ARCHIVED_PATH_RE.test(p) && !TEST_PATH_RE.test(p)

// --- Rule 1: CLAIM --------------------------------------------------------
// A `dispatch-check` that is not the plugin's (a file of the repo's own), or an
// INSTRUCTION in the repo's documentation ordering it to be run. Either of the
// two is enough: the file without the instruction is still a live protocol
// somebody can invoke, and the instruction without the file is still an order
// the dispatched agent will read and obey.
const CLAIM_FILE_RE = /(^|\/)dispatch-check[^/]*$/i

// isClaimInvocation: the structural part of the fix. `dispatch-check` shows up
// as a COMMAND when (a) it is explicitly executed — `./x`, `bash x`, `node x` —
// or (b) it carries an argument stuck behind it (`x <issue#>`, `x 42`,
// `x --release`). What NO LONGER counts, and was half the false positives of
// the real repo:
//   `scripts/       dispatch-check.sh, dependabot-*, sentry-*`   ← dir tree
//   `` `scripts/dispatch-check.sh` sigue en el repo para… ``     ← mention
//   `` `scripts/dispatch-check.sh` (anti-colisión por area…) ``  ← mention
const CLAIM_ARG_RE = /^(--?[\w-]|<[^\s]|\d|#\d|\$)/
// Besides the interpreter, the verbs with which a guide orders something to be
// run. Without them «antes de implementar, corre dispatch-check.sh» (with no
// `./` and no argument) escaped, and that is an order if ever there was one. A
// verb does NOT turn a mention into an order on its own: it has to sit stuck in
// front of the token.
const CLAIM_RUNNER_RE =
  /^(bash|sh|zsh|dash|node|python3?|source|exec|\.|\$|>|corre|corres|ejecuta|ejecutas|lanza|lanzas|invoca|invocas|usa|usas|run|runs|execute|call)$/i
// A third route, measured and added AFTER the sweep of false negatives: a line
// that does NOT have the shape of a command but declares an OBLIGATION about
// the script («el claim se gestiona con `scripts/dispatch-check.sh`, que es
// obligatorio», «primer paso del agente») is still an order the agent is going
// to obey, and without this it escaped. It is evaluated over the whole line,
// not over the token, because it is the context that obliges. It reintroduces
// none of the false positives of the real repo: not one of its four problematic
// lines contains an obligation mark (and the ones that did would fall out just
// the same through `scopedOut`, which is checked afterwards).
const CLAIM_DUTY_RE =
  /\b(obligatori|imprescindible|debes\b|deberás|tienes que|hay que|primer paso|antes de implementar|antes de empezar|is required|must run|mandatory)/i

function isClaimInvocation(cand, line = '') {
  if (/dispatch-check/i.test(cand) && CLAIM_DUTY_RE.test(stripMarkup(line))) return true
  const toks = String(cand).trim().split(/\s+/).filter(Boolean)
  for (let i = 0; i < toks.length; i++) {
    if (!/dispatch-check/i.test(toks[i])) continue
    const tok = toks[i]
    // A list element (`dispatch-check.sh,` / `dispatch-check.sh;`) is never an
    // invocation: it is an enumeration.
    if (/[,;]$/.test(tok)) continue
    if (/^(\.{1,2})?\//.test(tok)) return true // ./x, ../x, /abs/x
    if (CLAIM_RUNNER_RE.test(toks[i - 1] || '')) return true
    const next = toks[i + 1]
    if (next && CLAIM_ARG_RE.test(next)) return true
  }
  return false
}

// --- Rule 2: WORKTREES ----------------------------------------------------
// A documented `git worktree add` that does NOT point at `.worktrees/`; a
// worktree directory of the repo's own; or a hook whose name gives away that it
// watches over branches/worktrees (it is the one that can knock down every
// dispatch of the loop).
//
// The rule does NOT try to extract the path by position — `add <path> -b
// <branch>` and `add -b <branch> <path>` are both valid and a positional
// capturer picks the wrong token in half the cases. It skips flags and keeps
// the first operand; if there is NO operand, this is not a command but a
// mention, and that distinction is the one that kills the two false positives
// of the real repo:
//   `` …; empuja a `git worktree add`. Permite: `main`, restore… ``
//   `` `menoplus-worktree-guard.sh` (bloquea `git worktree add` con dirty tree) ``
const LOOP_WORKTREE_MENTION_RE = /(^|[^\w.])\.worktrees\//
const HOOK_GUARD_RE = /(^|\/)\.claude\/hooks\/[^/]*(worktree|branch|rama)[^/]*$/i
function foreignWorktreeAdd(cand) {
  const m = /git\s+worktree\s+add\b(.*)$/i.exec(String(cand))
  if (!m) return false
  const rest = m[1].trim()
  if (!rest) return false
  // Command split across several lines (`git worktree add \` + the path
  // underneath): the operand is not visible, so it CANNOT be ruled out that it
  // points somewhere else. Faced with "I do not know" it warns — that is what
  // the acknowledgement is there for, and it is the way out.
  if (rest === '\\') return true
  const toks = rest.split(/\s+/).filter(Boolean)
  let operand = null
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (/^--?[\w-]/.test(t)) { if (/^-[bB]$/.test(t)) i++; continue }
    operand = t
    break
  }
  // With no operand, or with an operand that does not look like a path (prose
  // punctuation: `add`. Permite: …), there is no command contradicting
  // anything.
  if (!operand || !/[\w~$]/.test(operand) || /^[.,;:!?)]+$/.test(operand)) return false
  return !LOOP_WORKTREE_MENTION_RE.test(rest)
}

// --- Rule 3: STATE (the `estado` signal) ----------------------------------
// A state file that is not `.agent/STATE.md`. The whole loop (the SessionStart
// hook, `/ct-next`'s seed, `blocked`) is tied to that path: if the repo already
// carried its own somewhere else, two of them are going to coexist and nobody
// will know which one is current.
const STATE_FILE_RE = /(^|\/)(STATE|STATUS)\.md$/i

export function detectConventions({ docs = [], files = [], acks = null } = {}) {
  const paths = (files || []).map(normalizePath)
  const findings = []

  // --- claim ---
  const claimFiles = paths.filter((p) => !isDir(p) && CLAIM_FILE_RE.test(p) && isLivePath(p))
  const claimDocs = evidenceFromDocs(docs, (cands, line) => cands.some((c) => isClaimInvocation(c, line)))
  if (claimFiles.length || claimDocs.length) {
    findings.push({
      id: 'claim',
      title: 'this repo already has its OWN claim protocol',
      // The documentation lines go FIRST, ahead of the files: they are the
      // order the dispatched agent is going to read and obey, so they are the
      // evidence that decides. (The list is truncated when printing; that what
      // survives the cut be the important part is not a cosmetic detail.)
      evidence: [
        ...claimDocs,
        ...claimFiles.map((p) => ({ path: p, line: null, text: 'a claim script belonging to this repo' })),
      ],
      decision:
        'The plugin brings its own `dispatch-check.mjs` and `/ct-next` invokes it IN CODE ' +
        '(status:ready → status:in-progress) before creating the worktree. With both alive there are ' +
        'TWO protocols over the same label space and nobody arbitrating: /ct-next claims, the ' +
        'agent starts up, obeys the old line in your AGENTS.md, and your script finds an active claim ' +
        "on its own issue. Decide which one rules: (a) keep the plugin's and delete " +
        'the old instruction from AGENTS.md/CLAUDE.md, (b) keep yours and do not use /ct-next ' +
        'to dispatch, or (c) make yours a wrapper around the other one. What cannot ' +
        'stay is the contradiction.',
    })
  }

  // --- worktrees ---
  const foreignAdds = evidenceFromDocs(docs, (cands) => cands.some(foreignWorktreeAdd))
  const foreignWorktreeDirs = [
    ...new Set(
      paths
        .filter((p) => isDir(p) && /(^|\/)worktrees\/$/i.test(p))
        .map((p) => p.slice(0, -1))
        .filter((d) => d !== LOOP_WORKTREE_DIR)
    ),
  ]
  const guardHooks = paths.filter((p) => !isDir(p) && HOOK_GUARD_RE.test(p))
  if (foreignAdds.length || foreignWorktreeDirs.length || guardHooks.length) {
    findings.push({
      id: 'worktrees',
      title: 'this repo already has a worktrees/branches convention of its own',
      evidence: [
        ...foreignAdds,
        ...foreignWorktreeDirs.map((d) => ({ path: `${d}/`, line: null, text: 'a worktrees directory belonging to this repo' })),
        ...guardHooks.map((p) => ({ path: p, line: null, text: 'a hook watching over branches/worktrees' })),
      ],
      decision:
        `/ct-next creates every slice in \`${LOOP_WORKTREE_DIR}/<n>\` on the branch ` +
        `\`${LOOP_BRANCH_PREFIX}<n>\` (\`<n>\` = the ISSUE number), and those two paths are fixed in ` +
        'the dispatcher: they are not configurable. If a hook of this repo demands another path or ' +
        'another branch name, it will knock down every dispatch AFTER the claim is already written. ' +
        `Decide: widen the hook to admit \`${LOOP_WORKTREE_DIR}/\` and \`${LOOP_BRANCH_PREFIX}\`, or do ` +
        'not use /ct-next in this repo. And take out of AGENTS.md/CLAUDE.md the instruction that ' +
        'orders the other path: the dispatched agent is going to read it.',
    })
  }

  // --- estado ---
  const foreignState = paths.filter(
    (p) => !isDir(p) && STATE_FILE_RE.test(p) && p !== '.agent/STATE.md' && isLivePath(p)
  )
  if (foreignState.length) {
    findings.push({
      id: 'estado',
      title: 'this repo already has a state file outside `.agent/STATE.md`',
      evidence: foreignState.map((p) => ({ path: p, line: null, text: 'a state file belonging to this repo' })),
      decision:
        'The whole loop is tied to TWO fixed paths, with different roles: `.agent/STATE.md` is ' +
        'the state of the coordinating session of the main checkout (tracked), and ' +
        '`.agent/SLICE.md` that of the dispatched slice, which /ct-next seeds inside each worktree ' +
        '(ignored, never committed). The SessionStart hook hydrates from SLICE.md if it exists and ' +
        'from STATE.md if not, and the `blocked` field is only read from those two. A third state ' +
        'file is looked at by nobody, and with two at once nobody will know which one is current. ' +
        'Decide which one is the source of truth and leave the other as historical (or delete it).',
    })
  }

  // The acknowledgement does not DELETE the finding: it marks it. Whoever
  // prints decides (formatFindings brings it down to a one-line note).
  // Returning it marked instead of vanished is what lets ct-next filter by id
  // and still know it was silenced.
  if (acks) {
    for (const f of findings) {
      const ack = acks.get ? acks.get(f.id) : acks[f.id]
      if (ack) f.silenced = ack
    }
  }

  return findings
}

// --- LINKS THE GUIDE ITSELF DECLARES AUTHORISED -----------------------------
//
// Second defect of F11: ONLY `AGENTS.md` and `CLAUDE.md` were scanned. In the
// real repo both guides pointed at `docs/agentic-workflow.md` as the «complete
// reference», and the old order was still alive there, in the imperative and
// addressed straight at the agent (`Claim (primer paso del agente):
// ./scripts/dispatch-check.sh <issue#>`). The two files the detector looked at
// were cleaned up and the order was left one click away, in the one it did not
// look at. An agent that reads AGENTS.md and follows the link that file calls
// authorised finds it all the same.
//
// SCOPE: ONE HOP, from the root documents. Neither zero (the hole above) nor
// transitive (a rabbit hole: `agentic-workflow.md` already links to a spec of
// 2026-05 that links to others). The criterion is that AGENTS.md/CLAUDE.md are
// the agent's front door, and a document THEY declare canonical is, as far as
// what the agent will obey goes, part of them. The grandchild is not.
export function linkedDocPaths(docs) {
  const out = []
  const seen = new Set()
  const push = (raw) => {
    let p = String(raw).trim().replace(/^<|>$/g, '')
    if (!p || !/\.md$/i.test(p)) return
    if (/^[a-z][\w+.-]*:/i.test(p)) return // http:, https:, mailto:…
    if (p.startsWith('/') || p.startsWith('~')) return // outside the repo
    if (/[<>{}*?|"']/.test(p)) return // templates: `.worktrees/<n>/…`, `apps/{a,b}/…`
    p = normalizePath(p)
    // `..` is not resolved here (this is pure logic): it is rejected. Leaving
    // the repo is precisely what we do not want, and whoever reads the disk
    // checks it again.
    if (p.split('/').includes('..')) return
    const first = p.split('/')[0]
    // The loop's own territory and known noise: not the repo's documentation.
    if (['.worktrees', '.agent', 'node_modules', '.git'].includes(first)) return
    if (seen.has(p)) return
    seen.add(p)
    out.push(p)
  }
  for (const doc of docs || []) {
    for (const { text } of docLines(doc.content)) {
      for (const m of text.matchAll(/\]\(\s*([^)\s#]+\.md)(?:#[^)]*)?\s*\)/gi)) push(m[1])
      for (const m of text.matchAll(/`([^`\n]+?\.md)`/gi)) push(m[1])
      for (const m of text.matchAll(/(?:^|[\s(])((?:\.{1,2}\/)?[\w.@+-]+(?:\/[\w.@+-]+)*\.md)\b/gi)) push(m[1])
    }
  }
  return out
}

// --- EXPLICIT ACKNOWLEDGEMENT -----------------------------------------------
//
// Format, one line per signal:
//     claim: 2026-07-28 — manda el claim del plugin; el script del repo se
//     queda solo para trabajo a mano fuera del loop
// The THREE things are required (which signal, when, why) because an
// acknowledgement with no date and no reason is indistinguishable from a
// `# TODO` somebody left behind and nobody remembers — and this one silences a
// real warning.
//
// F15/H3 — THE FILE OF THE WHY DID NOT ADMIT A WHY.
//
// F14's version went line by line and only knew how to skip blank lines, `#`
// headings, code blocks and a stray line starting with `<!--`. EVERYTHING else
// had to parse as an acknowledgement or it was reported. Measured by
// construction against that version, before touching anything: a three-line
// prose preamble produces 3 warnings of "silences nothing"; putting that same
// preamble between `<!--` and `-->` produces 4 (the three lines inside PLUS the
// one with the `-->`, because only the opening one was skipped). That is: a
// file whose only reason to exist is to put on record WHY a decision was taken
// did not admit writing the why anywhere, not even commented out.
//
// THE PROPERTY THAT CANNOT BE LOST. The unacceptable failure is not "prose
// sneaks in on me": it is somebody believing they have silenced a signal when
// they have not. So the question is not "does this parse?" but "did this MEAN
// to be an acknowledgement?" — and only what meant to be one and does not parse
// is reported.
//
// HOW PROSE IS TOLD APART FROM A BADLY WRITTEN ACKNOWLEDGEMENT (`looksLikeAck`,
// below). Two fingerprints, either of the two is enough:
//   (a) the line's first token IS a known signal, or is at edit distance 1 from
//       one (`clim:`, `worktree:`, `estado`). It covers the acknowledgement
//       whose syntax broke completely — no colon, with a dash, no date;
//   (b) the line has the shape `<word>: <YYYY-MM-DD>`. It covers the
//       acknowledgement with the syntax right and the signal NAME wrong, which
//       (a) does not reach.
// An ordinary prose sentence ("Contexto de la decisión, julio de 2026.") has
// neither of the two and is ignored with no noise.
//
// THE BIAS IS DELIBERATE: when in doubt, it REPORTS. A prose line starting with
// the word "claim" will take a warning — annoying, and with an obvious remedy
// (comment it out, or rewrite it); an acknowledgement silenced by mistake has
// no remedy, because nobody finds out. And for the case in which the WHOLE file
// was read as prose —the one that really does deceive— there is a voice of its
// own: see `formatFindings` and the `proseWithoutAcks` field returned here.
const ACK_ID_HEAD_RE = /^(?:[-*+]\s+)?[`"'*_]*([A-Za-zÁ-Úá-ú][\w-]*)/

// editDistanceAtMost1: can you get from `a` to `b` with ONE single insertion,
// deletion or substitution? Deliberately not a general Levenshtein — with a
// threshold of 1 a single linear pass is enough, and raising the threshold
// would start swallowing prose ("estado" and "estada" are neighbours; "estado"
// and "estamos" must no longer be).
function editDistanceAtMost1(a, b) {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  const [s, l] = a.length <= b.length ? [a, b] : [b, a]
  let i = 0
  let j = 0
  let budget = 1
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) { i++; j++; continue }
    if (budget-- === 0) return false
    if (s.length === l.length) { i++; j++ } else { j++ }
  }
  return true
}

// looksLikeAck: did this line MEAN to silence a signal? Exported because it is
// exactly the criterion that has to be testable on its own: it is the boundary
// between "nothing is said" and "a warning is given", and a boundary that only
// exists inside a loop cannot be attacked head on.
export function looksLikeAck(text) {
  const t = String(text ?? '').trim()
  if (!t) return false
  const head = ACK_ID_HEAD_RE.exec(t)
  if (head) {
    const id = head[1].toLowerCase()
    if (ACK_IDS.some((known) => editDistanceAtMost1(id, known))) return true
  }
  // Fingerprint (b): an ISO date stuck to the colon. It is the shape of the
  // acknowledgement, not that of any sentence.
  return /^(?:[-*+]\s+)?[`"'*_]*[A-Za-zÁ-Úá-ú][\w-]*[`"'*_]*\s*:\s*\d{4}-\d{2}-\d{2}\b/.test(t)
}

// Everything that MEANS to be an acknowledgement (see `looksLikeAck`) HAS to
// parse. Such a line, when it is not understood, is REPORTED, never ignored:
// the failure mode we cannot afford is somebody believing they have silenced
// something when they have not (they see the warning again and conclude the
// acknowledgement is no good) or the other way round. What does not mean to be
// one is prose, and prose is the reason this file exists.
//
// Returns `{ acks, problems, proseWithoutAcks }`. The third field is true only
// when the file did bring real content (something more than blanks, headings
// and comments) and produced NEITHER an acknowledgement NOR a problem — the
// only state in which this parser's silence can deceive anybody.
export function parseAcks(content) {
  const acks = new Map()
  const problems = []
  const raw = String(content ?? '').replace(/^﻿/, '') // BOM: Windows editors
  let fenced = false
  // State of the MULTI-LINE HTML comment. Before, only the line that STARTED
  // with `<!--` was skipped, so the comment's body and its closing `-->` were
  // parsed as if they were acknowledgements. A `<!-- ... -->` that opens and
  // closes on the same line does not enter the state (hence the
  // `&& !t.includes('-->')`).
  let inComment = false
  let sawProse = false
  raw.split('\n').forEach((rawLine, i) => {
    const line = rawLine.replace(/\r$/, '')
    const t = line.trim()
    if (inComment) {
      if (t) sawProse = true
      if (t.includes('-->')) inComment = false
      return
    }
    if (/^(```|~~~)/.test(t)) { fenced = !fenced; return }
    // Attacking this very implementation: an acknowledgement INSIDE a code
    // block (or inside a fence somebody opened and did not close, which
    // swallows everything that comes behind it) was ignored, and since it was
    // not "prose" it did not fire the `proseWithoutAcks` warning either — total
    // silence about a file the human believes silences something. It counts as
    // content: it is not parsed (a fence is a fence), but it stops being
    // invisible.
    if (fenced) { if (t) sawProse = true; return }
    if (!t || t.startsWith('#')) return
    if (t.startsWith('<!--')) {
      sawProse = true
      if (!t.includes('-->')) inComment = true
      return
    }
    const n = i + 1
    // PROSE: it did not mean to be an acknowledgement. It is ignored, which is
    // exactly what this file needed in order to be able to carry the human
    // explanation.
    if (!looksLikeAck(t)) { sawProse = true; return }
    const m = /^(?:[-*+]\s+)?([A-Za-zÁ-Úá-ú][\w-]*)\s*:\s*(.*)$/.exec(t)
    if (!m) {
      problems.push({ line: n, text: t, why: 'is not shaped like `signal: YYYY-MM-DD — reason`' })
      return
    }
    const id = m[1].toLowerCase()
    const rest = m[2].trim()
    if (!ACK_IDS.includes(id)) {
      problems.push({ line: n, text: t, why: `unknown signal \`${m[1]}\` (the valid ones: ${ACK_IDS.join(', ')})` })
      return
    }
    const d = /^(\d{4}-\d{2}-\d{2})\b[\s—–-]*(.*)$/.exec(rest)
    if (!d) {
      problems.push({ line: n, text: t, why: 'the date is missing, in YYYY-MM-DD format and right after the colon' })
      return
    }
    const reason = d[2].trim()
    if (!reason) {
      problems.push({ line: n, text: t, why: 'the reason is missing: what was decided, and why' })
      return
    }
    // F19/H2: the PER-CASE acknowledgements (`ACK_SET_IDS`) carry the numbers
    // they keep quiet about inside the reason, and they ACCUMULATE across lines
    // instead of clashing. See the ACK_SET_IDS comment block, above, for the
    // why of the two differences.
    if (ACK_SET_IDS.includes(id)) {
      const refs = [...reason.matchAll(/#(\d+)\b/g)].map((m) => Number(m[1])).filter((x) => Number.isInteger(x) && x > 0)
      if (!refs.length) {
        problems.push({ line: n, text: t, why: `\`${id}\` is a PER-CASE acknowledgement: it has to name the specific numbers it keeps quiet about (e.g. «${id}: ${d[1]} — #101, #102 reviewed: …»). With no numbers it silences nothing, and there is deliberately no wildcard for "all of them"` })
        return
      }
      const prev = acks.get(id)
      const cases = new Set([...(prev?.cases ?? []), ...refs])
      acks.set(id, { id, date: d[1], reason, line: n, cases })
      return
    }
    if (acks.has(id)) {
      problems.push({ line: n, text: t, why: `signal \`${id}\` was already acknowledged further up; this line adds nothing` })
      return
    }
    acks.set(id, { id, date: d[1], reason, line: n })
  })
  // The only way for the new silence to deceive: the human wrote something, it
  // was neither an acknowledgement nor anything resembling one, and the file
  // silences nothing.
  return { acks, problems, proseWithoutAcks: sawProse && acks.size === 0 && problems.length === 0 }
}

// formatFindings: the warning, ready for stderr. One function and not two
// (ct-init and ct-next print it the same way) so that the text cannot diverge
// between the bootstrap and the dispatch.
//
// Three blocks, in this order: the LIVE warnings, the silenced signals (one
// line each — it is said that they have been kept quiet, because «nothing was
// found» and «it was decided not to look at this» are not the same thing and
// confusing them is the lie this file has been trying not to tell since F11),
// and the problems of the acknowledgement file itself.
export function formatFindings(findings, { where = 'this repo', ackProblems = [], ackUnreadable = null, ackProseWithoutAcks = false } = {}) {
  const live = (findings || []).filter((f) => !f.silenced)
  const silenced = (findings || []).filter((f) => f.silenced)
  const out = []
  if (live.length) {
    out.push(
      `ATTENTION: ${where} already had conventions of its own on the ground the Control Tower loop occupies. ` +
        'Nothing has been changed for you — but this does NOT sort itself out, and leaving it like this is how you get to ' +
        'an AGENTS.md that contradicts itself and to two claim protocols over the same labels.'
    )
    for (const f of live) {
      out.push(`  · [${f.id}] ${f.title}`)
      for (const e of f.evidence.slice(0, 6)) {
        const via = e.via ? ` (linked from ${e.via})` : ''
        out.push(`      ${e.path}${e.line ? `:${e.line}` : ''}${via} — ${e.text}`)
      }
      if (f.evidence.length > 6) out.push(`      (+${f.evidence.length - 6} more)`)
      out.push(`      decision: ${f.decision}`)
    }
    // THE WAY OUT. It goes with the live warnings and not in a README, because
    // the moment it is needed is this one. Without it the warning becomes a
    // wall again: the real repo had already taken the correct decision and the
    // detector went on flagging it.
    out.push(
      '  If one of these signals is ALREADY decided and you are not going to change it, write it down ' +
        `in \`${ACK_PATH}\` — one line per signal, with the date and the reason:`
    )
    out.push(`      ${live[0].id}: 2026-01-31 — <what was decided and why>`)
    out.push(
      '  That signal —and only that one— stops warning; the rest carry on. There is no need to delete correct ' +
        'documentation to silence the warning: if what you are documenting is manual use outside the loop, acknowledge it and be done.'
    )
    // F15/H3: the rest of the file is yours. It is said HERE, next to the
    // example, because that is where somebody decides what they are going to
    // write — finding out after having fought the parser comes too late.
    out.push(
      `  The rest of \`${ACK_PATH}\` is free prose: write around those lines whatever long reasoning ` +
        'is needed. Only the lines that look like an acknowledgement are read as one, and one that looks like it and is ' +
        'badly written is reported to you; prose is not.'
    )
  }
  for (const f of silenced) {
    const n = f.evidence.length
    out.push(
      `  note: [${f.id}] silenced by ${ACK_PATH} (${f.silenced.date}: ${f.silenced.reason}) — ` +
        `${n} signal${n === 1 ? '' : 's'} left unreviewed.`
    )
  }
  if (ackUnreadable) {
    out.push(
      `  warning: \`${ACK_PATH}\` exists but could not be read (${ackUnreadable}). No acknowledgement is ` +
        'being applied: what you see above may be something you had already decided.'
    )
  }
  for (const p of ackProblems || []) {
    out.push(`  warning: ${ACK_PATH}:${p.line} silences nothing — ${p.why}: «${p.text}»`)
  }
  // F15/H3 — the voice of the new silence. Ever since prose is ignored, a
  // WHOLE file of prose produces neither acknowledgements nor warnings:
  // exactly the state in which somebody believes they have silenced something
  // and has not, which is the failure this parser cannot afford. It is said.
  //
  // Only when there ARE live warnings: if there is no signal to silence, that
  // the file silences nothing does not matter, and saying it on every dispatch
  // would be noise in a repo that has no problem at all. The condition that
  // matters is "you might believe you have kept THIS quiet, and you have not".
  if (ackProseWithoutAcks && live.length) {
    out.push(
      `  warning: \`${ACK_PATH}\` exists and has content, but it silences NO signal — everything inside ` +
        'it has been read as prose. An acknowledgement is a line that starts with the name of the signal: ' +
        `\`${ACK_IDS[0]}: 2026-01-31 — <reason>\` (valid signals: ${ACK_IDS.join(', ')}).`
    )
  }
  return out.join('\n')
}
