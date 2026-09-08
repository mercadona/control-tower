// F18/H6 — BOUNDED READS THAT WERE BEING TREATED AS COMPLETE.
//
// The pattern: a call to `gh` with a cap (`--limit N`, or a GraphQL `first: N`)
// whose result is used to decide that something DOES NOT EXIST. The plugin
// already had the lesson written down in two places —`ct-next.mjs#loadIssues`
// ("a fixed `--limit` leaves out precisely the OLD issues") and the issue
// enumeration of `ct-groom.mjs` ("it would reintroduce the same failure by
// truncation")— and unapplied in the two that were left, both on the
// `--project` path:
//
//   1. `gh project item-list --limit 200`: with more than 200 items,
//      `hasProjectItem` returns `false` for items that DO exist and /ct-groom
//      adds them again. DUPLICATES in the Project, in silence.
//   2. `fields(first: 50)`: with more than 50 fields, a project that DOES have
//      its Sprint field gets a "este project no tiene un campo de iteración
//      llamado Sprint" — a false claim about something that has not been seen.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir } from './fixtures/spec-repo.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')

const SPEC = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | – | api | db |
`

function writeSpec() {
  const dir = makeSpecDir('ctg-f18-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, SPEC)
  return { dir, spec }
}

function run(args, envOverrides = {}) {
  return spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...envOverrides },
  })
}

const MILESTONE_ENV = { FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]) }

// An issue that ALREADY exists (order 1, marker ct-order:1) so that /ct-groom
// creates nothing and only has to decide whether it is missing its project
// item.
const existing = { number: 501, title: '#1 login', milestone: { title: 'Epic' }, body: '<!-- ct-order:1 -->', labels: [{ name: 'status:backlog' }] }

// 200 filler items + the one for issue 501 at position 201: inside the
// project, but OUTSIDE the first page of `--limit 200`.
function itemsWithOursLast() {
  const filler = Array.from({ length: 200 }, (_, i) => ({ id: `PVTI_${i}`, content: { repository: 'o/r', number: 9000 + i, type: 'Issue' } }))
  return [...filler, { id: 'PVTI_ours', content: { repository: 'o/r', number: 501, type: 'Issue' } }]
}

describe('H6 — a truncated `gh project item-list` no longer produces duplicates in silence', () => {
  it('with 201 items, the item living beyond the cap IS FOUND (second query driven by totalCount) and is not re-added', () => {
    const { dir, spec } = writeSpec()
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '3'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existing]]),
      FAKE_GH_PROJECT_ITEMS: JSON.stringify(itemsWithOursLast()),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    // exit 3 = divergences detected against the spec (the fixture issue is
    // minimal on purpose); what matters here is that the run did NOT abort
    // (exit 1) and that the read of the project was complete.
    expect([0, 3]).toContain(res.status)
    const log = readFileSync(argvLog, 'utf8')
    // It was asked a second time, with the exact total GitHub gave.
    expect(log).toMatch(/project item-list 3 --owner o --limit 201 --format json/)
    // And it was NOT added to the project again: the item was already there.
    expect(log).not.toMatch(/project item-add/)
  })

  it('with no `totalCount` (a gh that does not expose it) the list is NOT taken as complete in silence', () => {
    const { dir, spec } = writeSpec()
    // The stub honours `--limit` like the real gh, so "the second query still
    // comes back short" is not simulable without a dishonest stub — that path
    // is covered by reading the code (it aborts with exit 1) and is not
    // asserted here. What IS checked is the other end of the contract.
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '3'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existing]]),
      FAKE_GH_PROJECT_ITEMS: JSON.stringify(itemsWithOursLast()),
      FAKE_GH_PROJECT_ITEMS_NO_TOTALCOUNT: '1',
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.stderr).toMatch(/no devuelve `totalCount`/)
    expect(res.stderr).toMatch(/NO se ha podido descartar que la lista de items/)
  })

  it('negative check: with few items there is no second query', () => {
    const { dir, spec } = writeSpec()
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '3'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existing]]),
      FAKE_GH_PROJECT_ITEMS: JSON.stringify([{ id: 'PVTI_ours', content: { repository: 'o/r', number: 501, type: 'Issue' } }]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect([0, 3]).toContain(res.status)
    const listCalls = readFileSync(argvLog, 'utf8').split('\n').filter((l) => l.startsWith('project item-list'))
    expect(listCalls.length).toBe(1)
    expect(listCalls[0]).toMatch(/--limit 200/)
  })
})

describe('H6 — `fields(first: 50)`: "I have not seen it" stops being said as "it does not exist"', () => {
  it('with more fields than the query brought back, it is NOT claimed that the Sprint field is missing', () => {
    const { spec } = writeSpec()
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '3'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existing]]),
      FAKE_GH_PROJECT_FIELDS: JSON.stringify([{ id: 'F1', name: 'Estado' }]),
      FAKE_GH_PROJECT_FIELDS_TOTALCOUNT: '87',
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/no se ha podido comprobar si el project/i)
    expect(res.stderr).toMatch(/1 de sus 87 campos/)
    expect(res.stderr).not.toMatch(/no tiene un campo de iteración llamado "Sprint" —/)
  })

  it('negative check: if all the fields really were seen and there is no Sprint, it is still said just as it was', () => {
    const { spec } = writeSpec()
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '3'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existing]]),
      FAKE_GH_PROJECT_FIELDS: JSON.stringify([{ id: 'F1', name: 'Estado' }]),
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/no tiene un campo de iteración llamado "Sprint"/)
  })
})

// Explicit sweep of the rest of the `gh` reads of the three executables, so
// that the criterion is pinned down and nobody has to rediscover it: every
// enumeration that decides "it does not exist" uses REAL pagination
// (`--paginate`), with no fixed cap at all.
describe('H6 — sweep: no enumeration in the plugin uses a fixed cap', () => {
  const scripts = ['ct-next.mjs', 'ct-groom.mjs', 'dispatch-check.mjs']
  it('the issue enumerations (the three executables) go with --paginate and without --limit', () => {
    for (const s of scripts) {
      const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', s), 'utf8')
      const lines = src.split('\n').filter((l) => l.includes("'issues'") && l.includes('gh(['))
      for (const l of lines) {
        expect(l, `${s}: ${l.trim()}`).toMatch(/--paginate/)
        expect(l, `${s}: ${l.trim()}`).not.toMatch(/--limit/)
      }
    }
  })
  it('the only `--limit` left (the project items) checks its own truncation', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs'), 'utf8')
    expect(src).toMatch(/item-list/)
    expect(src).toMatch(/totalCount/)
  })
})
