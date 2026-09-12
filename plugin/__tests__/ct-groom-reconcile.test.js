import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir, specUrl } from './fixtures/spec-repo.js'
import { buildIssueBody, FROZEN_DECISIONS_HEADING } from '../scripts/groom.js'

// F5 — the groom detects divergence, not only existence. This file covers the
// REAL RUN (mutating, with no --dry-run) against a fake `gh`: the default
// behaviour (it detects and reports, it touches nothing) and the opt-in
// --reconcile (it applies what was detected through `gh issue edit`, with the
// same hard-abort-on-a-gh-failure convention the rest of this file already
// uses for milestones/labels/project). The --dry-run tests (same report, zero
// mutation) live in ct-groom-dryrun.test.js.

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')

const ONE_SLICE_SPEC = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema | api | db |
`

// The plan ONE_SLICE_SPEC produces today (verified against groom.js):
// title "#1 login", labels ['type:backend','area:api','touches:db','status:backlog'],
// milestone "Epic" (--milestone by default).

// SPEC_REF_OK: the reference to the spec that ct-groom.mjs resolves for a
// "spec.md" inside a makeSpecDir directory (a git repo with origin
// https://github.com/o/r.git) when the `gh` stub confirms it is published on
// `main` and that the anchor exists. F10: it no longer depends on the temporary
// directory — what goes into the body is the path relative to the repo's root,
// identical in every test.
const SPEC_REF_OK = { path: 'spec.md', heading: '9. Slices', url: specUrl('spec.md'), reason: null }

// SPEC_LINK_LINE: the SAME line, written by hand. The fixtures that build a
// body by hand (the duplicate-section ones, further down) need it so that
// their only divergence is the one they mean to test — and writing it by hand,
// instead of calling renderSpecLink, is what makes these tests fail if the
// format changes by accident.
const SPEC_LINK_LINE = (n) => `> Slice \`#${n}\` of the epic. Spec: [spec.md § 9. Slices](${specUrl('spec.md')})`

// matchingBody(): the EXACT body ONE_SLICE_SPEC produces today — generated
// with the real buildIssueBody (not by hand), so that this file's "it matches
// in everything" fixtures really do match in EVERYTHING F5 compares (AC,
// Dependencias, Descripción, Protegido, and — review round 3 — the link to the
// spec).
function matchingBody() {
  return buildIssueBody(
    { n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' },
    SPEC_REF_OK,
  )
}

function writeSpec(content) {
  const dir = makeSpecDir('ctg-reconcile-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, content)
  return { dir, spec }
}

// `opts.cwd` (F10): needed in order to be able to invoke with a RELATIVE spec
// path — the check that the path's notation no longer changes anything of the
// resulting link.
function run(args, envOverrides = {}, opts = {}) {
  return spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...envOverrides },
    ...opts,
  })
}

// An existing issue that diverges in title AND labels at once (missing
// area:/touches:, a different title) — a single fixture that exercises both
// classes of field in the same run, plus status:in-progress (which must never
// be reported nor touched). It is a function of `specPath` for the same reason
// as matchingBody: the body (correct except for whatever each test means to
// test) includes the link to the real spec.
//
// F23: it carries `milestone: { title: 'Epic' }` (the very one the run asks
// for) on purpose — with the matching bounded by epic, an issue with a
// different milestone falls into `otrosEpics` and `findByMarker` does not find
// it, so a milestone divergence can no longer be manufactured from this call
// site. That branch of diffIssue/formatDrift is now tested in
// reconcile.test.js.
function existingIssueDrift(specPath) {
  return {
    number: 501,
    title: '#1 iniciar sesión',
    state: 'open',
    milestone: { title: 'Epic' },
    labels: [{ name: 'type:backend' }, { name: 'status:in-progress' }],
    // a correct body (AC/deps/Descripción/Protegido/link-to-the-spec already
    // match the spec) — so this fixture exercises ONLY the title/labels
    // divergence that is its purpose, without dragging along body drift by
    // accident.
    body: matchingBody(),
  }
}

function baseEnv(specPath) {
  return {
    FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
    FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existingIssueDrift(specPath)]]),
  }
}

