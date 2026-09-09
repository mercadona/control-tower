import { describe, it, expect } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir, specUrl } from './fixtures/spec-repo.js'

// F10 — the spec link, end to end and through the CLI.
//
// The defect it closes, reproduced before touching anything and verified
// against the real GitHub (not against a reading of the markdown):
//
//   > Slice `#1` del epic. Spec: [docs/x-design.md#9](docs/x-design.md#9)
//
//   1. `gh api /markdown -X POST` with mode:gfm and context:owner/repo returns
//      the href AS IS: `<a href="docs/x-design.md#9">`. On an issue's page
//      (github.com/owner/repo/issues/N) that resolves against that URL and
//      gives a 404. In a README it would work; in an issue, which is where
//      this line lives, it does not.
//   2. The anchor does not exist: the real heading is "## 9. Slices" and the
//      id GitHub generates is "9-slices" — checked in the rendered HTML of the
//      file itself.
//
// These tests are the ones that fail against the unfixed code: they check that
// the line that gets written carries an ABSOLUTE URL and the anchor of the
// REAL heading, not a "#9".

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const env = (overrides = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...overrides })

const SPEC = `# Plan actual vs propuestas — design

## 8. Contexto

Texto.

## Hipótesis

Apuesta del fixture.

## 9. Slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
`

function run(dir, spec, extra = [], overrides = {}) {
  return spawnSync('node', [script, spec, '--milestone', 'Epic', '--dry-run', ...extra], { encoding: 'utf8', env: env(overrides) })
}

function planOf(res) {
  return JSON.parse(res.stdout)
}

