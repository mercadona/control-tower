// Pure mapping of GitHub issues (the raw shape of `gh issue list --json
// number,title,labels,body` / `--json number,stateReason`) onto the shape
// selectNext/renderKickoff/buildStateSeed consume. Extracted out of
// ct-next.mjs (review round 1, Important/Minor 1) so that it can be tested
// without a network and without going through `gh`: before this change the
// only test path came in through CT_NEXT_FIXTURE, so this mapping never ran in
// the suite — a drift in groom.js#buildIssueBody's format (e.g. renaming the
// "## Acceptance criteria" heading) could break it silently until the real
// dispatch against a real repo.
import { gatesFromLabels } from './gates.js'

// detectLineEnding / normalizeToLF (review round 4, minor: CRLF): an issue
// edited on Windows (or pasted from an editor that uses CRLF) leaves a '\r'
// at the end of every line. Without normalising, that '\r' sneaks into any
// equality comparison (the link line to the spec, an "exact" heading) and into
// the multi-line content of Descripción/Protegido — making two VISUALLY
// identical texts get reported as drifting. And without denormalising back, a
// splice (which generates its own content with a bare '\n') leaves the
// resulting body with mixed line endings (part original CRLF, part our LF).
//
// Strategy: all the processing (detection AND application) ALWAYS works over
// text normalised to pure LF; whoever is going to return a body to write back
// (buildReconcileBody) detects the original's DOMINANT line ending with
// `detectLineEnding` and, if it was CRLF, converts the whole result back
// before returning it — that way the body written never ends up with mixed
// endings.
export function detectLineEnding(text) {
  return /\r\n/.test(text || '') ? '\r\n' : '\n'
}
export function normalizeToLF(text) {
  return (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '')
}

// FENCE_LINE_RE: the delimiter of a fenced code block (CommonMark: up to 3
// spaces of indentation, then 3+ backticks or 3+ tildes). It captures the
// whole run (group 1) so that whoever uses it can compare character AND
// length — see stepFence below.
const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})/

// ATX_HEADING_RE (review round 5, Critical 2 — the reviewer attacked their
// own terminator from round 4 and found that it only recognised a literal
// "## " at column 0): CommonMark considers an ATX heading any line with 1 to 6
// "#", indented up to 3 spaces, followed by a space/tab or by the end of the
// line. Before, a "#", "###", "####", a "##" separated by a TAB, or one
// indented 1-3 spaces — all five real headings on GitHub — terminated no
// section at all: everything below (up to the next exact "## ") was considered
// part of the CONTENT of the previous section. Verified with the reviewer's
// example: a "### Notas de implementación" with a real warning ("no tocar sin
// hablar con Ana") disappeared on reconciling because it fell "inside" the
// previous section, and --reconcile's splice replaced it without further
// ado.
const ATX_HEADING_RE = /^ {0,3}#{1,6}([ \t]|$)/

// COMMENT_OPEN_TOKEN / COMMENT_CLOSE_TOKEN: the delimiters of an HTML
// comment — see stepLine below (Critical 1, review round 5).
const COMMENT_OPEN_TOKEN = '<!--'
const COMMENT_CLOSE_TOKEN = '-->'

// stepFence (review round 4, Critical 1 — the reviewer attacked their own
// scanner from round 3 and found that ANY delimiter toggled the state,
// without looking at type or length): CommonMark only closes a fence with a
// run of the SAME character (a backtick closes a backtick, a tilde closes a
// tilde — never crossed) and of length >= the opening one. The previous
// version flipped `inFence` on ANY line that matched FENCE_LINE_RE — a ``` (3
// backticks) inside a block opened with ```` (4 backticks) falsely "closed"
// the state, so the content after it (the real ```` closing included) was
// treated as structure of the document. Reproduced with the exact example
// this very project documents about itself: a 4-backtick block showing, as an
// example, a 3-backtick block with "## Dependencias" inside.
//
// It receives the previous state `{ inFence, fenceChar, fenceLen }` and the
// current line; it returns `{ state, isFenceDelim }` — `isFenceDelim` is true
// when the line ITSELF is a real delimiter (it opens or closes), and those
// lines never count as a heading/terminator in their own right, regardless of
// the new value of `inFence`.
//
// Minor (review round 5): besides the character and the length, CommonMark
// demands that a CLOSING line carry nothing behind it but whitespace — an
// "info string" (e.g. the "js" of "```js") is only valid on the OPENING.
// Before, a line like "```js" inside an ALREADY open block (meant as example
// CONTENT — e.g. showing another fence with a language —, not as a closing)
// was read as a false closing all the same because only the delimiter's
// character+length was looked at, ignoring the rest of the line. It failed
// safe (it corrupted nothing: at worst it made locatable a heading that was in
// fact still "inside" the example), but an error message that depended on
// where that section ends could blame a heading that is still visibly present
// further down, instead of explaining that the closing was never one.
function stepFence(line, state) {
  const m = FENCE_LINE_RE.exec(line)
  if (!m) return { state, isFenceDelim: false }
  const char = m[1][0]
  const len = m[1].length
  if (!state.inFence) {
    // Outside any fence: this line ALWAYS opens a new one, remembering its
    // exact character and length. An info string behind it (the opening DOES
    // tolerate one) does not matter here.
    return { state: { inFence: true, fenceChar: char, fenceLen: len }, isFenceDelim: true }
  }
  const rest = line.slice(m[0].length)
  if (char === state.fenceChar && len >= state.fenceLen && /^\s*$/.test(rest)) {
    // It closes: same character, length equal to or greater than the
    // opening, and nothing but whitespace behind the delimiter.
    return { state: { inFence: false, fenceChar: null, fenceLen: 0 }, isFenceDelim: true }
  }
  // A delimiter of ANOTHER character (e.g. "~~~" inside a block opened with
  // "```"), of the same character but shorter, or with text behind it (an info
  // string, e.g. "```js") does NOT close the fence — it is ordinary content
  // inside it (`state` does not change; `isFenceDelim` is false because, as
  // far as this scanner is concerned, this line delimits nothing on its own —
  // it is still inside the already-open fence, which is exactly what decides
  // whether predicate() gets evaluated in the caller).
  return { state, isFenceDelim: false }
}

function initLineState() {
  return { inFence: false, fenceChar: null, fenceLen: 0, inComment: false }
}

// stepLine (review round 5, Critical 1 — "you hardened the fences
// thoroughly and left untouched the other two delimiter-shaped things that
// live in the same body"): a multi-line HTML comment is EXACTLY the same kind
// of risk as an unclosed code fence — nothing tracked its INSIDE, so a known
// heading "commented out" inside a `<!-- ... -->` that opens on one line and
// closes several lines later (e.g. some old deps commented out "while we
// decide") was read as if it were real structure of the document. With that,
// `locateSection` returned the commented-out copy, `--reconcile` wrote INSIDE
// the comment, and since the end of content reaches as far as the next real
// heading, the splice ate the closing `-->` itself — on GitHub, an unclosed
// comment swallows everything up to EOF.
//
// The distinction that matters: the `<!-- ct-order:N -->` marker (and any
// comment that OPENS and CLOSES on the SAME line) is a real, self-contained
// line — it is STILL valid as a section terminator, just as before. What can
// NOT go on happening is that the mere presence of "<!--" on a line (with no
// "-->" behind it, ON THAT SAME line) is treated as the marker: that is the
// OPENING of a multi-line comment, whose inside (as far as the line that
// finally brings a "-->") is as invisible to the scanner as the inside of a
// fence.
//
// It returns `{ state, wasHidden }` — `wasHidden` is true when, BEFORE
// processing this line, the scanner was already inside a fence or a multi-line
// comment opened by an EARLIER line: that is what decides, in each caller,
// whether this line is a candidate heading/terminator. The very line that
// OPENS the fence/the comment is never `wasHidden` (it was visible when it was
// reached), but it does not need to be either: neither a fence delimiter nor a
// "<!--" ever looks like an ATX heading or a self-contained marker, so it does
// not matter whether they get evaluated against those predicates — they never
// match by accident.
function stepLine(line, state) {
  const wasHidden = state.inFence || state.inComment
  if (state.inComment) {
    if (line.includes(COMMENT_CLOSE_TOKEN)) return { state: { ...state, inComment: false }, wasHidden }
    return { state, wasHidden }
  }
  if (state.inFence) {
    const step = stepFence(line, state)
    return { state: step.state, wasHidden }
  }
  const fenceStep = stepFence(line, state)
  if (fenceStep.isFenceDelim) return { state: fenceStep.state, wasHidden }
  const openIdx = line.indexOf(COMMENT_OPEN_TOKEN)
  if (openIdx !== -1) {
    const closesSameLine = line.indexOf(COMMENT_CLOSE_TOKEN, openIdx + COMMENT_OPEN_TOKEN.length) !== -1
    if (!closesSameLine) return { state: { ...state, inComment: true }, wasHidden }
  }
  return { state, wasHidden }
}