describe('ct-groom (real run) — it detects divergence by default, it does not apply it (F5)', () => {
  it('it reports the divergent title/labels over stderr, it NEVER calls `gh issue edit`, exit 3', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], { ...baseEnv(spec), FAKE_GH_ARGV_LOG_FILE: argvLog })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/drift.*slice #1.*issue #501/)
    expect(res.stderr).toMatch(/title differs/i)
    expect(res.stderr).toMatch(/"#1 iniciar sesión"/)
    expect(res.stderr).toMatch(/"#1 login"/)
    expect(res.stderr).toMatch(/the label "area:api" is missing/)
    expect(res.stderr).toMatch(/the label "touches:db" is missing/)
    // What this test defends is that the DIVERGENCE REPORT does not mention
    // `status:in-progress`: it is a label of the issue that the spec does not
    // own, and reporting it as "extra" would be the bug. The assertion is
    // bounded to the divergence lines because the name now shows up,
    // legitimately, on another line of stderr: the one of the `status:`
    // vocabulary /ct-groom creates so that the claim can write it later
    // (groom.js#LOOP_STATUS_LABELS).
    expect(res.stderr).not.toMatch(/drift.*status:in-progress/)
    expect(res.stdout).toMatch(/already exists \(#501\), not duplicated/) // the usual idempotence message is still there
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/) // with no --reconcile, the issue is never mutated
    rmSync(dir, { recursive: true, force: true })
  })

  it('with no divergence at all (the existing issue already matches) → exit 0, with no "drift" lines', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const MATCHING_ISSUE = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:none' }, { name: 'status:in-progress' }],
      body: matchingBody(),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[MATCHING_ISSUE]]),
    })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/drift/)
    rmSync(dir, { recursive: true, force: true })
  })

  // Review #45, point 4 — the NET of the GraphQL pagination. The issue that
  // matches (idempotence) goes on PAGE 2 (FAKE_GH_GRAPHQL_PAGE_SIZE=1, with a
  // foreign issue on page 1). If `--paginate` stayed on page 1 (a badly named
  // variable, an absent pageInfo, an old gh), ct-groom would not see #501 and
  // would try to create it. That "ya existe, no se duplica" comes out proves
  // that it read page 2.
  it('pagination: the issue that matches on PAGE 2 is seen → idempotent, it does not recreate it', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const OTHER = { number: 601, title: 'otro epic', state: 'open', milestone: { title: 'Otro Epic' }, labels: [], body: 'sin marcador' }
    const MATCHING_ISSUE = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:none' }, { name: 'status:in-progress' }],
      body: matchingBody(),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[OTHER, MATCHING_ISSUE]]),
      FAKE_GH_GRAPHQL_PAGE_SIZE: '1', // forces 2 pages: OTHER on page 1, #501 on page 2
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/already exists \(#501\), not duplicated/) // it saw page 2
    rmSync(dir, { recursive: true, force: true })
  })

  // I3.8: the decisions section does NOT move the exit code. The spec brings
  // "## Decisiones congeladas" and the existing issue (matchingBody, without
  // the section) diverges ONLY in that → it is reported as a note:, exit 0,
  // not 3.
  it('the spec brings ## Decisiones congeladas and the issue does not → note:, exit 0 (it does not move the exit code)', () => {
    const SPEC_DEC = ONE_SLICE_SPEC.replace('## 9. Slices', '## Decisiones congeladas\n- **D-1 · versión** — iOS 17. *(Procedencia: hablada.)*\n\n## 9. Slices')
    const { dir, spec } = writeSpec(SPEC_DEC)
    const MATCHING_ISSUE = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:none' }, { name: 'status:in-progress' }],
      body: matchingBody(), // with no "## Decisiones congeladas"
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[MATCHING_ISSUE]]),
    })
    expect(res.status).toBe(0) // NOT 3: the section is a note, not a machine divergence
    expect(res.stderr).toContain(FROZEN_DECISIONS_HEADING)
    expect(res.stderr).toMatch(/note:/)
    expect(res.stderr).not.toMatch(/drift/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a closed issue with no other divergence at all → total silence about the closure, exit 0', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const CLOSED_MATCHING = {
      number: 501,
      title: '#1 login',
      state: 'closed',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:none' }],
      body: matchingBody(),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[CLOSED_MATCHING]]),
    })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/the issue is closed/i)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a closed issue WITH divergence → it adds the "cerrado" note warning before --reconcile, exit 3', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const CLOSED_DRIFT = { ...existingIssueDrift(spec), state: 'closed', milestone: { title: 'Epic' }, labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }] }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[CLOSED_DRIFT]]),
    })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/title differs/i)
    expect(res.stderr).toMatch(/the issue is closed — review before applying --reconcile/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom (real run) --reconcile — it applies what was detected through `gh issue edit` (F5)', () => {
  it('it applies title + labels in a single call to `gh issue edit` (the milestone can no longer diverge: F23), exit 0', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], { ...baseEnv(spec), FAKE_GH_ARGV_LOG_FILE: argvLog })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/reconciled/)
    const log = readFileSync(argvLog, 'utf8')
    const editLine = log.split('\n').find((l) => l.startsWith('issue edit 501'))
    expect(editLine).toBeTruthy()
    expect(editLine).toMatch(/--repo o\/r/)
    expect(editLine).toMatch(/--title #1 login/)
    // F23: the `--milestone` flag NO LONGER comes out of here, and this
    // inverted assertion is what proves it. With the matching bounded by epic,
    // a matched issue always has the requested milestone, so diff.milestone is
    // unreachable from /ct-groom — and with it disappears BY CONSTRUCTION the
    // danger the feedback's §2 pointed out in capitals: a --reconcile that
    // dragged a closed issue from another epic over to the new milestone. The
    // branch is still alive in reconcile.js (a pure module, other callers), but
    // this call site cannot reach it. It is inverted instead of deleted because
    // a test that disappears documents nothing.
    expect(editLine).not.toMatch(/--milestone/)
    expect(editLine).toMatch(/--add-label area:api/)
    expect(editLine).toMatch(/--add-label touches:db/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--reconcile over a slice with NO divergence does not call `gh issue edit` for that slice (nothing to apply)', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const MATCHING_ISSUE = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:none' }],
      body: matchingBody(),
    }
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[MATCHING_ISSUE]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(0)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a closed issue + --reconcile: the edit is applied all the same (gh issue edit does not reopen the issue)', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const CLOSED_DRIFT = { ...existingIssueDrift(spec), state: 'closed' }
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[CLOSED_DRIFT]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(0)
    const log = readFileSync(argvLog, 'utf8')
    expect(log).toMatch(/issue edit 501/)
    rmSync(dir, { recursive: true, force: true })
  })

  // A convention already established in this file (milestones/labels/project):
  // a `gh` failure is never benign — we abort with a clear message instead of
  // going on blindly. FAKE_GH_EDIT_FAIL_SUBSTR simulates that the `gh issue
  // edit` of this particular issue fails (auth, network, rate limit...).
  it('--reconcile: if `gh issue edit` fails, it aborts with exit 1 and a clear message — it never goes on blindly', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], { ...baseEnv(spec), FAKE_GH_EDIT_FAIL_SUBSTR: 'issue edit 501' })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/could not reconcile issue #501/)
    expect(res.stdout).not.toMatch(/reconciled/) // success is never reported after the failure
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// The coordinator's review round 2 — three points:
// 1) CRITICAL: excluding the whole body threw away precisely what the
//    dispatcher DOES obey (deps → dispatch.js, ac → kickoff.js). They are now
//    compared and applied through --reconcile (a surgical splice of the body).
// 2) The labels rule has to be gated by column: with no "Área" in the §9
//    table, the spec has no authority over `area:` at all.
// 3) The exit 3 under --dry-run has to be a decision, not a consequence —
//    covered explicitly in ct-groom-dryrun.test.js.
//
// The coordinator's review round 3 — three more Criticals, attended to here
// where it applies at the CLI level (the pure-layer tests live in
// reconcile.test.js and gh-issue-map.test.js):
//   2. --reconcile could exit 0 over a real divergence that was not applied.
//   4. Orphan issues were never mentioned.
//   6. Descripción/Protegido anchored the exit code forever.
// ============================================================================

