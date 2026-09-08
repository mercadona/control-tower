import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EPIC_CONTEXT_HEADING, INHERITED_CONTEXT_HEADING, INHERITED_CONTEXT_PLACEHOLDER,
  readEpicContext, buildIssueBody, groomPlan,
} from '../scripts/groom.js'
import { makeSpecDir } from './fixtures/spec-repo.js'
import { renderKickoff } from '../scripts/kickoff.js'

// The truncation guardrail is not a style preference: the section is
// rewritten whole from the spec, and that replacement ends at the first thing
// that cuts the section (a heading of any level, an HTML comment, and so on).
// Anything that cuts cannot live inside, or it would leave the rest of the
// text orphaned under the replacement. It is cut off at the producer, where
// there is still somebody to tell.
describe('readEpicContext — the section of the spec and its guardrail', () => {
  const withSection = (body) => [
    '# Spec',
    '',
    '## 8. Algo',
    'texto previo',
    '',
    EPIC_CONTEXT_HEADING,
    body,
    '',
    '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices',
    '| # | Slice | Dep |',
    '|---|---|---|',
    '| 1 | A | – |',
  ].join('\n')

  it('returns the content when the section exists and is clean', () => {
    const r = readEpicContext(withSection('- `today_madrid()`, nunca `date.today()`\n- sin `JSONB` en modelos'))
    expect(r.content).toBe('- `today_madrid()`, nunca `date.today()`\n- sin `JSONB` en modelos')
    expect(r.warnings).toEqual([])
  })

  it('with no section: content null and a warning that says what to add', () => {
    const r = readEpicContext('# Spec\n\n## 9. Slices\n| # | Slice | Dep |')
    expect(r.content).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain(EPIC_CONTEXT_HEADING)
  })

  it('a section present but empty: it is treated as absent, with a warning of its own', () => {
    const r = readEpicContext(withSection(''))
    expect(r.content).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('no content')
  })

  it('a section with a heading inside: it is not emitted, and the warning names the line', () => {
    const r = readEpicContext(withSection('preámbulo\n\n### 1 · Un detalle\ntexto del detalle'))
    expect(r.content).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('### 1 · Un detalle')
  })

  it('the guardrail covers any level and the indentation CommonMark allows', () => {
    expect(readEpicContext(withSection('t\n\n#### hondo')).warnings[0]).toContain('#### hondo')
    expect(readEpicContext(withSection('t\n\n   ### indentada')).warnings[0]).toContain('### indentada')
  })

  it('a level 1 or 2 heading after it is NOT a subheading: it only ends the section', () => {
    expect(readEpicContext(withSection('- una regla')).content).toBe('- una regla')
    const withH1 = ['# Spec', '', EPIC_CONTEXT_HEADING, '- una regla', '', '# Otro título'].join('\n')
    expect(readEpicContext(withH1).content).toBe('- una regla')
  })

  // A "###" inside a code fence is an example, not a heading, and it breaks
  // nothing. It comes for free: the scanner being reused already carries the
  // fence hardening. It is pinned with a test so that it stays true if
  // somebody changes scanner.
  it('a ### inside a code fence does not trip the guardrail', () => {
    const r = readEpicContext(withSection('ejemplo:\n\n```md\n### esto es un ejemplo\n```'))
    expect(r.warnings).toEqual([])
    expect(r.content).toContain('### esto es un ejemplo')
  })

  it('the section at the end of the file, with nothing after it, is read whole', () => {
    const r = readEpicContext(['# Spec', '', EPIC_CONTEXT_HEADING, '- una regla', '- otra regla'].join('\n'))
    expect(r.content).toBe('- una regla\n- otra regla')
  })

  it('the last section of the file WITH a ### inside is cut off too', () => {
    const r = readEpicContext(['# Spec', '', EPIC_CONTEXT_HEADING, 'preámbulo', '', '### dentro', 'texto'].join('\n'))
    expect(r.content).toBeNull()
    expect(r.warnings[0]).toContain('### dentro')
  })

  it('the placeholder of the inherited section says who fills it in and that the plugin does not touch it', () => {
    expect(INHERITED_CONTEXT_PLACEHOLDER).toMatch(/coordinadora/)
    expect(INHERITED_CONTEXT_PLACEHOLDER).toMatch(/ct-groom/)
  })

  it('INHERITED_CONTEXT_HEADING has the exact value', () => {
    expect(INHERITED_CONTEXT_HEADING).toBe('## Contexto heredado')
  })

  it('a self-contained HTML comment inside trips the warning and names the line', () => {
    const r = readEpicContext(withSection('texto\n\n<!-- TODO: revisar esto -->'))
    expect(r.content).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('<!-- TODO: revisar esto -->')
  })

  it('validation: an H3 heading inside still trips the warning', () => {
    const r = readEpicContext(withSection('preámbulo\n\n### 1 · Un detalle\ntexto del detalle'))
    expect(r.content).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('### 1 · Un detalle')
  })

  it('validation: a code fence still does not trip it', () => {
    const r = readEpicContext(withSection('ejemplo:\n\n```md\n### esto es un ejemplo\n```'))
    expect(r.warnings).toEqual([])
    expect(r.content).toContain('### esto es un ejemplo')
  })

  it('validation: an H1/H2 heading after it is still a normal ending', () => {
    expect(readEpicContext(withSection('- una regla')).content).toBe('- una regla')
    const withH1 = ['# Spec', '', EPIC_CONTEXT_HEADING, '- una regla', '', '# Otro título'].join('\n')
    expect(readEpicContext(withH1).content).toBe('- una regla')
  })

  it('a bare H1 or H2 heading (with no text) is a normal ending, not a truncation', () => {
    // A line that is exactly "##" with nothing after it is a valid heading
    // for locateSection and ends the section normally
    const withBareH2 = ['# Spec', '', EPIC_CONTEXT_HEADING, '- una regla', '', '##'].join('\n')
    const r = readEpicContext(withBareH2)
    expect(r.content).toBe('- una regla')
    expect(r.warnings).toEqual([])
  })
})

const SLICE = { n: 2, issue: null, name: 'card del plan', type: 'ui', entrega: 'card contraíble', deps: [1], ac: ['AC-2.1'], protected: 'schema §6' }
const SPEC_REF = { path: 'docs/spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/docs/spec.md#9-slices', reason: null }

describe('buildIssueBody — the two new sections', () => {
  it('with epic context: it emits it as it is, and the inherited one goes out empty', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, '- `today_madrid()`, nunca `date.today()`')
    expect(body).toContain(`${EPIC_CONTEXT_HEADING}\n- \`today_madrid()\`, nunca \`date.today()\``)
    expect(body).toContain(`${INHERITED_CONTEXT_HEADING}\n${INHERITED_CONTEXT_PLACEHOLDER}`)
  })

  it('with no epic context: that section does NOT exist, the inherited one does', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, null)
    expect(body).not.toContain(EPIC_CONTEXT_HEADING)
    expect(body).toContain(INHERITED_CONTEXT_HEADING)
  })

  it('the third parameter is optional and does not break whoever calls with two', () => {
    expect(buildIssueBody(SLICE, SPEC_REF)).toContain(INHERITED_CONTEXT_HEADING)
  })

  // The order matters: it is context for interpreting the acceptance
  // criteria, so reading it after them is reading it too late.
  it('they go after Descripción and before Acceptance criteria', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, '- una regla')
    const pos = (s) => body.indexOf(s)
    expect(pos('## Descripción')).toBeLessThan(pos(EPIC_CONTEXT_HEADING))
    expect(pos(EPIC_CONTEXT_HEADING)).toBeLessThan(pos(INHERITED_CONTEXT_HEADING))
    expect(pos(INHERITED_CONTEXT_HEADING)).toBeLessThan(pos('## Acceptance criteria'))
  })

  it('groomPlan hands the SAME text to every issue of the epic', () => {
    const plan = groomPlan(
      [SLICE, { ...SLICE, n: 3, name: 'otro slice' }],
      { milestone: 'E1', specRef: SPEC_REF, epicContext: '- una regla común' },
    )
    expect(plan.issues.map((i) => i.epicContext)).toEqual(['- una regla común', '- una regla común'])
    for (const i of plan.issues) expect(i.body).toContain('- una regla común')
  })

  it('groomPlan with no epicContext leaves the field at null, not at undefined', () => {
    const plan = groomPlan([SLICE], { milestone: 'E1', specRef: SPEC_REF })
    expect(plan.issues[0].epicContext).toBeNull()
  })
})