// scanLines: walks `body` line by line, carrying the combined
// fence+comment state with `stepLine`, and returns the first line (index +
// absolute offset into the string) that satisfies `predicate`, IGNORING
// entirely the lines hidden inside a fence or a multi-line comment. It is the
// shared mechanism behind locateSection/locateLine — review round 3 (Critical
// 1): before, both the heading and the section terminator were looked for with
// a regex over the WHOLE string, with no distinction between "inside a code
// fence" (and, since round 5, "inside an HTML comment") and "real structure of
// the document".
function scanLines(body, predicate) {
  const src = body || ''
  const lines = src.split('\n')
  let offset = 0
  let state = initLineState()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const step = stepLine(line, state)
    state = step.state
    if (!step.wasHidden && predicate(line, i, offset)) {
      return { index: i, offset, line }
    }
    offset += line.length + 1
  }
  return null
}

// outsideOf (final branch review, C2): the predicate "this match does NOT
// fall inside a forbidden range of the body itself". A single implementation,
// shared by locateSection and locateLine, because the problem is the same in
// both: both keep the FIRST appearance over the WHOLE body, with no notion of
// "this bit here belongs to someone else and is not to be touched".
//
// The real case: the coordinator session pastes into "## Contexto heredado"
// the context of the previous slice's issue — which carries the SAME headings
// and the SAME link line to the spec as every issue of the epic, because the
// same generator writes them. Without this filter, its text becomes the
// splice's target, and the placeholder the section is created with («`/ct-groom`
// no escribe aquí ni reescribe lo que escribas») becomes a lie.
//
// `range` is `{ start, end }` in absolute offsets of the body, or
// null/undefined (no forbidden zone — the behaviour of always). A half-open
// interval [start, end): the character at `end` is already outside.
//
// WHAT THIS PROTECTS DEPENDS ENTIRELY ON THE RANGE IT IS HANDED, and it is
// worth saying so here because the first version of this filter fell short for
// not seeing it. If the range is that of the inherited section exactly as
// `locateSection` returns it, it protects against no heading at all: that
// function TERMINATES the section at the first ATX heading (F5's hardening,
// round 5), so the heading somebody pastes inside is precisely the one that
// closes the range and ends up OUTSIDE it. The caller decides where the zone
// ends — see `zonaHeredada` in reconcile.js, which takes it as far as "##
// Acceptance criteria" precisely so that pasted headings do fall inside. This
// helper has no opinion about that: it only applies the interval it
// receives.
function outsideOf(range) {
  if (!range) return () => true
  return (offset) => offset < range.start || offset >= range.end
}

// unterminatedDelimiter (final branch review, C3): walks `text` with the SAME
// state scanner as scanLines/locateSection (stepLine) and says whether, on
// reaching the end, a code fence or an HTML comment was left OPEN. It returns
// `'valla'`, `'comentario'` or `null`.
//
// It is the missing half of the section guardrail. `locateSection` and
// `groom.js#truncationLine` can only catch what ends a section TOO EARLY; an
// unclosed delimiter does exactly the opposite: it hides every following line,
// so there stops being a terminator and the section swallows whatever comes
// after it. With no noise, no warning, and with a later splice that deletes
// from the heading to the end of the body.
//
// It lives here, and not in groom.js, for the same reason `locateSection` is
// reused over the spec's text instead of writing a second scanner: the one in
// this file carries the hardening of fences (character, length, info string)
// and of multi-line comments from rounds 4 and 5 of F5, and a second
// implementation would drift from it.
export function unterminatedDelimiter(text) {
  let state = initLineState()
  for (const line of (text || '').split('\n')) {
    state = stepLine(line, state).state
  }
  if (state.inComment) return 'comentario'
  if (state.inFence) return 'valla'
  return null
}

// headingMatcher: `headings` is a string (the exact heading) or an array of
// strings (a CLOSED set of acceptable headings — see AC_HEADING_FORMS below,
// review round 5, Important 4). Always exact equality modulo trailing spaces
// (`trimEnd()`, which also absorbs a CRLF's `\r` since `trim`/`trimEnd` treat
// it as whitespace) against ANY of the alternatives — never an open prefix
// (see why in locateSection).
function headingMatcher(headings) {
  const list = Array.isArray(headings) ? headings : [headings]
  return (line) => list.includes(line.trimEnd())
}