describe('ct-groom (real run) — divergent AC/Dependencias: they are detected and --reconcile applies them (critical review)', () => {
  // Two slices so that the dependency (#2) is a real reference: the §9 table
  // requires "Dep" to point at a "#" that exists. Slice #1 asks for two AC
  // (AC-1.1, AC-1.2) and depends on #2; the existing issue of order 1 only has
  // AC-1.1 and no "## Dependencias" section at all — exactly the scenario that
  // worried the coordinator: an author corrects the §9 table (adds a
  // dependency, adds an AC) and before this fix nothing happened. Slice #2
  // already matches completely, so as to isolate the signal.
  const SPEC_2 = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | #2 | AC-1.1, AC-1.2 | schema |
| 2 | signup | backend | registro | – | AC-2.1 | – |
`
  function issue1Drift(specPath) {
    return {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'gate:none' }], // F21: the plan always produces a gate label (here, "none")
      // AC-1.2 is missing, and there is no "## Dependencias" section at all.
      body: buildIssueBody({ n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' }, SPEC_REF_OK),
    }
  }
  function issue2Matching(specPath) {
    return {
      number: 502,
      title: '#2 signup',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'gate:none' }],
      body: buildIssueBody({ n: 2, name: 'signup', type: 'backend', entrega: 'registro', deps: [], ac: ['AC-2.1'], protected: '–' }, SPEC_REF_OK),
    }
  }
  function env2(specPath) {
    return {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue1Drift(specPath), issue2Matching(specPath)]]),
    }
  }

  it('by default: it reports the missing AC and the missing dependency over stderr, it NEVER calls `gh issue edit`, exit 3', () => {
    const { dir, spec } = writeSpec(SPEC_2)
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], { ...env2(spec), FAKE_GH_ARGV_LOG_FILE: argvLog })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/the acceptance criterion "AC-1.2" is missing/)
    expect(res.stderr).toMatch(/the dependency "merge-after `#2`" is missing/)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--reconcile: it applies the missing AC and dependency through `--body` (a splice), it preserves Descripción/Protegido/the marker, it does NOT touch issue #2 (which already matched), exit 0', () => {
    const { dir, spec } = writeSpec(SPEC_2)
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], { ...env2(spec), FAKE_GH_ARGV_LOG_FILE: argvLog })
    expect(res.status).toBe(0)
    const log = readFileSync(argvLog, 'utf8')
    expect(log).toMatch(/issue edit 501/)
    expect(log).not.toMatch(/issue edit 502/) // #2 already matched completely — not a single call for it
    // The reconciled --body brings the added AC and the added dependency...
    expect(log).toContain('AC-1.2')
    expect(log).toContain('merge-after `#2`') // F6: the reconciled body uses the SAME renderer as buildIssueBody
    // ...and it preserves Descripción/Protegido/the marker just as they were (a
    // surgical splice, not a regeneration of the whole body).
    expect(log).toContain('modelo')
    expect(log).toContain('schema')
    expect(log).toContain('<!-- ct-order:1 -->')
    rmSync(dir, { recursive: true, force: true })
  })

  // Critical 2 (review round 3): if the AC heading is renamed by hand,
  // --reconcile CANNOT rewrite it — it has to report that precisely (not "just
  // prose"), NOT call `gh` for anything of that issue (title/milestone/labels
  // do match in this fixture; the only divergent thing is the inapplicable
  // AC), and the exit code has to stay at 3 even though --reconcile was asked
  // for.
  // The body is taken as it was before F26 (with no "## Contexto heredado") so
  // that what is read here is only what this test exists to pin down. With the
  // inherited section present, an unlocatable AC heading also leaves the
  // coordinating session's zone with no known boundary and Dependencias is not
  // applied either — that has its own test right below (the second wave of the
  // branch's final review), with its own reason, instead of diluting this one.
  const withoutInherited = (body) => body.replace(/## Contexto heredado\n.*\n\n/, '')

  it('the "## Acceptance criteria" heading renamed by hand → --reconcile does NOT apply it, it warns precisely (never "solo prosa"), the exit stays at 3', () => {
    const { dir, spec } = writeSpec(SPEC_2)
    const renamedIssue1 = {
      ...issue1Drift(spec),
      body: withoutInherited(issue1Drift(spec).body).replace('## Acceptance criteria (EARS, 1:1 con tests)', '## Criterios'),
    }
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[renamedIssue1, issue2Matching(spec)]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(3) // NOT 0 — a real gap was left unapplied
    expect(res.stderr).toMatch(/cannot fully apply this drift/)
    expect(res.stderr).toMatch(/acceptance criteria/)
    expect(res.stderr).not.toMatch(/prose only/i) // NEVER this lie (Critical 2)
    // deps COULD be applied (a domain independent of AC's) — the --body that is
    // sent (it embeds newlines of its own, which is why it is checked over the
    // whole log instead of isolating the line) has to include the dependency:
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).toMatch(/issue edit 501/)
    expect(log).toContain('merge-after `#2`')
    rmSync(dir, { recursive: true, force: true })
  })

  // The second wave of the branch's final review: the SAME body, but as F26
  // emits it (with "## Contexto heredado"). The coordinating session's
  // untouchable zone ends at "## Acceptance criteria"; without that heading
  // there is no knowing where its own part ends, so nothing is written behind
  // the inherited heading — not the missing Dependencias section either. The
  // exit stays at 3 and the warning says what the remedy is, without asserting
  // that the block is hers (that cannot be known).
  it('with the inherited section, the renamed AC heading also leaves Dependencias unapplied — and the warning says why', () => {
    const { dir, spec } = writeSpec(SPEC_2)
    const renamedIssue1 = {
      ...issue1Drift(spec),
      body: issue1Drift(spec).body.replace('## Acceptance criteria (EARS, 1:1 con tests)', '## Criterios'),
    }
    expect(renamedIssue1.body).toContain('## Contexto heredado') // the premise of the case
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[renamedIssue1, issue2Matching(spec)]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/there is no telling where "## Contexto heredado" ends/)
    expect(res.stderr).not.toMatch(/prose only/i)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit 501/) // nothing is written: there was nothing applicable
    rmSync(dir, { recursive: true, force: true })
  })
})