// ============================================================================
// End-to-end integration: a real /ct-groom --dry-run, not the pure functions
// above. `readEpicContext`/`groomPlan`/`buildIssueBody` are already tested in
// isolation — what is left to check is that ct-groom.mjs connects them: it
// reads the spec, prints the warnings on stderr, and passes the text to the
// plan. The invocation mechanics (spawnSync + a PATH carrying the fake `gh`)
// are reused exactly as they are from __tests__/ct-groom-dryrun.test.js /
// f21-gate-and-type.test.js — no second way of starting the binary is invented.
// ============================================================================
const groomScript = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = (overrides = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...overrides })

function dryRun(specText) {
  const dir = makeSpecDir('f26-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, specText)
  const res = spawnSync('node', [groomScript, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], {
    encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv(),
  })
  rmSync(dir, { recursive: true, force: true })
  return res
}

const SLICES_TABLE = [
  '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |',
  '|---|---|---|---|---|---|---|',
  '| 1 | login | backend | modelo | – | AC-1.1 | schema |',
  '| 2 | refresh | backend | flow | #1 | AC-2.1 | – |',
].join('\n')

// The real binary is invoked with --dry-run, not an internal function: the
// warning and the handing out of the text are only true if the wrapper really
// connects them.
describe('/ct-groom --dry-run — the epic context reaches the plan', () => {
  it('with the section in the spec: the text comes out in every issue of the dry-run', () => {
    const spec = [EPIC_CONTEXT_HEADING, '- una regla común', '', '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices', SLICES_TABLE, ''].join('\n')
    const res = dryRun(spec)
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues).toHaveLength(2)
    expect(plan.issues.every((i) => i.epicContext === '- una regla común')).toBe(true)
  })

  it('with no section: it warns on stderr and epicContext is left at null', () => {
    const spec = ['## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices', SLICES_TABLE, ''].join('\n')
    const res = dryRun(spec)
    expect(res.status).toBe(0)
    expect(res.stderr).toContain(EPIC_CONTEXT_HEADING)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues.every((i) => i.epicContext === null)).toBe(true)
  })

  it('with a heading inside: it warns naming the line and does not emit the section', () => {
    const spec = [
      EPIC_CONTEXT_HEADING, 'preámbulo', '', '### 1 · Un detalle', 'texto del detalle', '',
      '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices', SLICES_TABLE, '',
    ].join('\n')
    const res = dryRun(spec)
    expect(res.status).toBe(0)
    expect(res.stderr).toContain('### 1 · Un detalle')
    const plan = JSON.parse(res.stdout)
    expect(plan.issues.every((i) => !i.body.includes(EPIC_CONTEXT_HEADING))).toBe(true)
  })
})

// ============================================================================
// Task 4: diffIssue compares "## Contexto del epic" against the spec; the
// inherited section is never compared and never produces any field at all.
// ============================================================================
import { diffIssue, hasDrift, formatDrift } from '../scripts/reconcile.js'

const bodyWith = (epic, inherited) => [
  '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)',
  '',
  ...(epic ? [EPIC_CONTEXT_HEADING, epic, ''] : []),
  ...(inherited ? [INHERITED_CONTEXT_HEADING, inherited, ''] : []),
  '## Acceptance criteria (EARS, 1:1 con tests)',
  '- AC-2.1',
  '',
  '## Out of scope / Protected',
  '- 🚫 nada',
].join('\n')

const WANTED = {
  order: 2, title: '#2 card', labels: [], deps: [], ac: ['AC-2.1'],
  descripcion: null, protectedLine: '- 🚫 nada', gatesContent: '',
  specLink: '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)',
  epicContext: '- regla nueva',
}
const existingWith = (body) => ({ number: 90, title: '#2 card', state: 'open', milestone: { title: 'E1' }, labels: [], body })

