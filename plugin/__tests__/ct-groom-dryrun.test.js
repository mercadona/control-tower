import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir, specUrl } from './fixtures/spec-repo.js'
import { REAL_FAILING_TABLE, REAL_DEP_TABLE, REAL_TABLE_WITH_HASH_FIXED } from './fixtures/slices-real-tables.js'
import { buildIssueBody, EPIC_CONTEXT_HEADING, FROZEN_DECISIONS_HEADING, LOOP_STATUS_LABELS } from '../scripts/groom.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')

// Explicit stdio (finding 11 of the final review): without this, execFileSync
// not only captures the child's stderr in `e.stderr`, it also forwards it to
// the parent process — the output of `npm test`. Several tests in this file
// trigger error paths on purpose (non-existent spec, missing --repo, dangling
// flags in the finding 3 section further down); that stderr is expected, and
// stdio:['ignore','pipe','pipe'] keeps it available through `e.stderr` without
// echoing it to the parent.
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']

// F5: --dry-run stopped being 100% offline — it now also enumerates the
// existing issues of `--repo` (a pure read, to detect drift) BEFORE printing
// the plan, precisely so that the preview does not report LESS than a real
// run (the same trap F1 closed for the validation of the §9 table). Every
// test in this file passes `--repo o/r` under --dry-run — without a fake `gh`
// on the PATH, that enumeration would invoke the machine's REAL `gh`
// (installed and authenticated in this sandbox) against a repo that does not
// exist. `fakeEnv()` prepends the stub in __tests__/fixtures/fake-gh-bin to
// the PATH; with no overrides, that stub answers "[]" (no existing issue) to
// the issue listing — exactly "there is nothing to compare against yet",
// which is the correct reading for a plan that is being created for the first
// time and preserves, unchanged, everything this suite already verified
// before F5.
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = (overrides = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...overrides })

