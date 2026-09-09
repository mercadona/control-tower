// F5 — the pure reconciliation logic: until now ct-groom.mjs only knew how to
// say "does an issue with this ct-order marker already exist?" (existence-only
// idempotence). If yes, "it already exists, it is not duplicated" and that was
// that — NEVER looking at whether the issue's title/labels/milestone/AC/deps
// still match what the §9 table produces TODAY. An author who fixes a label, a
// title or a badly placed dependency in the spec and re-runs /ct-groom sees no
// signal at all that nothing changed: the same success message as if everything
// were perfect.
//
// Review round 4 (the reviewer attacked its OWN scanner from round 3, not only
// the three cases it had been given) — three more Criticals:
//   1. The fence tracker (gh-issue-map.js) toggled on ANY delimiter, without
//      looking at type or length — REWRITTEN there (stepFence), it now demands
//      the same character and a length >= the opening, like CommonMark.
//   2. `locateSection` used `startsWith` for ALL FOUR sections, but only AC has
//      a legitimate suffix — REWRITTEN there: exact equality by default, prefix
//      only for AC.
//   3. The degenerate branch of deps insertion (with neither "## Dependencias"
//      NOR "## Out of scope / Protected" locatable) added a new section BLINDLY
//      on every run, with no limit — now it GIVES UP (unresolvedDeps,
//      previously hardcoded to `false`) just as AC already did.
//
// And three Importants:
//   4. The link to the spec was compared by its full text, path included — two
//      invocation habits (relative/absolute) played ping-pong over real issues
//      forever. Now ONLY the `#section` anchor is compared (specLinkAnchor,
//      gh-issue-map.js).
//   5. A DUPLICATED `## Dependencias`/`## Acceptance criteria` changes what the
//      dispatcher does (it knows nothing of "first occurrence") — those two DO
//      count towards the exit code; duplicating Descripción/Protegido is still
//      only cosmetic (a note, it does not count).
//   6. Asymmetry with mapGhIssue: the application stays bounded to the section
//      (on purpose, see point 3 of the previous round), but now the WHOLE body
//      is scanned TOO in order to warn (note:, never drift:) about any
//      `merge-after` the dispatcher would see but that lives outside the
//      recognised section — silence no longer asserts more than the tool
//      knows.
//
// And one Minor: CRLF. All the processing normalises to LF internally
// (gh-issue-map.js#normalizeToLF) and, where it applies, `buildReconcileBody`
// converts the result back to the original line ending before returning it.
//
// Review round 5 — the same diagnosis as round 4, applied to the OTHER two
// delimiter-shaped things that live in the same body: "the fences were hardened
// thoroughly and HTML comments and headings that are not '## ' were left
// intact". Two more Criticals, closed in gh-issue-map.js (see
// stepLine/ATX_HEADING_RE there):
//   1. A MULTI-LINE HTML comment (it opens `<!--` without closing on the same
//      line) did not hide its interior — a known heading "commented out" inside
//      read as real structure, and --reconcile could write INSIDE the comment
//      and delete its own closing `-->`.
//   2. Only a "## " at column 0 ended a section — "#", "###", "####", a "##"
//      with a tab, or indented by 1-3 spaces (all of them real headings on
//      GitHub) ended nothing: their content got swallowed in the splice of the
//      previous section.
//
// And in this file, one more Important and one more Minor:
//   3. `hasDrift` counts duplicateMachineSections, but `reconcileGaps` only
//      covered ac/deps — a real drift (a duplicate) that --reconcile cannot
//      apply came out 0. Now `reconcileGaps` also carries `duplicates` (see
//      that function's comment).
//   4. The justification for why a duplicated AC counts was the SAME as the one
//      for Dependencias (union) — false: only Dependencias unites, AC discards
//      the second copy in silence (see DUPLICATE_CHECKS' comment).
//      `machine: true` is kept for AC — silently discarding a real human edit is
//      as grave as an undue union — but with the correct justification.
// And, in gh-issue-map.js, Important 4: `extractAc` located the section by an
// open prefix (`{ exact: false }`) — the only legitimate gap is a CLOSED set of
// two strings (AC_HEADING_FORMS), not a prefix.
//
// Besides, a product decision: `--reconcile` is documented as EXPERIMENTAL (see
// ct-groom.mjs and commands/ct-groom.md) — five rounds of review, each one
// finding a new way to corrupt a real body, are evidence enough that the
// APPLICATION half of this feature (unlike the DETECTION half, which never
// writes anything) is still not completely understood.
//
// This module decides WHAT counts as drift (diffIssue/hasDrift), HOW it is
// reported (formatDrift) and HOW it is applied: buildReconcileEditArgs for
// title/milestone/labels, via the flags of `gh issue edit`; buildReconcileBody
// for the link to the spec (a single-line splice), AC/Dependencias and the
// epic's context (a surgical section splice, all three), all via `--body`.
// ct-groom.mjs is thin glue: it calls these functions with what it already has
// from `gh` and from the plan, and prints/executes what they return — no
// business decision lives in the wrapper.
import {
  extractAc, extractDepsInSection, extractStrayDeps, extractSectionContent, locateSection, locateLine,
  extractSpecLink, normalizeSpecLink, countHeadingLines, detectLineEnding, normalizeToLF,
  unterminatedDelimiter, AC_HEADING_FORMS, SPEC_LINK_PREFIXES,
} from './gh-issue-map.js'
// F6: the CONTENT of "## Dependencias"/"## Acceptance criteria" is rendered by
// groom.js — the same function buildIssueBody uses when CREATING the issue.
// Until F6 this file had its own copy of the format: two implementations of the
// same criterion that would diverge as soon as one of them changed (and F6 did
// change it: the slice order now goes inside backticks so that GitHub does not
// autolink it as an issue number — a --reconcile with the old copy would have
// rewritten the new format back into the old one, reintroducing the false link
// on every run).
import { renderDepsContent, renderAcContent, GATES_HEADING, E2E_HEADING, EPIC_CONTEXT_HEADING, INHERITED_CONTEXT_HEADING, FROZEN_DECISIONS_HEADING, SIGNAL_HEADING } from './groom.js'

// ownedLabelsOnly: the spec is authority over a prefix (`type:`, `area:`,
// `touches:`) ONLY IF the §9 table carries the column that feeds it
// (Tipo/Área/Toca respectively) — `ownedPrefixes` is that subset, decided by
// the caller (ct-groom.mjs, out of which columns the table carries) and it
// deliberately has NO default here: guessing "all of them by default" would
// silently reintroduce the false positive this corrects: with no "Área" column,
// the spec has no opinion at all about `area:` and must not claim authority over
// a label a human put there by hand on their own account — reporting it as
// "surplus" would be noise that teaches people to ignore the rest of the
// report.
//
// `status:` is NEVER an active prefix, not even when the spec does control its
// initial value (`status:backlog`, when creating the issue) — a human or
// `/ct-next` move it afterwards (backlog → ready → in-progress → in-review…) as
// a normal part of the flow, so comparing it would report "surplus
// status:in-progress" on every slice under way on every re-groom.
export function ownedLabelsOnly(labels, ownedPrefixes) {
  return (labels || []).filter((l) => (ownedPrefixes || []).some((p) => l.startsWith(p)))
}

// diffLabels: compares TWO sets of labels, but only within `ownedPrefixes`
// (ownedLabelsOnly filters both sides). This implies, with no special code,
// that:
//   - a label foreign to the spec, or of a prefix whose column is not in the §9
//     table, never appears in either missing or extra.
//   - ANY status: never appears either (it is never in ownedPrefixes).
export function diffLabels(currentLabels, wantedLabels, ownedPrefixes) {
  const current = new Set(ownedLabelsOnly(currentLabels, ownedPrefixes))
  const wanted = new Set(ownedLabelsOnly(wantedLabels, ownedPrefixes))
  const missing = [...wanted].filter((l) => !current.has(l))
  const extra = [...current].filter((l) => !wanted.has(l))
  return { missing, extra }
}

// diffSet / diffDeps / diffAc: set-based comparison (the order in which they
// appear in the body, or in the §9 table, is not semantically significant —
// they are sets of references/criteria, not ordered lists).
function diffSet(current, wanted) {
  const c = new Set(current || [])
  const w = new Set(wanted || [])
  return {
    missing: [...w].filter((x) => !c.has(x)),
    extra: [...c].filter((x) => !w.has(x)),
  }
}
export function diffDeps(currentDeps, wantedDeps) {
  return diffSet(currentDeps, wantedDeps)
}
export function diffAc(currentAc, wantedAc) {
  return diffSet(currentAc, wantedAc)
}

// depsInSection / acInSection: they extract deps/ac ONLY from the content of
// their own recognised section — the same domain in detection (here) and in
// application (`buildReconcileBody`, which can only splice that section
// safely). Until the hardening of the dispatch (D1), this was a DELIBERATE
// difference with respect to the real dispatcher (gh-issue-map.js#mapGhIssue
// called extractDeps over the WHOLE body) — D1 finding 2 unified both domains:
// mapGhIssue now uses exactly `extractDepsInSection`, the same function as this
// file. `depsInSection` remains as a thin wrapper (only so as not to touch the
// calls further down) over that single source of truth — there are no longer two
// implementations of the same criterion that can diverge. `extractAc` is, in
// itself, already section-scoped against the closed set AC_HEADING_FORMS (see
// gh-issue-map.js, Important 4) — it is simply re-exported here so that
// diffIssue does not have to decide between two different criteria.
function depsInSection(body) {
  return extractDepsInSection(body).deps
}
function acInSection(body) {
  return extractAc(body)
}