// NO_AREA_SPEC: unlike ONE_SLICE_SPEC (above), this §9 table does NOT bring
// "Área" or "Toca" columns — the body it produces is identical to
// matchingBody's (those columns do not feed the body, only labels), so it is
// reused.
const NO_AREA_SPEC = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
`

describe('ct-groom (real run) — labels: the spec is only the authority over a prefix if the table brings its column (review, point 2)', () => {
  // With no "Área" column at all: the spec has NO opinion whatsoever about
  // `area:`. An area:ops put on the issue by hand (for whatever reason) must
  // never be reported as "sobra" — it would be a false positive that teaches
  // people to ignore the rest of the report.
  it('a §9 table with NO "Área" column: an area: put on the issue by hand is not reported as "sobra", exit 0', () => {
    const { dir, spec } = writeSpec(NO_AREA_SPEC)
    const ISSUE_WITH_AREA = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:ops' }, { name: 'gate:none' }], // area:ops put on by hand, the spec never spoke of an area
      body: matchingBody(),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[ISSUE_WITH_AREA]]),
    })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/area:ops/)
    rmSync(dir, { recursive: true, force: true })
  })
})

// Review round 3, point 6: a divergence --reconcile can NEVER resolve
// (Descripción/Protegido, prose) must not anchor the exit code forever — it is
// reported (as a note:), but the process exits 0. The PREVIOUS behaviour (a
// perpetual exit 3) was the same noise problem that was already closed for the
// labels, in the opposite direction.
describe('ct-groom (real run) — a divergence of prose ONLY (Descripción/Protegido): it is reported, but it NO LONGER anchors the exit code (review round 3, point 6)', () => {
  it('a divergent Descripción, everything else matching: it is reported as a "note:", exit 0 (with or without --reconcile)', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const PROSE_DRIFT = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      // area:api/touches:db included — this file's ONE_SLICE_SPEC DOES bring
      // those columns, so they are needed for labels/AC/deps NOT to diverge and
      // for the only real divergence to be the Descripción.
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:none' }],
      // A different Descripción ("otro texto" instead of "modelo") —
      // everything else (AC, deps, Protegido, the link to the spec) matches the
      // spec.
      body: buildIssueBody({ n: 1, name: 'login', type: 'backend', entrega: 'otro texto', deps: [], ac: ['AC-1.1'], protected: 'schema' }, SPEC_REF_OK),
    }
    const argvLog = join(dir, 'argv.log')
    const envBase = {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[PROSE_DRIFT]]),
    }
    const resDefault = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], envBase)
    expect(resDefault.status).toBe(0) // point 6: it is NO LONGER anchored at 3
    expect(resDefault.stderr).toMatch(/^note:.*Descripción/m)
    expect(resDefault.stderr).not.toMatch(/^drift:/m) // nothing counts as a real divergence

    const resReconcile = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], { ...envBase, FAKE_GH_ARGV_LOG_FILE: argvLog })
    expect(resReconcile.status).toBe(0) // not with --reconcile either
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/) // nothing really to apply — not a single call
    rmSync(dir, { recursive: true, force: true })
  })
})

// Important 4 (review round 3): an issue with a ct-order:N marker whose slice
// N is no longer in the current §9 table (the row was deleted) must not
// disappear in silence.
describe('ct-groom (real run) — orphan issues: a slice deleted from the §9 table does not leave its issue in silence (review round 3, important 4)', () => {
  it('an issue with ct-order:9 when the table no longer has a slice #9 → an explicit warning, exit 3', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC) // it only has slice #1
    const orphan = {
      number: 999,
      title: '#9 algo que ya no existe',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [],
      body: '<!-- ct-order:9 -->',
    }
    const matchingSlice1 = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:none' }],
      body: matchingBody(),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[orphan, matchingSlice1]]),
    })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/issue #999/)
    expect(res.stderr).toMatch(/ct-order:9/)
    expect(res.stderr).toMatch(/orphaned/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('with no orphan issue at all → no orphan warning', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const matchingSlice1 = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:none' }],
      body: matchingBody(),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[matchingSlice1]]),
    })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/orphaned/)
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// Review round 4 — the reviewer attacked their OWN implementation of round 3,
// not only the three cases they had been given. These two tests cover, at the
// end-to-end CLI level, the two "important" findings most visible to a human
// (the rest — the fence tracker, the exact heading equality, the surrender
// instead of unbounded growth, and the warning about a merge-after outside its
// section — are already covered exhaustively in the pure layer,
// reconcile.test.js/gh-issue-map.test.js).
// ============================================================================

// F10 replaces in full the section that used to be here ("the link to the spec
// ignores the path notation, it only compares the anchor"). That defence
// existed because the line was composed with `process.argv[2]` as it came: the
// same §9 produced two different lines depending on how the path had been
// written, and comparing the whole line caused a perpetual ping-pong between
// two invocation habits. Now the line is derived from the REPOSITORY (path
// relative to the root + remote + default branch), so the premise of that test
// can no longer be built: there are not two possible lines for the same file.
// That very thing is checked — and what is gained in exchange.
describe('ct-groom (real run) — the link to the spec is the SAME however it is invoked, and it is compared whole (F10)', () => {
  it('invoking with a relative path and with an absolute path produces EXACTLY the same link line (there is no ping-pong left to avoid)', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const abs = JSON.parse(run([spec, '--milestone', 'Epic', '--dry-run']).stdout)
    const rel = JSON.parse(run(['spec.md', '--milestone', 'Epic', '--dry-run'], {}, { cwd: dir }).stdout)
    expect(abs.issues[0].specLink).toBe(rel.issues[0].specLink)
    // And it is the line with the absolute URL, not a degradation that happens
    // to coincide in being equally useless both times.
    expect(abs.issues[0].specLink).toContain(specUrl('spec.md'))
    rmSync(dir, { recursive: true, force: true })
  })

  it('an issue created BEFORE F10 (relative link, numeric anchor) DOES diverge — the broken link no longer passes as good because the "9" matched', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const preF10 = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      // The EXACT line the previous version of groom.js produced.
      body: matchingBody().replace(/^> Slice .*$/m, '> Slice `#1` of the epic. Spec: [spec.md#9](spec.md#9)'),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[preF10]]),
    })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/the link to the spec differs/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the spec MOVED to another file (same heading, same section) DOES diverge — the known limit the anchor comparison did not detect', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const otherFile = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: buildIssueBody(
        { n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' },
        { path: 'docs/old.md', heading: '9. Slices', url: specUrl('docs/old.md'), reason: null },
      ),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[otherFile]]),
    })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/the link to the spec differs/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the SAME link (same file, same heading) does NOT diverge, and --reconcile does not call `gh issue edit` over it', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    const matching = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:none' }],
      body: matchingBody(),
    }
    const envBase = {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[matching]]),
    }
    const resDefault = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], envBase)
    expect(resDefault.status).toBe(0)
    expect(resDefault.stderr).not.toMatch(/enlace al spec/)

    const resReconcile = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], { ...envBase, FAKE_GH_ARGV_LOG_FILE: argvLog })
    expect(resReconcile.status).toBe(0)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom (real run) — a duplicated "## Dependencias"/"## Acceptance criteria" counts for the exit code (review round 4, important 5)', () => {
  const SPEC_2 = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | #2 | AC-1.1 | schema |