// locateSection: finds where a section of the body lives (buildIssueBody in
// groom.js generates a handful of sections with a fixed heading: "##
// Acceptance criteria…", "## Dependencias", "## Out of scope / Protected",
// "## Descripción") — delimited by its own heading and by the same "end of
// section" criterion extractAc already used: the next ATX heading, the
// self-contained `<!-- ct-order -->` marker, or the end of the body. It
// returns `null` if the heading does not appear at all.
//
// `headingText` accepts a string or an array of strings (see headingMatcher)
// — review round 5, Important 4: until now "## Acceptance criteria" was the
// ONLY case with `{ exact: false }` (an open prefix), because it is the only
// one of the four headings with a legitimate suffix ("(EARS, 1:1 con
// tests)"). But buildIssueBody (groom.js) emits ONLY two fixed strings for
// that heading (the current one and, in older bodies, the one from before EARS
// was added) — the legitimate gap is a CLOSED SET of two elements, not an open
// prefix. With an open prefix, a "## Acceptance criteria propuestos por QA
// (borrador)" written by a human ABOVE the real section was claimed as if it
// were it: the dispatcher injected ZERO real criteria into the agent's prompt,
// and --reconcile would have replaced QA's prose. See AC_HEADING_FORMS below.
//
// The OTHER three headings (Descripción/Dependencias/Out of scope) still
// demand exact equality with a SINGLE string: with a generic `startsWith`
// (round 3), a human writing `## Dependencias externas (notas del equipo)` — a
// section of their own, about ANOTHER thing — was claimed AS IF IT WERE the
// real dependencies section: --reconcile replaced that human prose with `-
// merge-after #N` and left the real section (if there was one, somewhere else
// in the body) obsolete and invisible, a stable exit 0 forever.
//
// It is used both to EXTRACT content (comparing spec vs. issue — F5) and to
// REPLACE it surgically (F5 --reconcile, see
// scripts/reconcile.js#buildReconcileBody): the positions `headingStart`/
// `headingEnd`/`contentEnd` allow a `body.slice(...)` that touches ONLY that
// section, leaving intact any human content before it, after it, or in any new
// section the human has added elsewhere in the body.
// `forbidden` (optional, final branch review C2): a `{start, end}` range of
// the body whose content belongs to another owner. A heading that falls inside
// is DISCARDED and the search carries on with the next appearance outside the
// range — see `outsideOf` above, its measured limit included.
export function locateSection(body, headingText, forbidden = null) {
  const src = body || ''
  const matches = headingMatcher(headingText)
  const allowed = outsideOf(forbidden)
  const heading = scanLines(src, (line, _i, offset) => matches(line) && allowed(offset))
  if (!heading) return null
  const headingStart = heading.offset
  // headingEnd: just after the '\n' that closes the heading line (if the body
  // ends right there, with no further lines, headingEnd is src.length).
  const headingEnd = Math.min(headingStart + heading.line.length + 1, src.length)

  // Terminator: the first line (from the one after the heading onwards),
  // ignoring hidden lines (inside a fence OR a multi-line comment — see
  // stepLine, review round 5, Critical 1), that is another ATX heading (review
  // round 5, Critical 2: any level from "#" to "######", not only a literal
  // "## " — see ATX_HEADING_RE) or a SELF-CONTAINED comment (it opens AND
  // closes on the same line — the real `<!-- ct-order:N -->` marker). The
  // opening of a MULTI-LINE comment (a "<!--" with no "-->" on that same line)
  // NEVER terminates the section on its own: instead, it makes the following
  // lines hidden (`wasHidden`) until the comment itself closes — the real
  // terminator is still whatever comes AFTER that closing. `consumed`
  // accumulates, line by line, the START position (relative to headingEnd) of
  // the line being evaluated — on finding the terminator on line `i`,
  // `consumed` does NOT yet include that line, so it points at the '\n'
  // character immediately preceding it (or at headingEnd if there is no
  // content line in between), so that the "blank line before the next heading"
  // format buildIssueBody generates is preserved when rebuilding the splice
  // (see buildReconcileBody).
  const restLines = src.slice(headingEnd).split('\n')
  let state = initLineState()
  let consumed = 0
  let contentEnd = src.length
  for (let i = 0; i < restLines.length; i++) {
    const line = restLines[i]
    const step = stepLine(line, state)
    state = step.state
    const isSelfContainedComment = line.startsWith(COMMENT_OPEN_TOKEN) && line.includes(COMMENT_CLOSE_TOKEN)
    if (!step.wasHidden && (ATX_HEADING_RE.test(line) || isSelfContainedComment)) {
      contentEnd = headingEnd + Math.max(consumed - 1, 0)
      break
    }
    consumed += line.length + 1
  }
  return { headingStart, headingEnd, contentEnd, content: src.slice(headingEnd, contentEnd) }
}

export function extractSectionContent(body, headingText) {
  const loc = locateSection(body, headingText)
  return loc ? loc.content.trim() : null
}

// locateLine / extractLine: like locateSection, but for a SINGLE-line entity
// (no heading + delimited content) — used for the link line to the spec that
// buildIssueBody writes as the body's first line (`> Slice #N del epic. Spec:
// […]`). The same criterion of anchoring at column 0 and of ignoring lines
// hidden inside a code fence or a multi-line HTML comment
// (scanLines/stepLine, review round 5).
// `prefix` accepts a string or an array of strings (F6): the link line to the
// spec has TWO valid forms — the usual one ("> Slice #N …") and the one that
// avoids the false autolink ("> Slice `#N` …", see SPEC_LINK_PREFIXES). An
// array is a CLOSED set of alternatives, never a shorter prefix that
// encompasses both ("> Slice ", which would also claim any quoted line that
// starts with those words) — the same criterion as
// headingMatcher/AC_HEADING_FORMS.
//
// `forbidden` (optional, final branch review C2): the same range and the same
// criterion as in locateSection — see `outsideOf`. Here is where it really
// bites: the link line to the spec is NOT a heading, so it does not close the
// inherited section and can live inside it (the coordinator pastes the
// previous issue's context, link included).
export function locateLine(body, prefix, forbidden = null) {
  const prefixes = Array.isArray(prefix) ? prefix : [prefix]
  const allowed = outsideOf(forbidden)
  const found = scanLines(body, (line, _i, offset) => prefixes.some((p) => line.startsWith(p)) && allowed(offset))
  if (!found) return null
  return { start: found.offset, end: found.offset + found.line.length, line: found.line }
}
export function extractLine(body, prefix) {
  const loc = locateLine(body, prefix)
  return loc ? loc.line : null
}

// extractSpecLink: the line `> Slice #N del epic. Spec: […]` that
// buildIssueBody (groom.js) always writes as the body's first line — review
// round 3, important 5: it is content the spec genuinely owns (F10: it derives
// from the spec's own path inside its repo and from the heading under which
// the §9 table lives), not bookkeeping like the `ct-order` marker — so F5
// compares it just like the title.
// SPEC_LINK_PREFIXES: the two forms buildIssueBody has emitted for that line —
// with the order between backticks (F6, the current one: it stops GitHub
// linking the slice ORDER to the ISSUE with that number) and without them (the
// already-created issues, which are not migrated). A CLOSED set, just like
// AC_HEADING_FORMS and for the same reason: the bare prefix "> Slice " would
// claim as a link to the spec any quoted line that starts with those two
// words.
export const SPEC_LINK_PREFIXES = ['> Slice `#', '> Slice #']
export function extractSpecLink(body) {
  return extractLine(body, SPEC_LINK_PREFIXES)
}

// normalizeSpecLink (F10, replaces specLinkAnchor): the canonical form of a
// link line to the spec, for comparing it against another.
//
// specLinkAnchor extracted ONLY the "#section" anchor and discarded the path
// on purpose (review round 4, important 4): until F10, ct-groom.mjs composed
// the line with `process.argv[2]` as it came, so the SAME §9 produced
// "docs/spec.md#9" from a slash command and "/Users/.../docs/spec.md#9" from a
// cron — comparing the whole line would have made each invocation rewrite the
// other's, forever. The price was not detecting that the spec had moved to
// another file.
//
// F10 removes the cause: the line is now composed of the path relative to the
// repo root + the remote + the default branch (scripts/spec-link.js), three
// properties of the REPOSITORY, not of whoever invokes. There are no longer
// two possible notations of the same thing, so the whole line is compared and
// what used to go undetected is gained: a spec moved to another file, a link
// pointing at another repo, and (most immediately) the issues created before
// F10, whose broken relative link now gets reported as drift instead of
// passing as good because the "9" happened to match.
//
// The only thing that is normalised is the whitespace at the ends: an editor
// that adds or removes a space at the end of the line is not a change of
// content.
export function normalizeSpecLink(specLinkLine) {
  if (specLinkLine === null || specLinkLine === undefined) return null
  return String(specLinkLine).trim()
}