// DUPLICATE_CHECKS: which headings are checked for duplication (`headings`: a
// string, or AC_HEADING_FORMS — the closed set of two acceptable forms, just
// like locateSection), and whether a duplicate is "machine" (it counts towards
// the exit code — review round 4, important 5) or merely cosmetic
// (Descripción/Protegido: a note, it never counts).
//
// The justification for why Dependencias/AC DO count is NOW THE SAME for both
// (before D1 it was not — see the history further down; round 4 had written it
// as if it were and round 5 corrected that):
// gh-issue-map.js#extractSectionContent/locateSection ALWAYS returns the FIRST
// occurrence of a heading — for both Dependencias and AC. Neither of the two
// "unites" two copies. That does not make them harmless: if a human edits the
// WRONG copy (the second one, after a badly resolved merge conflict or a
// copy-paste), that edit stays invisible to the DISPATCHER, which silently keeps
// using the FIRST copy, which may be the old one. That is why both still count
// towards the exit code.
//
// What did change with the final branch review (C2): --reconcile no longer
// writes into "the first one" when there are two — it gives up and says so (see
// `spliceableSection` in buildReconcileBody), because one of those two copies
// may be text the coordinator pasted into "## Contexto heredado". The duplicate
// still counts towards the exit code because of the dispatcher, which does
// resolve in silence.
//
// History (before D1, the hardening of the dispatch):
// gh-issue-map.js#extractDeps, the one the real DISPATCHER used (mapGhIssue),
// scanned the WHOLE body with a global regex, with no notion of section at all —
// two "## Dependencias" with different `merge-after` were genuinely UNITED (the
// dispatcher obeyed the sum of both copies, not "the first one"), unlike AC. D1
// finding 2 unified the dispatcher's domain with --reconcile's (both
// section-scoped, both "first copy") — the asymmetry of justification
// disappeared with it.
const DUPLICATE_CHECKS = [
  { headings: '## Descripción', label: 'Descripción', machine: false },
  { headings: AC_HEADING_FORMS, label: 'Acceptance criteria', machine: true },
  { headings: '## Dependencias', label: 'Dependencias', machine: true },
  // F21: a duplicated gates section is NOT "machine". The channel the machine
  // obeys (kickoff.js, via gh-issue-map.js#mapGhIssue) is the `gate:` LABELS,
  // not this section — which exists for the human who opens the issue or the
  // PR. A duplicate here is cosmetic, exactly as in Descripción/Protegido, and
  // anchoring the exit code to it would train people to ignore the rest of the
  // report. That the `gate:` labels DO count (they go in `ownedLabelPrefixes`,
  // see ct-groom.mjs) is what keeps a REAL gate drift from going unnoticed.
  { headings: GATES_HEADING, label: 'Gates', machine: false },
  // The "## E2E" section is NOT "not machine" for Gates' reason —that sentence
  // was false and the final branch review corrects it—: code does parse it
  // (gh-issue-map.js#extractE2eRuns, which /ct-next uses to seed the worktree
  // and `dispatch-check --release` uses for its exit-8 door), and like every
  // reader of sections, it reads the FIRST occurrence.
  //
  // Even so the DUPLICATE stays out of `machine`, and now for a reason that
  // stands on its own: since this round the content drift already counts
  // (hasDrift), and --reconcile refuses to write over a duplicated section,
  // marking it as a gap (`unresolvedE2e: 'duplicada'`) — which means a duplicate
  // that changes what the slice traverses ALREADY moves the exit code by those
  // two routes. What is left —two copies whose FIRST one matches the spec—
  // changes nothing for anybody: /ct-next seeds the right journeys. It gets a
  // warning, which is what it deserves.
  { headings: E2E_HEADING, label: 'E2E', machine: false },
  { headings: '## Out of scope / Protected', label: 'Out of scope / Protected', machine: false },
  // The two duplicated context sections are cosmetic: no machine decides
  // anything with them. It gets a warning —a duplicate is usually a badly
  // resolved merge, and whoever edits the wrong copy deserves to know— but
  // anchoring the exit code to this would train people to ignore the rest of the
  // report.
  { headings: EPIC_CONTEXT_HEADING, label: 'Contexto del epic', machine: false },
  { headings: INHERITED_CONTEXT_HEADING, label: 'Contexto heredado', machine: false },
  // Decisiones congeladas: like the epic's context, a duplicate is cosmetic (no
  // machine decides anything with them) — it gets a warning, it does not
  // count.
  { headings: FROZEN_DECISIONS_HEADING, label: 'Decisiones congeladas', machine: false },
]

