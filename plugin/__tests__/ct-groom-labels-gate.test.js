import { describe, it, expect } from 'vitest'
import { LOOP_STATUS_LABELS } from '../scripts/groom.js'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir, specUrl } from './fixtures/spec-repo.js'

// F6 — two silences of /ct-groom that the field test uncovered:
//
//   serious 2: ALL issues are born with `status:backlog` (groom.js#buildLabels)
//   and the dispatcher only looks at `status:ready` — so running groom and
//   then `/ct-next` straight after produces "no hay slices despachables" over
//   six freshly created issues. The groom did not mention it anywhere in its
//   output.
//
//   minor 5: `gh label create --force` does not tell "I reused a label that
//   already existed in the repo" apart from "I have just invented one". The
//   contract asks for the repo's label vocabulary to be reused, but nobody
//   could check what that vocabulary was, nor see, afterwards, which ones
//   ended up being invented.
//
// Besides, --force UPDATES the existing label (colour and description
// included): creating only the missing ones stops touching the ones the repo
// already had.

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')

const SPEC = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | – | api | db |
`
// Labels this spec produces: type:backend, area:api, touches:db, status:backlog

function writeSpec(content = SPEC) {
  const dir = makeSpecDir('ctg-labels-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, content)
  return { dir, spec }
}

function run(args, envOverrides = {}) {
  return spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...envOverrides },
  })
}

const MILESTONE_ENV = { FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]) }

describe('ct-groom — labels: it tells the ones that already existed apart from the ones it creates (F6, minor 5)', () => {
  it('a real run: it only calls `gh label create` for the ones that do NOT exist, and names reused and new ones separately', () => {
    const { dir, spec } = writeSpec()
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_LABELS_LIST: JSON.stringify([[{ name: 'type:backend' }, { name: 'area:api' }, { name: 'bug' }]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(0)
    const log = readFileSync(argvLog, 'utf8')
    // The ones that already existed are NOT touched (with --force, `gh label
    // create` would rewrite them — colour and description included — on every
    // run).
    expect(log).not.toMatch(/label create type:backend/)
    expect(log).not.toMatch(/label create area:api/)
    // The ones that were missing do get created.
    expect(log).toMatch(/label create touches:db/)
    expect(log).toMatch(/label create status:backlog/)
    // And the output says so, in two separate groups.
    expect(res.stderr).toMatch(/ya exist[íi]an.*type:backend/)
    expect(res.stderr).toMatch(/ya exist[íi]an.*area:api/)
    expect(res.stderr).toMatch(/creadas.*touches:db/)
    expect(res.stderr).toMatch(/creadas.*status:backlog/)
    // A label of the repo that is foreign to the plan is neither mentioned nor touched.
    expect(res.stderr).not.toMatch(/\bbug\b/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--dry-run --repo: it announces which labels would be invented BEFORE creating anything, and stdout is still pure JSON', () => {
    const { dir, spec } = writeSpec()
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_LABELS_LIST: JSON.stringify([[{ name: 'type:backend' }]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(0)
    expect(() => JSON.parse(res.stdout)).not.toThrow() // the plan still comes out clean on stdout
    expect(res.stderr).toMatch(/ya exist[íi]an.*type:backend/)
    expect(res.stderr).toMatch(/se crear[íi]an.*area:api/)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/label create/) // a dry-run never creates a label
    rmSync(dir, { recursive: true, force: true })
  })

  // Counterweight: the warning is only worth something if it does NOT appear
  // when there is nothing to invent. A message on every run (including the one
  // that reuses the whole vocabulary) would train people to ignore it, which
  // is exactly the family of failure this batch is after — same criterion as
  // the divergence report of F5: silence = nothing to review.
  it('every label of the plan already exists → it creates none and says nothing about labels', () => {
    const { dir, spec } = writeSpec()
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      // F21: the plan also produces `gate:none` (one gate label per issue,
      // always) — without it in the repo, this run WOULD have a new label to
      // create and the test would stop testing the case "there is nothing to
      // say". Same criterion as the note of F21 about `gate:none`: the whole
      // `status:` vocabulary (groom.js#LOOP_STATUS_LABELS) is part of what the
      // repo has to HAVE, so without it here this run WOULD have new labels to
      // create and the test would stop testing the case "there is nothing to say".
      FAKE_GH_LABELS_LIST: JSON.stringify([[{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:plan' }, ...LOOP_STATUS_LABELS.map((name) => ({ name }))]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(0)
    const log = readFileSync(argvLog, 'utf8')
    expect(log).not.toMatch(/label create/)
    expect(res.stderr).not.toMatch(/labels/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('if the labels of the repo cannot be listed, it aborts with a clear message instead of creating them blindly', () => {
    const { dir, spec } = writeSpec()
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_LABELS_FAIL: '1',
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/no se pudieron listar las labels/i)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — it says that what it has just created is NOT dispatchable yet (F6, serious 2)', () => {
  it('a real run: after creating the issues, it names status:backlog, the promotion to status:ready and the exact command', () => {
    const { dir, spec } = writeSpec()
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_LABELS_LIST: JSON.stringify([[]]),
    })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/status:backlog/)
    expect(res.stderr).toMatch(/status:ready/)
    expect(res.stderr).toMatch(/ct-next/)
    expect(res.stderr).toMatch(/gh issue edit/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--dry-run: the same reminder (the preview cannot keep quiet about what the real run would say)', () => {
    const { dir, spec } = writeSpec()
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_LABELS_LIST: JSON.stringify([[]]),
    })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/status:backlog/)
    expect(res.stderr).toMatch(/status:ready/)
    rmSync(dir, { recursive: true, force: true })
  })

  // The reminder cannot be perpetual noise: if the epic is already promoted
  // whole, there is nothing to remind anybody of. `status:` is moved by a human
  // or by /ct-next as a normal part of the flow (which is why it stays out of
  // the divergence diff, see reconcile.js), so the criterion is the REAL state
  // of the issues, not "I have just created something".
  it('every issue of the epic already promoted (status:ready) → no reminder', () => {
    const { dir, spec } = writeSpec()
    const existing = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'status:ready' }],
      body: '<!-- ct-order:1 -->',
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existing]]),
      FAKE_GH_LABELS_LIST: JSON.stringify([[]]),
    })
    expect(res.stderr).not.toMatch(/recordatorio/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a pre-existing issue still in backlog → the reminder counts it even though this run creates nothing', () => {
    const { dir, spec } = writeSpec()
    const existing = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'status:backlog' }],
      body: '<!-- ct-order:1 -->',
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existing]]),
      FAKE_GH_LABELS_LIST: JSON.stringify([[]]),
    })
    expect(res.stderr).toMatch(/recordatorio/)
    expect(res.stderr).toMatch(/status:ready/)
    rmSync(dir, { recursive: true, force: true })
  })
})