const SPEC = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice (issue) | Tipo | Entrega | Dep | Acepta (AC) | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
| 2 | refresh | backend | flow | #1 | AC-2.1 | – |
`

describe('ct-groom --dry-run', () => {
  it('it prints the plan without touching gh', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.milestone).toBe('Epic')
    expect(plan.issues).toHaveLength(2)
    expect(plan.issues[1].labels).toContain('type:backend')
    expect(plan.issues[1].body).toContain('merge-after `#1`') // F6: inline code, GitHub does not autolink it to issue #1
    // F3: the title comes from "Slice" ("login"/"refresh"), not from "Entrega"
    // ("modelo"/"flow") — "Entrega" shows up in the body as a description.
    expect(plan.issues[0].title).toBe('#1 login')
    expect(plan.issues[1].title).toBe('#2 refresh')
    expect(plan.issues[0].body).toContain('modelo')
    rmSync(dir, { recursive: true, force: true })
  })

  it('--project 7 shows up as the number 7 in the dry-run JSON', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '7', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.project).toBe(7)
    rmSync(dir, { recursive: true, force: true })
  })

  it('with no --project, the plan carries project: null', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.project).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('a non-existent spec exits with a code other than 0 and a usage message', () => {
    let threw = false
    try {
      execFileSync('node', [script, '/no/existe/spec.md', '--repo', 'o/r', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).not.toBe(0)
      expect(e.stderr.toString()).toMatch(/could not read the spec/)
    }
    expect(threw).toBe(true)
  })

  it('a spec with duplicated slice orders exits with a code other than 0 and a message naming the duplicate', () => {
    const dir = makeSpecDir('ctg-')
    const DUP_SPEC = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice (issue) | Tipo | Entrega | Dep | Acepta (AC) | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
| 1 | login-bis | backend | modelo bis | – | AC-1.2 | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, DUP_SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      // exit 2, not a raw exit 1 from an uncaught exception: the same code as
      // the rest of this wrapper's validation errors (non-existent spec,
      // invalid --milestone/--project/--repo).
      expect(e.status).toBe(2)
      expect(e.stderr.toString()).toMatch(/duplicate/)
      expect(e.stderr.toString()).toMatch(/1/)
      // the wrapper's convention: console.error + process.exit, NEVER a Node
      // stack trace dumped by an uncaught exception.
      expect(e.stderr.toString()).not.toMatch(/at \S+ \(file:/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('with no --repo outside --dry-run it exits with a code other than 0 and a usage message', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--milestone', 'Epic'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).not.toBe(0)
      expect(e.stderr.toString()).toMatch(/--repo is required/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

// Finding 3 of the final review: ct-groom.mjs's `arg()` (unlike
// ct-next.mjs/dispatch-check.mjs) took `process.argv[i+1]` literally without
// checking that it was a real value. Verified live against the sandbox:
// `--milestone` as the last token made `milestone` the boolean `true`, and a
// real run CREATED a milestone titled "true" hooking every issue of the epic
// to it; `--milestone --dry-run` ate `--dry-run` as a value; `--project` with
// no value turned into `1` (`Number(true)===1`).
describe('ct-groom — dangling flags do not sneak false values through (final review, finding 3)', () => {
  it('--milestone as the last token (with no value) → exit 2, it never creates or uses a "true" milestone', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--dry-run', '--milestone'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '').toString()).toMatch(/--milestone/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--milestone followed by another flag (--dry-run) with no real value → exit 2, it does not eat the next flag', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '').toString()).toMatch(/--milestone/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--project as the last token (with no value) → exit 2, it never turns into 1', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--dry-run', '--project'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '').toString()).toMatch(/--project/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--project followed by another flag (with no real value) → exit 2', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--project', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '').toString()).toMatch(/--project/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a non-numeric --project → exit 2', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--project', 'nope', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '').toString()).toMatch(/--project/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  // D4 (review of numeric arguments): `Number('2.9')` is 2.9 — finite and > 0,
  // so the previous validation let it through and the value travelled as it
  // stood all the way to `gh project view 2.9`, which fails late and
  // confusingly. A project number is an integer or it is nothing.
  for (const bad of ['2.9', '1e3', ' 3', '0x10']) {
    it(`--project ${JSON.stringify(bad)} → exit 2 (it is not an integer in plain digits)`, () => {
      const dir = makeSpecDir('ctg-')
      const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
      let threw = false
      try {
        execFileSync('node', [script, spec, '--repo', 'o/r', '--project', bad, '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
      } catch (e) {
        threw = true
        expect(e.status).toBe(2)
        expect((e.stdout || '') + (e.stderr || '')).toMatch(/--project invalid/)
      }
      expect(threw).toBe(true)
      rmSync(dir, { recursive: true, force: true })
    })
  }

  // F10 — `--section` becomes OBSOLETE. Up to here, F6 had given it a call-site
  // validation (a dangling `--section` returned the boolean `true` and the spec
  // link of EVERY issue came out as "[spec.md#true](spec.md#true)"). That
  // validation was correct for what the flag did back then, but the whole flag
  // was an empty promise: the §9 table is located by its column header
  // ("Slice" + "Dep"), not by any section number, so --section never decided
  // WHAT got groomed; it only composed the link's anchor… and "#9" is not an
  // anchor that exists on GitHub (the heading "## 9. Slices" has the id
  // "9-slices"). Its only observable effect was producing a broken link.
  //
  // The new contract: it is accepted in any shape (nobody sees their script
  // break all at once), it is ignored, and the fact that it is ignored is said
  // out loud — which is what stops anyone from going on believing it decides
  // anything.
  it('--section with a real value: it is IGNORED (the anchor comes from the real heading), it warns, and it does not break', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--section', '12', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/--section is OBSOLETE and is IGNORED/)
    const plan = JSON.parse(res.stdout)
    // Not a trace of the "12" that was asked for: the anchor is the real heading's.
    expect(plan.issues[0].body).not.toContain('#12')
    expect(plan.issues[0].body).toContain(specUrl('spec.md'))
    rmSync(dir, { recursive: true, force: true })
  })

  for (const [caseName, argv] of [
    ['como último token (sin valor)', ['--dry-run', '--section']],
    ['seguido de otro flag (sin valor real)', ['--section', '--dry-run']],
  ]) {
    it(`--section ${caseName}: it is no longer an error — it is ignored and warned about, exit 0`, () => {
      const dir = makeSpecDir('ctg-')
      const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
      const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', ...argv],
        { encoding: 'utf8', env: fakeEnv() })
      expect(res.status).toBe(0)
      expect(res.stderr).toMatch(/--section is OBSOLETE/)
      // The hole F6 closed must NOT reappear through the back door: the boolean
      // `true` of a dangling flag reaches no anchor.
      expect(res.stdout).not.toContain('#true')
      rmSync(dir, { recursive: true, force: true })
    })
  }

  it('with no --section nothing is said about --section (the warning is not background noise)', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/--section/)
    rmSync(dir, { recursive: true, force: true })
  })

  // Re-review: --repo had the same gap (only `if (!repo)`, which a dangling
  // `true` passes unnoticed by being truthy) — now validated the same way as
  // ct-next.mjs/dispatch-check.mjs (`typeof !== 'string'`).
  it('--repo as the last token (with no value) → exit 2, never a "true" slipping through towards gh', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--dry-run', '--milestone', 'Epic', '--repo'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '').toString()).toMatch(/--repo/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--repo followed by another flag (with no real value) → exit 2', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '').toString()).toMatch(/--repo/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

// F1 — /ct-groom fails hard on an unusable §9 table, BEFORE touching GitHub and
// under --dry-run too (a dry-run that validates less than the real run is a
// trap). The three silent-failure proofs from the incident report: parseSlices
// returning [] in silence (defect 1), prefix duplication in Área/Toca
// (defect 2) and absent columns going unreported (defect 3).
describe('ct-groom — it fails hard on an unusable §9 table (F1)', () => {
  it('with no §9 table in the spec → exit != 0, the message names the absence, BEFORE printing the plan', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '# Spec sin sección de slices\n\nSolo prosa, ninguna tabla.\n')
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).not.toBe(0)
      expect(e.stdout).toBe('') // it never gets as far as printing the plan JSON
      expect(e.stderr.toString()).toMatch(/no markdown table.*was found/i)
      expect(e.stderr.toString()).toMatch(/§9/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the "#" column is missing → exit != 0, the message names the column and the consequence (order/dependencies)', () => {
    const dir = makeSpecDir('ctg-')
    const NO_HASH = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|
| x | backend | y | – | – | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, NO_HASH)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      expect(e.stderr.toString()).toMatch(/"#"\s+column/)
      expect(e.stderr.toString()).toMatch(/slice order/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  // F3: the title no longer comes from "Entrega" (it comes from "Slice") —
  // "Entrega" became an OPTIONAL column (the body's Descripción), so its
  // absence NO longer aborts; it degrades like Tipo/Acepta/Protegido/Área/Toca
  // (a warning on stderr, the dry-run keeps working). This test used to verify
  // the abort; it now verifies the new contract explicitly, to put the change
  // on record.
  it('the "Entrega" column is missing → it NO longer aborts (F3: it became optional), it warns on stderr and the dry-run keeps working', () => {
    const dir = makeSpecDir('ctg-')
    const NO_DELIVERY = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Dep | Acepta | Protegido |
|---|---|---|---|---|---|
| 1 | x | backend | – | – | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, NO_DELIVERY)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues).toHaveLength(1)
    expect(plan.issues[0].title).toBe('#1 x') // title from "Slice"
    expect(res.stderr).toMatch(/"Entrega"\s+column/)
    expect(res.stderr).toMatch(/Descripci/i)
    rmSync(dir, { recursive: true, force: true })
  })

  it('rows whose "#" is not a plain integer → exit != 0, the message says how many, shows an offending value and says what to write instead', () => {
    const dir = makeSpecDir('ctg-')
    const BAD_HASH = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| **S1** | x | backend | y | – | – | – |
| 2 | ok | backend | z | – | – | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, BAD_HASH)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('') // not even partially: it aborts before printing anything
      const err = e.stderr.toString()
      // Anchored to the count (a toothless test from the review: the message
      // carries the literal "1" in its own example, so a bare /1/ would pass
      // with any count). Anchored to the start of the message.
      expect(err).toMatch(/^1 row/)
      expect(err).toMatch(/\*\*S1\*\*/) // the offending value, as it stands
      expect(err).toMatch(/integer/i)
      expect(err).toMatch(/"1"/) // what to write instead
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the table is there but with no data row at all → exit != 0, the message says there are no rows', () => {
    const dir = makeSpecDir('ctg-')
    const EMPTY_TABLE = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, EMPTY_TABLE)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      expect(e.stderr.toString()).toMatch(/no data rows/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  // A mandatory regression: the REAL table that triggered the incident
  // (imported from __tests__/fixtures/slices-real-tables.js — it is neither
  // paraphrased nor duplicated: they are the exact rows of the report, the
  // "**S1**"/"**S2**" numbering, S2's dep as "S1" with no "#", Área/Toca values
  // with backticks and the full label prefix). Before this fix,
  // `/ct-groom --dry-run` printed `{"issues": [], ...}` and exited 0.
  it('regression: the real table from the incident → exit != 0 instead of "0 issues, exit 0"', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, REAL_FAILING_TABLE)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('') // the original bug: this printed {"issues":[],...} and exited 0
      const err = e.stderr.toString()
      expect(err).toMatch(/^2 row/) // anchored to the count: the two rows, S1 and S2
      expect(err).toMatch(/\*\*S1\*\*/)
      expect(err).not.toMatch(/at \S+ \(file:/) // convention: never a raw stack trace
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — it warns but carries on with absent columns or a prefix in the wrong column (F1)', () => {
  it('with no Tipo/Acepta/Protegido/Área/Toca columns → the dry-run keeps working, stderr warns about each absence and its consequence', () => {
    const dir = makeSpecDir('ctg-')
    const MINIMAL = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Entrega | Dep |
|---|---|---|---|
| 1 | login | modelo | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, MINIMAL)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.issues).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the absent-columns warning is visible on stderr when captured explicitly (spawnSync)', () => {
    const dir = makeSpecDir('ctg-')
    const MINIMAL = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Entrega | Dep |
|---|---|---|---|
| 1 | login | modelo | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, MINIMAL)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0) // it warns, it does not abort
    expect(res.stderr).toMatch(/Tipo/)
    expect(res.stderr).toMatch(/type:/)
    expect(res.stderr).toMatch(/Acepta/)
    expect(res.stderr).toMatch(/Protegido/)
    expect(res.stderr).toMatch(/Área|Area/)
    expect(res.stderr).toMatch(/Toca/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a value with the other column\u2019s prefix ("area:x" in Toca) → the dry-run does not abort, the label is generated properly (touches:pbxproj, not touches:areapbxproj), and it warns', () => {
    const dir = makeSpecDir('ctg-')
    const MISMATCHED = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | – | – | – | area:pbxproj |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, MISMATCHED)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).toContain('touches:pbxproj')
    expect(plan.issues[0].labels).not.toContain('touches:areapbxproj')
    expect(res.stderr).toMatch(/area:pbxproj/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a correctly prefixed value ("area:medicacion" in Área, with backticks) → a label with no duplicated prefix', () => {
    const dir = makeSpecDir('ctg-')
    const PREFIXED = [
      '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices',
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | login | backend | modelo | – | – | – | `area:medicacion` | `touches:pbxproj` |',
      '',
    ].join('\n')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, PREFIXED)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.issues[0].labels).toContain('area:medicacion')
    expect(plan.issues[0].labels).toContain('touches:pbxproj')
    expect(plan.issues[0].labels).not.toContain('area:areamedicacion')
    expect(plan.issues[0].labels).not.toContain('touches:touchespbxproj')
    rmSync(dir, { recursive: true, force: true })
  })
})

