// THE `status:` VOCABULARY HAS TO EXIST IN GITHUB BEFORE ANYONE WRITES IT.
//
// THE REAL FAILURE, measured on a freshly bootstrapped repository
// (behavior-map-studio): after the first /ct-groom, the human step that the
// AGENTS.md contract itself orders to be run —`gh issue edit <n> --add-label
// status:ready`— failed, and if you created that label by hand the next one to
// fall was the claim (`--add-label status:in-progress`), which goes out through
// dispatch-check.mjs#setStatus and dies in `dieErr(…, 3)`: /ct-next reported
// exit 3, «fallo de infraestructura, reintenta más tarde» — advice that can
// NEVER work, because this is not a race lost but a label that does not exist.
//
// THE CAUSE: `wantedLabels` (ct-groom.mjs) comes out of the labels the issues
// CARRY, and buildLabels (groom.js) only puts one of the vocabulary:
// `status:backlog`. Nobody ever created the other three.
//
// WHY THEY CANNOT BE CREATED BY WRITING THEM: `gh issue edit --add-label`
// resolves name -> id for the GraphQL mutation `addLabelsToLabelable`, which
// takes ids and not names. Verified read-only against the API: a name that does
// not exist resolves to `null`, so the command cannot create it — it fails.
//
// DELIBERATE SCOPE: the FOUR of STATUS_LADDER (harvest.js), not seven. Nothing
// in the plugin writes `status:blocked`, `status:paused` or `status:rejected`:
// gh-issue-map.js calls them «custom labels, none of them gates anything» and
// dispatch-check.mjs documents why `status:rejected` was discarded as a design.
// Creating them would be inventing vocabulary the plugin decided not to have.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir } from './fixtures/spec-repo.js'
import { LOOP_STATUS_LABELS } from '../scripts/groom.js'
import { STATUS_LADDER } from '../scripts/harvest.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = (overrides = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...overrides })

const SPEC = '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices\n' +
  '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
  '|---|---|---|---|---|---|---|---|---|\n' +
  '| 1 | login | backend | modelo | – | – | – | `area:web` | – |\n'

describe('the status: vocabulary of the loop', () => {
  // It is DERIVED from STATUS_LADDER, not rewritten by hand: two lists of the
  // same vocabulary diverge the moment anyone touches a single one.
  it('LOOP_STATUS_LABELS is exactly STATUS_LADDER with the prefix', () => {
    expect(LOOP_STATUS_LABELS).toEqual(STATUS_LADDER.map((s) => `status:${s}`))
  })

  it('it covers the four the plugin really writes, and no more', () => {
    expect(LOOP_STATUS_LABELS).toEqual(['status:backlog', 'status:ready', 'status:in-progress', 'status:in-review'])
  })
})

describe('/ct-groom creates the status: vocabulary, not only the labels it applies', () => {
  const groom = (extra = []) => {
    const dir = makeSpecDir('ctg-vocab-')
    const spec = join(dir, 'spec.md')
    writeFileSync(spec, SPEC)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', ...extra], { encoding: 'utf8', env: fakeEnv() })
    rmSync(dir, { recursive: true, force: true })
    return res
  }

  // The symptom the user saw: groom finishes, and the labels the next step
  // needs are not there. The report of new labels is the window onto what is
  // going to be created, and it is computed the same in a dry-run as in the
  // real run.
  it('the dry-run announces the four as labels to create', () => {
    const res = groom(['--dry-run'])
    expect(res.status).toBe(0)
    for (const l of LOOP_STATUS_LABELS) {
      expect(res.stderr, `no anuncia ${l}`).toContain(l)
    }
  })

  // The ones the issue DOES carry go on being created: this fix ADDS to the
  // set, it does not replace it.
  it('it does not wipe out the labels the issue applies', () => {
    const res = groom(['--dry-run'])
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).toContain('area:web')
    expect(plan.issues[0].labels).toContain('type:backend')
    expect(res.stderr).toContain('area:web')
    expect(res.stderr).toContain('type:backend')
  })

  // The vocabulary has to EXIST, but the issue is born in backlog: creating
  // status:ready cannot mean applying it to anyone.
  it('creating the vocabulary does NOT change the status the issue is born with', () => {
    const plan = JSON.parse(groom(['--dry-run']).stdout)
    const status = plan.issues[0].labels.filter((l) => l.startsWith('status:'))
    expect(status).toEqual(['status:backlog'])
  })
})