describe('diffIssue — the epic context is compared; the inherited one never is', () => {
  it('detects that the epic text differs', () => {
    const d = diffIssue(existingWith(bodyWith('- regla VIEJA', null)), WANTED, 'E1', [])
    expect(d.epicContextDiffers).toBe(true)
  })

  it('null on both sides is agreement, not drift', () => {
    const d = diffIssue(existingWith(bodyWith(null, null)), { ...WANTED, epicContext: null }, 'E1', [])
    expect(d.epicContextDiffers).toBe(false)
  })

  it('does NOT count towards the exit code, neither drifting nor duplicated', () => {
    const d = diffIssue(existingWith(bodyWith('- regla VIEJA', null)), WANTED, 'E1', [])
    expect(hasDrift(d)).toBe(false)
    const dup = bodyWith('- a', null) + `\n${EPIC_CONTEXT_HEADING}\n- b\n\n${INHERITED_CONTEXT_HEADING}\nx\n\n${INHERITED_CONTEXT_HEADING}\ny\n`
    const d2 = diffIssue(existingWith(dup), { ...WANTED, epicContext: '- a' }, 'E1', [])
    expect(d2.duplicateMachineSections).toEqual([])
    expect(hasDrift(d2)).toBe(false)
  })

  it('is reported as note:, never as drift:', () => {
    const d = diffIssue(existingWith(bodyWith('- regla VIEJA', null)), WANTED, 'E1', [])
    const line = formatDrift(d).find((l) => l.includes(EPIC_CONTEXT_HEADING))
    expect(line).toMatch(/^note:/)
  })

  // The inherited section is the literal request of §4: the plugin holds no
  // opinion.
  it('the content of the inherited section produces NO field and no line at all', () => {
    const a = diffIssue(existingWith(bodyWith('- x', 'lo que escribio la coordinadora')), { ...WANTED, epicContext: '- x' }, 'E1', [])
    const b = diffIssue(existingWith(bodyWith('- x', 'algo COMPLETAMENTE distinto')), { ...WANTED, epicContext: '- x' }, 'E1', [])
    expect(formatDrift(a)).toEqual(formatDrift(b))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

// ============================================================================
// Task 5: buildReconcileBody rewrites "## Contexto del epic" from the spec;
// "## Contexto heredado" survives byte for byte, always — nobody splices it.
// ============================================================================
import { buildReconcileBody } from '../scripts/reconcile.js'
import { extractSectionContent, extractAc } from '../scripts/gh-issue-map.js'

// The LITERAL slab of the body between two headings. extractSectionContent is
// no use for asserting "untouched": it cuts at the first heading of any level,
// so over a section with subheadings inside it would compare only its first
// slab and would say yes to things that are not.
const chunk = (body, from, to) => body.slice(body.indexOf(from), body.indexOf(to))

describe('buildReconcileBody — it rewrites the epic one, it does not touch the inherited one', () => {
  const WITH_BOTH = [
    '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)',
    '',
    EPIC_CONTEXT_HEADING,
    '- regla VIEJA',
    '',
    INHERITED_CONTEXT_HEADING,
    'Preámbulo de la coordinadora.',
    '',
    '### 1 · Una subcabecera suya',
    'Texto bajo la subcabecera.',
    '',
    '| col | col |',
    '|---|---|',
    '| a | b |',
    '',
    '## Acceptance criteria (EARS, 1:1 con tests)',
    '- AC-VIEJO',
    '',
    '## Out of scope / Protected',
    '- 🚫 nada',
  ].join('\n')

  const wanted = (over) => ({
    specLink: '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)',
    ac: ['AC-NUEVO'], deps: [], epicContext: '- regla NUEVA', ...over,
  })

  it('rewrites the epic one and leaves the inherited one byte for byte, with its subheadings and its table', () => {
    const r = buildReconcileBody(WITH_BOTH, wanted())
    expect(extractSectionContent(r.body, EPIC_CONTEXT_HEADING)).toBe('- regla NUEVA')
    expect(chunk(r.body, INHERITED_CONTEXT_HEADING, '## Acceptance criteria'))
      .toBe(chunk(WITH_BOTH, INHERITED_CONTEXT_HEADING, '## Acceptance criteria'))
    expect(extractAc(r.body)).toEqual(['AC-NUEVO'])
  })

  it('with no epic heading, it inserts it right BEFORE Acceptance criteria', () => {
    const withoutEpic = WITH_BOTH.replace(`${EPIC_CONTEXT_HEADING}\n- regla VIEJA\n\n`, '')
    const r = buildReconcileBody(withoutEpic, wanted())
    expect(r.body.indexOf(EPIC_CONTEXT_HEADING)).toBeLessThan(r.body.indexOf('## Acceptance criteria'))
    expect(extractSectionContent(r.body, EPIC_CONTEXT_HEADING)).toBe('- regla NUEVA')
  })

  // With NO anchor at all (neither "## Contexto heredado" nor "## Acceptance
  // criteria") it still gives up, which is the property of §6.4 of the design:
  // no position is invented. What changed in the final branch review is which
  // anchor is the preferred one, not that it writes blind when there is none.
  it('with no anchor at all, it inserts NOTHING and does not blow up', () => {
    const withoutAnchor = [
      '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)',
      '',
      '## Descripción',
      'lo que entrega',
    ].join('\n')
    const r = buildReconcileBody(withoutAnchor, wanted({ ac: [] }))
    expect(r.body === null || !r.body.includes(EPIC_CONTEXT_HEADING)).toBe(true)
  })

  // And with the inherited one present but with no AC, there IS a safe
  // anchor: it is inserted right before it (outside its text), in the position
  // of §3.4.
  it('with the inherited one but no Acceptance criteria, it anchors on the inherited one', () => {
    const onlyInherited = [
      '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)',
      '',
      INHERITED_CONTEXT_HEADING,
      'lo de la coordinadora',
    ].join('\n')
    const r = buildReconcileBody(onlyInherited, wanted({ ac: [] }))
    expect(r.body.indexOf(EPIC_CONTEXT_HEADING)).toBeLessThan(r.body.indexOf(INHERITED_CONTEXT_HEADING))
    expect(r.body).toContain(`${INHERITED_CONTEXT_HEADING}\nlo de la coordinadora`)
  })

  it('if the spec stops carrying context, the epic section is withdrawn whole', () => {
    const r = buildReconcileBody(WITH_BOTH, wanted({ epicContext: null }))
    expect(r.body).not.toContain(EPIC_CONTEXT_HEADING)
    expect(r.body).toContain(INHERITED_CONTEXT_HEADING)
    expect(r.body).not.toContain('\n\n\n')
  })

  // The property that holds on its own today and that nobody protects.
  it('never inserts the inherited section when it is missing from the body', () => {
    const withoutInherited = WITH_BOTH.replace(/## Contexto heredado[\s\S]*?(?=## Acceptance)/, '')
    const r = buildReconcileBody(withoutInherited, wanted())
    expect(r.body).not.toContain(INHERITED_CONTEXT_HEADING)
  })

  it('a change ONLY in the inherited one produces no write at all', () => {
    const alreadyUpToDate = WITH_BOTH.replace('- regla VIEJA', '- regla NUEVA').replace('- AC-VIEJO', '- AC-NUEVO')
    expect(buildReconcileBody(alreadyUpToDate, wanted()).body).toBeNull()
  })
})

// ============================================================================
// Task 6: renderKickoff names the two context sections
// ============================================================================

describe('renderKickoff — it names the two sections', () => {
  const K = () => renderKickoff({ n: 7, name: 'card', type: 'ui', ac: ['AC-7.1'], deps: [], issue: '#7' }, { repo: 'o/r' , conventionsDir: '/plugin/conventions' })

  it('names the two EXACT headings the groom emits', () => {
    expect(K()).toContain(EPIC_CONTEXT_HEADING)
    expect(K()).toContain(INHERITED_CONTEXT_HEADING)
  })

  it('the output does NOT depend on any context content the slice carries', () => {
    // The real property: the sections are NAMED and their text is not
    // interpolated. It is checked by comparing two outputs —one with no
    // context fields, another with those same fields loaded with recognisable
    // text— and demanding that they be identical. If somebody introduces
    // interpolation tomorrow, that equality breaks and the test says so. A
    // test that cannot fail does not protect the design decision.
    const withoutContext = K()
    const withContext = renderKickoff(
      {
        n: 7, name: 'card', type: 'ui', ac: ['AC-7.1'], deps: [], issue: '#7',
        epicContext: 'TEXTO EPICCONTEXT QUE NO DEBE APARECER',
        inheritedContext: 'TEXTO INHERITEDCONTEXT QUE NO DEBE APARECER',
      },
      { repo: 'o/r', conventionsDir: '/plugin/conventions' },
    )
    expect(withoutContext).toBe(withContext)
  })

  it('announces the «vacía» case explicitly: the section exists but with no content', () => {
    expect(K()).toMatch(/vacía/)
  })

  // #99 — the sentence was «Si alguna está vacía o no aparece, no hay nada
  // que heredar». It says the same in the positive: the issue is the whole
  // source, and an absent section means that what is inherited is nothing.
  it('announces the «ausente» case explicitly: an issue from before this round never gets the inherited section', () => {
    expect(K()).toMatch(/ausente/)
  })

  it('goes on naming Out of scope / Protected — it does not displace it', () => {
    expect(K()).toContain('## Out of scope / Protected')
  })
})

// ============================================================================
// FINAL BRANCH REVIEW — C1: the seam between the pure functions above and
// ct-groom.mjs. Everything earlier in this file tests the pieces separately;
// the defect lived exactly at the point where the wrapper joins them, and that
// is why no test saw it: --reconcile computed the new body and threw it away
// when the ONLY drift was the epic context (the primary scenario of the
// feature), because it gated the write on `hasDrift`, which excludes this
// section on purpose (§4.4). They are TWO different questions: "is there
// anything to write?" is not "does this count towards the exit code?".
// ============================================================================
import { specUrl } from './fixtures/spec-repo.js'

const SPEC_REF_E2E = { path: 'spec.md', heading: '9. Slices', url: specUrl('spec.md'), reason: null }
const SLICE_1 = { n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' }
// The labels the plan produces today for SLICE_1 (verified against
// groom.js#buildLabels). `status:` is never compared, so it does not matter
// which one the issue carries.
const LABELS_1 = [{ name: 'type:backend' }, { name: 'gate:plan' }, { name: 'status:backlog' }]

const ONE_SLICE_TABLE = [
  '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |',
  '|---|---|---|---|---|---|---|',
  '| 1 | login | backend | modelo | – | AC-1.1 | schema |',
].join('\n')

const specWithContext = (context) => [
  EPIC_CONTEXT_HEADING, context, '', '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices', ONE_SLICE_TABLE, '',
].join('\n')

function invoke(specText, issues, extraArgs) {
  const dir = makeSpecDir('f26-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, specText)
  const res = spawnSync('node', [groomScript, spec, '--repo', 'o/r', '--milestone', 'Epic', ...extraArgs], {
    encoding: 'utf8',
    stdio: QUIET_STDIO,
    env: fakeEnv({
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([issues]),
    }),
  })
  rmSync(dir, { recursive: true, force: true })
  return res
}

const issueWith = (epicContext) => ({
  number: 501,
  title: '#1 login',
  state: 'open',
  milestone: { title: 'Epic' },
  labels: LABELS_1,
  body: buildIssueBody(SLICE_1, SPEC_REF_E2E, epicContext),
})

describe('C1 — the epic context as the ONLY drift does get written', () => {
  it('--dry-run --reconcile announces it with an "aplicaría" line that names the section', () => {
    const res = invoke(specWithContext('- regla NUEVA'), [issueWith('- regla VIEJA')], ['--dry-run', '--reconcile'])
    expect(res.status).toBe(0) // §4.4: this section never produces a 3
    expect(res.stderr).toMatch(/--reconcile aplicaría: gh issue edit 501/)
    // The preview names what would really change, not a fixed list of
    // categories that here would be false (neither deps nor AC drift).
    expect(res.stderr).toMatch(/aplicaría.*contexto del epic/)
    expect(res.stderr).not.toMatch(/aplicaría.*criterios de aceptación/)
  })

  it('the real run calls `gh issue edit` with the rewritten --body, and the summary names the category', () => {
    const res = invoke(specWithContext('- regla NUEVA'), [issueWith('- regla VIEJA')], ['--reconcile'])
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/issue #501 reconciliado \(orden #1\): .*contexto del epic/)
    expect(res.stdout).not.toMatch(/reconciliado \(orden #1\): *$/m) // never a bare colon
  })

  it('with no --reconcile nothing is written, and the exit is still 0 (never 3 because of this section)', () => {
    const res = invoke(specWithContext('- regla NUEVA'), [issueWith('- regla VIEJA')], [])
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/^note:.*Contexto del epic/m)
    expect(res.stderr).not.toMatch(/^drift:.*Contexto del epic/m)
  })

  it('with no drift at all (the context already matches) `gh issue edit` is not called', () => {
    const res = invoke(specWithContext('- regla NUEVA'), [issueWith('- regla NUEVA')], ['--dry-run', '--reconcile'])
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/aplicaría/)
  })
})

// Giving up with no anchor was already tested in the pure layer (further up:
// "with no Acceptance criteria as an anchor, it inserts NOTHING"). What was
// missing is that it be SAID: AC and Dependencias have been giving up out loud
// since review round 4, and this one did it in silence — with the C1 fix, the
// caller went on to announce a write that did not exist.
describe('giving up on the epic context is said out loud, and it still does not move the exit code', () => {
  const NO_ANCHOR_TABLE = [
    '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |',
    '|---|---|---|---|---|---|---|',
    '| 1 | login | backend | modelo | – | – | schema |',
  ].join('\n')

  // A body with no anchor at all —neither "## Acceptance criteria" (a human
  // deleted it) nor "## Contexto heredado" (an issue from before F26)— and
  // with no epic section: there is nowhere to insert it in its place. The
  // table asks for no criterion, so AC does not drift and there is no gap that
  // does count.
  const NO_ANCHOR_BODY = [
    `> Slice \`#1\` del epic. Spec: [spec.md § 9. Slices](${specUrl('spec.md')})`,
    '',
    '## Descripción',
    'modelo',
    '',
    '## Out of scope / Protected',
    '- 🚫 schema',
    '',
    '<!-- ct-order:1 -->',
  ].join('\n')

  const spec = [EPIC_CONTEXT_HEADING, '- regla', '', '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices', NO_ANCHOR_TABLE, ''].join('\n')
  const issue = { number: 501, title: '#1 login', state: 'open', milestone: { title: 'Epic' }, labels: LABELS_1, body: NO_ANCHOR_BODY }

  it('says it as note:, names the anchor that is missing, and writes nothing', () => {
    const res = invoke(spec, [issue], ['--dry-run', '--reconcile'])
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/note:.*NO ha reescrito la sección "## Contexto del epic"/)
    expect(res.stderr).toMatch(/ancla.*Contexto heredado.*Acceptance criteria/) // it names the TWO that would do
    expect(res.stderr).not.toMatch(/aplicaría/) // there is no new body: no write is announced
  })

  it('the inherited section is neither compared nor inserted', () => {
    const res = invoke(spec, [issue], ['--reconcile'])
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(new RegExp(`drift.*${INHERITED_CONTEXT_HEADING}`))
  })
})

// ============================================================================
// FINAL BRANCH REVIEW — C2: the splices were writing INSIDE "## Contexto
// inherited". Every locator of buildReconcileBody is a "first occurrence over
// the whole body", with no notion at all of an untouchable zone. The real use
// case —the coordinator pastes context from the issue of the previous slice,
// which carries the SAME headings as every issue of the epic— turned her text
// into the target of the splice. The placeholder promises the opposite in
// writing: «`/ct-groom` no escribe aquí ni reescribe lo que escribas».
// ============================================================================

const SPEC_LINK_3 = `> Slice \`#3\` del epic. Spec: [spec.md § 9. Slices](${specUrl('spec.md')})`
const END_OF_PASTED = 'Hasta aquí lo pegado por la coordinadora.'

// The real body that reproduced the defect: the coordinator pastes the
// criteria block of slice #2 inside HER section, heading included.
const WITH_PASTED = (pasted) => [
  SPEC_LINK_3,
  '',
  '## Descripción',
  'flow',
  '',
  EPIC_CONTEXT_HEADING,
  '- regla VIEJA',
  '',
  INHERITED_CONTEXT_HEADING,
  'El slice #2 dejó montado el endpoint. Copio lo suyo:',
  '',
  ...pasted,
  '',
  END_OF_PASTED,
  '',
  '## Acceptance criteria (EARS, 1:1 con tests)',
  '- AC-3.1 VIEJO',
  '',
  '## Dependencias',
  '- merge-after `#2`',
  '',
  '## Out of scope / Protected',
  '- 🚫 nada',
  '',
  '<!-- ct-order:3 -->',
].join('\n')

const WANTED_3 = { specLink: SPEC_LINK_3, ac: ['AC-3.1 NUEVO'], deps: [2], epicContext: '- regla NUEVA' }

// The comparison is done with `chunk` (a LITERAL fragment between two
// anchors), never with extractSectionContent: that one cuts at the first
// heading of any level, so over a section with headings pasted inside it would
// compare only its first slab and would pass a wrecked section as good.
describe('C2 — nothing the coordinator writes is touched', () => {
  it('an AC heading pasted inside: her text survives byte for byte', () => {
    const body = WITH_PASTED(['## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1 de la coordinadora', '- AC-2.2 de la coordinadora'])
    const r = buildReconcileBody(body, WANTED_3)
    const result = r.body ?? body
    expect(result).toContain(END_OF_PASTED)
    expect(chunk(result, INHERITED_CONTEXT_HEADING, END_OF_PASTED))
      .toBe(chunk(body, INHERITED_CONTEXT_HEADING, END_OF_PASTED))
    // And it is said: it is not applied blind over the wrong copy, it is
    // reported.
    expect(r.unresolvedAc).toBe(true)
  })

  it('a Dependencias heading pasted inside: her text survives byte for byte', () => {
    const body = WITH_PASTED(['## Dependencias', '- merge-after `#1`'])
    const r = buildReconcileBody(body, { ...WANTED_3, deps: [2, 5] })
    const result = r.body ?? body
    expect(chunk(result, INHERITED_CONTEXT_HEADING, END_OF_PASTED))
      .toBe(chunk(body, INHERITED_CONTEXT_HEADING, END_OF_PASTED))
    expect(r.unresolvedDeps).toBe(true)
  })

  it('the epic context heading pasted inside: nothing is written on her copy, and it is said', () => {
    const body = WITH_PASTED([EPIC_CONTEXT_HEADING, '- la regla que le tocaba al slice #2'])
    const r = buildReconcileBody(body, WANTED_3)
    const result = r.body ?? body
    expect(chunk(result, INHERITED_CONTEXT_HEADING, END_OF_PASTED))
      .toBe(chunk(body, INHERITED_CONTEXT_HEADING, END_OF_PASTED))
    expect(r.unresolvedEpicContext).toBe('duplicada')
  })

  it('the insertion anchor of Dependencias has to be unambiguous too', () => {
    // With no "## Dependencias" of its own and with the Protected one pasted
    // inside the inherited section: the insertion anchored on the FIRST
    // occurrence, that is, inside the text of the coordinator.
    const body = [
      SPEC_LINK_3, '',
      INHERITED_CONTEXT_HEADING,
      'Copio lo suyo:', '',
      '## Out of scope / Protected',
      '- 🚫 lo que protegía el slice #2',
      '',
      END_OF_PASTED, '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-3.1 NUEVO', '',
      '## Out of scope / Protected', '- 🚫 nada',
    ].join('\n')
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: ['AC-3.1 NUEVO'], deps: [2], epicContext: null })
    const result = r.body ?? body
    expect(chunk(result, INHERITED_CONTEXT_HEADING, END_OF_PASTED))
      .toBe(chunk(body, INHERITED_CONTEXT_HEADING, END_OF_PASTED))
    expect(r.unresolvedDeps).toBe(true)
  })

  it('the spec link line pasted inside is not the line of the issue', () => {
    // Here the literal forbidden range does bite: the link line is not a
    // heading, so it does not end the inherited section and it lives INSIDE
    // it.
    const pastedLink = '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/OTRO.md#9-slices)'
    const body = [
      INHERITED_CONTEXT_HEADING,
      'El slice #2 apuntaba a:',
      pastedLink,
      '',
      END_OF_PASTED, '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-3.1 NUEVO', '',
      '## Out of scope / Protected', '- 🚫 nada',
    ].join('\n')
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: ['AC-3.1 NUEVO'], deps: [], epicContext: null })
    expect(r.body).toContain(pastedLink) // untouched
    expect(chunk(r.body, INHERITED_CONTEXT_HEADING, END_OF_PASTED))
      .toBe(chunk(body, INHERITED_CONTEXT_HEADING, END_OF_PASTED))
    expect(r.body).toContain(SPEC_LINK_3) // the one of the issue is put in front, as when it is missing altogether
  })
})

// ============================================================================
// FINAL BRANCH REVIEW — C3: `truncationLine` only catches terminators that
// cut the section TOO EARLY. An unclosed code fence (or a `<!--` with no
// `-->`) does the opposite: it hides every following line from the scanner, so
// there is NO terminator at all and the section swallows the rest of the spec
// —the slices table included— without a single warning. That unclosed
// delimiter then travels into the body of every issue, and the next
// --reconcile splices from the epic heading to the end of the body: it takes
// down "## Contexto heredado", the AC, the gates, what is protected and the
// `ct-order` marker (and losing the marker unpairs the issue, so the next
// groom creates a duplicate).
// ============================================================================
describe('C3 — an unclosed delimiter inside the section of the spec', () => {
  const specWith = (body) => [
    '# Spec', '', EPIC_CONTEXT_HEADING, body, '', '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices',
    '| # | Slice | Dep |', '|---|---|---|', '| 1 | A | – |',
  ].join('\n')

  it('an unclosed code fence: it is not emitted, and the warning says so', () => {
    const r = readEpicContext(specWith('- regla A\n```js\nconst x = 1'))
    expect(r.content).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/fence|```/)
    expect(r.warnings[0]).toContain(EPIC_CONTEXT_HEADING)
  })

  it('an unclosed HTML comment: the same treatment', () => {
    const r = readEpicContext(specWith('- regla A\n<!-- ojo con esto'))
    expect(r.content).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/comment/)
  })

  it('the slices table NEVER ends up inside the epic context', () => {
    for (const broken of ['- regla\n```js\nconst x = 1', '- regla\n<!-- ojo']) {
      expect(readEpicContext(specWith(broken)).content).toBeNull()
    }
  })

  // A PROPERLY closed fence is still legitimate content: the guardrail
  // catches the open delimiter, not the code block.
  it('a properly closed fence trips nothing', () => {
    const r = readEpicContext(specWith('ejemplo:\n\n```md\n### no es una cabecera\n```'))
    expect(r.warnings).toEqual([])
    expect(r.content).toContain('### no es una cabecera')
  })

  // The guardrail cannot be the only line of defence: a human edits the body
  // of the issue by hand, and there there is no producer to cut off.
  it('the epic splice defends itself against an issue body with the fence left open', () => {
    const body = [
      SPEC_LINK_3, '',
      EPIC_CONTEXT_HEADING,
      '- regla VIEJA',
      '```js',
      'const x = 1',
      '',
      INHERITED_CONTEXT_HEADING,
      'lo de la coordinadora',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-3.1 NUEVO', '',
      '## Out of scope / Protected', '- 🚫 nada', '',
      '<!-- ct-order:3 -->',
    ].join('\n')
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: ['AC-3.1 NUEVO'], deps: [], epicContext: '- regla NUEVA' })
    const result = r.body ?? body
    expect(result).toContain(INHERITED_CONTEXT_HEADING)
    expect(result).toContain('lo de la coordinadora')
    expect(result).toContain('## Out of scope / Protected')
    expect(result).toContain('<!-- ct-order:3 -->')
    expect(r.unresolvedEpicContext).toBe('seccion-sin-cerrar')
  })

  it('nor is a new text written that carries the fence left open', () => {
    const body = [
      SPEC_LINK_3, '',
      EPIC_CONTEXT_HEADING, '- regla VIEJA', '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-3.1 NUEVO', '',
      '## Out of scope / Protected', '- 🚫 nada',
    ].join('\n')
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: ['AC-3.1 NUEVO'], deps: [], epicContext: '- regla\n```js\nconst x = 1' })
    expect(r.body === null || !r.body.includes('const x = 1')).toBe(true)
    expect(r.unresolvedEpicContext).toBe('texto-sin-cerrar')
  })
})