// F3 — `Tipo` decides which addendum the dispatched agent gets
// (kickoff.js#ADDENDA, through renderKickoff): `ADDENDA[slice.type] || ''`
// returns an empty string in silence for any value that is not an exact key of
// ADDENDA. An author who writes "ios"/"swift" for a slice that is really UI
// gets a normal-looking `type:ios` label, but the dispatched agent NEVER gets
// `ui`'s addendum (the mandatory screenshot gate) — with no warning at all.
// /ct-groom must warn (not abort: `type:ios` is still a legitimate label even
// with no addendum), naming the value, the slice, the consequence and the
// recognised set.
describe('ct-groom — "Tipo" with a value that is no key of ADDENDA warns, it does not abort (F3)', () => {
  it('"Tipo" = "ios" (not a key of ADDENDA) → the dry-run does not abort, the type:ios label is created all the same, and it warns on stderr with the value, the slice, the consequence and the recognised set', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | pantalla | ios | pantalla de alta | – | – | – |
`)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).toContain('type:ios') // the value is used all the same
    expect(res.stderr).toMatch(/"ios"/) // the offending value
    expect(res.stderr).toMatch(/Tipo/) // the column
    expect(res.stderr).toMatch(/#1/) // the slice
    expect(res.stderr).toMatch(/addendum/i) // the consequence
    expect(res.stderr).toMatch(/ui/) // the recognised set includes "ui"
    expect(res.stderr).toMatch(/backend/)
    expect(res.stderr).toMatch(/infra/)
    expect(res.stderr).toMatch(/bugfix/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('"Tipo" with a recognised value ("ui") fires no type warning at all', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | pantalla | ui | pantalla de alta | – | – | – | – | – |
`)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    // F6: a new epic never produces an empty stderr any more — the groom says
    // which labels it would invent and that what it creates will not be
    // dispatchable until someone promotes it to status:ready. What this test
    // checks is the absence of the type WARNING, not global silence. F26: this
    // test's spec does not carry "## Contexto del epic" either, so since T3 the
    // stderr ALSO carries that warning — orthogonal to what is checked here.
    // It is anchored to the Tipo column (the only source of the warning this
    // test watches), not to a bare "warning:".
    expect(res.stderr).not.toMatch(/column Tipo/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('an empty "Tipo" (the column is there, the cell is blank) fires no type warning at all (it still gets no type: label)', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | pantalla |  | pantalla de alta | – | – | – | – | – |
`)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    // F6: a new epic never produces an empty stderr any more — the groom says
    // which labels it would invent and that what it creates will not be
    // dispatchable until someone promotes it to status:ready. What this test
    // checks is the absence of the type WARNING, not global silence. F26: this
    // test's spec does not carry "## Contexto del epic" either, so since T3 the
    // stderr ALSO carries that warning — orthogonal to what is checked here.
    // It is anchored to the Tipo column (the only source of the warning this
    // test watches), not to a bare "warning:".
    expect(res.stderr).not.toMatch(/column Tipo/)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels.some((l) => l.startsWith('type:'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  // Review of F3, finding 1: a "no value" marker in "Tipo" ("–", "-", "—", and
  // so on — the SAME criterion Dep/Acepta/Protegido/Área/Toca already use)
  // means "none", just like the empty cell above — NOT an unknown real value.
  // Before the fix this fired TWO symptoms at once: (a) the "unrecognised Tipo"
  // warning accused of a typo whoever wrote exactly the marker the contract
  // itself teaches them to use in every other column, and (b) `buildLabels`
  // (groom.js) treated "–" as truthy and emitted the literal label "type:–" —
  // which `gh label create --force` would really create in the user's repo, the
  // same "area:areamedicacion" bug through another door. The two ways of saying
  // "none" (an empty cell, a cell with a marker) must behave the same.
  it.each(['-', '–', '—', '―', '−', '--'])('"Tipo" = a "no value" marker ("%s") → no warning, and no "type:" label (the same treatment as an empty Tipo)', (marker) => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | pantalla | ${marker} | pantalla de alta | – | – | – | – | – |
`)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    // F6: a new epic never produces an empty stderr any more — the groom says
    // which labels it would invent and that what it creates will not be
    // dispatchable until someone promotes it to status:ready. What this test
    // checks is the absence of the type WARNING, not global silence. F26: this
    // test's spec does not carry "## Contexto del epic" either, so since T3 the
    // stderr ALSO carries that warning — orthogonal to what is checked here.
    // It is anchored to the Tipo column (the only source of the warning this
    // test watches), not to a bare "warning:".
    expect(res.stderr).not.toMatch(/column Tipo/)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels.some((l) => l.startsWith('type:'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

// F2 — pointed at by the coordinator after verifying F1 against the real spec:
// a "Dep" cell with content but no recognisable "#N" reference at all ("S1"
// instead of "#1", say) produces deps: [] in silence. Unlike the 0-slices case
// (which at least creates nothing), this one DOES create the milestone and the
// issues, with exit 0, but with no `merge-after` line — /ct-next dispatches
// dependent slices without waiting for the merge of the one they depended on.
describe('ct-groom — Dep with content but no recognisable #N reference at all aborts hard (F2)', () => {
  // The table exactly as the coordinator verified it (imported from
  // __tests__/fixtures/slices-real-tables.js, with the columns filled in where
  // the original message used "…"): the "#" of all 3 rows is valid — the only
  // problem is the Dep column.
  it('regression: the coordinator\u2019s table → exit != 0 instead of "issues created, exit 0, deps wiped"', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, REAL_DEP_TABLE)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('') // the bug: this printed the whole plan (deps: []) and exited 0
      const err = e.stderr.toString()
      // Anchored to the count (a toothless test from the review: a bare /2/
      // passes with any count because the example message itself contains
      // digits). 2 malformed rows (slices #2 and #3; #1 with "–" is
      // legitimate).
      expect(err).toMatch(/^2 row/)
      expect(err).toMatch(/"S1"/) // the offending value, as it stands
      expect(err).toMatch(/#N/) // which format to use
      expect(err).toMatch(/#1/) // an example of the correct format
      expect(err).toMatch(/write\s+"–"/) // CRITICAL 1: the half of the message that was missing
      expect(err).not.toMatch(/at \S+ \(file:/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('"–" (no dependencies, the legitimate form) does not abort', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC) // the SPEC from the top of the file: Dep "–" and "#1"
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(2)
    rmSync(dir, { recursive: true, force: true })
  })

  it('legitimate text around a valid #N reference ("#1 (tras el merge)") does not abort', () => {
    const dir = makeSpecDir('ctg-')
    const LEGIT = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #1 (tras el merge) | – | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, LEGIT)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.issues[1].body).toContain('merge-after `#1`')
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// Review of F1/F2 — 2 Criticals + 4 silent paths, verified end-to-end at CLI
// level (dry-run). The equivalent unit tests live in __tests__/slices.test.js
// against analyzeSlicesTable directly.
// ============================================================================

describe('ct-groom — an em dash (—) in Dep does not abort; the malformed-Dep message says what to write (CRITICAL 1)', () => {
  it('an em dash (—) in Dep does not abort — the plan is generated with deps: []', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | — | – | – |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the exact regression of the coordinator\u2019s sequence: "#" already fixed (REAL_TABLE_WITH_HASH_FIXED) — it does not abort because of row 1 (Dep "—"), it does keep aborting because of row 2 (Dep "S1")', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, REAL_TABLE_WITH_HASH_FIXED)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      const err = e.stderr.toString()
      // The message must be about "S1" (row 2), NEVER about "—" (row 1, which
      // always meant "no dependencies" correctly).
      expect(err).toMatch(/^1 row/)
      expect(err).toMatch(/"S1"/)
      expect(err).not.toMatch(/"—"/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the "malformed Dep" message says explicitly what to write when there are no dependencies', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | ninguna | – | – |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stderr.toString()).toMatch(/if there are no dependencies, write\s+"–"/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — bold/italics around the prefix in Área/Toca does not duplicate the label (CRITICAL 2)', () => {
  it('"**area:medicacion**"/"**touches:pbxproj**" (bold) → labels with no duplicated prefix', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | – | – | **area:medicacion** | **touches:pbxproj** |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.issues[0].labels).toContain('area:medicacion')
    expect(plan.issues[0].labels).toContain('touches:pbxproj')
    expect(plan.issues[0].labels).not.toContain('area:areamedicacion')
    expect(plan.issues[0].labels).not.toContain('touches:touchespbxproj')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — a gap (a blank line) inside the §9 table aborts hard, it does not truncate in silence (3)', () => {
  it('a blank line between 2 data rows → exit != 0 instead of "1 issue created, exit 0" (half a silent epic)', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | primero | – | – | – |

| 2 | b | ui | segundo | – | – | – |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('') // the bug: this printed a single issue and exited 0
      const err = e.stderr.toString()
      expect(err).toMatch(/^1 data row/)
      expect(err).toMatch(/segundo/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

// F3: the cell with mandatory content (the one that, when empty, leaves no
// reliable title to build) moved from "Entrega" to "Slice".
describe('ct-groom — an empty "Slice" cell, or a row shorter than the header, aborts hard (4, updated by F3)', () => {
  it('an empty Slice cell → exit != 0 instead of an issue titled just "#1"', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 |  | ui | y | – | – | – |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      const err = e.stderr.toString()
      expect(err).toMatch(/^1 row/)
      expect(err).toMatch(/Slice/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('an empty Entrega cell (with content in Slice) NO longer aborts (F3: Entrega is optional)', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui |  | – | – | – |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.issues).toHaveLength(1)
    expect(plan.issues[0].title).toBe('#1 a')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — Dep pointing at a slice that does not exist, or at itself, aborts hard (5)', () => {
  it('a self-reference (slice #3 depends on #3) → exit != 0, the message names the self-reference', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #1 | – | – |
| 3 | c | ui | z | #3 | – | – |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      const err = e.stderr.toString()
      expect(err).toMatch(/^1 "Dep" reference/)
      expect(err).toMatch(/#3.*itself|itself.*#3/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a reference to a "#" that does not exist (#99 in a table of 2 slices) → exit != 0', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #99 | – | – |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      expect(e.stderr.toString()).toMatch(/#99/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — an Área/Toca token that normalises to empty warns but does not abort (6)', () => {
  it('an "area:" empty after the prefix → the dry-run does not abort, it warns on stderr that the label is left inert for that slice', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | – | – | area: | – |
`)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).not.toContain('area:')
    expect(plan.issues[0].labels.some((l) => l.startsWith('area:'))).toBe(false)
    expect(res.stderr).toMatch(/Área/)
    expect(res.stderr).toMatch(/inert/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — "the §9 table was not found" tells "there is no table" apart from "there is a table with no Slice/Dep header"', () => {
  it('there are markdown table rows but no header with "Slice"/"Dep" → a different message from "there is no table at all"', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## 9. Algo\n| Foo | Bar |\n|---|---|\n| 1 | 2 |\n')
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      const err = e.stderr.toString()
      expect(err).toMatch(/header/i)
      expect(err).toMatch(/Slice/)
      expect(err).not.toMatch(/no markdown table/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('with no markdown table at all → the message "no markdown table was found at all"', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '# Spec sin ninguna tabla\n\nSolo prosa.\n')
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stderr.toString()).toMatch(/no markdown table.*was found/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// Review round 2/5 — CRITICAL (markup wrapping the whole cell of a list),
// IMPORTANT (false positives of the end-of-table heuristic) and 3 more silent
// paths, verified end-to-end at CLI level.
// ============================================================================

describe('ct-groom — markup wrapping the WHOLE CELL of a comma-separated list does not duplicate the prefix (review round 2, CRITICAL)', () => {
  it('"**area:medicacion, area:otro**" / "`touches:pbxproj, touches:otro`" → correct labels, no duplication, no abort', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | login | backend | modelo | – | – | – | **area:medicacion, area:otro** | `touches:pbxproj, touches:otro` |\n')
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    const labels = plan.issues[0].labels
    expect(labels).toContain('area:medicacion')
    expect(labels).toContain('area:otro')
    expect(labels).toContain('touches:pbxproj')
    expect(labels).toContain('touches:otro')
    expect(labels).not.toContain('area:areamedicacion')
    expect(labels).not.toContain('touches:touchespbxproj')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — the post-gap scan does not drag in a foreign table (review round 2, IMPORTANT)', () => {
  it('a horizontal rule ("---") before an unrelated table, with no markdown heading → it does not abort', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | primero | – | – | – |

---

| Cosa | Valor |
|---|---|
| x | y |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — a row with more cells than the header aborts hard (review round 2, a)', () => {
  it('an unescaped "|" in a cell (more cells than the header) → exit != 0 instead of columns shifted in silence', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – | med | icacion | pbx |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      expect(e.stderr.toString()).toMatch(/^1 row/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

// F3: the demand for real content moved from "Entrega" to "Slice" — a "no
// value" marker in "Entrega" no longer aborts (it is "no description", which is
// legitimate); in "Slice" it does, because that is where the title comes from.
describe('ct-groom — "Slice" with a "no value" marker aborts hard (review round 2, b — updated by F3)', () => {
  it('"Slice" = "–" → exit != 0 instead of an issue titled "#1 –"', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | – | ui | y | – | – | – |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      expect(e.stderr.toString()).toMatch(/^1 row/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('"Entrega" = "–" (with content in Slice) NO longer aborts', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | – | – | – | – |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — a "nothing" marker wrapped in markup in Dep does not abort (review round 2, c)', () => {
  it('"`–`" (backtick) in Dep does not abort', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |\n' +
      '|---|---|---|---|---|---|---|\n' +
      '| 1 | a | ui | x | `–` | – | – |\n')
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('"**–**" (bold) in Dep does not abort', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | **–** | – | – |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

// A usability improvement recommended by the coordinator: with several defects
// at once, only the first was printed before (a merry-go-round of up to eight
// runs to see them all). Now every class of error that fires is aggregated and
// they are printed together before a single exit(2).
describe('ct-groom — several defects at once are ALL reported in a single run (usability improvement)', () => {
  it('one row with a malformed "#" and another with a malformed "Dep" in the same table → stderr carries BOTH messages, a single exit 2', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| **1** | a | ui | x | – | – | – |
| 2 | b | ui | y | S1 | – | – |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      const err = e.stderr.toString()
      // Both classes of error must show up in the SAME run — there is no need
      // to fix one, run again, and discover the other.
      expect(err).toMatch(/"#"/)
      expect(err).toMatch(/\*\*1\*\*/)
      expect(err).toMatch(/"Dep"/)
      expect(err).toMatch(/"S1"/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

// Review round 3/5 — the prefix Critical, for the third time: each token
// wrapped in ITS OWN backtick ("`area:hoy`, `area:web`") kept producing
// "area:areaweb" because round 2's fix only cleaned the borders of the WHOLE
// cell or the borders of each piece, by layers — and the split broke exactly at
// the point neither of the two layers reached. Fix: normalise in one go
// (backtick/asterisk out globally, underscore only at token borders, split,
// prefix, normalise) instead of by layers. Verified with the four shapes in the
// same table, plus a negative control that what is legitimate is not corrupted.
describe('ct-groom — markup normalisation in a single pass closes the whole class (review round 3)', () => {
  it('the coordinator\u2019s EXACT REPRODUCTION: "`area:hoy`, `area:web`" → clean labels, no abort, no warning', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | login | backend | modelo | – | – | – | `area:hoy`, `area:web` | – |\n')
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    const labels = plan.issues[0].labels
    expect(labels).toContain('area:hoy')
    expect(labels).toContain('area:web')
    expect(labels).not.toContain('area:areaweb')
    // with no normalisation warning at all: both tokens are recognised clean
    // (F6: stderr is no longer empty — it carries the new labels and the
    // status:backlog reminder. F26: nor is it empty because "## Contexto del
    // epic" is absent — orthogonal to what this test watches, so it is anchored
    // to the Área/Toca columns instead of a bare "warning:").
    expect(res.stderr).not.toMatch(/in column (Área|Toca)/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the four shapes of markup in the same table, plus a negative control, all correct in a single run', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | celda entera | backend | y | – | – | – | **area:medicacion, area:otro** | – |\n' +
      '| 2 | cada token | backend | y | – | – | – | `area:hoy`, `area:web` | – |\n' +
      '| 3 | mezcla | backend | y | – | – | – | **area:x**, `area:y` | – |\n' +
      '| 4 | anidada | backend | y | – | – | – | `**area:z**` | – |\n' +
      '| 5 | control negativo | backend | y | – | – | – | areas-comunes | mi_token |\n')
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    const labelsOf = (order) => plan.issues.find((i) => i.order === order).labels
    expect(labelsOf(1)).toEqual(expect.arrayContaining(['area:medicacion', 'area:otro']))
    expect(labelsOf(2)).toEqual(expect.arrayContaining(['area:hoy', 'area:web']))
    expect(labelsOf(3)).toEqual(expect.arrayContaining(['area:x', 'area:y']))
    expect(labelsOf(4)).toEqual(expect.arrayContaining(['area:z']))
    expect(labelsOf(5)).toEqual(expect.arrayContaining(['area:areas-comunes', 'touches:mi_token']))
    for (const order of [1, 2, 3, 4]) {
      expect(labelsOf(order).some((l) => /^area:area/.test(l))).toBe(false)
    }
    rmSync(dir, { recursive: true, force: true })
  })
})

// Review round 4/5 (the last one of F1) — verified at CLI level: the
// asymmetric-underscore regression (issue 1) and the widened matrix of wrappers
// (issue 2), in a single run.
describe('ct-groom — symmetric underscore + inverted prefix (review round 4)', () => {
  it('a negative control of file names (_layout.tsx, __init__.py, trailing_) reaches the labels UNmutilated — it fails if the asymmetric ^_+/_+$ comes back', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | backend | y | – | – | – | – | _layout.tsx |
| 2 | b | backend | y | – | – | – | – | __init__.py |
| 3 | c | backend | y | – | – | – | – | trailing_ |
| 4 | d | backend | y | – | – | – | – | mi_token_largo |
| 5 | e | backend | y | – | – | – | areas-comunes | – |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    const labelsOf = (order) => plan.issues.find((i) => i.order === order).labels
    expect(labelsOf(1)).toContain('touches:_layout.tsx')
    expect(labelsOf(2)).toContain('touches:__init__.py')
    expect(labelsOf(3)).toContain('touches:trailing_')
    expect(labelsOf(4)).toContain('touches:mi_token_largo')
    expect(labelsOf(5)).toContain('area:areas-comunes')
    rmSync(dir, { recursive: true, force: true })
  })

  it('the matrix of wrappers (backtick, asterisk, underscore, ~~, straight quotes, parentheses, nested) — they all produce "area:med", none duplicates the prefix', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | backtick | backend | y | – | – | – | `area:med` | – |\n' +
      '| 2 | asterisco | backend | y | – | – | – | **area:med** | – |\n' +
      '| 3 | guion bajo | backend | y | – | – | – | _area:med_ | – |\n' +
      '| 4 | tachado | backend | y | – | – | – | ~~area:med~~ | – |\n' +
      '| 5 | comillas | backend | y | – | – | – | "area:med" | – |\n' +
      '| 6 | parentesis | backend | y | – | – | – | (area:med) | – |\n' +
      '| 7 | anidado | backend | y | – | – | – | `**area:med**` | – |\n')
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    for (const issue of plan.issues) {
      expect(issue.labels).toContain('area:med')
      expect(issue.labels.some((l) => /^area:area/.test(l))).toBe(false)
    }
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// F5 — the groom detects divergence, not just existence. Until now, an issue
// that already existed (found by its ct-order marker) only fired "it already
// exists, it is not duplicated" — NEVER comparing its title, labels or
// milestone against what the §9 table produces today. These tests cover the
// report under --dry-run (identical to the real run's, see
// ct-groom-reconcile.test.js for that half) — "a dry-run that reports less than
// the real run is a trap" applies here exactly as it already applied to the
// table validation in F1.
// ============================================================================

const ONE_SLICE_SPEC = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema | api | db |
`
// The plan ONE_SLICE_SPEC produces with --milestone Epic (verified against
// groom.js): title "#1 login", labels ['type:backend','area:api','touches:db','status:backlog'].
// PLAN_LABELS_EXIST (F6): the plan's four labels, already present in the repo.
// The "everything matches" fixtures further down need a COHERENT world to be
// able to keep demanding an empty stderr: an issue that already exists with
// those labels implies those labels exist in the repo — without this, the stub
// would answer "the repo has no label at all" and the groom would say, quite
// rightly, that four would be created.
// F21: `gate:none` joins the plan (one gate label per issue, always — see
// gates.js#GATE_LABEL_NONE). Without it here, the world would stop being
// coherent and the groom would say, quite rightly, that a new label would be
// created.
// The whole `status:` vocabulary joins the set the repo has to HAVE
// (groom.js#LOOP_STATUS_LABELS): an issue is born in `status:backlog`, but the
// other three are written later with `--add-label`, which cannot create them.
// Without them here the world would stop being coherent and the groom would
// say, quite rightly, that three new labels would be created. They are derived
// from the constant, not copied: a hand-written list would diverge the moment
// anyone touched the vocabulary.
const PLAN_LABELS_EXIST = JSON.stringify([[{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:none' }, ...LOOP_STATUS_LABELS.map((name) => ({ name }))]])

// SPEC_REF_OK: the spec reference ct-groom.mjs resolves for a spec called
// "spec.md" inside a makeSpecDir directory (a git repo with the origin
// https://github.com/o/r.git) when the `gh` stub confirms the file is published
// on `main` and that the anchor exists. F10: it NO longer depends on the
// temporary directory's path — the path that goes into the body is the one
// relative to the repo root, so it is the same in every `it`.
const SPEC_REF_OK = { path: 'spec.md', heading: '9. Slices', url: specUrl('spec.md'), reason: null }

// matchingBody(): the EXACT body ONE_SLICE_SPEC produces today — generated with
// the real buildIssueBody (not by hand) so that a real "it matches in
// everything" matches in EVERYTHING, including the sections F5 now also compares
// (AC, Dependencias, Descripción, Protegido, and — review round 3 — the spec
// link).
function matchingBody() {
  return buildIssueBody(
    { n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' },
    SPEC_REF_OK,
  )
}

describe('ct-groom --dry-run — it detects the divergence of an issue that already exists (F5)', () => {
  it('a divergent title or labels → they are reported on stderr, exit 3, the plan JSON identical to the usual one (nothing is mutated)', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const EXISTING = {
      number: 501,
      title: '#1 iniciar sesión',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'status:in-progress' }],
      body: '<!-- ct-order:1 -->',
    }
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
        { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EXISTING]]) }) })
    } catch (e) {
      threw = true
      expect(e.status).toBe(3)
      const plan = JSON.parse(e.stdout) // the plan IS printed under drift (only the exit code changes)
      expect(plan.issues[0].title).toBe('#1 login')
      const err = e.stderr.toString()
      expect(err).toMatch(/slice #1.*issue #501/)
      expect(err).toMatch(/title differs/i)
      expect(err).toMatch(/"#1 iniciar sesión"/)
      expect(err).toMatch(/"#1 login"/)
      expect(err).toMatch(/the label "area:api" is missing/)
      expect(err).toMatch(/the label "touches:db" is missing/)
      // Narrowed to the DIVERGENCE lines, which is what this test defends:
      // `status:in-progress` is a label of the issue that the spec does not own,
      // and reporting it as "extra" would be the bug. The name now shows up,
      // legitimately, in the line about the `status:` vocabulary /ct-groom
      // creates so that the claim can write it later
      // (groom.js#LOOP_STATUS_LABELS).
      expect(err).not.toMatch(/drift.*status:in-progress/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('with no divergence at all (the existing issue already matches) → exit 0, empty stderr', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const MATCHING = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:none' }, { name: 'status:in-progress' }],
      body: matchingBody(),
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[MATCHING]]), FAKE_GH_LABELS_LIST: PLAN_LABELS_EXIST }) })
    expect(res.status).toBe(0)
    // F26 + Slice 10 + decisions: ONE_SLICE_SPEC carries no "## Contexto del
    // epic", no "## Decisiones congeladas" and no "Señal" column, so the stderr
    // carries the THREE absence warnings — all of them orthogonal to the
    // divergence this test watches. What is checked is that ONLY those three
    // are there (nothing of "differs"/"the label … is missing"/etc.), instead of
    // demanding bare emptiness.
    const stderrLines = res.stderr.split('\n').filter(Boolean)
    expect(stderrLines).toHaveLength(3)
    expect(stderrLines.some((l) => l.includes(EPIC_CONTEXT_HEADING))).toBe(true)
    expect(stderrLines.some((l) => l.includes(FROZEN_DECISIONS_HEADING))).toBe(true)
    expect(stderrLines.some((l) => l.includes('has no "Señal" column'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a closed issue with no other divergence → no closure note (closed on its own is not a divergence), exit 0', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const CLOSED_MATCHING = {
      number: 501,
      title: '#1 login',
      state: 'closed',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:none' }],
      body: matchingBody(),
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[CLOSED_MATCHING]]), FAKE_GH_LABELS_LIST: PLAN_LABELS_EXIST }) })
    expect(res.status).toBe(0)
    // F6: this fixture (a CLOSED issue, with no status: label at all) is also
    // the proof that the status:backlog reminder does not chase an epic that is
    // already finished: a closed issue is not awaiting promotion.
    // F26 + Slice 10 + decisions: the same case as the previous test —
    // ONE_SLICE_SPEC carries neither "## Contexto del epic", nor "## Decisiones
    // congeladas", nor a "Señal" column, so the stderr carries those three
    // warnings and nothing else.
    const stderrLines = res.stderr.split('\n').filter(Boolean)
    expect(stderrLines).toHaveLength(3)
    expect(stderrLines.some((l) => l.includes(EPIC_CONTEXT_HEADING))).toBe(true)
    expect(stderrLines.some((l) => l.includes(FROZEN_DECISIONS_HEADING))).toBe(true)
    expect(stderrLines.some((l) => l.includes('has no "Señal" column'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a closed issue WITH divergence → it adds a "closed" note warning before --reconcile, exit 3', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const CLOSED_DRIFT = {
      number: 501,
      title: '#1 iniciar sesión',
      state: 'closed',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: '<!-- ct-order:1 -->',
    }
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
        { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[CLOSED_DRIFT]]) }) })
    } catch (e) {
      threw = true
      expect(e.status).toBe(3)
      const err = e.stderr.toString()
      expect(err).toMatch(/title differs/i)
      expect(err).toMatch(/the issue is closed — review before applying --reconcile/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--reconcile under --dry-run: it announces what it would apply, but NEVER calls `gh issue edit` (it still mutates nothing), exit 3', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    const EXISTING = {
      number: 501,
      title: '#1 iniciar sesión',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: '<!-- ct-order:1 -->',
    }
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run', '--reconcile'],
        { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EXISTING]]), FAKE_GH_ARGV_LOG_FILE: argvLog }) })
    } catch (e) {
      threw = true
      expect(e.status).toBe(3) // a dry-run never "resolves" anything, even with --reconcile
      expect(e.stderr.toString()).toMatch(/--reconcile would apply.*issue edit 501/)
    }
    expect(threw).toBe(true)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/) // the announcement is not a real call
    rmSync(dir, { recursive: true, force: true })
  })

  // A product decision (review round 5): the "--reconcile is EXPERIMENTAL"
  // warning is printed as soon as the flag is present, WITH or WITHOUT
  // --dry-run — the warning is about the flag's risk, not about whether this
  // particular run actually gets to mutate anything.
  it('--dry-run --reconcile → the EXPERIMENTAL warning shows up too (the same risk, even though a dry-run never mutates)', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run', '--reconcile'],
      { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0) // with no existing issues, nothing diverges — the warning lives on stderr, it does not affect the exit
    expect(res.stderr).toMatch(/--reconcile is EXPERIMENTAL/)
    rmSync(dir, { recursive: true, force: true })
  })
  it('--dry-run WITHOUT --reconcile → the warning NEVER shows up', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    let stderrOut = ''
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
        { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      stderrOut = e.stderr ? e.stderr.toString() : ''
    }
    expect(stderrOut).not.toMatch(/EXPERIMENTAL/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a failure listing GitHub issues under --dry-run (with --repo) aborts just like the real run — the plan is never printed', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
        { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv({ FAKE_GH_LIST_FAIL_AT: '0' }) })
    } catch (e) {
      threw = true
      expect(e.status).toBe(1)
      expect(e.stdout).toBe('') // the bug this avoids: a dry-run that reports LESS than the real run
      expect(e.stderr.toString()).toMatch(/could not list the issues/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  // F10 changes this property, and the change is declared instead of deleted:
  // the test said "--dry-run WITHOUT --repo never invokes `gh`". That is no
  // longer true, and it could not stay true — the spec link is VERIFIED against
  // GitHub (is the file published on the default branch? does the anchor
  // exist?), and that verification does not depend on `--repo` but on the
  // repository where the SPEC lives. Skipping it under --dry-run would bring
  // back the trap F1 and F5 have already closed twice: a preview that reports
  // less than the real run — here, a preview that shows a link the real run
  // would degrade.
  //
  // What DOES remain true, and is what this test really protected, is that
  // --dry-run mutates nothing: the only `gh` calls without --repo are the two
  // READS of the spec link.
  it('--dry-run WITHOUT --repo: the only `gh` calls are the reads of the spec link — no mutation', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    const out = execFileSync('node', [script, spec, '--milestone', 'Epic', '--dry-run'],
      { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv({ FAKE_GH_ARGV_LOG_FILE: argvLog }) })
    const plan = JSON.parse(out)
    expect(plan.repo).toBeNull()
    const calls = readFileSync(argvLog, 'utf8').trim().split('\n')
    expect(calls).toEqual([
      'repo view o/r --json defaultBranchRef -q .defaultBranchRef.name',
      'api repos/o/r/contents/spec.md?ref=main -H Accept: application/vnd.github.html',
    ])
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// The coordinator's review after the first version of F5 — coverage under
// --dry-run of the two substantive points (the body IS compared for AC/deps;
// the labels are gated by column) and an explicit confirmation that exit 3
// under --dry-run is a decision, not an accidental consequence.
// ============================================================================

describe('ct-groom --dry-run — divergent AC/Dependencias are detected (critical review: the body IS compared for what the dispatcher reads)', () => {
  const SPEC_2 = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | #2 | AC-1.1, AC-1.2 | schema |
| 2 | signup | backend | registro | – | AC-2.1 | – |
`
  const ISSUE_1_DRIFT = {
    number: 501,
    title: '#1 login',
    state: 'open',
    milestone: { title: 'Epic' },
    labels: [{ name: 'type:backend' }],
    body: buildIssueBody({ n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' }, SPEC_REF_OK),
  }
  const ISSUE_2_MATCHING = {
    number: 502,
    title: '#2 signup',
    state: 'open',
    milestone: { title: 'Epic' },
    labels: [{ name: 'type:backend' }],
    body: buildIssueBody({ n: 2, name: 'signup', type: 'backend', entrega: 'registro', deps: [], ac: ['AC-2.1'], protected: '–' }, SPEC_REF_OK),
  }

  it('it reports the missing AC and dependency on stderr, exit 3, mutating nothing', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC_2)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], {
        encoding: 'utf8', stdio: QUIET_STDIO,
        env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[ISSUE_1_DRIFT, ISSUE_2_MATCHING]]) }),
      })
    } catch (e) {
      threw = true
      expect(e.status).toBe(3)
      const err = e.stderr.toString()
      expect(err).toMatch(/the acceptance criterion "AC-1.2" is missing/)
      expect(err).toMatch(/the dependency "merge-after `#2`" is missing/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--reconcile under --dry-run: the preview names the categories (dependencies, acceptance criteria) WITHOUT dumping the whole `--body`, and mutates nothing', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC_2)
    const argvLog = join(dir, 'argv.log')
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run', '--reconcile'], {
        encoding: 'utf8', stdio: QUIET_STDIO,
        env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[ISSUE_1_DRIFT, ISSUE_2_MATCHING]]), FAKE_GH_ARGV_LOG_FILE: argvLog }),
      })
    } catch (e) {
      threw = true
      expect(e.status).toBe(3)
      const err = e.stderr.toString()
      expect(err).toMatch(/--reconcile would apply.*issue edit 501.*--body <updated/)
      // the real text of the AC or dependency is not dumped into the preview message:
      expect(err).not.toContain('merge-after `#2`\n')
    }
    expect(threw).toBe(true)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/) // --dry-run never mutates, not even with --reconcile
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom --dry-run — labels: gated by column (review, point 2)', () => {
  const NO_AREA_SPEC = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
`
  it('with no "Área" column in the table: an area: put on the issue by hand is not reported as "extra", exit 0', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, NO_AREA_SPEC)
    const ISSUE_WITH_AREA = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      // F21: the spec does ask for `gate:none` — the `Tipo` column is present,
      // so the spec DOES have an opinion about `gate:` (unlike `area:`, which
      // is what this test is about).
      labels: [{ name: 'type:backend' }, { name: 'area:ops' }, { name: 'gate:none' }],
      body: matchingBody(),
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[ISSUE_WITH_AREA]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/area:ops/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom --dry-run — exit 3 on divergence is an explicit decision, not a consequence (review, point 3)', () => {
  // --dry-run and the real run WITHOUT --reconcile share the same 3 on the SAME
  // divergence, out of PARITY (the same condition, the same signal, no
  // surprises going from "review" to "actually execute"). The coordinator's
  // round 3 review: this file's original justification ("that way
  // `groom --dry-run && groom` gets the same signal") was back to front — with
  // `&&`, an exit 3 CUTS the chain exactly when there is divergence that
  // --reconcile could apply, so that chaining would never get as far as running
  // the real run. Parity stands on its own (see the comment next to the
  // `process.exit` in ct-groom.mjs); this test pins that equality as observable
  // behaviour.
  it('--dry-run and the real run (without --reconcile) return the SAME exit code (3) on the SAME divergence', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const EXISTING = {
      number: 501,
      title: '#1 otro título',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:none' }],
      body: matchingBody(),
    }
    const envOverrides = { FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EXISTING]]), FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]) }
    const dryRunRes = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv(envOverrides) })
    const realRes = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic'], { encoding: 'utf8', env: fakeEnv(envOverrides) })
    expect(dryRunRes.status).toBe(3)
    expect(realRes.status).toBe(3)
    rmSync(dir, { recursive: true, force: true })
  })
})

// F23 — the two faces of §2 of the field feedback, measured in production on
// menoplus-app/menoplus with issues #451–#456 of an earlier, closed epic.
// Before this fix, matching by marker swept the WHOLE REPO, so the §9 contract
// ("the #s are unique within their milestone, not within the repo") was true in
// /ct-next and false here.
const THREE_SLICES = (a, b, c) => `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| ${a} | uno | backend | a | – | AC-${a}.1 | – | api | db |
| ${b} | dos | backend | b | – | AC-${b}.1 | – | api | db |
| ${c} | tres | backend | c | – | AC-${c}.1 | – | api | db |
`

// The six of the earlier epic: closed, in ANOTHER milestone, with ct-order 1..6
// and a link to ANOTHER spec (so as not to fire Task 5's gate, which is a
// different check — what is tested here is the narrowing).
const PREVIOUS_EPIC = [1, 2, 3, 4, 5, 6].map((n) => ({
  number: 450 + n,
  title: `#${n} old slice`,
  state: 'closed',
  milestone: { number: 1, title: 'Previous epic' },
  labels: [{ name: 'type:backend' }],
  body: `> Slice \`#${n}\` of the epic. Spec: [other-spec.md](https://github.com/o/r/blob/main/other-spec.md)\n\nold body\n\n<!-- ct-order:${n} -->`,
}))