| 2 | signup | backend | registro | – | AC-2.1 | – |
`
  it('issue #1 with a duplicated "## Dependencias" (the same dependency in both copies) → exit 3, even though the spec and the issue match in everything else', () => {
    const { dir, spec } = writeSpec(SPEC_2)
    const issue1WithDuplicateDeps = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'gate:none' }], // F21: the plan always produces a gate label (here, "none")
      body: [
        SPEC_LINK_LINE(1), '',
        '## Descripción', 'modelo', '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-1.1', '',
        '## Dependencias', '- merge-after #2', '',
        '## Dependencias', '- merge-after #2', '', // a duplicated copy — the dispatcher does not tell "the first one" apart
        '## Out of scope / Protected', '- 🚫 schema', '',
        '<!-- ct-order:1 -->',
      ].join('\n'),
    }
    const issue2Matching = {
      number: 502,
      title: '#2 signup',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'gate:none' }],
      body: buildIssueBody({ n: 2, name: 'signup', type: 'backend', entrega: 'registro', deps: [], ac: ['AC-2.1'], protected: '–' }, SPEC_REF_OK),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue1WithDuplicateDeps, issue2Matching]]),
    })
    expect(res.status).toBe(3) // before this round, this exited 0 (it was only a note)
    expect(res.stderr).toMatch(/drift:[^\n]*"## Dependencias" section appears more than once/)
    rmSync(dir, { recursive: true, force: true })
  })

  // Important 3 (review round 5): with --reconcile, this SAME duplicate
  // (title/milestone/labels/ac/deps already match the spec — the ONLY
  // divergence is that "## Dependencias" shows up twice with the SAME content)
  // has NO ac/deps gap to report (the sets already match), so before this fix
  // `anyReconcileGapRemains` stayed at `false` — zero calls to `gh issue edit`
  // (nothing to change), the divergence line was printed all the same, and the
  // process exited 0. Now `reconcileGaps` also covers duplicateMachineSections:
  // it has to go on exiting 3, with the same "no se puede aplicar" warning.
  it('the SAME duplicate, with --reconcile → it still exits 3 (not 0): --reconcile has nothing with which to resolve a duplicate, zero calls to `gh issue edit`', () => {
    const { dir, spec } = writeSpec(SPEC_2)
    const argvLog = join(dir, 'argv.log')
    const issue1WithDuplicateDeps = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'gate:none' }], // F21: the plan always produces a gate label (here, "none")
      body: [
        SPEC_LINK_LINE(1), '',
        '## Descripción', 'modelo', '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-1.1', '',
        '## Dependencias', '- merge-after #2', '',
        '## Dependencias', '- merge-after #2', '', // a duplicated copy, the SAME content — ac/deps already match the spec
        '## Out of scope / Protected', '- 🚫 schema', '',
        '<!-- ct-order:1 -->',
      ].join('\n'),
    }
    const issue2Matching = {
      number: 502,
      title: '#2 signup',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'gate:none' }],
      body: buildIssueBody({ n: 2, name: 'signup', type: 'backend', entrega: 'registro', deps: [], ac: ['AC-2.1'], protected: '–' }, SPEC_REF_OK),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue1WithDuplicateDeps, issue2Matching]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(3) // before this fix, this exited 0 — it also broke the parity with --dry-run --reconcile over the same body
    expect(res.stderr).toMatch(/drift:[^\n]*"## Dependencias" section appears more than once/)
    expect(res.stderr).toMatch(/--reconcile cannot fully apply this drift.*duplicated sections/is)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit 501/) // nothing really to apply: ac/deps already matched, all that is left over is one copy
    rmSync(dir, { recursive: true, force: true })
  })
})

// A product decision (review round 5): --reconcile is documented as
// EXPERIMENTAL — the warning is printed over stderr as soon as the flag is
// present, BEFORE any validation or mutation, and it NEVER appears without the
// flag (the default behaviour does not gain new warnings).
describe('ct-groom — the "--reconcile is EXPERIMENTAL" warning (review round 5, a product decision)', () => {
  it('with --reconcile → the warning shows up over stderr', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], baseEnv(spec))
    expect(res.stderr).toMatch(/--reconcile is EXPERIMENTAL/)
    rmSync(dir, { recursive: true, force: true })
  })
  it('WITHOUT --reconcile → the warning NEVER shows up (the default behaviour does not gain new warnings)', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], baseEnv(spec))
    expect(res.stderr).not.toMatch(/EXPERIMENTAL/)
    rmSync(dir, { recursive: true, force: true })
  })
})