// specTarget (F23): the TARGET of the link to the spec — what renderSpecLink
// (scripts/groom.js) writes after "Spec: ". It answers a different question
// from diffIssue's, and that is why it does not reuse its comparison:
//
//   diffIssue asks "has THIS issue's link line changed with respect to what
//   the spec produces today?" — it is content of the spec, its drift is
//   reportable, and since F10 it is compared IN FULL on purpose (it detects
//   that the spec has moved file or repo).
//
//   specTarget asks "do these two issues point at the SAME document?", in
//   order to decide whether an issue from another milestone is really this
//   very epic under another title. There the prefix gets in the way: the line
//   starts with "> Slice `#N` del epic. " and that prefix (a) carries the
//   slice's order and (b) changed format in F6 (`#N` with backticks, see
//   SPEC_LINK_PREFIXES), so comparing the whole line would give a false
//   negative on any issue created before F6.
//
// It fails OPEN by design, and the price of that failure has to be said in
// full, because it is NOT the status quo. The premise comes first: if the epic
// is renamed on GitHub, `inEpic` comes out empty —that run sees none of its
// issues— and it will recreate the whole epic. The only thing that can stop it
// is the caller's door B (ct-groom.mjs), and to fire it one has to recognise
// that the issue of that other milestone points at the same document. What is
// compared here, at that call site, is the EXISTING issue against what the
// spec produces TODAY for that same order (`specTargetPorOrden`) — not one
// issue against another issue. If those two targets do not match, the door
// does not fire and the epic is duplicated in full with exit 0: this function
// does not cause that, but it is what lets it happen. Before F23, with the
// global pairing, those same issues were found by marker and drift came out
// with exit 3 without creating anything. That is: the false negative restores
// no previous behaviour, it lets through a hole that did not exist before. It
// is a risk ACCEPTED in exchange for not bricking the normal case — a false
// positive would stop dead two different epics reusing order numbers, which is
// precisely what F23 comes to enable. The caller compensates by warning on
// stderr about every discard that could end in duplication —that of a slice
// that does not yet have an issue in the run's epic—, without blocking.
//
// The two real ways two targets can differ for the SAME document (the third
// —"two invocation habits, relative vs. absolute"— was eliminated by F10: the
// line is no longer composed of argv, but of the path inside the repo, the
// remote and the default branch; see normalizeSpecLink above):
//   (a) issues groomed BEFORE F10, which carry the link in the old relative
//       form ("[docs/x.md#9](docs/x.md#9)");
//   (b) the degraded form "— sin enlace: <motivo>" that
//       groom.js#renderSpecLink emits when the spec was not published at
//       grooming time (scripts/spec-link.js#SPEC_REF_REASONS enumerates the
//       reasons).
const SPEC_TARGET_SEPARATOR = 'Spec: '
export function specTarget(specLinkLine) {
  const line = normalizeSpecLink(specLinkLine)
  if (line === null) return null
  const at = line.indexOf(SPEC_TARGET_SEPARATOR)
  if (at === -1) return null
  const target = line.slice(at + SPEC_TARGET_SEPARATOR.length).trim()
  return target.length > 0 ? target : null
}

// countHeadingLines: how many times a heading appears (the same criterion of
// exact/set equality and of hidden lines — fence or comment — as
// locateSection) in the whole body — not just whether it appears, but HOW MANY
// times. Review round 3 (minor): locateSection always finds/splices the FIRST
// appearance; if a human duplicated a section by hand (copy-paste, a badly
// resolved merge conflict…), the second copy is invisible both to the
// comparison and to --reconcile. It is used to warn about that situation, not
// to decide what gets applied (that is still, on purpose, "the first one").
// `headingText` accepts an array (see headingMatcher) — for AC, the two forms
// of AC_HEADING_FORMS count as the SAME conceptual section: one of each form
// is also a "duplicate".
export function countHeadingLines(body, headingText) {
  const src = body || ''
  const matches = headingMatcher(headingText)
  const lines = src.split('\n')
  let state = initLineState()
  let count = 0
  for (const line of lines) {
    const step = stepLine(line, state)
    state = step.state
    if (!step.wasHidden && matches(line)) count++
  }
  return count
}

// AC_HEADING_FORMS (review round 5, Important 4): buildIssueBody (groom.js)
// emits a SINGLE fixed string for the AC heading — but that string changed
// once in the project's history (the suffix "(EARS, 1:1 con tests)" was added
// to it), so an issue created with the old version of the generator still
// carries the earlier form. The legitimate gap is therefore a CLOSED SET of
// exactly two strings — never an open prefix (`{ exact: false }`, the version
// from before this round): with a prefix, a "## Acceptance criteria propuestos
// por QA (borrador)" written by a human above the real section was claimed as
// if it were it — the dispatcher injected ZERO real criteria into the agent's
// prompt, and --reconcile would have replaced QA's prose.
export const AC_HEADING_FORMS = ['## Acceptance criteria', '## Acceptance criteria (EARS, 1:1 con tests)']

// extractAc: locates the AC section against the closed set AC_HEADING_FORMS
// (see above) — never by prefix.
export function extractAc(body) {
  const section = extractSectionContent(body, AC_HEADING_FORMS)
  if (section == null) return []
  return section.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter((l) => l && l !== '(rellenar desde el spec)')
}

// E2E_HEADING (TASK 9): the runs section of the issue body. It lives HERE,
// alongside its sisters AC_HEADING_FORMS/DEPS_HEADING (above), and not in
// groom.js: this file is already the one that centralises the headings that
// groom.js#buildIssueBody WRITES and the real dispatcher (mapGhIssue, below)
// READS — the dependency always ran in that direction (groom.js imports
// `locateSection`/`unterminatedDelimiter`/`normalizeToLF` FROM HERE). Defining
// it in groom.js and re-importing it would have closed a cycle between the two
// modules over a text constant; groom.js imports it back and re-exports it, so
// as not to move the import of its other two consumers (reconcile.js and the
// tests).
export const E2E_HEADING = '## E2E'

// extractE2eRuns (TASK 9): the runs of the issue's "## E2E" section, with the
// SAME pattern as extractAc — `extractSectionContent` (locateSection
// underneath), not a new parser, and the "- <run>" lines read VERBATIM
// (groom.js#renderE2eContent wrote them that way on purpose, so that the
// gate's report can quote them as they are).
//
// The dispatcher (/ct-next) rebuilds the slice FROM THE ISSUE — it never opens
// the spec — so this is the ONLY way `slice.e2eRuns` arrives populated on the
// real dispatch path; `resolveE2e(slice.e2e)` (gates.js) is still /ct-groom's
// path, which does have the raw cell of the §9 table.
//
// `groom.js#buildIssueBody` omits the WHOLE section when there is no run at
// all (unlike "## Gates", which is always emitted) — so its absence is
// indistinguishable from "zero runs", and both give `[]`, never `undefined`: a
// slice with no e2e has to say "no e2e" with a datum, not with a missing
// field.
// Exported (Task 10): `dispatch-check.mjs#--release` reuses it for the F-e2e
// door (exit 8) — the very function `/ct-next` uses to seed the worktree, so
// the two readings of the "## E2E" section can never disagree with each other
// through a different parse.
export function extractE2eRuns(body) {
  const section = extractSectionContent(body, E2E_HEADING)
  if (section == null) return []
  return section.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter(Boolean)
}