describe('ct-groom — the ct-order marker narrowed by milestone (F23, §2 of the feedback)', () => {
  it('face 1: a §9 table starting at 1,2,3 over an earlier epic with 1..6 → it creates the three, zero divergences, zero orphans, exit 0', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[PREVIOUS_EPIC]]) }) })
    expect(res.status).toBe(0)
    // What it did before: it matched #451/#452/#453 and reported the different
    // milestone as a divergence, creating nothing.
    expect(res.stderr).not.toMatch(/drift/)
    // And it also declared #454/#455/#456 orphans in the SAME run.
    expect(res.stderr).not.toMatch(/orphaned/)
    // #451/#452/#453 ARE named now, but only as gate B's non-blocking
    // fail-open warning (their link points at another spec): the earlier
    // assertion was `not.toMatch(/#45[123]/)` and it has been sharpened, not
    // relaxed — what matters is that none of those mentions is a match, a
    // divergence or an orphan.
    for (const line of res.stderr.split('\n').filter((l) => /#45[1-6]/.test(l))) {
      expect(line.startsWith('warning: ')).toBe(true)
    }
    const plan = JSON.parse(res.stdout)
    expect(plan.issues.map((i) => i.order)).toEqual([1, 2, 3])
    rmSync(dir, { recursive: true, force: true })
  })

  // The SAME face 1, without --dry-run. The test above cannot observe the fix:
  // ct-groom.mjs exits before the creation loop under --dry-run, so its only
  // assertion about creation (`plan.issues.map(i => i.order)`) comes out of the
  // §9 table and would have passed just the same BEFORE the narrowing. And this
  // fix's failure mode is precisely the opposite: matching the earlier epic's
  // issues instead of creating its own. That is only visible in a real run.
  it('face 1, a REAL run: it creates the three issues of the new epic and matches none of #451–#456', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo'],
      {
        encoding: 'utf8',
        env: fakeEnv({
          FAKE_GH_LIST_SEQUENCE: JSON.stringify([[PREVIOUS_EPIC]]),
          FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic nuevo', number: 2 }]),
        }),
      })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/issue created, order #1/)
    expect(res.stdout).toMatch(/issue created, order #2/)
    expect(res.stdout).toMatch(/issue created, order #3/)
    // In a real run the warning's verb is indicative: here it really is created.
    expect(res.stderr).toMatch(/will create a new issue for slice #1 in "Epic nuevo"/)
    // The failure this fix closes: "issue of order #1 already exists (#451), not
    // duplica". Neither the idempotence message nor any of the earlier epic's
    // six numbers may come out over stdout.
    expect(res.stdout).not.toMatch(/issue of order #\d+ already exists/)
    expect(res.stdout).not.toMatch(/#45[1-6]/)
    expect(res.stderr).not.toMatch(/drift/)
    expect(res.stderr).not.toMatch(/orphaned/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('face 2: a §9 table starting at 7,8,9 → it does NOT declare the earlier epic\u2019s six orphans', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(7, 8, 9))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[PREVIOUS_EPIC]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/orphaned/)
    expect(res.stderr).not.toMatch(/#45[1-6]/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the legitimate orphan — an issue OF THE CURRENT EPIC whose order is no longer in the table — still warns and still exits 3', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const REAL_ORPHAN = {
      number: 601,
      title: '#9 slice retirado',
      state: 'open',
      milestone: { number: 2, title: 'Epic nuevo' },
      labels: [{ name: 'type:backend' }],
      body: 'cuerpo\n\n<!-- ct-order:9 -->',
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[...PREVIOUS_EPIC, REAL_ORPHAN]]]) }) })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/issue #601.*ct-order:9/)
    expect(res.stderr).toMatch(/orphaned/)
    // The narrowing has not silenced the signal, it has only limited it to its
    // own epic: none of the earlier epic's six is declared an orphan.
    // (#451–#453 do come out as gate B's non-blocking warning — the fail-open
    // of a link that does not match — so the assertion is sharpened to the
    // orphan line rather than to "the number does not appear".)
    for (const line of res.stderr.split('\n').filter((l) => /#45[1-6]/.test(l))) {
      expect(line.startsWith('warning: ')).toBe(true)
      expect(line).not.toMatch(/orphaned/)
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('matching DOES happen within the epic itself: an issue of the requested milestone with the same order is not duplicated', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const FROM_THE_EPIC = {
      number: 700,
      title: '#1 uno',
      state: 'open',
      milestone: { number: 2, title: 'Epic nuevo' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'status:backlog' }],
      body: 'cuerpo\n\n<!-- ct-order:1 -->',
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[...PREVIOUS_EPIC, FROM_THE_EPIC]]]) }) })
    // A real divergence (the body carries neither AC nor a spec link) → exit 3,
    // naming the issue of ITS epic. What matters here is that it finds it.
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/slice #1.*issue #700/)
    // And since slice #1 ALREADY has an issue in this epic, gate B's warning
    // does not talk about it: no creation is possible, hence no duplication is
    // possible. Slices 2 and 3, which would be created, are warned about.
    expect(res.stderr).not.toMatch(/warning: slice #1 of this spec/)
    expect(res.stderr).toMatch(/warning: slice #2 of this spec/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — gate A: issues with no milestone (F23)', () => {
  const SIN_MILESTONE = (number, order) => ({
    number,
    title: `#${order} suelto`,
    state: 'open',
    milestone: null,
    labels: [],
    body: `cuerpo\n\n<!-- ct-order:${order} -->`,
  })

  it('it collides with the §9 table → exit 1, it names them, and it mutates NOTHING', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[SIN_MILESTONE(487, 2), SIN_MILESTONE(488, 3)]]]) }) })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/#487\s+ct-order:2/)
    expect(res.stderr).toMatch(/#488\s+ct-order:3/)
    expect(res.stderr).toMatch(/nothing has been created or modified/)
    expect(res.stderr).toMatch(/gh issue edit .*--milestone/)
    // The effect, not the exit code: the gate falls BEFORE the first mutation,
    // which is the creation of the milestone.
    expect(res.stdout).not.toMatch(/milestone created/)
    expect(res.stdout).not.toMatch(/issue created/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('it does NOT collide with the §9 table → a warning that names it, the run carries on', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[SIN_MILESTONE(487, 9)]]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/issue #487.*ct-order:9.*has no milestone/)
    expect(res.stderr).not.toMatch(/nothing has been created or modified/)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues.map((i) => i.order)).toEqual([1, 2, 3])
    rmSync(dir, { recursive: true, force: true })
  })

  it('under --dry-run the gate aborts too: a preview that keeps quiet about the real run stopping reports less than the real run', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[SIN_MILESTONE(487, 2)]]]) }) })
    expect(res.status).toBe(1)
    expect(res.stdout).not.toMatch(/"issues"/) // the plan is not even printed
    rmSync(dir, { recursive: true, force: true })
  })

  it('an issue with no milestone and NO ct-order marker says nothing at all', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const LOOSE = { number: 490, title: 'issue a mano', state: 'open', milestone: null, labels: [], body: 'sin marcador' }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[LOOSE]]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/#490/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — gate B: the same epic under another title (F23)', () => {
  // The SAME spec that produces this test directory's plan (spec.md), but in
  // ANOTHER milestone: the signature of a renamed epic, or of a typo in
  // --milestone.
  const sameSpecOtherEpic = (number, order) => ({
    number,
    title: `#${order} uno`,
    state: 'open',
    milestone: { number: 1, title: 'Previous epic' },
    labels: [{ name: 'type:backend' }],
    body: buildIssueBody(
      { n: order, name: 'uno', type: 'backend', entrega: 'a', deps: [], ac: [`AC-${order}.1`], protected: '–' },
      SPEC_REF_OK,
    ),
  })

  it('the same order + the same spec in another milestone → exit 1, it names the issue and its real milestone, it mutates nothing', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[sameSpecOtherEpic(452, 2)]]]) }) })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/#452\s+ct-order:2/)
    expect(res.stderr).toMatch(/Previous epic/)
    expect(res.stderr).toMatch(/Epic nuevo/)
    expect(res.stderr).toMatch(/nothing has been created or modified/)
    expect(res.stdout).not.toMatch(/milestone created/)
    expect(res.stdout).not.toMatch(/issue created/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the same order but ANOTHER spec → it does not fire: it is a different epic reusing numbers, which is what F23 enables', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[PREVIOUS_EPIC]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/nothing has been created or modified/)
    // "It does not fire" means it does not BLOCK, not that it keeps quiet: the
    // three orders that are in today's table come out as a warning (see the
    // warning's tests further down).
    expect(res.stderr).toMatch(/warning: slice #1 of this spec/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the same spec but an order that is NOT in today\u2019s table → it does not fire', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[sameSpecOtherEpic(452, 8)]]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/nothing has been created or modified/)
    rmSync(dir, { recursive: true, force: true })
  })

  // The fail-open warning. Gate B discards an issue from another milestone when
  // its spec link does not match ours — and that is exactly the bucket a
  // duplicated epic with exit 0 comes out of, if the link failed to match only
  // because the issue is old or because its link ended up degraded. Discarding
  // it in silence was the asymmetry with gate A, which does name the issues
  // without a milestone that do NOT block.
  it('warning (a DIFFERENT link): it names the issue, its milestone and the duplication risk — and it does not change the exit code', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[PREVIOUS_EPIC[1]]]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/^warning: slice #2 of this spec has an issue in another milestone with the same ct-order \(#452, "Previous epic"\)/m)
    expect(res.stderr).toMatch(/its link to the spec does not match this spec's/)
    // Under --dry-run the verb is conditional: nothing is created here (the
    // same criterion as the status:backlog reminder,
    // "would be left"/"are left").
    expect(res.stderr).toMatch(/would create a new issue for slice #2 in "Epic nuevo"/)
    expect(res.stderr).toMatch(/this is going to duplicate it: check before carrying on/)
    // It does not block: the run carries on and the whole plan is printed.
    expect(res.stderr).not.toMatch(/nothing has been created or modified/)
    expect(JSON.parse(res.stdout).issues.map((i) => i.order)).toEqual([1, 2, 3])
    rmSync(dir, { recursive: true, force: true })
  })

  // The `suyo === null` branch of the fail-open: an issue from another epic
  // with a ct-order marker but with NO spec-link line in the body. It is the
  // most likely one in a real repo (issues created by hand, or groomed by a
  // version older than the link line) and it had no test at all.
  it('warning (with NO spec link in the body): it is named too, with the right reason', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const NO_LINK = {
      number: 470,
      title: '#2 a mano',
      state: 'open',
      milestone: { number: 1, title: 'Previous epic' },
      labels: [],
      body: 'cuerpo escrito a mano, sin enlace al spec\n\n<!-- ct-order:2 -->',
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[NO_LINK]]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/warning:.*#470, "Previous epic"/)
    expect(res.stderr).toMatch(/carries no link-to-the-spec line/)
    expect(res.stderr).not.toMatch(/nothing has been created or modified/)
    rmSync(dir, { recursive: true, force: true })
  })

  // The narrowing of the warning: duplication can only happen if the slice is
  // going to be CREATED. If it already has an issue in this epic, the matching
  // finds it, the creation is skipped, and warning would be a warning nobody
  // can satisfy — it would come out on every run, for ever, describing no loss
  // at all (the same criterion as backlogPendingCount's closed-issue filter).
  it('the warning does NOT come out for a slice that ALREADY has an issue in this epic: with no creation there is no duplication', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const ALREADY_IN_THIS_EPIC = {
      number: 700,
      title: '#1 uno',
      state: 'open',
      milestone: { number: 2, title: 'Epic nuevo' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:none' }, { name: 'status:backlog' }],
      body: buildIssueBody(
        { n: 1, name: 'uno', type: 'backend', entrega: 'a', deps: [], ac: ['AC-1.1'], protected: '–' },
        SPEC_REF_OK,
      ),
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[...PREVIOUS_EPIC, ALREADY_IN_THIS_EPIC]]]) }) })
    expect(res.status).toBe(0)
    // #451 carries ct-order:1, just like the issue this epic already has:
    // nothing to duplicate, no warning that names it.
    expect(res.stderr).not.toMatch(/warning: slice #1 of this spec/)
    expect(res.stderr).not.toMatch(/#451/)
    // #452/#453 do: slices 2 and 3 would still be created.
    expect(res.stderr).toMatch(/warning: slice #2 of this spec.*#452/)
    expect(res.stderr).toMatch(/warning: slice #3 of this spec.*#453/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the warning does NOT come out when the order of another epic\u2019s issue is not in today\u2019s table: there is nothing to duplicate there', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(7, 8, 9))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[PREVIOUS_EPIC]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/warning: slice #/)
    expect(res.stderr).not.toMatch(/#45[1-6]/)
    rmSync(dir, { recursive: true, force: true })
  })

  // The warning asserts that this groom is going to create that slice. In a run
  // that stops dead nothing is created, so the warnings are emitted AFTER the
  // exit of the blocks: a warning that comes out alongside "no se ha creado ni
  // modificado nada" contradicts its own run's footer. Nothing is lost — the
  // next run, now unblocked, computes them again.
  it('when the gate blocks, the warning is not emitted: nothing is going to be created, so nothing can be duplicated', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[sameSpecOtherEpic(452, 2), PREVIOUS_EPIC[0]]]]) }) })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/#452\s+ct-order:2/) // the block does come out
    expect(res.stderr).toMatch(/nothing has been created or modified/)
    // #451 (ct-order:1, another spec) would have warned in a run that carried on.
    expect(res.stderr).not.toMatch(/warning: slice #/)
    expect(res.stderr).not.toMatch(/#451/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('BOTH gates in the same run: the two blocks are reported and it exits ONLY once', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, THREE_SLICES(1, 2, 3))
    const NO_MILESTONE = { number: 487, title: '#3 suelto', state: 'open', milestone: null, labels: [], body: 'x\n\n<!-- ct-order:3 -->' }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[NO_MILESTONE, sameSpecOtherEpic(452, 2)]]]) }) })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/#487\s+ct-order:3/)   // gate A
    expect(res.stderr).toMatch(/#452\s+ct-order:2/)   // gate B
    // A single closure: the footer shows up exactly once.
    expect(res.stderr.match(/nothing has been created or modified/g)).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

// Slice 10 — the `Señal` column in the wrapper: an exemption with no reason is
// a hardError (exit 2, BEFORE any mutation and under --dry-run too — the
// precedent of the unknown Gate: what cannot be read cannot slip through in
// silence), and the column's absence warns BY CONSEQUENCE (the slice judge will
// measure its observabilidad item as without-a-yardstick across the whole
// epic).
describe('the Señal column in the groom (Slice 10)', () => {
  const WITH_SIGNAL = (signal1, signal2) => `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Señal |
|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema | ${signal1} |
| 2 | refresh | backend | flow | #1 | AC-2.1 | – | ${signal2} |
`

  it('an exemption with no reason aborts with exit 2 naming the row, the N/A — <razón> syntax and the remedy', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, WITH_SIGNAL('N/A', 'métrica x'))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/slice #1: "N\/A"/)
    expect(res.stderr).toMatch(/N\/A — <razón>/)
    expect(res.stderr).toMatch(/leave the cell empty or with "–"/)
    expect(res.stderr).toMatch(/fix those rows and try again/)
    // It aborts BEFORE printing any plan: under --dry-run no JSON comes out either.
    expect(res.stdout).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  it('exemptions with no reason are aggregated with the rest of the hardErrors in a single run', () => {
    const dir = makeSpecDir('ctg-')
    // Two defects at once: the exemption with no reason (Señal) and a malformed
    // Dep ("S1") — both messages must come out in ONE single run, like the rest
    // of the aggregated hardErrors.
    const TWO_DEFECTS = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Señal |
|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema | N/A — |
| 2 | refresh | backend | flow | S1 | AC-2.1 | – | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TWO_DEFECTS)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/exemption with no reason/)
    expect(res.stderr).toMatch(/with no recognizable dependency/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a table with no Señal column: a warning by consequence on stderr, exit 0', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/has no "Señal" column/)
    // The warning describes the measurable CONSEQUENCE, not just the absence.
    expect(res.stderr).toMatch(/with no "## Señal de observabilidad" section/)
    expect(res.stderr).toMatch(/observability item as sin-vara/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the dry-run shows the "## Señal de observabilidad" section in the body of the slice that declares it and not in the one that does not', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, WITH_SIGNAL('–', 'métrica `backfill_progress` con label `estado`'))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].body).not.toContain('## Señal de observabilidad')
    expect(plan.issues[1].body).toContain('## Señal de observabilidad')
    expect(plan.issues[1].body).toContain('métrica `backfill_progress` con label `estado`')
    rmSync(dir, { recursive: true, force: true })
  })

  it('the reasoned exemption travels verbatim to the body and aborts nothing', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, WITH_SIGNAL('N/A — pantalla sin telemetría nueva que prometer', 'métrica x'))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].body).toContain('## Señal de observabilidad')
    expect(plan.issues[0].body).toContain('N/A — pantalla sin telemetría nueva que prometer')
    rmSync(dir, { recursive: true, force: true })
  })
})