describe('ct-groom — the spec link is absolute and carries the real anchor (F10)', () => {
  it('the line carries an absolute GitHub URL, not a relative path (a relative one 404s from an issue page)', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const plan = planOf(run(dir, spec))
    const link = plan.issues[0].specLink
    expect(link).toContain('](https://github.com/o/r/blob/main/spec.md')
    // And NOTHING of the old shape: a relative target.
    expect(link).not.toMatch(/\]\((?!https:\/\/)/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the anchor is the real heading\'s ("## 9. Slices" → "#9-slices"), never the section number', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const link = planOf(run(dir, spec)).issues[0].specLink
    expect(link).toContain('#9-slices')
    expect(link).not.toMatch(/#9\)/) // the bare "#9" of before
    rmSync(dir, { recursive: true, force: true })
  })

  it("the anchor comes from the heading's TEXT, not from its number: a spec whose §9 is named differently produces a different anchor", () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md')
    writeFileSync(spec, SPEC.replace('## 9. Slices', '## Desglose en slices'))
    const link = planOf(run(dir, spec, [], { FAKE_GH_CONTENTS_ANCHORS: 'desglose-en-slices' })).issues[0].specLink
    expect(link).toContain('#desglose-en-slices')
    expect(link).toContain('§ Desglose en slices')
    rmSync(dir, { recursive: true, force: true })
  })

  it("the link is written into every issue's BODY, not only into the plan's specLink field", () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const plan = planOf(run(dir, spec))
    expect(plan.issues[0].body.split('\n')[0]).toBe(plan.issues[0].specLink)
    expect(plan.issues[0].body).toContain(specUrl('spec.md'))
    rmSync(dir, { recursive: true, force: true })
  })

  it('the anchor is CHECKED against the published copy: if it is missing, the file is linked and a warning is issued — never an invented anchor', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = run(dir, spec, [], { FAKE_GH_CONTENTS_ANCHORS: 'otra-cosa' })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/the anchor "9-slices".*does not exist in the copy of spec\.md published/s)
    const link = planOf(res).issues[0].specLink
    expect(link).toContain(specUrl('spec.md', null))
    expect(link).not.toContain('#9-slices')
    rmSync(dir, { recursive: true, force: true })
  })

  it("the link's path is the one relative to the repo root, not to the working directory", () => {
    const dir = makeSpecDir('ctg-link-')
    mkdirSync(join(dir, 'docs', 'specs'), { recursive: true })
    const spec = join(dir, 'docs', 'specs', 'plan.md'); writeFileSync(spec, SPEC)
    const link = planOf(run(dir, spec)).issues[0].specLink
    expect(link).toContain('/blob/main/docs/specs/plan.md#9-slices')
    expect(link).toContain('[docs/specs/plan.md § 9. Slices]')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — when a good link cannot be built, it does not go quiet (F10)', () => {
  // "The spec written but not pushed yet" is the most common case of all in
  // real life. An absolute link to something unpublished is the same defect
  // wearing another face.
  it('a spec unpublished on the default branch → a reference WITHOUT a link, with the reason in the body and a warning on stderr', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = run(dir, spec, [], { FAKE_GH_CONTENTS_FAIL: '1' })
    expect(res.status).toBe(0) // grooming is still possible: the link is not the work
    expect(res.stderr).toMatch(/left WITHOUT a link/)
    const link = planOf(res).issues[0].specLink
    expect(link).toContain('sin enlace: the spec is not published on the default branch of the repository (o/r, branch main)')
    expect(link).not.toMatch(/\]\(/) // not even a half-finished markdown link
    expect(link).not.toContain('https://')
    rmSync(dir, { recursive: true, force: true })
  })

  it('a spec outside any git repository → a reference WITHOUT a link, with the reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-nogit-')) // deliberately: NOT a repo
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = run(dir, spec)
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/left WITHOUT a link.*not inside a git repository/s)
    expect(planOf(res).issues[0].specLink).toContain('sin enlace: the spec is not inside a git repository')
    rmSync(dir, { recursive: true, force: true })
  })

  it('a repo with no "origin" remote → a reference WITHOUT a link, with the reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-noremote-'))
    execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' })
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = run(dir, spec)
    expect(res.status).toBe(0)
    expect(planOf(res).issues[0].specLink).toContain('sin enlace: the repository of the spec has no "origin" remote')
    rmSync(dir, { recursive: true, force: true })
  })

  it('a §9 table with no heading above it → a link to the file (which does work) and a warning that it does not land on the section', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md')
    // The hypothesis goes BELOW the table on purpose: the test's premise is
    // "no heading ABOVE the table", and the freeze gate (F32) only demands
    // that the section exist in the spec, not where.
    writeFileSync(spec, '| # | Slice | Dep |\n|---|---|---|\n| 1 | login | – |\n\n## Hipótesis\n\nApuesta del fixture.\n')
    const res = run(dir, spec)
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/does not live under any heading/)
    const link = planOf(res).issues[0].specLink
    // The link's target carries no fragment: neither the invented anchor of
    // before nor a dangling "#". (The "#1" at the start of the line is the
    // slice's order, and it has gone in inline code since F6.)
    expect(link).toMatch(/\]\((https:\/\/[^)#]+)\)$/)
    expect(link).toContain(specUrl('spec.md', null))
    rmSync(dir, { recursive: true, force: true })
  })

  it('a heading with no usable anchor ("## ...") → a link to the file, a warning, and NEVER a dangling "#"', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md')
    writeFileSync(spec, SPEC.replace('## 9. Slices', '## ...'))
    const res = run(dir, spec)
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/produces no anchor/)
    const link = planOf(res).issues[0].specLink
    expect(link).toContain(specUrl('spec.md', null))
    expect(link).not.toMatch(/spec\.md#\)/)
    rmSync(dir, { recursive: true, force: true })
  })

  // A VALID anchor that lands in the wrong place is worse than none: it does
  // not fail, it does not warn, and whoever clicks it believes they are
  // reading their §9. It happens as soon as the document repeats the heading's
  // text (a summary above, the development below), because GitHub suffixes the
  // second appearance.
  it('a heading repeated in the document: the table under the SECOND copy links to the suffixed anchor, not to the first', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md')
    writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices\n\n(resumen)\n\n${SPEC.slice(SPEC.indexOf('## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices'))}`)
    const link = planOf(run(dir, spec, [], { FAKE_GH_CONTENTS_ANCHORS: '9-slices 9-slices-1' })).issues[0].specLink
    expect(link).toContain('#9-slices-1')
    rmSync(dir, { recursive: true, force: true })
  })

  it('a spec with CRLF line endings resolves the same heading and the same anchor', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC.replace(/\n/g, '\r\n'))
    expect(planOf(run(dir, spec)).issues[0].specLink).toContain('#9-slices')
    rmSync(dir, { recursive: true, force: true })
  })

  // The link points at where the SPEC lives, which need not be the repo where
  // the issues are created (--repo). Using --repo to build it would give a
  // link to a file that is not there.
  it("the link points at the SPEC's repo, not at --repo's", () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = spawnSync('node', [script, spec, '--repo', 'otro/destino', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: env() })
    expect(planOf(res).issues[0].specLink).toContain('https://github.com/o/r/blob/main/spec.md#9-slices')
    rmSync(dir, { recursive: true, force: true })
  })

  // Idempotence: two runs in a row over the same spec produce the same line.
  // Otherwise F5 would report divergence on every run and --reconcile
  // (EXPERIMENTAL, it has already corrupted real bodies) would spend its time
  // rewriting healthy issues indefinitely.
  it('two runs in a row produce EXACTLY the same line (neither with a link nor degraded is there ping-pong)', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    for (const overrides of [{}, { FAKE_GH_CONTENTS_FAIL: '1' }]) {
      const a = planOf(run(dir, spec, [], overrides)).issues[0].specLink
      const b = planOf(run(dir, spec, [], overrides)).issues[0].specLink
      expect(a).toBe(b)
    }
    rmSync(dir, { recursive: true, force: true })
  })
})