// diffIssue: compares a genuinely EXISTING issue (the raw shape of `gh api
// repos/<o>/<r>/issues`: number, title, state, milestone, labels, body) against
// what the plan (groom.js#groomPlan) says THAT slice should have today
// (wantedIssue: title, milestone, labels, deps, ac, descripcion, protectedLine,
// specLink, specSection — all of them fields groomPlan already exposes, not just
// the already rendered body).
//
// The `<!-- ct-order:N -->` marker is the ONLY thing in the body that stays
// completely outside the diff: it is our own bookkeeping. The link to the spec
// IS content of the spec, and since F10 it is compared WHOLE.
//
// Until F10 only the `#section` anchor was compared (specLinkAnchor), and
// rightly so for its time: the line was composed with `process.argv[2]` exactly
// as whoever invoked the command had written it, so two invocation habits for the
// SAME file (relative from a slash command, absolute from a cron) produced two
// different lines — comparing the whole line would have made every run
// "reconcile" against the previous one's habit, indefinitely. The price was a
// known limit: if the spec MOVED to another file without changing its section
// number, it went undetected.
//
// F10 removes the cause, not the symptom: the line is no longer composed from
// argv but from the path RELATIVE TO THE REPO'S ROOT, the repo's remote and the
// default branch — three things that are properties of the repository, not of
// whoever invokes it (see scripts/spec-link.js). The same §9 produces the same
// line from any clone, any branch and any path notation, so the ping-pong is no
// longer possible and comparing the whole line is strictly better: it also
// detects that the spec has moved, that the link points at another repo, and
// that an old issue's link is still the broken relative one from before F10.
//
// Descripción/Protegido ARE compared (the spec owns them: they derive from
// Entrega/Protegido in the §9 table), but only with a boolean flag
// (descripcionDiffers/protectedDiffers) — the full text is never shown, and (see
// hasDrift further down) they NEVER count towards the exit code: they are prose
// a human edits routinely and legitimately after creating the issue.
//
// `duplicateSections`/`duplicateMachineSections`: known headings that appear more
// than once — the AC/Dependencias ones DO count towards the exit code (they
// change what the dispatcher does; see DUPLICATE_CHECKS), Descripción/Protegido
// do not.
//
// `strayDeps`: `merge-after #N` references that live OUTSIDE the recognised
// "## Dependencias" section. Before D1 (the hardening of the dispatch), the real
// DISPATCHER DID see them (it scanned the whole body) while --reconcile could
// never touch them (outside the section it can splice safely) — the report below
// existed so that THAT asymmetry, at least, would not stay invisible. D1
// finding 2 unified the domain: mapGhIssue now also ignores everything that
// lives outside the section — a `strayDep` is now obeyed by NOBODY (neither the
// dispatcher nor --reconcile). The field is kept because it is still real and
// actionable information: a human who wrote a "merge-after" in there thinking it
// counted deserves to be told, even if the reason is now "this is dead text" and
// not "the dispatcher applies it but I cannot".
//
// labels accepts both the REST API's raw shape (`[{name: 'x'}, ...]`) and an
// array of already flat strings.
export function diffIssue(existing, wantedIssue, wantedMilestone, ownedLabelPrefixes) {
  const body = normalizeToLF(existing.body)
  const currentLabelNames = (existing.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
  const labels = diffLabels(currentLabelNames, wantedIssue.labels, ownedLabelPrefixes)
  const currentMilestoneTitle = existing.milestone ? existing.milestone.title : null
  const titleDiffers = existing.title !== wantedIssue.title
  const milestoneDiffers = currentMilestoneTitle !== wantedMilestone

  const currentSpecLink = extractSpecLink(body)
  const specLinkDiffers = normalizeSpecLink(currentSpecLink) !== normalizeSpecLink(wantedIssue.specLink)

  const currentDeps = depsInSection(body)
  const deps = diffDeps(currentDeps, wantedIssue.deps)
  const ac = diffAc(acInSection(body), wantedIssue.ac)

  // Descripción: `null` on either of the two sides means "no section should
  // exist" — null on BOTH sides is agreement (real silence), not drift. The text
  // is only compared (trimmed) when both sides do have a section.
  const currentDescription = extractSectionContent(body, '## Descripción') // a string, or null (no section)
  const wantedDescription = wantedIssue.descripcion ?? null // same
  let descripcionDiffers
  if (currentDescription === null && wantedDescription === null) {
    descripcionDiffers = false // agreement: neither of the two sides has a section
  } else if (currentDescription === null || wantedDescription === null) {
    descripcionDiffers = true // one side has a section, the other does not
  } else {
    descripcionDiffers = currentDescription.trim() !== wantedDescription.trim()
  }

  // Señal (Slice 10): an EXACT mirror of Descripción — three states, the
  // null/null agreement included (neither of the two sides has a section = real
  // silence, never drift). The authority at runtime is THE ISSUE, like the gates
  // ("it is read from the issue, not from the spec"): the signal the slice judge
  // obeys is the one the issue had at dispatch time. That is why this comparison
  // only feeds a `note:` (see formatDrift) and NEVER enters hasDrift,
  // reconcileGaps or buildReconcileBody — the splice machinery is the
  // EXPERIMENTAL half that five rounds of review decided not to fatten. An old
  // epic without the section only drifts if today's spec declares a signal, and
  // even then a note:, never a block.
  const currentSignal = extractSectionContent(body, SIGNAL_HEADING)
  const wantedSignal = wantedIssue.senal ?? null
  let senalDiffers
  if (currentSignal === null && wantedSignal === null) {
    senalDiffers = false // agreement: neither of the two sides has a section
  } else if (currentSignal === null || wantedSignal === null) {
    senalDiffers = true // one side has a section, the other does not
  } else {
    senalDiffers = currentSignal.trim() !== wantedSignal.trim()
  }

  // Contexto del epic: the same three-state criterion as Descripción — null on
  // both sides is agreement (real silence), null on only one is drift, and the
  // text is only compared when both sides have a section.
  //
  // The inherited section is NOT compared here nor anywhere else: its owner is
  // whoever writes it, and the plugin has no opinion at all about its content.
  // That it does not appear in this diff is the property, not an oversight.
  //
  // `epicContextUnknown` (final branch review, I1): the spec carries the section
  // but no valid text could be read from it (a heading inside, an unclosed
  // delimiter…). That is not a drift: it is having nothing to compare against.
  // Without this branch, one `###` too many in the spec was reported as "the
  // issue has a section and the spec does not" and --reconcile deleted it from
  // all N issues.
  const currentEpicContext = extractSectionContent(body, EPIC_CONTEXT_HEADING)
  const wantedEpicContext = wantedIssue.epicContext ?? null
  let epicContextDiffers
  if (wantedIssue.epicContextUnknown) {
    epicContextDiffers = false
  } else if (currentEpicContext === null && wantedEpicContext === null) {
    epicContextDiffers = false
  } else if (currentEpicContext === null || wantedEpicContext === null) {
    epicContextDiffers = true
  } else {
    epicContextDiffers = currentEpicContext.trim() !== wantedEpicContext.trim()
  }

  // Decisiones congeladas: the same criterion as epicContextDiffers, the
  // `frozenDecisionsUnknown` branch included (the spec carries the section but
  // no valid text could be read from it — it is not drift, it is having nothing
  // to compare against).
  const currentFrozenDecisions = extractSectionContent(body, FROZEN_DECISIONS_HEADING)
  const wantedFrozenDecisions = wantedIssue.frozenDecisions ?? null
  let frozenDecisionsDiffers
  if (wantedIssue.frozenDecisionsUnknown) {
    frozenDecisionsDiffers = false
  } else if (currentFrozenDecisions === null && wantedFrozenDecisions === null) {
    frozenDecisionsDiffers = false
  } else if (currentFrozenDecisions === null || wantedFrozenDecisions === null) {
    frozenDecisionsDiffers = true
  } else {
    frozenDecisionsDiffers = currentFrozenDecisions.trim() !== wantedFrozenDecisions.trim()
  }

  // Protegido: it should ALWAYS exist (buildIssueBody emits it
  // unconditionally) — if the heading is missing entirely from the existing
  // issue (a human deleted it by hand), it is treated as drift.
  const currentProtected = extractSectionContent(body, '## Out of scope / Protected')
  const protectedDiffers = currentProtected === null || currentProtected.trim() !== (wantedIssue.protectedLine || '').trim()

  // Gates (F21): the same treatment as Protegido — the section is always
  // emitted, so its total absence counts as drift; and it is reported as a NOTE,
  // not as drift that counts towards the exit code (see hasDrift). The reason is
  // not that it does not matter: it is that the gate the machine obeys is the
  // `gate:` labels, which do count, and duplicating the signal across two
  // channels would make an issue groomed BEFORE this round (which does not have
  // the section) come out 3 on every re-groom until somebody rewrote its body by
  // hand.
  const currentGates = extractSectionContent(body, GATES_HEADING)
  const gatesDiffers = currentGates === null || currentGates.trim() !== (wantedIssue.gatesContent || '').trim()

  // E2E: the THREE-value state of Descripción/Contexto del epic, not that of
  // Gates/Protegido — because, unlike those two, the section is NOT always
  // emitted (see groom.js#buildIssueBody: only if there are journeys). `null`
  // on both sides is real agreement (this slice has no journeys, and the issue
  // does not carry the section), not drift; treating it like Gates would treat
  // "every slice with e2e:no" as drifting always.
  //
  // And unlike Gates, this drift DOES count towards the exit code (hasDrift) and
  // --reconcile DOES rewrite it (buildReconcileBody). Until the final branch
  // review it was the other way round, and that left the whole feature inert
  // along the most natural adoption path it has: an already groomed epic, plus
  // the new `E2E` column, plus `--reconcile`. The `gate:e2e` label did get added
  // (the `gate:` prefix of ownedLabelPrefixes covers it), the section did not —
  // that is, an issue with the label and with no journeys: /ct-next seeded
  // `[]`, the agent traversed nothing, and `--release` released with a warning on
  // stderr. The tool manufactured exactly the drifted state §4.6 of the design
  // describes as "somebody edited the issue by hand".
  //
  // The argument for why Descripción/Protegido are NOT reconciled —a human's
  // right to edit THEIR issue— does not hold here, and it is precisely the other
  // way round: §3.3 of the design says the journey cannot be editable without
  // going through Door 1 (that is why it lives in the frozen spec and not in
  // AGENTS.md). A `## E2E` section edited by hand in the issue is precisely what
  // has to be put back to what the spec says.
  const currentE2e = extractSectionContent(body, E2E_HEADING)
  const wantedE2e = wantedIssue.e2eContent ?? null
  let e2eDiffers
  if (currentE2e === null && wantedE2e === null) {
    e2eDiffers = false
  } else if (currentE2e === null || wantedE2e === null) {
    e2eDiffers = true
  } else {
    e2eDiffers = currentE2e.trim() !== wantedE2e.trim()
  }

  const duplicates = DUPLICATE_CHECKS.filter((c) => countHeadingLines(body, c.headings) > 1)
  const duplicateSections = duplicates.map((c) => c.label)
  const duplicateMachineSections = duplicates.filter((c) => c.machine).map((c) => c.label)

  // strayDeps: deps that live in the body but outside the recognised section —
  // since D1, inert text for everybody (neither the dispatcher nor --reconcile
  // obey it); it is reported all the same, regardless of whether it also matches
  // what the spec asks for (`deps` above already covers that).
  // `extractStrayDeps` (gh-issue-map.js) is the SAME function mapGhIssue uses to
  // expose this on the dispatcher's route (D1, review: "expose the out-of-section
  // deps from mapGhIssue" — you already have the shape here, it is the same
  // one) — one single implementation, not two that can diverge.
  const strayDeps = extractStrayDeps(body, currentDeps)

  return {
    order: wantedIssue.order,
    issueNumber: existing.number,
    closed: existing.state === 'closed',
    title: titleDiffers ? { current: existing.title, wanted: wantedIssue.title } : null,
    milestone: milestoneDiffers ? { current: currentMilestoneTitle, wanted: wantedMilestone } : null,
    specLink: specLinkDiffers ? { current: currentSpecLink, wanted: wantedIssue.specLink } : null,
    labels,
    deps,
    ac,
    descripcionDiffers,
    senalDiffers,
    epicContextDiffers,
    frozenDecisionsDiffers,
    protectedDiffers,
    gatesDiffers,
    e2eDiffers,
    duplicateSections,
    duplicateMachineSections,
    strayDeps,
  }
}

// hasDrift: it counts title/milestone/link-to-the-spec (the whole line, since
// F10)/labels/deps/ac, the `## E2E` section (final branch review: see the
// `e2eDiffers` block in diffIssue — without it the `--reconcile` of an already
// groomed epic left the feature inert and did not even change the exit code),
// and the DUPLICATED sections that change what the dispatcher does
// (AC/Dependencias — review round 4, important 5). `closed`,
// Descripción/Protegido (duplicated or drifted), the epic's context and
// `strayDeps` NEVER count, and the reason is NOT the same for all of them —
// enumerating them as if it were is what the final branch review corrects (I3):
//
//   - `closed`: the spec has no authority whatsoever over the issue's state.
//   - Descripción/Protegido: prose a human edits routinely and legitimately in
//     THEIR issue, and which is why --reconcile does not rewrite it either.
//   - `strayDeps`: --reconcile could not apply it safely even if it wanted to —
//     it lives outside the section it can touch.
//   - the epic's context: NONE of the three previous reasons applies to it (the
//     spec does own it, it has no right of human editing —which is precisely
//     what distinguishes it from Descripción/Protegido, see
//     buildReconcileBody— and --reconcile DOES apply it). The reason is the
//     fourth one, and it is written in §4.4 of the design: counting it would
//     leave EVERY issue groomed before F26 at `3`, on every run, until somebody
//     rewrote its body by hand.
//
// They all lead to the same thing: anchoring the exit code to any of them would
// train people to ignore the rest of the report.
//
// That the epic's context does not count here does NOT mean it does not get
// written: the caller asks the two things separately (see ct-groom.mjs, the
// `hasDrift(diff) || bodyResult.body !== null` gate). Confusing them was C1 of
// the final branch review.
export function hasDrift(diff) {
  return Boolean(
    diff.title || diff.milestone || diff.specLink ||
    diff.labels.missing.length || diff.labels.extra.length ||
    diff.deps.missing.length || diff.deps.extra.length ||
    diff.ac.missing.length || diff.ac.extra.length ||
    diff.e2eDiffers ||
    diff.duplicateMachineSections.length,
  )
}

// reconcileGaps / hasReconcileGap: --reconcile can REPORT a drift without being
// able to APPLY it. Two different forms of this:
//   - ac/deps: the section's heading may not exist (a human renamed it or
//     deleted it) and without it `buildReconcileBody` has nowhere to write the
//     fix (nor does it invent a position for deps when there is no safe anchor
//     either — review round 4, Critical 3); or it may appear MORE THAN ONCE, and
//     then none of the copies can be pointed at as the plugin's one (final
//     branch review, C2 — the coordinator pastes the previous issue's body
//     inside "## Contexto heredado", headings and all). `bodyResult` is the
//     result of `buildReconcileBody` (further down; it carries
//     `unresolvedAc`/`unresolvedDeps` and the reason for each in
//     `unresolvedReasons`) — a real gap is "the diff says it drifts AND
//     buildReconcileBody could not touch it".
//   - duplicates (review round 5, Important 3): a duplicated "machine" section
//     (diff.duplicateMachineSections) COUNTS towards hasDrift, but --reconcile
//     has no code at all that decides which copy is the right one and merges or
//     deletes the surplus — it is not a "I do not know where to write" gap like
//     ac/deps, it is a "no safe write is possible at all" gap. Without this
//     field, `ct-groom.mjs` (which under --reconcile uses ONLY
//     `hasReconcileGap` to decide its exit code, see the comment next to that
//     file's final `process.exit`) saw `anyReconcileGapRemains` as `false` when
//     the ONLY drift was a duplicate (ac/deps still agreed on content) — zero
//     calls to `gh`, nothing changes, the drift line gets printed, and the
//     process came out 0: it also broke the documented parity with `--dry-run
//     --reconcile` over the SAME body, which did come out 3 (that branch uses
//     `anyUnresolvedDrift`, not `anyReconcileGapRemains`).
//
// title/milestone/labels/specLink never have a gap: they are always resolved via
// flags or a single-line splice, without depending on locating a section by its
// heading.
export function reconcileGaps(diff, bodyResult) {
  return {
    ac: Boolean((diff.ac.missing.length || diff.ac.extra.length) && bodyResult.unresolvedAc),
    deps: Boolean((diff.deps.missing.length || diff.deps.extra.length) && bodyResult.unresolvedDeps),
    // The same criterion as ac/deps, and for the same reason: this drift counts
    // towards the exit code (hasDrift), so if --reconcile could not write it, it
    // stays pending and that has to be said. Without this line, a `--reconcile`
    // over a body in which the section cannot be touched safely came out 0,
    // leaving the issue with no journeys.
    e2e: Boolean(diff.e2eDiffers && bodyResult.unresolvedE2e),
    duplicates: Boolean((diff.duplicateMachineSections || []).length),
  }
}
export function hasReconcileGap(gaps) {
  return Boolean(gaps.ac || gaps.deps || gaps.e2e || gaps.duplicates)
}

// formatDrift: one human line per field. Title/milestone/link-to-the-spec/
// labels/deps/ac and the "machine" duplicates (AC/Dependencias) are
// "drift:" — they count towards the exit code (hasDrift) and show the
// current value and the one the spec asks for where that applies.
// Descripción/Protegido (and their duplicates), the epic's context and
// `strayDeps` are "note:" — they are ALWAYS reported where they apply (total
// silence about this would be as bad as reporting nothing), but they NEVER count
// towards the exit code. The issue's closure is noted at the end, and only if
// there is already some other line to report.
export function formatDrift(diff) {
  const lines = []
  const head = `slice #${diff.order} (issue #${diff.issueNumber})`
  if (diff.title) lines.push(`drift: ${head}: título difiere — issue: "${diff.title.current}", spec: "${diff.title.wanted}"`)
  if (diff.milestone) lines.push(`drift: ${head}: milestone difiere — issue: "${diff.milestone.current ?? '(ninguno)'}", spec: "${diff.milestone.wanted}"`)
  if (diff.specLink) lines.push(`drift: ${head}: el enlace al spec difiere — issue: "${diff.specLink.current ?? '(ausente)'}", spec: "${diff.specLink.wanted}"`)
  for (const l of diff.labels.missing) lines.push(`drift: ${head}: falta la label "${l}" (la pide el spec, el issue no la tiene)`)
  for (const l of diff.labels.extra) lines.push(`drift: ${head}: sobra la label "${l}" (la tiene el issue, el spec ya no la produce)`)
  // F6: the number named here is the slice's ORDER in the §9 table, never an
  // issue number — saying so in the message itself keeps whoever reads the
  // report from going off to look for "issue #3", which has nothing to do with
  // it.
  for (const d of diff.deps.missing) lines.push(`drift: ${head}: falta la dependencia "merge-after \`#${d}\`" (orden de slice de la tabla §9, no un número de issue; la pide el spec, el issue no la tiene)`)
  for (const d of diff.deps.extra) lines.push(`drift: ${head}: sobra la dependencia "merge-after \`#${d}\`" (orden de slice de la tabla §9, no un número de issue; la tiene el issue, el spec ya no la produce)`)
  for (const a of diff.ac.missing) lines.push(`drift: ${head}: falta el criterio de aceptación "${a}" (lo pide el spec, el issue no lo tiene)`)
  for (const a of diff.ac.extra) lines.push(`drift: ${head}: sobra el criterio de aceptación "${a}" (lo tiene el issue, el spec ya no lo produce)`)
  for (const section of diff.duplicateMachineSections || []) {
    // Minor (review round 5): "the dispatcher does not tell the first one
    // apart" was accurate for Dependencias (it unites both copies, a scan of
    // the whole body) but FALSE for Acceptance criteria (the dispatcher DOES
    // use only the first one — the risk there is that that first copy is no
    // longer the one a human wanted, not that the dispatcher mixes them). The
    // message no longer asserts a single mechanism for both: it names the real
    // risk, which is enough for reviewing by hand to make sense without having
    // to know which mechanism applies.
    lines.push(`drift: ${head}: la sección "## ${section}" aparece más de una vez en el body — el dispatcher no reconstruye la intención de un humano a partir de "la primera" ni de "la unión": revisa y une o elimina la copia sobrante a mano`)
  }
  if (diff.descripcionDiffers) lines.push(`note: ${head}: la sección "## Descripción" difiere del spec (prosa — no cuenta para el exit code; --reconcile no la reescribe)`)
  // Slice 10: the signal, like Descripción, is only noted. The half sentence
  // about "the one the judge obeys" exists so that whoever reads the note knows
  // WHY it is not rewritten: at runtime the authority is the dispatch's issue,
  // not today's spec — the same contract as the gates.
  if (diff.senalDiffers) lines.push(`note: ${head}: la sección "${SIGNAL_HEADING}" difiere del spec (no cuenta para el exit code; --reconcile no la reescribe — la señal que obedece el juez de slice es la que el issue tenía al despachar, igual que los gates)`)
  // Task 4 deliberately left this note without saying who rewrites the section:
  // in that commit "with --reconcile it is rewritten from the spec" was still
  // false (buildReconcileBody did not touch it). Task 5 made it true.
  //
  // The final branch review moved it again: --reconcile no longer rewrites this
  // section ALWAYS. It gives up —out loud, with a `note:` of its own that states
  // the reason— if the heading appears twice, if there is an unclosed fence or
  // comment, if it does not exist and there is no anchor where to put it, or if
  // the only copy falls inside the "## Contexto heredado" zone. This line is
  // emitted by `diffIssue`, which only compares: it does not know which of those
  // cases applies, so it cannot promise the rewrite — it says what the normal
  // case is and where the exception comes from, which is exactly what it
  // knows.
  if (diff.epicContextDiffers) lines.push(`note: ${head}: la sección "${EPIC_CONTEXT_HEADING}" difiere del spec (no cuenta para el exit code; con --reconcile se reescribe desde el spec salvo que el body no deje hacerlo con seguridad, en cuyo caso se dice aquí mismo con otra nota y el motivo). La sección "${INHERITED_CONTEXT_HEADING}" de al lado no se toca nunca`)
  if (diff.frozenDecisionsDiffers) lines.push(`note: ${head}: la sección "${FROZEN_DECISIONS_HEADING}" difiere del spec (no cuenta para el exit code; con --reconcile se reescribe desde el spec salvo que el body no deje hacerlo con seguridad, en cuyo caso se dice aquí mismo con otra nota y el motivo)`)
  if (diff.protectedDiffers) lines.push(`note: ${head}: la sección "## Out of scope / Protected" difiere del spec (prosa — no cuenta para el exit code; --reconcile no la reescribe)`)
  // F21: the label is named as the channel that DOES count, so that whoever
  // reads this note knows where to look if a gate really worries them — without
  // that sentence, "it does not count towards the exit code" reads as "gates do
  // not matter".
  if (diff.gatesDiffers) lines.push(`note: ${head}: la sección "${GATES_HEADING}" difiere del spec (no cuenta para el exit code; --reconcile no la reescribe). El gate que obedece el dispatcher son las labels "gate:" de este issue, que sí se comparan arriba — si un issue es anterior a los gates, esta sección le falta entera y basta con re-groomear su body a mano`)
  // Unlike the Gates note next door, this one is a DRIFT: the section is the
  // only place that says WHAT to traverse, and both /ct-next (the worktree's
  // seed) and `--release` (the exit-8 door) feed off it. An issue with the label
  // and without the section is a slice that traverses nothing — see the
  // `e2eDiffers` block in diffIssue.
  if (diff.e2eDiffers) lines.push(`drift: ${head}: la sección "${E2E_HEADING}" difiere del spec — de ella salen los recorridos que /ct-next siembra en el worktree y los que "dispatch-check --release" exige haber atravesado, así que un issue sin ella (o con otra cosa) no atraviesa lo que el spec pide; con --reconcile se reescribe desde el spec`)
  for (const section of diff.duplicateSections || []) {
    if ((diff.duplicateMachineSections || []).includes(section)) continue // already reported above as drift:
    // Only the first one is COMPARED (locateSection always returns that one),
    // and none of them is REWRITTEN: since the final branch review, --reconcile
    // gives up in the face of a duplicated section instead of writing into "the
    // first one", because one of the copies may be text pasted inside
    // "## Contexto heredado". The sections in this list are never rewritten
    // anyway, except the epic's context one.
    lines.push(`note: ${head}: la sección "## ${section}" aparece más de una vez en el body — solo la primera se compara, y ninguna se reescribe mientras haya dos; revisa la(s) copia(s) sobrante(s) a mano`)
  }
  for (const d of diff.strayDeps || []) {
    lines.push(`note: ${head}: "merge-after #${d}" aparece fuera de la sección "## Dependencias" — desde el hardening del dispatch (D1), ya NO lo obedece nadie (ni el dispatcher real ni --reconcile); si se pretendía como dependencia real, muévelo dentro de la sección`)
  }
  if (diff.closed && lines.length) lines.push(`note: ${head}: el issue está cerrado — revisa antes de aplicar --reconcile`)
  return lines
}

// buildReconcileEditArgs: translates title/milestone/labels into the flags of a
// SINGLE `gh issue edit` (atomic from the caller's point of view). [] if there
// is nothing of this to apply. The link to the spec and AC/Dependencias do NOT
// live here — they are applied via `--body` (see buildReconcileBody), but the
// caller (ct-groom.mjs) combines both into the SAME call to `gh issue edit`.
export function buildReconcileEditArgs(diff) {
  const args = []
  if (diff.title) args.push('--title', diff.title.wanted)
  // F23: from ct-groom.mjs this branch is no longer reachable (there the
  // pairing is bounded by epic, so a paired issue always has the requested
  // milestone). It is kept because diffIssue/buildReconcileEditArgs are pure and
  // owe nothing to that call site: for any caller that compares an issue against
  // a different milestone, moving the milestone is still the correct repair. It
  // is not dead code — it is code with no current consumer, which is not the
  // same thing.
  if (diff.milestone) args.push('--milestone', diff.milestone.wanted)
  for (const l of diff.labels.missing) args.push('--add-label', l)
  for (const l of diff.labels.extra) args.push('--remove-label', l)
  return args
}

// buildReconcileBody: --reconcile DOES rewrite the link to the spec,
// AC/Dependencias, the "## E2E" section and the epic's context — not
// Descripción, not Protegido, and not the inherited context (see diffIssue).
// "Whose the text is" is NOT what distinguishes these two lists: the spec owns
// the FIRST FIVE equally — the link derives from the spec's own path (F10);
// AC/Dependencias and the journeys of "## E2E", from the §9 table; the epic's
// context, from the section of the same name the spec itself carries
// (groom.js#readEpicContext); and Descripción/Protegido from the
// Entrega/Protegido columns of that same table (renderDescription/
// renderProtectedLine, groom.js — see also diffIssue's comment further up, "the
// spec owns them").
//
// What does distinguish them is the RIGHT OF EDITING after the issue has been
// created. Descripción and Protegido are prose a human edits routinely and
// legitimately in THEIR issue, once it exists — rewriting over it would delete
// deliberate work, so --reconcile never touches it. The epic's context has no
// such right: it must be identical in every issue of the epic, and editing it by
// hand in one of them is exactly the drift this round exists to eliminate —
// whoever wants context of their own for a slice has "## Contexto heredado" next
// door. That section, unlike the other three, is not text the spec owns at all:
// the coordinator session writes it, and the plugin has no opinion whatsoever
// about its content — which is why it is not touched here either, but for a
// different reason than Descripción/Protegido.
//
// It replaces ONLY the range of each known section/line inside the EXISTING body
// (locateSection/locateLine, scripts/gh-issue-map.js) — it never reconstructs
// the whole body — so any human content before/after those sections is preserved
// intact.
//
// "Each known section" is not the same as "the first occurrence of its heading",
// and confusing the two was what broke the promise of the "## Contexto heredado"
// placeholder (final branch review, C2): the coordinator pastes the previous
// slice's issue context in there —which carries the SAME headings, because this
// very generator writes them— and that copy of hers became the target of the
// splice. Two filters prevent it, and they cover different things:
//   - the forbidden zone (`inheritedZone`), which runs from the inherited heading
//     to "## Acceptance criteria" and skips EVERYTHING that falls inside it: the
//     spec-link line and also the pasted headings when they are the body's only
//     copy (the issue does not have that section of its own);
//   - the refusal to splice any section whose heading appears more than once
//     (`spliceableSection`), for when the issue DOES have its own and there is no
//     way to point at which of the two copies it is.
// See each one's comment for the detail.
//
// All the internal processing works over the body normalised to LF
// (`normalizeToLF`) — if the original used CRLF, the result is converted back to
// CRLF before being returned (`detectLineEnding`), so as not to leave a body with
// mixed line endings (review round 4, minor).
//
// Returns `{ body, unresolvedAc, unresolvedDeps, unresolvedReasons, unresolvedEpicContext, unresolvedE2e }`:
// `body` is the spliced body (in the same line ending as the original), or `null`
// if nothing needed changing. `unresolvedAc`/`unresolvedDeps` are true when the
// diff DID ask for a change but it could not be applied without guessing a
// position:
//   - AC: its heading should ALWAYS exist in a well-formed body; if a human
//     renames it or deletes it, there is nowhere to write the replacement.
//   - Dependencias (review round 4, Critical 3): if the section does not exist
//     AND "## Out of scope / Protected" (the safe anchor for inserting it) does
//     not exist EITHER, the previous version inserted a new section blindly at
//     the end of the body ON EVERY RUN — verified that, with an unclosed fence
//     in front (which makes any later heading unfindable), this grew without
//     limit: 2, 3, 4 sections on successive passes, and the dispatcher (which
//     does see all three) accumulated a repeated "merge-after #N". Now, with no
//     safe anchor, it GIVES UP just like AC: it inserts nothing, it marks
//     `unresolvedDeps`, and it lets the gap machinery report it and count it
//     towards the exit code.
//
// `unresolvedE2e` is a STRING with the reason (or `null`), of the same vocabulary
// as `unresolvedReasons.deps`: the "## E2E" section gives up for the same causes
// as "## Dependencias" and with the same remedies. Unlike
// `unresolvedEpicContext`, this one DOES enter `reconcileGaps` and does move the
// exit code — the drift counts (hasDrift), so giving up without counting would
// leave `--reconcile` coming out 0 over an issue that still has no journeys:
// the same hole review round 5 closed for the duplicates.
//
// `unresolvedEpicContext` is different from those two: it is a STRING with the
// reason (or `null` if there was none), and it does NOT enter `reconcileGaps` nor
// can it move the exit code — §4.4 of the design: neither a drift nor a duplicate
// of this section ever comes out 3, because that would leave every issue groomed
// before F26 at 3 forever. It exists so that the giving up is not SILENT: AC and
// Dependencias have given up out loud since round 4, and this section used to
// give up without saying anything, so that the caller reported "reconciled" about
// a section that had not been touched.
//
// "Does it need changing?" is decided with diffSet/depsInSection/acInSection (the
// SAME criterion, and the SAME domain — section-scoped — that diffIssue uses) —
// never a raw text comparison nor a scan of the whole body: if the issue has
// "AC-1.1, AC-1.2" and the spec asks for the same set in a different order,
// diffIssue already says "no drift", so rewriting here just over a difference of
// order would contradict that very decision. The link to the spec is compared
// WHOLE (normalizeSpecLink) — the same criterion as diffIssue; see there why F10
// could stop comparing it by the anchor alone.
export function buildReconcileBody(existingBody, wantedIssue) {
  const eol = detectLineEnding(existingBody)
  let body = normalizeToLF(existingBody)
  let changed = false
  let unresolvedAc = false
  let unresolvedDeps = false
  let unresolvedEpicContext = null
  let unresolvedFrozenDecisions = null
  let unresolvedE2e = null
  const unresolvedReasons = { ac: null, deps: null }

  // inheritedZone: the range of the body that belongs to the coordinator
  // session. It is RECOMPUTED on every use, not cached up front: every splice
  // down below changes the body's length, and a range computed earlier would
  // point at different characters afterwards. It is pure and cheap.
  //
  // WHERE THE RANGE ENDS (second wave of the final branch review). The first
  // wave closed it at `loc.contentEnd`, and that left it almost useless:
  // `locateSection` ends a section at the FIRST ATX heading, so the heading the
  // coordinator pastes inside her section does not fall inside the range — it is
  // precisely the one that closes it. With the issue having no section of its
  // own by that name (a slice with no dependencies, an issue older than F26 with
  // no "## Contexto del epic"), the copy count was 1, `spliceableSection` did not
  // see it as ambiguous, and the splice was applied INSIDE her text: it deleted
  // what had been pasted and, since the deletion runs to the next heading, all
  // the prose she had written after it.
  //
  // The end of the range is a CHOICE, not a datum. The heading chosen is the one
  // that canonically follows the inherited one: "## Acceptance criteria", which
  // `buildIssueBody` (groom.js) ALWAYS emits and emits right after (the order of
  // §3.4 of the design: link → Descripción → Contexto del epic → Contexto
  // heredado → Acceptance criteria → …). No section of the plugin legitimately
  // lives between those two, so widening as far as there takes reach away from
  // nothing, and no marker inside the body is needed — §3.3 rules out markers IN
  // THE BODY, it does not demand that the range end at the first heading.
  //
  // IF "## Acceptance criteria" CANNOT BE LOCATED —neither through absence (a
  // human deleted it or renamed it) nor through ambiguity (it appears more than
  // once, which means one of the two may also be pasted text)— the range extends
  // to the END of the body, and the `bounded` flag stays false so that whoever
  // gives up can say WHY without asserting more than it knows. It is the
  // conservative extreme on purpose: without that heading there is no evidence
  // left of where what the coordinator wrote ends —it could reach all the way to
  // the end—, and of the two possible errors the expensive one is the one that
  // deletes human text with no way back; the other is a noisy refusal that gets
  // fixed by restoring a heading. The cost is measured and it is paid in full:
  // over a body like that, --reconcile stops being able to apply Dependencias
  // (see the test "con la sección heredada y sin cabecera de AC…" in
  // reconcile.test.js).
  const inheritedZone = () => {
    const loc = locateSection(body, INHERITED_CONTEXT_HEADING)
    if (!loc) return null
    // The end anchor is looked for starting from the inherited heading itself,
    // reusing `forbidden` to discard everything that lies ahead of it (the same
    // `outsideOf` helper, not a second criterion): an "## Acceptance criteria"
    // EARLIER than the inherited section says nothing about where this one
    // ends.
    const ac = countHeadingLines(body, AC_HEADING_FORMS) === 1
      ? locateSection(body, AC_HEADING_FORMS, { start: 0, end: loc.headingEnd })
      : null
    return { start: loc.headingStart, end: ac ? ac.headingStart : body.length, bounded: !!ac }
  }

  // spliceableSection: where to splice a known section, or why it cannot be
  // done. Two filters, and both are needed because they cover different things:
  //
  //   - `copies > 1` → AMBIGUOUS: it is not touched. It covers the case in which
  //     the issue DOES have its own section and the coordinator pasted another
  //     copy: there is no way to decide which one is the plugin's without
  //     inventing a criterion, so it gives up and reports — exactly what the
  //     report already tells the user about duplicated sections ("--reconcile
  //     does not decide which copy is the right one: merge or delete the surplus
  //     by hand").
  //   - the forbidden zone → it covers EVERYTHING that lives inside the
  //     inherited section: the spec-link line (which is not a heading and
  //     therefore never closed the section) and, since the range reaches as far
  //     as "## Acceptance criteria", also the pasted headings when they are the
  //     body's only copy.
  //
  // `reason` (null when there IS a `loc`) separates the four ways of not having
  // one, because the remedy offered to the user is different in each and saying
  // the wrong one would be asserting something false. Besides 'duplicada' (the
  // filter above):
  //   - 'sin-seccion': the heading does not appear in the body. It is the only
  //     one in which the caller can ALWAYS go ahead, inserting the section where
  //     it belongs; with the other two, only the epic's context can (its anchor
  //     goes IN FRONT of the zone — see there).
  //   - 'en-heredado': it appears ONCE and falls inside the coordinator's
  //     bounded zone — it is not the issue's section, it is text of hers. It is
  //     not the same as "it does not exist": any reader of "the first
  //     occurrence" (the dispatcher, via gh-issue-map.js#mapGhIssue) IS going to
  //     read it as if it were the issue's.
  //   - 'zona-sin-fin': it appears ONCE and falls behind the inherited heading,
  //     but the zone could not be bounded (with no locatable "## Acceptance
  //     criteria"). Here it CANNOT be asserted that it is the coordinator's
  //     text: what is asserted is that there is no way of knowing.
  const spliceableSection = (headings) => {
    const copies = countHeadingLines(body, headings)
    if (copies > 1) return { loc: null, ambiguous: true, reason: 'duplicada' }
    const zone = inheritedZone()
    const loc = locateSection(body, headings, zone)
    // copies === 1 and even so there is no `loc` ⟹ that single copy fell inside
    // the zone (it is the only thing that can hide a heading that IS in the
    // body).
    const reason = loc ? null : copies === 0 ? 'sin-seccion' : zone.bounded ? 'en-heredado' : 'zona-sin-fin'
    return { loc, ambiguous: false, reason }
  }

  const specLinkLoc = locateLine(body, SPEC_LINK_PREFIXES, inheritedZone())
  const currentSpecLink = specLinkLoc ? specLinkLoc.line : null
  if (normalizeSpecLink(currentSpecLink) !== normalizeSpecLink(wantedIssue.specLink)) {
    if (specLinkLoc) {
      body = body.slice(0, specLinkLoc.start) + wantedIssue.specLink + body.slice(specLinkLoc.end)
    } else {
      // With no previous line to replace (a human deleted it): it is prepended
      // at the start of the body, in the same position buildIssueBody always
      // places it.
      body = wantedIssue.specLink + (body.length ? '\n\n' + body : '')
    }
    changed = true
  }

  const acDiff = diffAc(acInSection(body), wantedIssue.ac)
  if (acDiff.missing.length || acDiff.extra.length) {
    const ac = spliceableSection(AC_HEADING_FORMS)
    if (ac.loc) {
      body = body.slice(0, ac.loc.headingEnd) + renderAcContent(wantedIssue.ac) + '\n' + body.slice(ac.loc.contentEnd)
      changed = true
    } else {
      // There is nowhere to write the replacement without guessing: either the
      // "## Acceptance criteria" heading is nowhere to be found (a human renamed
      // it or deleted it), or there is more than one and none of them can be
      // pointed at as the plugin's. It gives up cleanly instead of inventing one,
      // and it says so (unresolvedAc + the reason) so that the caller never
      // reports this as "applied".
      //
      // Here `ac.reason` can only be 'duplicada' or 'sin-seccion', and that is no
      // accident: the forbidden range ENDS at "## Acceptance criteria" itself
      // when it appears exactly once (so it cannot fall inside it), and when it
      // appears more than once `spliceableSection` returns 'duplicada' before
      // even looking at the range. See `inheritedZone`.
      unresolvedAc = true
      unresolvedReasons.ac = ac.reason
    }
  }

  const depsDiff = diffDeps(depsInSection(body), wantedIssue.deps)
  const wantDeps = (wantedIssue.deps || []).length > 0
  if (depsDiff.missing.length || depsDiff.extra.length) {
    const deps = spliceableSection('## Dependencias') // over the ALREADY updated body (fresh positions after the splices above, if there were any)
    const depsLoc = deps.loc
    const wantedDepsContent = renderDepsContent(wantedIssue.deps)
    if (deps.ambiguous) {
      // More than one "## Dependencias" in the body: neither rewriting the
      // first one nor withdrawing it is defensible — the other copy is still
      // there, and one of the two may be text the coordinator pasted into her
      // section.
      unresolvedDeps = true
      unresolvedReasons.deps = 'duplicada'
    } else if (deps.reason === 'en-heredado' || deps.reason === 'zona-sin-fin') {
      // The ONLY "## Dependencias" in the body falls inside the coordinator's
      // zone: the issue has no section of its own and that block is (or may be)
      // text she pasted (second wave of the final review).
      //
      // Treating it as an "absent section" and inserting a new one further down
      // will not do here, even though the forbidden range would already protect
      // her text: the insertion anchor ("## Out of scope / Protected") goes
      // BEHIND hers, and everybody who reads "the first occurrence" —the real
      // dispatcher, via gh-issue-map.js#mapGhIssue/extractDepsInSection— would
      // keep obeying HER dependencies, not the spec's. Adding a second copy
      // would be silently manufacturing precisely the drift this file exists to
      // eliminate. It gives up and says so, with the exact reason: the two
      // remedies are different (taking the block out of the inherited section
      // vs. restoring the AC heading that bounds the zone).
      unresolvedDeps = true
      unresolvedReasons.deps = deps.reason
    } else if (wantDeps && depsLoc) {
      body = body.slice(0, depsLoc.headingEnd) + wantedDepsContent + '\n' + body.slice(depsLoc.contentEnd)
      changed = true
    } else if (wantDeps && !depsLoc) {
      // Section absent but the spec now does want deps: it is inserted WHOLE
      // (heading included) right before "## Out of scope / Protected" — ONLY if
      // that heading can be located (it is the only safe anchor for where to
      // insert). Without it, no position is invented (Critical 3, review round
      // 4): it gives up, marks `unresolvedDeps`, and does not touch the body —
      // the alternative (inserting blindly at the end) created a new section ON
      // EVERY RUN with no limit when the body had an unclosed fence in front.
      // The anchor also has to be UNAMBIGUOUS: if "## Out of scope / Protected"
      // appears twice (the coordinator pasted the previous issue's body, which
      // carries it), anchoring on "the first one" means inserting inside her
      // text.
      const anchor = spliceableSection('## Out of scope / Protected')
      if (anchor.loc) {
        const insertion = `## Dependencias\n${wantedDepsContent}\n\n`
        body = body.slice(0, anchor.loc.headingStart) + insertion + body.slice(anchor.loc.headingStart)
        changed = true
      } else {
        // Each reason has its own sentence because "the Protegido section does
        // not exist either" would be FALSE when what is happening is that it
        // does exist but falls inside the coordinator's zone. 'zona-sin-fin'
        // travels as it is: it does not talk about the anchor, it talks about
        // the zone not having been possible to delimit.
        unresolvedDeps = true
        unresolvedReasons.deps = {
          duplicada: 'ancla-duplicada',
          'sin-seccion': 'sin-ancla',
          'en-heredado': 'ancla-en-heredado',
          'zona-sin-fin': 'zona-sin-fin',
        }[anchor.reason]
      }
    } else if (!wantDeps && depsLoc) {
      // The spec no longer declares deps for this slice, but the issue keeps
      // the section — it is withdrawn WHOLE (heading included), not just its
      // content.
      //
      // Minor (review round 5): `body.slice(0, depsLoc.headingStart)` keeps the
      // blank line that already separated the PREVIOUS section from
      // "## Dependencias" (buildIssueBody always leaves one between sections),
      // and `body.slice(depsLoc.contentEnd)` starts with the '\n' that separated
      // Dependencias from the NEXT section — concatenating both as they are
      // leaves TWO blank lines in a row at the point of the seam. One surplus
      // '\n' is trimmed off the end of the first chunk (if there is none, e.g.
      // because Dependencias was the body's first section, there is nothing to
      // trim and the `replace` is a no-op) so as to leave exactly one.
      const before = body.slice(0, depsLoc.headingStart).replace(/\n$/, '')
      body = before + body.slice(depsLoc.contentEnd)
      changed = true
    }
  }

  // The "## E2E" section (final branch review). It is rewritten, inserted or
  // withdrawn, with the same three-state mechanics as "## Dependencias" — its
  // giving up when the only copy falls inside the coordinator's zone included,
  // and for the SAME reason of position: the insertion anchor ("## Out of scope
  // / Protected") goes BEHIND, so inserting a copy of our own would leave
  // everybody who reads "the first occurrence"
  // (gh-issue-map.js#extractE2eRuns, which /ct-next and `--release` use)
  // reading hers forever.
  //
  // Why this section does get rewritten and Descripción/Protegido do not: it is
  // not "whose the text is" (the spec owns all three), it is the right of
  // editing after the issue has been created. Those are prose a human edits
  // legitimately; the e2e journey cannot be editable without going through
  // Door 1 (§3.3 of the design) — it lives in the frozen spec precisely for
  // that. Editing it by hand in the issue is the drift that has to be undone,
  // not work to protect.
  //
  // The positions are located over the body ALREADY updated by the splices
  // above, not over the original.
  const currentE2eBody = extractSectionContent(body, E2E_HEADING)
  const wantedE2eContent = wantedIssue.e2eContent ?? null
  const e2eDiffers = (currentE2eBody === null && wantedE2eContent === null)
    ? false
    : (currentE2eBody === null || wantedE2eContent === null)
      ? true
      : currentE2eBody.trim() !== wantedE2eContent.trim()
  if (e2eDiffers) {
    const e2e = spliceableSection(E2E_HEADING)
    if (e2e.ambiguous) {
      unresolvedE2e = 'duplicada'
    } else if (e2e.reason === 'en-heredado' || e2e.reason === 'zona-sin-fin') {
      unresolvedE2e = e2e.reason
    } else if (wantedE2eContent && e2e.loc) {
      body = body.slice(0, e2e.loc.headingEnd) + wantedE2eContent + '\n' + body.slice(e2e.loc.contentEnd)
      changed = true
    } else if (wantedE2eContent && !e2e.loc) {
      // Section absent (the adoption case: an epic groomed before the column
      // existed) and the spec now does carry journeys: it is inserted WHOLE
      // right before "## Out of scope / Protected", which is the position
      // buildIssueBody (groom.js) gives it and the only unambiguous anchor — the
      // same one "## Dependencias" uses, with the same four ways of giving
      // up.
      const anchor = spliceableSection('## Out of scope / Protected')
      if (anchor.loc) {
        body = body.slice(0, anchor.loc.headingStart) + `${E2E_HEADING}\n${wantedE2eContent}\n\n` + body.slice(anchor.loc.headingStart)
        changed = true
      } else {
        unresolvedE2e = {
          duplicada: 'ancla-duplicada',
          'sin-seccion': 'sin-ancla',
          'en-heredado': 'ancla-en-heredado',
          'zona-sin-fin': 'zona-sin-fin',
        }[anchor.reason]
      }
    } else if (!wantedE2eContent && e2e.loc) {
      // The spec no longer declares journeys for this slice (the cell became
      // "no"): the section is withdrawn WHOLE, heading included. Leaving it
      // would be leaving the agent travelling a journey the spec has already
      // withdrawn. One '\n' is trimmed off the end of the first chunk so as not
      // to leave two blank lines at the seam, just as when withdrawing
      // "## Dependencias".
      const before = body.slice(0, e2e.loc.headingStart).replace(/\n$/, '')
      body = before + body.slice(e2e.loc.contentEnd)
      changed = true
    }
  }

  // Contexto del epic. It is prose, and even so it gets rewritten — unlike
  // Descripción and Protegido, which do not. What distinguishes them: those are
  // prose a human edits routinely and legitimately in a single issue; this one
  // is text of the epic, identical across all its issues, and editing it by hand
  // in just one of them is exactly the drift that keeping it up to date comes to
  // eliminate. Whoever wants context of their own for this slice has the section
  // next door, which is never touched — and the placeholder it is created with
  // already tells them so.
  //
  // The positions are located over the body ALREADY updated by the splices
  // above, not over the original.
  // `epicContextUnknown` (I1): the same criterion as in diffIssue — the spec
  // carries the section but no valid text could be read from it. There is nothing
  // to write and, above all, nothing to withdraw: "I have no text" is not "the
  // epic has no context", and confusing the two deleted the section from all N
  // issues of the epic over one `###` too many in the spec.
  const currentEpic = extractSectionContent(body, EPIC_CONTEXT_HEADING)
  const wantedEpic = wantedIssue.epicContext ?? null
  const epicDiffers = wantedIssue.epicContextUnknown
    ? false
    : (currentEpic === null && wantedEpic === null)
      ? false
      : (currentEpic === null || wantedEpic === null)
        ? true
        : currentEpic.trim() !== wantedEpic.trim()
  if (epicDiffers) {
    const epic = spliceableSection(EPIC_CONTEXT_HEADING)
    const epicLoc = epic.loc
    // Defence at the consumer (final branch review, C3). The guardrail in
    // groom.js#readEpicContext cuts this off at the producer, but it cannot be
    // the only line: a human edits the issue's body by hand, and there there is
    // no producer to cut off. With an unclosed fence (or comment) inside the
    // section, `locateSection` finds no terminator and `contentEnd` falls at the
    // end of the body — the splice would delete from the epic's heading to the
    // end: "## Contexto heredado", the ACs, the gates, the protected part and
    // the `ct-order` marker (and with no marker the issue stops pairing, so the
    // next groom creates a duplicate). The NEW text is looked at too: writing an
    // open delimiter into the body is manufacturing this very damage for the
    // next run.
    const openSection = epicLoc ? unterminatedDelimiter(epicLoc.content) : null
    const openText = wantedEpic ? unterminatedDelimiter(wantedEpic) : null
    if (openSection || openText) {
      unresolvedEpicContext = openSection ? 'seccion-sin-cerrar' : 'texto-sin-cerrar'
    } else if (epic.ambiguous) {
      // Two copies of the epic's section: one of them may be the one the
      // coordinator pasted inside hers. Neither of them gets written to.
      unresolvedEpicContext = 'duplicada'
    } else if (wantedEpic && epicLoc) {
      body = body.slice(0, epicLoc.headingEnd) + wantedEpic + '\n' + body.slice(epicLoc.contentEnd)
      changed = true
    } else if (wantedEpic && !epicLoc) {
      // Section absent (an issue older than this round) and the spec does carry
      // text: it is inserted whole right BEFORE "## Acceptance criteria", which
      // is the position that belongs to it (see further down which heading is
      // used as the anchor and why).
      //
      // The "the only copy falls inside the coordinator's zone" case
      // (`epic.reason === 'en-heredado'`) comes through here on purpose, and the
      // other way round from Dependencias, which gives up in the equivalent
      // case. The difference is not one of criterion, it is one of POSITION:
      // this section's anchor is the inherited heading, which means the inserted
      // copy ends up IN FRONT of the one the coordinator pasted, and everybody
      // who reads "the first occurrence" starts reading the plugin's. Inserting
      // here converges; in Dependencias, whose anchor goes behind, inserting
      // would leave the dispatcher obeying hers forever.
      // Without that anchor no position is invented — inserting blindly at the
      // end is what, with an unclosed code fence in front, added a new section
      // on every run with no limit.
      // The preferred anchor is "## Contexto heredado", not "## Acceptance
      // criteria" (final branch review, minor): §3.4 fixes the order
      // epic → inherited → criteria, and anchoring on AC left the inserted
      // section AFTER the inherited one, precisely backwards. It is anchored
      // BEFORE its heading, so not one byte is written inside it. With no
      // inherited section in the body (an issue older than F26 that does not
      // have that one either), it falls back to AC, which is where it was.
      //
      // The anchor has to be unambiguous, for the same reason as Dependencias':
      // with two copies of the heading in the body, "the first one" may be the
      // one the coordinator pasted into her section. For the inherited one
      // `spliceableSection` is NOT used: that function discards any match inside
      // the inherited zone, and the heading of the inherited section itself is,
      // by definition, the first character of that zone.
      const soleInheritedSection = countHeadingLines(body, INHERITED_CONTEXT_HEADING) === 1
        ? locateSection(body, INHERITED_CONTEXT_HEADING)
        : null
      const anchor = soleInheritedSection ? { loc: soleInheritedSection, ambiguous: false } : spliceableSection(AC_HEADING_FORMS)
      if (anchor.loc) {
        body = body.slice(0, anchor.loc.headingStart) + `${EPIC_CONTEXT_HEADING}\n${wantedEpic}\n\n` + body.slice(anchor.loc.headingStart)
        changed = true
      } else {
        // With no anchor: nothing is written and no gap is marked (this section
        // never counts towards the exit code, so it cannot produce one) — but it
        // IS said. Giving up in silence left the caller announcing "reconciled"
        // about a section that still did not exist.
        unresolvedEpicContext = anchor.ambiguous ? 'ancla-duplicada' : 'sin-ancla'
      }
    } else if (!wantedEpic && epicLoc) {
      // The spec no longer carries the epic's context: the section is withdrawn
      // WHOLE, heading included. One '\n' is trimmed off the end of the first
      // chunk so as not to leave two blank lines at the seam, just as when
      // withdrawing "## Dependencias".
      const before = body.slice(0, epicLoc.headingStart).replace(/\n$/, '')
      body = before + body.slice(epicLoc.contentEnd)
      changed = true
    } else {
      // `!wantedEpic && !epicLoc`, and even so `epicDiffers`: the body's only
      // copy of the heading falls inside the coordinator's zone (`epic.reason`
      // is 'en-heredado' or 'zona-sin-fin') — `currentEpic` read it, because
      // `extractSectionContent` looks at the whole body, and the spec no longer
      // carries any context. Withdrawing it would be deleting text that is not
      // the plugin's, so it is not touched; and it has to be SAID, or the caller
      // would report as withdrawn a section that is still there. This branch is
      // not reachable in any other way: with `wantedEpic` and `currentEpic` both
      // null, `epicDiffers` is already false.
      //
      // The reason travels as it is, without collapsing it to 'en-heredado':
      // with the zone unbounded it CANNOT be asserted that that text is the
      // coordinator's —only that there is no way of knowing where hers ends—,
      // and saying so would be exactly the class of over-assertion this branch
      // has spent eleven rounds removing. It is the same distinction the
      // Dependencias route already makes, a few blocks further up.
      unresolvedEpicContext = epic.reason
    }
  }

  // Decisiones congeladas. Exactly the same treatment as "## Contexto del
  // epic": it comes from the spec, and it gets rewritten (it is text of the
  // epic, not prose a human edits in a single issue). It goes AFTER the epic's
  // block on purpose: both of them are inserted anchored on "## Contexto
  // heredado", so running this one second leaves the order
  // epic → decisions → inherited that buildIssueBody fixes. The positions are
  // located over the body ALREADY updated by the splices above.
  const currentFrozen = extractSectionContent(body, FROZEN_DECISIONS_HEADING)
  const wantedFrozen = wantedIssue.frozenDecisions ?? null
  const frozenDiffers = wantedIssue.frozenDecisionsUnknown
    ? false
    : (currentFrozen === null && wantedFrozen === null)
      ? false
      : (currentFrozen === null || wantedFrozen === null)
        ? true
        : currentFrozen.trim() !== wantedFrozen.trim()
  if (frozenDiffers) {
    const frozen = spliceableSection(FROZEN_DECISIONS_HEADING)
    const frozenLoc = frozen.loc
    // Defence at the consumer (just as in the epic's context): an unclosed
    // delimiter inside the section would make the splice delete as far as the
    // end of the body. The section is looked at and so is the new text.
    const openSection = frozenLoc ? unterminatedDelimiter(frozenLoc.content) : null
    const openText = wantedFrozen ? unterminatedDelimiter(wantedFrozen) : null
    if (openSection || openText) {
      unresolvedFrozenDecisions = openSection ? 'seccion-sin-cerrar' : 'texto-sin-cerrar'
    } else if (frozen.ambiguous) {
      unresolvedFrozenDecisions = 'duplicada'
    } else if (wantedFrozen && frozenLoc) {
      body = body.slice(0, frozenLoc.headingEnd) + wantedFrozen + '\n' + body.slice(frozenLoc.contentEnd)
      changed = true
    } else if (wantedFrozen && !frozenLoc) {
      // Section absent and the spec does carry it: it is inserted whole.
      // Preferred anchor "## Contexto heredado" (so as to respect
      // epic → decisions → inherited), with "## Acceptance criteria" as the
      // fallback — just like the epic's context. Since this block runs AFTER
      // its one, if the epic has just been inserted the section lands between
      // the epic and the inherited one. spliceableSection is not used for the
      // inherited one, for the same reason as there: its heading is the first
      // character of the zone that function discards.
      const soleInheritedSection = countHeadingLines(body, INHERITED_CONTEXT_HEADING) === 1
        ? locateSection(body, INHERITED_CONTEXT_HEADING)
        : null
      const anchor = soleInheritedSection ? { loc: soleInheritedSection, ambiguous: false } : spliceableSection(AC_HEADING_FORMS)
      if (anchor.loc) {
        body = body.slice(0, anchor.loc.headingStart) + `${FROZEN_DECISIONS_HEADING}\n${wantedFrozen}\n\n` + body.slice(anchor.loc.headingStart)
        changed = true
      } else {
        unresolvedFrozenDecisions = anchor.ambiguous ? 'ancla-duplicada' : 'sin-ancla'
      }
    } else if (!wantedFrozen && frozenLoc) {
      // The spec no longer carries any decisions: the section is withdrawn
      // whole, heading included. One '\n' is trimmed off the end of the first
      // chunk so as not to leave two blank lines at the seam, just as when
      // withdrawing the epic's.
      const before = body.slice(0, frozenLoc.headingStart).replace(/\n$/, '')
      body = before + body.slice(frozenLoc.contentEnd)
      changed = true
    } else {
      // `!wantedFrozen && !frozenLoc` and even so `frozenDiffers`: the only
      // copy falls inside the coordinator's zone (extractSectionContent read it)
      // and the spec no longer carries any decisions. It is not touched (it is
      // not the plugin's text) and it is said, or the caller would report as
      // withdrawn a section that is still there.
      unresolvedFrozenDecisions = frozen.reason
    }
  }

  if (!changed) return { body: null, unresolvedAc, unresolvedDeps, unresolvedReasons, unresolvedEpicContext, unresolvedFrozenDecisions, unresolvedE2e }
  const finalBody = eol === '\r\n' ? body.replace(/\n/g, '\r\n') : body
  return { body: finalBody, unresolvedAc, unresolvedDeps, unresolvedReasons, unresolvedEpicContext, unresolvedFrozenDecisions, unresolvedE2e }
}