// ============================================================================
// FINAL BRANCH REVIEW — I1: the three (now four) failure modes of the
// guardrail collapsed into `content: null`, indistinguishable downstream from
// "the spec holds no opinion at all". And `buildReconcileBody` reads `null` as
// WITHDRAW THE WHOLE SECTION. That is: adding one `###` too many to the spec
// erased the context of the N issues of the epic on the next --reconcile. The
// warning said only that the section would not be emitted, and §7 of the
// design called it "fail-safe": neither of those two things is true with
// --reconcile in front.
// ============================================================================
describe('I1 — "I have no valid text" is not "the epic has no context"', () => {
  const withReason = (spec) => readEpicContext(spec)

  it('readEpicContext says WHY, not only that there is no text', () => {
    const table = '\n\n## 9. Slices\n| # | Slice | Dep |'
    expect(withReason('# Spec' + table).reason).toBe('ausente')
    expect(withReason(`# Spec\n\n${EPIC_CONTEXT_HEADING}\n` + table).reason).toBe('vacia')
    expect(withReason(`# Spec\n\n${EPIC_CONTEXT_HEADING}\ntexto\n\n### dentro\nmás` + table).reason).toBe('malformada')
    expect(withReason(`# Spec\n\n${EPIC_CONTEXT_HEADING}\ntexto\n\`\`\`js\nx` + table).reason).toBe('malformada')
    expect(withReason(`# Spec\n\n${EPIC_CONTEXT_HEADING}\n- regla` + table).reason).toBeNull()
  })

  it('the warning of a malformed section says that what is already in the issues is NOT erased', () => {
    const w = withReason(`# Spec\n\n${EPIC_CONTEXT_HEADING}\ntexto\n\n### dentro\nmás\n\n## 9. Slices`).warnings[0]
    expect(w).toMatch(/neither touched nor deleted/i)
  })

  it('a malformed spec does NOT withdraw the section from the body of the issues', () => {
    const spec = [
      EPIC_CONTEXT_HEADING, 'preámbulo', '', '### 1 · un detalle', 'texto', '',
      '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices', ONE_SLICE_TABLE, '',
    ].join('\n')
    const res = invoke(spec, [issueWith('- regla que YA está en el issue')], ['--reconcile'])
    expect(res.status).toBe(0)
    expect(res.stderr).toContain('### 1 · un detalle')
    expect(res.stdout).not.toMatch(/reconciliado/) // there is nothing to apply: the spec holds no valid opinion
  })

  it('a spec WITHOUT the section does withdraw it: that does mean "the epic has no context"', () => {
    const spec = ['## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices', ONE_SLICE_TABLE, ''].join('\n')
    const res = invoke(spec, [issueWith('- regla que YA está en el issue')], ['--reconcile'])
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/reconciliado \(orden #1\): .*contexto del epic/)
  })
})

// ============================================================================
// FINAL BRANCH REVIEW — I2: ct-groom.mjs reads the spec without normalising,
// and `readEpicContext` is the first MULTI-LINE value derived from the spec
// that reaches a body (the cells of the table all go through `trim`, so this
// exposure is new in this branch). A spec in CRLF put `\r` inside the body,
// and since diffIssue/buildReconcileBody compare text already normalised to LF
// against a value carrying `\r`, they could NEVER match: a `note:` on every
// run, for ever, and a write on every run, for ever.
// ============================================================================
describe('I2 — a spec in CRLF does not put \\r into the body of the issues', () => {
  const crlf = (...lines) => lines.join('\r\n')

  it('the content comes out in pure LF', () => {
    const r = readEpicContext(crlf('# Spec', '', EPIC_CONTEXT_HEADING, '- regla A', '- regla B', '', '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices'))
    expect(r.content).toBe('- regla A\n- regla B')
    expect(r.content).not.toContain('\r')
  })

  it('the text read from a CRLF spec and that of the SAME spec in LF are identical', () => {
    const lines = ['# Spec', '', EPIC_CONTEXT_HEADING, '- regla A', '- regla B', '', '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices']
    expect(readEpicContext(lines.join('\r\n')).content).toBe(readEpicContext(lines.join('\n')).content)
  })

  it('always converges: the same text cannot be left in perpetual drift', () => {
    const context = readEpicContext(crlf('# Spec', '', EPIC_CONTEXT_HEADING, '- regla A', '- regla B', '', '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices')).content
    const body = [SPEC_LINK_3, '', EPIC_CONTEXT_HEADING, '- regla A', '- regla B', '', '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-1', '', '## Out of scope / Protected', '- 🚫 nada'].join('\n')
    const wanted = { specLink: SPEC_LINK_3, ac: ['AC-1'], deps: [], epicContext: context }
    expect(buildReconcileBody(body, wanted).body).toBeNull() // second run: nothing to write
  })

  // The guardrail has to see the CRLF spec just as it sees the LF one.
  // Without normalising, ATX_HEADING_RE does not recognise "##\r" as a
  // heading: the section does not end there and it swallows the rest of the
  // file — the same damage as C3, through another door.
  it('a bare heading in a CRLF spec ends the section, it does not swallow it', () => {
    const r = readEpicContext(crlf('# Spec', '', EPIC_CONTEXT_HEADING, '- regla A', '', '##', 'texto de otra sección'))
    expect(r.content).toBe('- regla A')
    expect(r.warnings).toEqual([])
  })
})

// ============================================================================
// FINAL BRANCH REVIEW (minor) — when INSERTING the missing epic section (an
// issue from before F26), the only anchor was "## Acceptance criteria", so the
// section landed AFTER "## Contexto heredado" and inverted the order that §3.4
// of the design fixes (epic → inherited → criteria). Reproduced.
// ============================================================================
describe('the insertion respects the order of §3.4', () => {
  const withoutEpic = [
    SPEC_LINK_3, '',
    '## Descripción', 'flow', '',
    INHERITED_CONTEXT_HEADING, 'lo de la coordinadora', '',
    '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-1', '',
    '## Out of scope / Protected', '- 🚫 nada',
  ].join('\n')

  it('the epic section ends up BEFORE the inherited one, not after it', () => {
    const r = buildReconcileBody(withoutEpic, { specLink: SPEC_LINK_3, ac: ['AC-1'], deps: [], epicContext: '- regla' })
    expect(r.body.indexOf(EPIC_CONTEXT_HEADING)).toBeLessThan(r.body.indexOf(INHERITED_CONTEXT_HEADING))
    expect(r.body.indexOf(INHERITED_CONTEXT_HEADING)).toBeLessThan(r.body.indexOf('## Acceptance criteria'))
    expect(extractSectionContent(r.body, EPIC_CONTEXT_HEADING)).toBe('- regla')
    // And not a single letter of hers has been touched.
    expect(r.body).toContain(`${INHERITED_CONTEXT_HEADING}\nlo de la coordinadora`)
  })

  it('with no inherited section it still anchors on Acceptance criteria', () => {
    const withoutEither = withoutEpic.replace(`${INHERITED_CONTEXT_HEADING}\nlo de la coordinadora\n\n`, '')
    const r = buildReconcileBody(withoutEither, { specLink: SPEC_LINK_3, ac: ['AC-1'], deps: [], epicContext: '- regla' })
    expect(r.body.indexOf(EPIC_CONTEXT_HEADING)).toBeLessThan(r.body.indexOf('## Acceptance criteria'))
    expect(r.body).not.toContain(INHERITED_CONTEXT_HEADING) // it is never inserted
  })
})

// The non-negotiable property of §4.4, checked end-to-end over the real
// binary and in the three ways this section can be left unapplied (it drifts,
// it is duplicated, it gives up with no anchor). The exit code is read off
// spawnSync, never through a pipe.
describe('§4.4 — the epic context cannot produce an exit 3, whatever happens', () => {
  const cases = {
    'it drifts and gets applied': buildIssueBody(SLICE_1, SPEC_REF_E2E, '- regla VIEJA'),
    'it is duplicated in the body': buildIssueBody(SLICE_1, SPEC_REF_E2E, '- regla VIEJA')
      .replace(INHERITED_CONTEXT_HEADING, `${EPIC_CONTEXT_HEADING}\n- una copia pegada\n\n${INHERITED_CONTEXT_HEADING}`),
  }
  for (const [name, body] of Object.entries(cases)) {
    it(`${name}: exit 0, and no "drift:" line at all because of this section`, () => {
      const issue = { number: 501, title: '#1 login', state: 'open', milestone: { title: 'Epic' }, labels: LABELS_1, body }
      for (const args of [[], ['--reconcile'], ['--dry-run', '--reconcile']]) {
        const res = invoke(specWithContext('- regla NUEVA'), [issue], args)
        expect(res.status, `${name} con ${args.join(' ') || '(sin flags)'}`).toBe(0)
        expect(res.stderr).not.toMatch(new RegExp(`drift:.*${EPIC_CONTEXT_HEADING}`))
      }
    })
  }

  // The third case —an unclosed fence INSIDE the epic section in the body of
  // the issue— does come out 3, and why has to be said, because this section
  // is not what causes it: the open fence hides EVERYTHING that comes after it
  // from the scanner, so "## Acceptance criteria" stops existing for whoever
  // reads the body and the criteria come out as real drift. The body really is
  // broken; the 3 is correct and it does not come from the epic context, which
  // still produces not one "drift:" line.
  it('with the fence left open the 3 is produced by AC (which stops being readable), never by this section', () => {
    const body = buildIssueBody(SLICE_1, SPEC_REF_E2E, '- regla VIEJA\n```js')
    const issue = { number: 501, title: '#1 login', state: 'open', milestone: { title: 'Epic' }, labels: LABELS_1, body }
    const res = invoke(specWithContext('- regla NUEVA'), [issue], ['--reconcile'])
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/drift:.*criterio de aceptación/)
    expect(res.stderr).not.toMatch(new RegExp(`drift:.*${EPIC_CONTEXT_HEADING}`))
    // And nothing has been written in the epic section: why has been said.
    expect(res.stderr).toMatch(/note:.*NO ha reescrito la sección "## Contexto del epic".*SIN CERRAR/s)
  })
})