// extractDeps: reads ALL the `merge-after #N` references from whatever string
// it is handed, without anchoring itself to any section — the SCOPE (the whole
// body, or only a section's content) is decided by the caller. It is still a
// bare regex on purpose: `extractDepsInSection` (below) is the single source
// of truth of "which section to look at", shared between mapGhIssue (the real
// dispatcher) and reconcile.js.
//
// D1 finding 2 (hardening of the dispatch — the history of this decision):
// until this round, mapGhIssue called extractDeps over the WHOLE body
// (dispatch.js needed to see any `merge-after`, wherever it lived), while
// scripts/reconcile.js (F5, review round 3, Critical 3) already called it ONLY
// over the content of "## Dependencias" — the only section --reconcile can
// safely touch through a splice. That deliberate divergence had a real cost: a
// "merge-after #N" quoted in the prose of an Acceptance Criterion (never meant
// as a dependency) DID block the dispatcher, but --reconcile could never
// "resolve" it (there is no safe splice outside the recognised section) — the
// same datum, two behaviours irreconcilable with each other. The auditor also
// found that the absence of a section anchor hid a second class of bug: a
// human rewrite of the dependency line ("Depende de #1 (merge primero)", or a
// simple lost hyphen in "merge after #1") does not match the regex — zero deps
// extracted, indistinguishable from "this slice has no dependencies". The gate
// opens in silence.
//
// D1 unifies the domain: mapGhIssue now uses `extractDepsInSection`, EXACTLY
// the same function (and therefore the same scope) as reconcile.js. Cost
// explicitly accepted: an issue created/edited by hand with a "merge-after" in
// free text, outside "## Dependencias", stops being honoured by the dispatcher
// — just as it had already stopped being honoured by --reconcile. Gain: the
// same body produces the SAME reading for anyone who reads it, and the
// section-present-but-with-no-matches stops being a silent `[]` (see
// `malformed` in extractDepsInSection) — dispatch.js no longer treats it as
// "no dependencies".
//
// F6 (serious 1) — the EMITTED format changes to inline code (``merge-after
// `#N` ``) so that GitHub stops autolinking the slice order to the issue with
// that number (see groom.js#DEPS_ORDER_NOTE). The READER accepts both forms,
// forever: the issues already created in real repos carry the old format and
// are NOT migrated (nobody rewrites an existing body just for this; an old
// body only adopts the new format if `--reconcile` was already going to
// rewrite that section over a real drift). The closing backtick is not
// demanded: what identifies the reference is the number that follows
// "merge-after".
export function extractDeps(body) {
  return [...(body || '').matchAll(/merge-after `?#(\d+)/g)].map((m) => parseInt(m[1], 10))
}

// SENAL_HEADING (Slice 10): the section of the issue body that declares the
// slice's observability signal (or its reasoned exemption `N/A — <reason>`).
// The constant is BORN here and not in groom.js, even though groom is the one
// that writes it: this file is the lower layer (groom.js already imports from
// here) and mapGhIssue needs it too, to extract it from the body — putting it
// in groom.js would create a circular import. groom.js re-exports it so that
// its consumers do not have to know where it was born, the same treatment as
// its sister headings.
export const SENAL_HEADING = '## Señal de observabilidad'

// extractSenal (Slice 10): section-scoped with extractSectionContent — the
// first appearance wins, the same stance as extractAc (locateSection always
// returns the first copy; a duplicate is a badly resolved merge and the first
// one is the one everybody compares against and obeys). It returns the trimmed
// content verbatim, or null with no section — mapGhIssue additionally
// collapses empty content to null (section present but blank = absent).
export function extractSenal(body) {
  return extractSectionContent(body, SENAL_HEADING)
}

// DEPS_HEADING / extractDepsInSection: the SINGLE source of "which deps
// anyone reading this body sees" — mapGhIssue (the real dispatcher) and
// reconcile.js#depsInSection share it (D1 finding 2). `malformed: true` is the
// signal that used to be wasted: the section exists (something was attempted
// as a declaration) but no "merge-after #N" matched inside it — it can never
// happen with a body buildIssueBody really generated (it only emits the
// heading when `deps.length > 0`, and always as "merge-after #N"), so if it
// happens it is because a human rewrote the line by hand in a way the regex no
// longer recognises. Whoever consumes this (mapGhIssue) treats `malformed` as
// "the real state of this gate is UNKNOWN" — never as "no dependencies"
// (fail-closed, just as an unmappable order is translated to `null` instead of
// to "satisfied").
export const DEPS_HEADING = '## Dependencias'
export function extractDepsInSection(body) {
  const content = extractSectionContent(body, DEPS_HEADING)
  if (content == null) return { deps: [], malformed: false }
  const deps = extractDeps(content)
  // `malformed` (round 2 of D1's review — the first heuristic, counting "- "
  // bullets against extracted deps, was NOT the right axis): it is defeated by
  // any GOOD line with two "merge-after" in a single bullet (it inflates deps
  // without inflating bullets → false negative) and by any BROKEN line that
  // does not use "- " (a "*" bullet, a numbered list, or no bullet at all →
  // false negative too), and it fires falsely on a NOTE with no relation
  // whatsoever to dependencies that merely happens to share space with a real
  // one already read correctly (false positive).
  //
  // The signal that really tells "this line meant to declare a dependency and
  // is badly written" from "this line is a note" is another one: ANY "#N"
  // reference in the section's content — whether or not it is part of a
  // recognised "merge-after #N" — that mentions a number `merge-after` NEVER
  // captured. A real note ("ojo: revisar con Ana") mentions no "#N" at all, so
  // it never fires this. Comparison by VALUE (the number), not by position nor
  // by bullet shape: it does not matter whether the broken line uses "-", "*",
  // numbering or no bullet, and the SAME reference repeated in prose (e.g.
  // "ver también #1 en el spec", with #1 ALREADY recognised as a dependency)
  // does not count as a problem — only a NUMBER that does not appear among the
  // already-extracted deps signals a real human rewrite.
  //
  // `deps.length === 0` is kept as a separate base case: buildIssueBody NEVER
  // emits the heading without at least one real "merge-after #N", so ZERO deps
  // extracted (including a completely empty section, with no "#N" reference at
  // all) is already, on its own, a divergence from the invariant —
  // independently of whether there is a loose "#N" to confirm it.
  const hashRefs = [...content.matchAll(/#(\d+)/g)].map((m) => parseInt(m[1], 10))
  const depsSet = new Set(deps)
  const hasUncoveredRef = hashRefs.some((n) => !depsSet.has(n))
  return { deps, malformed: deps.length === 0 || hasUncoveredRef }
}

// extractStrayDeps (D1 finding 1, review follow-up): narrowing the
// dispatcher's deps domain to "## Dependencias" (D1 finding 2) opened a door
// `main` kept shut — a `merge-after #N` that lives OUTSIDE the recognised
// section (e.g. under "## Descripción", or in an AC's prose) no longer counts
// as a real dependency for anyone (neither the dispatcher nor --reconcile, see
// the history in reconcile.js). That narrowing is correct and wanted — but it
// is invisible if nothing says so: an issue whose author wrote their
// dependency in the wrong place gets dispatched silently, with nobody knowing
// that their attempted block stopped applying. `extractStrayDeps` exposes
// those ignored references — the SAME function used both by mapGhIssue (so
// that ct-next.mjs can warn) and by reconcile.js#diffIssue (which already
// computed exactly this for its own "note" report — one shared implementation,
// not two that can drift).
export function extractStrayDeps(body, sectionDeps) {
  const wholeBodyDeps = extractDeps(body || '')
  const sectionDepsSet = new Set(sectionDeps || [])
  return [...new Set(wholeBodyDeps)].filter((d) => !sectionDepsSet.has(d)).sort((a, b) => a - b)
}

// extractOrder: reads the `<!-- ct-order:N -->` marker that
// groom.js#buildIssueBody writes into EVERY issue, using the slice's ORDER
// number (slice.n, the position in the spec's §9 table) — not the GitHub issue
// number. It is the only reliable bridge between the two ID spaces: the issue
// number is assigned by GitHub when the issue is created (it is not
// controlled), the order is decided by the spec. See
// buildOrderIndex/buildDispatchInput below for the translation.
export function extractOrder(body) {
  // Anchored to the REAL, WHOLE marker: a line that is exactly
  // "<!-- ct-order:N -->" (an opening <!-- + a closing -->, with /m for line by
  // line). Demanding only "-->" is not enough: a frozen decision that writes
  // "ct-order:99 -->" in its prose would fool it. Without this anchor, any text
  // AHEAD of the real marker (e.g. a "## Decisiones congeladas" section that
  // talks about ct-order) would be read as the issue's order, would collide in
  // buildOrderIndex and would take the whole epic out of the dispatch.
  const m = (body || '').match(/^<!--\s*ct-order:(\d+)\s*-->\s*$/m)
  return m ? parseInt(m[1], 10) : null
}

// STATUS_PRECEDENCE / resolveStatus (D1 finding 3): a half-finished label
// edit (a new `status:X` is added without removing the old `status:Y`) leaves
// TWO `status:` labels on the same issue. The previous code used
// `Array.prototype.find`, which keeps the FIRST of the array `gh` returns —
// the auditor verified that THAT array's order changes the result
// (`['status:in-progress','status:ready']` resolves differently from the same
// array reversed) and could not determine offline which order GitHub really
// uses. The explicit instruction is not to guess it: the criterion has to be
// independent of the array's order.
//
// Instead of trying to work out WHICH of the two labels is "the real one"
// (there are two observed consequences if it is chosen wrong: in the "ready
// wins" direction, an issue already claimed (really in-progress) is treated as
// dispatchable AND does not count in the in-flight tally against the cap — the
// two worst possible consequences at once), the most conservative reading is
// ALWAYS applied: in-progress > in-review > ready > backlog. It is the one
// least likely to redispatch the same work twice or to leave it outside the
// cap — it is not "guessing which label is correct", it is "assuming the state
// that does least harm if we are wrong". `statusLabels` is exposed so that
// whoever detects `statusAmbiguous` can warn with the exact detail of which
// labels clashed (see ct-next.mjs).
// Exported (F6): ct-groom.mjs needs it in order to say, when it finishes, how
// many issues of the epic are still not dispatchable — with EXACTLY the same
// criterion the dispatcher applies, not with a second reading of labels that
// could disagree with it.
const STATUS_PRECEDENCE = ['in-progress', 'in-review', 'ready', 'backlog']
export function resolveStatus(labels) {
  const statusLabels = labels.filter((l) => l.startsWith('status:')).map((l) => l.slice('status:'.length))
  if (statusLabels.length === 0) return { status: 'backlog', statusAmbiguous: false, statusLabels }
  if (statusLabels.length === 1) return { status: statusLabels[0], statusAmbiguous: false, statusLabels }
  // Minor (D1's review): if NONE of the clashing labels is one of the four
  // known ones (e.g. two custom labels like "status:blocked" and
  // "status:paused" — neither gates anything in dispatch.js, so the dispatch
  // DECISION does not change whatever happens here), the earlier `??
  // statusLabels[0]` still returned the FIRST of the array exactly as it
  // arrives from GitHub — the same unverifiable order this function exists in
  // order not to depend on. The warning's TEXT (ct-next.mjs) does depend on
  // this value, and that was precisely the guarantee that was asked to be
  // independent of the order: it is sorted alphabetically before taking the
  // first one as a deterministic fallback.
  const resolved = STATUS_PRECEDENCE.find((s) => statusLabels.includes(s)) ?? [...statusLabels].sort()[0]
  return { status: resolved, statusAmbiguous: true, statusLabels }
}

export function mapGhIssue(i) {
  const labels = (i.labels || []).map((l) => l.name)
  const { status, statusAmbiguous, statusLabels } = resolveStatus(labels)
  // touches: it includes BOTH `touches:` and `area:` (fix from the final
  // review, finding 5): claim.js#tokensOf already treated both prefixes as
  // equally relevant for a collision (and §14 of the spec defines the conflict
  // as a shared `area:` OR `touches:` token), but this mapping only looked at
  // `touches:` — so `selectNext` (selection/co-dispatch in ct-next.mjs) could
  // launch two slices that share ONLY an `area:` (e.g. `area:api` in both)
  // without detecting the collision, and only dispatch-check.mjs detected it
  // afterwards, with the worktrees and agents already launched. The prefix
  // (whichever it is) is stripped as before so as not to break the
  // already-tested convention of "bare" tokens that
  // SERIALIZING_TOUCHES/runningTouches use in dispatch.js.
  //
  // D1 finding 4: an "area:"/"touches:" label WITH NO VALUE (the colon
  // present, nothing behind it — e.g. created by accident in GitHub's editor)
  // strips to the EMPTY string. Unfiltered, two issues with that broken label
  // "collide" over '' in dispatch.js#touchesConflict even though they share no
  // real area/touch — an empty token represents nothing, it is discarded
  // before entering the collision machinery. `.trim()` BEFORE filtering by
  // length (adversarial attack: "area: ", a colon followed by whitespace with
  // no real content, strips to ' ' — not the empty string — and a filter that
  // only looked at `.length > 0` would let the SAME bug through with a
  // different character).
  const touches = labels
    .filter((l) => l.startsWith('touches:') || l.startsWith('area:'))
    .map((l) => l.slice(l.indexOf(':') + 1).trim())
    .filter((t) => t.length > 0)
  const type = (labels.find((l) => l.startsWith('type:')) || 'type:').slice('type:'.length)
  // gates (F21): the human gate comes back from the ISSUE, not from the spec
  // — which is what makes it survive a redispatch, a `--reopen` and any
  // session that rehydrates. `gatesDeclared` tells "this slice has no gates"
  // (a `gate:none` label) from "this issue predates the gates" (no `gate:`
  // label at all), and that distinction is not cosmetic: in the second case
  // kickoff.js falls back to the `Tipo`, so that the already-groomed `type:ui`
  // issues do not lose their screenshot gate the day this is deployed. The
  // `gate:` values that are not in the vocabulary are discarded (gates.js) —
  // the agent is never announced a gate whose text nobody knows how to
  // write.
  const { gates, declared: gatesDeclared } = gatesFromLabels(labels)
  const body = i.body || ''
  const order = extractOrder(body)
  // deps here stay in ORDER SPACE (groom.js#buildIssueBody writes
  // `merge-after #<order>`, not `#<issue>`) — see buildDispatchInput for the
  // translation into issue-number space before comparing against mergedIssues
  // (which are real issue numbers).
  //
  // D1 finding 2: extractDepsInSection (above) — not extractDeps over the
  // whole body — is what decides the scope now: only "## Dependencias".
  // `depsMalformed` travels as it is all the way to
  // dispatch.js#computeReadyCandidates, which treats an issue like that as NOT
  // ready to dispatch (never as "no dependencies" — see the comment on
  // extractDepsInSection).
  const { deps, malformed: depsMalformed } = extractDepsInSection(body)
  // strayDeps (D1 finding 1, review follow-up): "merge-after #N" references
  // that exist in the body but OUTSIDE the recognised section — finding 2's
  // narrowing means they no longer count as a real dependency, so they are
  // exposed separately so that ct-next.mjs can warn instead of silently
  // dispatching an issue whose intended dependency lives in the wrong place.
  const strayDeps = extractStrayDeps(body, deps)
  return {
    n: i.number,
    order: order ?? i.number,
    status,
    statusAmbiguous,
    statusLabels,
    deps,
    depsMalformed,
    strayDeps,
    touches,
    type,
    gates,
    gatesDeclared,
    // name: it comes from the issue's TITLE (the spec's Slice column, F3) —
    // not to be confused with `slice.entrega` (the Entrega column) that
    // slices.js/groom.js use for the body's "Descripción" section. The same
    // field name as slices.js#name (the Slice column) on purpose: both structs
    // represent the same concept, so they use the same word.
    name: (i.title || '').replace(/^#\d+\s*/, ''),
    ac: extractAc(body),
    // senal (Slice 10): the observability signal the issue declares — the
    // body's "## Señal de observabilidad" section, first appearance wins (the
    // same stance as extractAc). Empty content = absent: `null` and not '' so
    // that buildStateSeed (kickoff.js) can declare the absence with
    // SENAL_AUSENTE without telling two forms of "nothing" apart.
    senal: extractSenal(body) || null,
    // e2eRuns (TASK 9): see extractE2eRuns above. It is what
    // kickoff.js#resolveE2eRunsForAgent consumes to seed the `e2e` field of
    // .agent/SLICE.md and to name the runs in the kickoff.
    e2eRuns: extractE2eRuns(body),
    issue: `#${i.number}`,
  }
}

// mergedIssues: closed issues whose PR was merged (an explicit approximation
// from the brief: "closed" is not the same as "merged", but it is the only
// thing observable without crossing with the PR graph). Verified against gh
// 2.86 (`gh issue list --json bogusField` lists the valid fields without
// touching the network): the field is called `stateReason`, exactly so, and gh
// exposes the value in the casing of the GraphQL enum `IssueStateReason`
// (upper case: "COMPLETED", "NOT_PLANNED", "REOPENED"). No real lower-case
// variant exists — we do not tolerate one here on purpose (review round 1,
// Minor 3: dead branch removed).
export function filterMergedIssues(closedIssues) {
  return (closedIssues || []).filter((i) => i.stateReason === 'COMPLETED').map((i) => i.number)
}

// ============================================================================
// F13/H4 — THE "CLOSED = MERGED" APPROXIMATION HAS TWO OPPOSITE TRAPS, AND
// NEITHER WAS VISIBLE FROM OUTSIDE.
//
// `filterMergedIssues`'s comment (above) already acknowledged that "closed is
// not the same as merged, but it is the only thing observable without crossing
// with the PR graph". That was honest when it was written; what was missing
// was enumerating the CONSEQUENCES, which are two and run in opposite
// directions:
//
//   (1) FALSE NEGATIVE, silent and permanent. Closing a discarded slice as
//       **not planned** —the semantically correct thing— leaves `stateReason
//       = 'NOT_PLANNED'`, so it does NOT enter `mergedIssues` and ALL its
//       dependents wait forever. Verified against the unfixed code:
//       `/ct-next` answered "falta mergear #7", with #7 closed — an
//       instruction to wait for something that is not going to happen any
//       more, indistinguishable from "#7 is still in progress".
//
//   (2) FALSE POSITIVE. Closing by hand as **completed** without having
//       merged anything satisfies the dep all the same, and the dependent gets
//       dispatched on top of work that does not exist.
//
// WHAT IS FIXED AND WHAT IS NOT, AND WHY. (1) is fixed: it is the case that
// leaves the loop stuck in silence, and it is DETECTABLE with data that is
// already fetched (each closed issue's `state_reason` travels in the same REST
// call that is already made, network cost ZERO). `closedNotCompleted` exposes
// it and ct-next.mjs names it in the unsatisfied-deps message, with the exact
// remedy.
//
// (2) is NOT fixed by crossing the PR graph, and that is a decision, not an
// oversight: telling "closed as completed by a merge" from "closed as
// completed by hand" demands the issue's timeline (GraphQL, one call per
// closed issue) in order to armour a case that requires somebody to close by
// hand as completed a slice that was not merged — whereas (1) happens on doing
// THE RIGHT THING. The cost is not justified; what is done instead is to stop
// PROMISING what is not checked: the §9 contract (ct-init.sh) said
// "`merge-after` significa MERGEADO" and now says what is really looked at and
// what is not. A promise withdrawn is worth more than an expensive half-made
// check.
//
// 'REOPENED' appears here for completeness of the `IssueStateReason` enum: a
// reopened issue is normally OPEN again (and then it does not even reach this
// list), but if it did appear closed with that reason it would not count as
// merged either, and the same message serves. `null`/absent (issues closed
// before GitHub had `state_reason`) also enters: there is no record that it
// was completed, and asserting otherwise would be inventing it.
export function closedNotCompleted(closedIssues) {
  const out = {}
  for (const i of (closedIssues || [])) {
    if (i.stateReason === 'COMPLETED') continue
    out[i.number] = i.stateReason ?? null
  }
  return out
}

// ============================================================================
// F18/H2 — A CLOSED ISSUE THAT KEEPS ITS `status:` LABEL DISAPPEARS FROM THE
// DISPATCHER WITHOUT A WORD.
//
// `/ct-next` only enumerates OPEN issues (state=open). A closed issue with
// `status:ready` still on it stops existing for the dispatcher: it is not
// selected, it does not count as in flight, and —the serious part— it is NAMED
// nowhere.
//
// What happened in the field: the only dispatchable slice was closed by
// accident, and the next run fell through to the repo's next `status:ready`
// (another epic, with no milestone) and explained in detail why THAT one was
// not dispatchable. The operator read a careful explanation of something
// irrelevant, without a single hint that their work had fallen out of the
// queue.
//
// THE RATE, measured (28-jul-2026, production repo, a COMPLETE paginated query
// — not a hand-written list): 10 of 99 closed issues keep a live `status:`
// label. One in ten. It is not a one-off accident: closing the issue and
// removing its label are two separate acts and NOTHING checks the second, so
// the residue accumulates on its own.
//
//   53, 54, 58, 63   COMPLETED  status:in-review
//   155, 245         COMPLETED  status:in-progress
//   156, 157, 161    COMPLETED  status:ready
//   158              COMPLETED  status:blocked
//
// This function returns ALL of them (the `in-review` ones included) and does
// not classify: the separation between "contradiction" and "a slice's normal
// ending" is a PRESENTATION decision and lives in ct-next.mjs, where the
// message is. Here only the datum is looked at, and it already travels in the
// same REST call for closed issues that
// `filterMergedIssues`/`closedNotCompleted` already consume: network cost
// ZERO.
//
// A `status:` label WITH NO value (a bare `status:`, or `status: ` with a
// space) is discarded, with the same criterion and for the same reason as
// empty `area:`/`touches:` in mapGhIssue: an empty token represents no
// state.
export function closedWithLiveStatus(closedIssues) {
  const out = []
  for (const i of (closedIssues || [])) {
    const labels = (i.labels || [])
      .map((l) => (typeof l === 'string' ? l : l?.name))
      .filter((s) => typeof s === 'string')
    const statusLabels = labels
      .filter((l) => l.startsWith('status:'))
      .map((l) => l.slice('status:'.length).trim())
      .filter((s) => s.length > 0)
    if (!statusLabels.length) continue
    out.push({ n: i.number, statusLabels: [...new Set(statusLabels)].sort(), stateReason: i.stateReason ?? null })
  }
  return out
}
// ============================================================================

// NO_MILESTONE_KEY / epicKeyOf (D1 finding 1): /ct-groom numbers slices 1..N
// PER EPIC (one invocation = one `--milestone` = one epic — see
// groom.js#groomPlan) and writes THAT number into `<!-- ct-order:N -->`. The
// order number is therefore NOT unique across the repo — only inside its own
// epic. `epicKeyOf` derives the epic's SCOPE from the real milestone number
// GitHub already assigns to every issue (open or closed) ever since
// ct-groom.mjs exists: ZERO compatibility cost for any issue already groomed
// — not a single existing `ct-order` marker has to be touched, the milestone
// already travels in the raw JSON of `gh api repos/<o>/<r>/issues`. Encoding
// the epic identifier INSIDE the marker itself is discarded (the other option
// that was considered): it would be the SAME information the milestone
// already provides, but it would demand rewriting issues already groomed, or
// keeping two marker formats in parallel indefinitely, for what the
// `milestone` field resolves for free.
//
// An issue with no milestone (created by hand, or from a repo that predates
// ct-groom starting to assign one) falls into the shared `NO_MILESTONE_KEY`
// bucket — better than blowing up, but that bucket can collide again if two
// epics with no milestone reuse order numbers; buildOrderIndex's collision
// detection (further down) covers exactly that case, so the shared bucket
// never fails SILENTLY — at worst, the issues involved are left out of the
// selection with a clear warning (see buildDispatchInput/ct-next.mjs), never
// resolved blind.
export const NO_MILESTONE_KEY = '(sin milestone)'
export function epicKeyOf(rawIssue) {
  const ms = rawIssue?.milestone
  return (ms && Number.isFinite(ms.number)) ? String(ms.number) : NO_MILESTONE_KEY
}

// buildOrderIndex: Map(epicKey -> Map(order -> issue number)), built out of
// ALL the issues (open + closed) of gh's raw enumeration. It has to include
// the closed ones: the typical dependency we want to recognise as satisfied
// is precisely that of an issue ALREADY MERGED (and therefore closed), and
// its ct-order marker (and its milestone) live only in its own body/metadata
// — if we indexed only the open ones, every dependency on an already closed
// issue would vanish from the index the moment it was merged.
//
// D1 finding 1 — DETECTION: before this fix, the index was a single Map
// GLOBAL TO THE REPO and `index.set` kept the LAST issue seen for a repeated
// order — with `[...open, ...closed]`, an ALREADY MERGED issue from ANOTHER
// epic silently won the slot that a `merge-after` of an epic in progress
// needed to resolve against its own sibling. The per-epic scan (above) closes
// the VAST majority of those cases (different epics = different milestones =
// different maps), but a collision WITHIN the same epic is still possible
// (two epics sharing a milestone by mistake — e.g. both with the default
// title "Epic" because nobody passed `--milestone` — or an accidental
// re-groom that left two issues with the same marker). That collision is
// NEVER resolved silently by keeping "the last one" (nor "the first one"): it
// accumulates in `collisions` so that buildDispatchInput leaves the affected
// epic out of the selection (see its own comment) instead of risking a
// dispatch against the wrong dependency — exactly the bug this finding
// describes.
//
// Every slot (epicKey, order) accumulates ALL the distinct issue numbers seen
// for it (not just "the first one" and "the one that clashes") — D1 review:
// with three issues in the same slot, comparing only against "the first one
// seen" produced TWO overlapping collision entries ([first,second] and
// [first,third]), repeating the first one and never letting you see at a
// glance that THREE of them compete for the same slot, not two distinct
// pairs. A single entry per slot, with the complete list of issues involved,
// is easier to read and to act on.
export function buildOrderIndex(rawIssues) {
  // seen: epicKey -> Map(order -> [issue numbers, in the order they were
  // seen, without duplicates]) — EVERYTHING accumulates before deciding what
  // counts as a collision, so that a single entry per slot can be emitted at
  // the end.
  const seen = new Map()
  for (const i of (rawIssues || [])) {
    const order = extractOrder(i.body)
    if (order == null) continue
    const epicKey = epicKeyOf(i)
    if (!seen.has(epicKey)) seen.set(epicKey, new Map())
    const orderMap = seen.get(epicKey)
    if (!orderMap.has(order)) orderMap.set(order, [])
    const issuesHere = orderMap.get(order)
    if (!issuesHere.includes(i.number)) issuesHere.push(i.number)
  }
  const perEpic = new Map()
  const collisions = []
  for (const [epicKey, orderMap] of seen) {
    const outOrderMap = new Map()
    for (const [order, issuesHere] of orderMap) {
      outOrderMap.set(order, issuesHere[0]) // the first one seen keeps the slot; see the comment above on why the exact value no longer matters once there is a collision.
      if (issuesHere.length > 1) {
        collisions.push({ epicKey, order, issues: [...issuesHere].sort((a, b) => a - b) })
      }
    }
    perEpic.set(epicKey, outOrderMap)
  }
  return { perEpic, collisions }
}

// buildDispatchInput: composes mapGhIssue + filterMergedIssues + the
// order→issue translation of `deps` (already scoped per epic, see
// buildOrderIndex) in a single place, so that ct-next.mjs never has to decide
// which ID space it is comparing in. Root cause of the bug found in T10:
// `deps` comes out of mapGhIssue in ORDER space (groom.js writes
// `merge-after #<order>`), but `mergedIssues` are real ISSUE numbers
// (filterMergedIssues reads `i.number`) — comparing one against the other
// without translating leaves any slice with dependencies blocked forever,
// unless order and issue coincide by accident. A dependency whose order does
// not appear in the issue's own epic (neither open nor closed) translates to
// `null`: `mergedIssues` (issue numbers) never contains `null`, so that
// dependency stays permanently unsatisfied instead of throwing or, worse,
// colliding by accident with a real issue number.
//
// `orderCollisions` (D1 finding 1) travels through from buildOrderIndex
// unchanged — ct-next.mjs uses it ONLY to warn (never to abort anything, see
// below). `issues` ALREADY EXCLUDES, right here, any open issue whose OWN
// epicKey is involved in a collision (D1 review, finding 4): the original
// "refuse" aborted the WHOLE BATCH — with the order indexed over closed
// issues too, a collision that lived only among issues merged long ago (an
// epic already finished, unrelated to anything open today) bricked the
// COMPLETE repo for ever, with no remedy but editing GitHub by hand. Going on
// refusing to resolve it silently is still the right direction — what changes
// is the RADIUS: only the epic(s) whose own order collides are left out of
// `issues` (they are neither selected nor counted as in flight, because their
// own order→issue translation cannot be trusted), while an unrelated epic
// (different epicKey, no collision) is seen entirely normally. Leaving them
// out of the selection AS WELL AS out of the in-flight count is deliberate:
// there is no safe way to trust ANY datum of an epic whose own order index is
// corrupted, not even "it is in progress".
export function buildDispatchInput(rawOpenIssues, rawClosedIssues) {
  const allRaw = [...(rawOpenIssues || []), ...(rawClosedIssues || [])]
  const { perEpic, collisions } = buildOrderIndex(allRaw)
  const collidingEpics = new Set(collisions.map((c) => c.epicKey))
  const issues = (rawOpenIssues || [])
    .filter((raw) => !collidingEpics.has(epicKeyOf(raw)))
    .map((raw) => {
      const issue = mapGhIssue(raw)
      const orderMap = perEpic.get(epicKeyOf(raw))
      return {
        ...issue,
        // D-4 — the epic travels with the issue because it is already
        // computed here. In Control Tower the epic IS the milestone (see the
        // header of `epicKeyOf`, above), and `/ct-next` already derives it to
        // detect collisions of the `ct-order` marker. Seeding it into the
        // dispatch keeps every run of `ct-step` from asking `gh` for a datum
        // the dispatcher already had in hand — that is, network on the
        // critical path.
        epic: epicKeyOf(raw),
        deps: (issue.deps || []).map((d) => (orderMap && orderMap.has(d) ? orderMap.get(d) : null)),
      }
    })
  const mergedIssues = filterMergedIssues(rawClosedIssues)
  // depStates (F13/H4): the state of the CLOSED issues that do NOT count as
  // merged, so that whoever cannot get out can know WHY. It travels alongside
  // `mergedIssues` (and is not recomputed in ct-next.mjs) because both things
  // are derived from the SAME list of closed issues: separating them would
  // invite one of them to be filtered and the other not.
  // closedStatusResidue (F18/H2): it travels here for the same reason as
  // `depStates` — it is derived from the SAME list of closed issues, and
  // separating it would invite one of the two derivations to be filtered and
  // the other not.
  return {
    issues,
    mergedIssues,
    depStates: closedNotCompleted(rawClosedIssues),
    closedStatusResidue: closedWithLiveStatus(rawClosedIssues),
    orderCollisions: collisions,
  }
}