// ============================================================================
// SECOND WAVE — Important: the success line of the REAL run asserted what the
// code had REFUSED to do. It used `driftCategories` (what DRIFTS) where the
// --dry-run preview already used `bodyDriftCategories` (what was WRITTEN), so
// preview and real run contradicted each other and the false assertion came
// out on stdout, the channel this script reserves for what really happened.
// ============================================================================

describe('the "reconciliado" line names what was written, not what drifts', () => {
  const epicTwice = (epicContext) =>
    `${buildIssueBody(SLICE_1, SPEC_REF_E2E, epicContext)}\n\n${EPIC_CONTEXT_HEADING}\n- copia pegada`

  it('with the epic section duplicated, stdout does not say it reconciled it', () => {
    const issue = {
      number: 501, title: '#1 login MAL', state: 'open', milestone: { title: 'Epic' },
      labels: LABELS_1, body: epicTwice('- regla VIEJA'),
    }
    const res = invoke(specWithContext('- regla NUEVA'), [issue], ['--reconcile'])
    // stderr was already telling the truth: it has not been rewritten.
    expect(res.stderr).toMatch(/note:.*NO ha reescrito la sección "## Contexto del epic"/)
    // stdout cannot say the opposite in the same run.
    expect(res.stdout).toMatch(/issue #501 reconciliado \(orden #1\): título/)
    expect(res.stdout).not.toMatch(/reconciliado \(orden #1\):.*contexto del epic/)
  })

  it('the same for AC: a duplicated section is not reported as reconciled', () => {
    const withDuplicatedAc = [
      buildIssueBody({ ...SLICE_1, ac: ['AC-1.1 VIEJO'] }, SPEC_REF_E2E, null),
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1 copia pegada',
    ].join('\n')
    const issue = {
      number: 501, title: '#1 login MAL', state: 'open', milestone: { title: 'Epic' },
      labels: LABELS_1, body: withDuplicatedAc,
    }
    const spec = ['## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices', ONE_SLICE_TABLE, ''].join('\n')
    const res = invoke(spec, [issue], ['--reconcile'])
    expect(res.stdout).toMatch(/issue #501 reconciliado \(orden #1\): título/)
    expect(res.stdout).not.toMatch(/reconciliado \(orden #1\):.*criterios de aceptación/)
  })
})

// ============================================================================
// SECOND WAVE — C2, the half that was left open: the UNIQUE pasted heading.
//
// The first wave closed the DUPLICATED case (`spliceableSection` gives up if
// the heading appears twice). What is left is the case where the issue does
// NOT have that section of its own, so the copy pasted by the coordinator is
// the only one in the body: the count is 1, and the splice was applied inside
// her text. The deletion runs to the NEXT ATX heading, so it takes down all
// the prose she wrote after what she pasted, not only what she pasted.
//
// The fix widens the forbidden zone: it ends at "## Acceptance criteria" (the
// heading buildIssueBody ALWAYS emits right behind the inherited one), not at
// the first ATX heading that turns up — which, inside the inherited section,
// may be the one she pasted.
// ============================================================================

// With no Dependencias section of its own and no Contexto del epic either:
// what was pasted is the ONLY copy of that heading in the whole body.
const SOLE_PASTED = (pasted) => [
  SPEC_LINK_3,
  '',
  '## Descripción',
  'flow',
  '',
  INHERITED_CONTEXT_HEADING,
  'El slice #2 dejó montado el endpoint. Copio lo suyo:',
  '',
  ...pasted,
  '',
  END_OF_PASTED,
  '',
  '## Acceptance criteria (EARS, 1:1 con tests)',
  '- AC-3.1 VIEJO',
  '',
  '## Out of scope / Protected',
  '- 🚫 nada',
  '',
  '<!-- ct-order:3 -->',
].join('\n')

describe('C2 (2nd wave) — the UNIQUE pasted heading is not a target of the splice either', () => {
  it('"## Dependencias" pasted and the spec starts asking for a dep: her text survives byte for byte', () => {
    const body = SOLE_PASTED(['## Dependencias', '- merge-after `#1`'])
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: ['AC-3.1 VIEJO'], deps: [2], epicContext: null })
    const result = r.body ?? body
    expect(result).toContain(END_OF_PASTED) // her prose AFTER what was pasted
    expect(chunk(result, INHERITED_CONTEXT_HEADING, '## Acceptance criteria'))
      .toBe(chunk(body, INHERITED_CONTEXT_HEADING, '## Acceptance criteria'))
    // And it is said: no giving up in silence and letting the caller report
    // it as applied.
    expect(r.unresolvedDeps).toBe(true)
  })

  it('"## Contexto del epic" pasted in an issue from before F26: its text survives byte for byte', () => {
    const body = SOLE_PASTED([EPIC_CONTEXT_HEADING, '- la regla que le tocaba al slice #2'])
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: ['AC-3.1 VIEJO'], deps: [], epicContext: '- regla NUEVA' })
    const result = r.body ?? body
    expect(result).toContain(END_OF_PASTED)
    expect(chunk(result, INHERITED_CONTEXT_HEADING, '## Acceptance criteria'))
      .toBe(chunk(body, INHERITED_CONTEXT_HEADING, '## Acceptance criteria'))
    // The section the issue is missing is inserted in ITS place (§3.4: before
    // the inherited one), not on top of her copy.
    expect(result.indexOf(`${EPIC_CONTEXT_HEADING}\n- regla NUEVA`)).toBeLessThan(result.indexOf(INHERITED_CONTEXT_HEADING))
  })

  it('the protection of the DUPLICATED case still stands (one is not traded for the other)', () => {
    const body = WITH_PASTED(['## Dependencias', '- merge-after `#1`'])
    const r = buildReconcileBody(body, { ...WANTED_3, deps: [2, 5] })
    const result = r.body ?? body
    expect(chunk(result, INHERITED_CONTEXT_HEADING, END_OF_PASTED))
      .toBe(chunk(body, INHERITED_CONTEXT_HEADING, END_OF_PASTED))
    expect(r.unresolvedDeps).toBe(true)
  })
})

// The epic case converges, and that has to be pinned: the inserted copy ends
// up IN FRONT of the one the coordinator pasted, so the next pass reads the
// one of the plugin as "the first" and rewrites nothing any more. Without this
// property, the fix would trade an erasure of text for a perpetual rewrite.
describe('C2 (2nd wave) — inserting the epic section in front of the pasted copy CONVERGES', () => {
  it('the second pass over the body already written returns body: null', () => {
    const body = SOLE_PASTED([EPIC_CONTEXT_HEADING, '- la regla que le tocaba al slice #2'])
    const wanted = { specLink: SPEC_LINK_3, ac: ['AC-3.1 VIEJO'], deps: [], epicContext: '- regla NUEVA' }
    const firstPass = buildReconcileBody(body, wanted)
    expect(firstPass.body).not.toBeNull()
    expect(buildReconcileBody(firstPass.body, wanted).body).toBeNull()
  })
})

// The same case, end to end over the real binary: this is how it was
// reproduced (exit 0, "reconciliado … contexto del epic" and the prose of the
// coordinator gone from the `--body` sent to `gh`). The success line is true
// now —the section IS written, in its place— and what is checked is that the
// body that goes out over the wire keeps her text.
describe('C2 (2nd wave) — end to end: the --body that is sent keeps the text of the coordinator', () => {
  it('the `gh issue edit` carries the new epic section AND the pasted prose untouched', () => {
    const dir = makeSpecDir('f26-')
    const spec = join(dir, 'spec.md')
    const argvLog = join(dir, 'argv.log')
    writeFileSync(spec, specWithContext('- regla NUEVA'))
    // The body of an issue from before F26 (with no epic section of its own)
    // with the block of the neighbour pasted inside the inherited one, and
    // prose of her own after it.
    const body = [
      `> Slice \`#1\` del epic. Spec: [spec.md § 9. Slices](${specUrl('spec.md')})`, '',
      '## Descripción', 'modelo', '',
      INHERITED_CONTEXT_HEADING,
      'Copio lo del slice anterior:', '',
      EPIC_CONTEXT_HEADING, '- la regla que le tocaba al vecino', '',
      END_OF_PASTED, '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-1.1', '',
      '## Out of scope / Protected', '- 🚫 schema', '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const issue = { number: 501, title: '#1 login', state: 'open', milestone: { title: 'Epic' }, labels: LABELS_1, body }
    const res = spawnSync('node', [groomScript, spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], {
      encoding: 'utf8',
      stdio: QUIET_STDIO,
      env: fakeEnv({
        FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
        FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue]]),
        FAKE_GH_ARGV_LOG_FILE: argvLog,
      }),
    })
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    rmSync(dir, { recursive: true, force: true })
    expect(res.status).toBe(0) // §4.4: this section never produces a 3
    expect(log).toMatch(/issue edit 501/)
    expect(log).toContain('- regla NUEVA') // the epic section, written
    expect(log).toContain(END_OF_PASTED) // and her prose, untouched — this is what used to be lost
    expect(log).toContain('- la regla que le tocaba al vecino') // what was pasted, too
    expect(res.stdout).toMatch(/issue #501 reconciliado \(orden #1\):.*contexto del epic/)
  })
})

// Giving up on the epic context has to say what it KNOWS. With the zone
// unbounded (with no locatable "## Acceptance criteria") it cannot be asserted
// that the copy is text of the coordinator: only that there is no way of
// knowing where hers ends. It is the same distinction the Dependencias route
// already made.
describe('C2 (2nd wave) — the reason for giving up on the epic does not assert whose the text is', () => {
  const withRenamedAc = (pasted) => SOLE_PASTED(pasted)
    .replace('## Acceptance criteria (EARS, 1:1 con tests)', '## Criterios')

  it('an unbounded zone → "zona-sin-fin", not "en-heredado"', () => {
    const body = withRenamedAc([EPIC_CONTEXT_HEADING, '- la regla que le tocaba al slice #2'])
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: [], deps: [], epicContext: null })
    expect(r.unresolvedEpicContext).toBe('zona-sin-fin')
    expect(r.body).toBeNull() // and the body is not touched
    expect(body).toContain(END_OF_PASTED)
  })

  it('with the zone bounded it can be asserted: "en-heredado"', () => {
    const body = SOLE_PASTED([EPIC_CONTEXT_HEADING, '- la regla que le tocaba al slice #2'])
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: ['AC-3.1 VIEJO'], deps: [], epicContext: null })
    expect(r.unresolvedEpicContext).toBe('en-heredado')
  })

  // The reason is looked up by direct key in EPIC_CONTEXT_SURRENDERS, with no
  // fallback: a new one with no sentence of its own would come out on stderr
  // as "undefined".
  it('the new reason has its sentence: the warning comes out whole and does not assert whose the text is', () => {
    const body = [
      `> Slice \`#1\` del epic. Spec: [spec.md § 9. Slices](${specUrl('spec.md')})`, '',
      '## Descripción', 'modelo', '',
      INHERITED_CONTEXT_HEADING, 'Copio lo del vecino:', '',
      EPIC_CONTEXT_HEADING, '- la regla del vecino', '',
      END_OF_PASTED, '',
      '## Criterios', '- AC-1.1', '',
      '## Out of scope / Protected', '- 🚫 schema', '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const issue = { number: 501, title: '#1 login', state: 'open', milestone: { title: 'Epic' }, labels: LABELS_1, body }
    const res = invoke(['## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices', ONE_SLICE_TABLE, ''].join('\n'), [issue], ['--reconcile'])
    expect(res.stderr).toMatch(/NO ha reescrito la sección "## Contexto del epic": no se puede saber dónde termina/)
    expect(res.stderr).not.toMatch(/undefined/)
    // And whose the text is is not asserted, which is what this reason exists
    // in order not to say.
    expect(res.stderr).not.toMatch(/NO ha reescrito la sección "## Contexto del epic":[^\n]*pertenece a la sesión coordinadora/)
  })
})
