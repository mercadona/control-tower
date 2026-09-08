import { describe, it, expect } from 'vitest'
import { parseState, parseStateSafe, renderState, composeHydration, readBlocked, blockNotice, fieldReadingGuide, describeStopRelation, classifyStopState, noticeDecision, NOTICE_REPEAT_EVERY_TURNS } from '../scripts/state.js'
import { SLICE_REL_PATH } from '../scripts/state-paths.js'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SAMPLE = `---
task: "OAuth login"
status: in_progress
last_commit: abc1234
github_issue: 482
tasks:
  - {id: T001, done: true, desc: "model"}
  - {id: T007, done: false, desc: "refresh"}
---
## Current State
Login works, refresh a medias.`

describe('parseState', () => {
  it('extracts the typed frontmatter', () => {
    const { meta } = parseState(SAMPLE)
    expect(meta.status).toBe('in_progress')
    expect(meta.github_issue).toBe(482)
    expect(meta.tasks[1].done).toBe(false)
  })
  it('extracts the body in prose', () => {
    expect(parseState(SAMPLE).body).toContain('Login works')
  })
  it('with no frontmatter → an empty meta, the whole body', () => {
    const { meta, body } = parseState('solo prosa')
    expect(meta).toEqual({})
    expect(body).toBe('solo prosa')
  })
  it('tolerates a leading BOM and still extracts the frontmatter', () => {
    const withBom = '﻿' + SAMPLE
    expect(parseState(withBom).meta.status).toBe('in_progress')
  })
  it('tolerates leading blank lines', () => {
    expect(parseState('\n\n' + SAMPLE).meta.github_issue).toBe(482)
  })
})

describe('renderState', () => {
  it('a roundtrip preserves the fields', () => {
    const again = parseState(renderState(parseState(SAMPLE)))
    expect(again.meta.task).toBe('OAuth login')
    expect(again.meta.tasks[0].id).toBe('T001')
  })
})

describe('composeHydration', () => {
  it('includes the state and the commits', () => {
    const out = composeHydration('ESTADO', 'abc log')
    expect(out).toContain('ESTADO')
    expect(out).toContain('abc log')
  })
  it('with no state → an empty string (it injects no noise)', () => {
    expect(composeHydration('', 'x')).toBe('')
  })
})

// F22 — the header said "Estado del slice" ALWAYS, in the coordinator session
// too, whose `.agent/STATE.md` talks about no slice at all. Now it comes out
// of `stateRel`, which is the file the hook has just resolved.
describe('composeHydration: the header names what the file IS', () => {
  it('with the coordinator STATE.md (the default) it does NOT say "del slice"', () => {
    const out = composeHydration('ESTADO', '')
    expect(out).toContain('# Estado del repo (hidratación automática)')
    expect(out).not.toContain('Estado del slice')
  })
  it('with the SLICE.md of a dispatched worktree it does say "del slice"', () => {
    const out = composeHydration('ESTADO', '', { stateRel: SLICE_REL_PATH })
    expect(out).toContain('# Estado del slice (hidratación automática)')
  })
})

describe('parseState CRLF', () => {
  it('tolerates a frontmatter with CRLF', () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n')
    expect(parseState(crlf).meta.status).toBe('in_progress')
  })
})

describe('composeHydration with no commits', () => {
  it('omits the commits section if gitLog is empty', () => {
    const out = composeHydration('ESTADO', '')
    expect(out).toContain('ESTADO')
    expect(out).not.toContain('Últimos commits')
  })
  it('includes the section if there are commits', () => {
    expect(composeHydration('ESTADO', 'abc log')).toContain('Últimos commits')
  })
})

// ===========================================================================
// F7 — `blocked`: so that the STATE.md can say "this cannot be done" in a
// datum, and so that the hook transmits it as such.
//
// THE INCIDENT (real): `next_action: "Lanzar la corrida REAL de /ct-groom…"`.
// The run was found to be about to write false data and was left blocked, but
// the field was still there and the SessionStart hook injects it into EVERY
// new session of the repo — any of them would have executed it. The mitigation
// was to rewrite the field with the word "BLOQUEADO" in prose: exactly what
// these tests exist so as never to need again.
// ===========================================================================
const STATE_BLOCKED = `---
task: "Plan vs Propuestas"
status: in_progress
next_action: "Lanzar la corrida REAL de /ct-groom sobre el spec"
blocked:
  reason: "la corrida escribiría datos falsos (el spec cita issues que no existen)"
  since: "2026-07-25"
  unblock: "corregir la §9 del spec para que no invente números de issue, y revalidarla"
verify: "\`gh issue list --milestone 'Plan vs Propuestas'\` devuelve 6 issues"
---
## Current State
Groom preparado, sin ejecutar.`

describe('readBlocked', () => {
  it('a map with reason/since/unblock → blocked, with the three fields', () => {
    const b = readBlocked(parseState(STATE_BLOCKED).meta)
    expect(b.state).toBe('blocked')
    expect(b.reason).toMatch(/datos falsos/)
    expect(b.since).toBe('2026-07-25')
    expect(b.unblock).toMatch(/corregir la §9/)
  })

  it('an absent field → NOT blocked (every STATE.md older than this one is)', () => {
    expect(readBlocked(parseState(SAMPLE).meta).state).toBe('none')
  })

  it('null / false / an empty string → NOT blocked', () => {
    for (const v of [null, false, '', '   ']) {
      expect(readBlocked({ blocked: v }).state).toBe('none')
    }
  })

  // YAML 1.2 parses `blocked: no` as the STRING "no", not as false: a naive
  // truthy-check would read it as a block with the reason "no".
  it('words a human writes meaning "not blocked" (no/none/-/n/a) → NOT blocked', () => {
    for (const v of ['no', 'No', 'FALSE', 'none', 'ninguno', 'nada', 'n/a', '-', '–', '--']) {
      expect(readBlocked({ blocked: v }).state, `blocked: ${v}`).toBe('none')
    }
  })

  // The symmetric one, and the one that matters: the comparison is of the
  // WHOLE string, never by prefix. A real reason that BEGINS with "no" is a
  // block.
  it('a reason that begins with "no" is still a block (it is not compared by prefix)', () => {
    const b = readBlocked({ blocked: 'no se puede hasta que Legal responda' })
    expect(b.state).toBe('blocked')
    expect(b.reason).toBe('no se puede hasta que Legal responda')
  })

  it('a bare string → blocked, and the string is preserved as the reason', () => {
    expect(readBlocked({ blocked: 'la API de pagos está caída' })).toMatchObject({ state: 'blocked', reason: 'la API de pagos está caída' })
  })

  it('blocked: true → blocked WITH NO reason (and that is told apart from having one)', () => {
    expect(readBlocked({ blocked: true })).toMatchObject({ state: 'blocked', reason: '' })
  })

  // Narrowing what is accepted creates a new category of the rejected:
  // somebody who writes `razon:` in Spanish would have a STATE.md that states
  // the reason and a warning that says "no consta". That category has to have
  // a voice, and it cannot lose the content.
  it('a map with unrecognised keys → blocked, and it announces them WITH their content', () => {
    const b = readBlocked({ blocked: { razon: 'datos falsos', motivo: 'x' } })
    expect(b.state).toBe('blocked')
    expect(b.notes.join(' ')).toMatch(/razon/)
    expect(b.notes.join(' ')).toMatch(/datos falsos/) // the content is not swallowed
    expect(b.notes.join(' ')).toMatch(/`reason`/) // and it says which is the right key
  })

  it('an unrecognised shape (a list) → blocked for safety, saying that it is not recognised', () => {
    const b = readBlocked({ blocked: ['a', 'b'] })
    expect(b.state).toBe('blocked')
    expect(b.notes.join(' ')).toMatch(/no se reconoce/i)
    expect(b.notes.join(' ')).toMatch(/\["a","b"\]/)
  })

  // Putting the block in a field of its own (and not in `status`) creates a
  // new category of the rejected: whoever wants to block and writes the first
  // thing that sounds reasonable, `status: blocked`. Swallowing it in silence
  // would be a block written in good faith that blocks nothing — worse than
  // the original failure.
  it('`status: blocked` with no `blocked` field → BLOCKED all the same, saying which is the right field', () => {
    const b = readBlocked({ status: 'blocked', next_action: 'seguir' })
    expect(b.state).toBe('blocked')
    expect(b.notes.join(' ')).toMatch(/`blocked: \{reason:/) // it says the right field AND its shape
    expect(b.notes.join(' ')).toMatch(/PROGRESO/)
  })

  it('variants of "stopped" in `status` (bloqueado, on_hold…) too', () => {
    for (const s of ['bloqueado', 'BLOCKED', 'on_hold', 'on-hold', 'parado']) {
      expect(readBlocked({ status: s }).state, `status: ${s}`).toBe('blocked')
    }
  })

  it('control: the normal `status` values block NOTHING', () => {
    for (const s of ['not_started', 'in_progress', 'in_review', 'done', '']) {
      expect(readBlocked({ status: s }).state, `status: ${s}`).toBe('none')
    }
  })

  it('`status: blocked` + `blocked: null` (a contradiction) → BLOCKED for safety, and it is said to be a contradiction', () => {
    const b = readBlocked({ status: 'blocked', blocked: null })
    expect(b.state).toBe('blocked')
    expect(b.notes.join(' ')).toMatch(/contradicción/i)
  })

  it('`blocked` with a reason rules over `status` (neither the reason is lost nor the warning duplicated)', () => {
    const b = readBlocked({ status: 'blocked', blocked: { reason: 'la API está caída' } })
    expect(b.reason).toBe('la API está caída')
    expect(b.notes).toEqual([])
  })

  it('a frontmatter that is not a map → "it is not known", never "not blocked"', () => {
    expect(readBlocked('solo texto').state).toBe('unreadable')
    expect(readBlocked(['a']).state).toBe('unreadable')
    expect(readBlocked(null).state).toBe('unreadable')
  })
})

describe('parseStateSafe', () => {
  it('a broken YAML frontmatter → the error as a datum, without throwing', () => {
    const broken = '---\ntask: "sin cerrar\n  ]: [\n---\ncuerpo'
    expect(() => parseState(broken)).toThrow() // control: the strict parser DOES throw
    const r = parseStateSafe(broken)
    expect(r.error).toBeTruthy()
    expect(r.meta).toEqual({})
  })
  it('a good frontmatter → error null and the same meta as parseState', () => {
    const r = parseStateSafe(SAMPLE)
    expect(r.error).toBe(null)
    expect(r.meta.status).toBe('in_progress')
  })
})

describe('composeHydration with BLOCKED work', () => {
  const out = composeHydration(STATE_BLOCKED, 'abc log')

  it('the blocking warning goes FIRST, before the state (it is read from the top down)', () => {
    expect(out.split('\n')[0]).toMatch(/TRABAJO BLOQUEADO/) // la PRIMERA línea
    // The header is the main checkout's (`composeHydration` with no
    // `stateRel` = `.agent/STATE.md`): "del repo", not "del slice" — F22.
    expect(out.indexOf('TRABAJO BLOQUEADO')).toBeLessThan(out.indexOf('# Estado del repo'))
  })

  it('declares the next_action SUSPENDED and quotes it, so that it is not read as a standing order', () => {
    expect(out).toMatch(/SUSPENDIDO/)
    expect(out).toMatch(/Lanzar la corrida REAL/)
    expect(out).toMatch(/No lo ejecutes/i)
  })

  it('says the reason and what it would take to unblock', () => {
    expect(out).toMatch(/datos falsos/)
    expect(out).toMatch(/corregir la §9/)
    expect(out).toMatch(/2026-07-25/)
  })

  it('says how the block is lifted, and that the session itself must not lift it', () => {
    expect(out).toMatch(/borra el campo `blocked`/)
    expect(out).toMatch(/no lo levantes por tu cuenta/i)
  })

  it('goes on injecting the whole state and the commits (no context is lost)', () => {
    expect(out).toContain('Groom preparado, sin ejecutar.')
    expect(out).toContain('Últimos commits')
  })

  it('blocked with neither reason nor unblock → it says so as NO CONSTA, without inventing them', () => {
    const o = composeHydration('---\nnext_action: "x"\nblocked: true\n---\ncuerpo', '')
    expect(o).toMatch(/Motivo: NO CONSTA/)
    expect(o).toMatch(/Para desbloquear: NO CONSTA/)
  })

  it('a mile-long next_action is trimmed in the warning (but stays whole in the state)', () => {
    const longText = 'x'.repeat(900)
    const o = composeHydration(`---\nnext_action: "${longText}"\nblocked: "porque sí"\n---\ncuerpo`, '')
    const warning = o.slice(0, o.indexOf('# Estado del repo'))
    expect(warning).toContain('…')
    expect(warning.length).toBeLessThan(2000)
    expect(o).toContain(longText) // the text in full is still there, further down
  })
})

describe('composeHydration with no block (backwards compatibility)', () => {
  it('a STATE.md with no `blocked` field fires no blocking warning at all', () => {
    const out = composeHydration(SAMPLE, 'abc log')
    expect(out).not.toMatch(/TRABAJO BLOQUEADO/)
    expect(out).not.toMatch(/SUSPENDIDO/)
    expect(out.startsWith('# Estado del repo')).toBe(true)
  })
  it('`blocked: null` (what ct-next seeds) does not either', () => {
    expect(composeHydration('---\ntask: "x"\nblocked: null\n---\ncuerpo', '')).not.toMatch(/TRABAJO BLOQUEADO/)
  })
})

describe('composeHydration with an unreadable STATE.md', () => {
  const out = composeHydration('---\ntask: "sin cerrar\n  ]: [\n---\ncuerpo', '')

  it('does not blow up and warns that IT CANNOT BE KNOWN whether it is blocked', () => {
    expect(out).toMatch(/NO SE PUDO LEER/)
    expect(out).toMatch(/no se puede saber si el trabajo está BLOQUEADO/i)
    expect(out).toMatch(/posiblemente bloqueado/i)
  })
  it('goes on injecting the raw text of the state (it is the only thing left)', () => {
    expect(out).toContain('cuerpo')
  })
})

// The second symptom of the same hole: `verify` said «`gh issue list …`
// devuelve 6 issues» when there was neither a milestone nor any issues. It was
// written as the check FOR AFTERWARDS, but read cold it is indistinguishable
// from the assertion of a fact.
describe('fieldReadingGuide — a checked fact vs. a pending check', () => {
  it('with a non-empty `verify`, it says that it is PENDING and not a fact', () => {
    const g = fieldReadingGuide({ verify: '`gh issue list …` devuelve 6 issues' })
    expect(g).toMatch(/PENDIENTE/)
    expect(g).toMatch(/no un hecho ya comprobado/i)
  })
  it('with a non-empty `next_action`, it warns that it may have gone stale', () => {
    expect(fieldReadingGuide({ next_action: 'seguir por el AC-2' })).toMatch(/caducad/i)
  })
  it('empty fields → no guide at all (a guide that always comes out is noise)', () => {
    expect(fieldReadingGuide({ verify: '', next_action: '' })).toBe('')
    expect(fieldReadingGuide({})).toBe('')
  })
  it('blocked → it does not repeat the next_action tag line (the blocking warning already says more)', () => {
    const g = fieldReadingGuide({ next_action: 'x', verify: 'y' }, { blocked: true })
    expect(g).toMatch(/`verify`/)
    expect(g).not.toMatch(/`next_action`/)
  })
  it('the guide reaches the hydration of a normal STATE.md', () => {
    const out = composeHydration('---\nverify: "el test T7 pasa"\nnext_action: "seguir"\n---\ncuerpo', '')
    expect(out).toMatch(/Cómo leer estos campos/)
    expect(out).toMatch(/PENDIENTE/)
  })
})

describe('blockNotice', () => {
  it('with no block → an empty string', () => {
    expect(blockNotice({ state: 'none' })).toBe('')
    expect(blockNotice(null)).toBe('')
  })
  it('with no next_action to suspend, it does not invent one', () => {
    const n = blockNotice({ state: 'blocked', reason: 'r' }, { nextAction: '' })
    expect(n).toMatch(/no dice nada/)
    expect(n).not.toMatch(/SUSPENDIDO/)
  })
})

// F12: `shouldBlockStop` compared the two SHAs by equality and whoever used
// it claimed «hay commits más nuevos» — an ancestry equality does not check.
// It is replaced by `describeStopRelation` (which asks git) and
// `classifyStopState` (which decides and writes).
const HEAD = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

// A fake runner: `plan` maps each query to its answer, so that every branch
// can be tested without setting up a repo. Keys: `rev-parse`, `rev-list`,
// `merge-base`, `is-ancestor:<a>:<b>`, `branch` (local branches) and
// `branch-r` (remote ones). The integration tests against real git are in
// __tests__/stop.test.js.
function fakeGit(plan, log) {
  return (args) => {
    log?.push(args)
    const key = args[0] === 'merge-base' && args[1] === '--is-ancestor'
      ? `is-ancestor:${args[2]}:${args[3]}`
      : args[0] === 'branch' && args[1] === '-r' ? 'branch-r' : args[0]
    const v = plan[key]
    if (v === undefined) return { status: 1, stdout: '' }
    return typeof v === 'number' ? { status: v, stdout: '' } : { status: 0, stdout: v }
  }
}

describe('describeStopRelation', () => {
  const rel = (lastCommit, plan, branch = 'main') =>
    describeStopRelation({ headSha: HEAD, lastCommit, git: fakeGit(plan), branch })

  it('with no last_commit → unset', () => {
    expect(rel(null, {}).kind).toBe('unset')
    expect(rel('', {}).kind).toBe('unset')
    expect(rel('   ', {}).kind).toBe('unset')
  })
  it('a value git does not resolve → unresolvable (and no SHA is invented)', () => {
    const r = rel('sha_viejo', { 'rev-parse': 1 })
    expect(r.kind).toBe('unresolvable')
    expect(r.stateSha).toBe('')
    expect(r.raw).toBe('sha_viejo')
  })
  it('a value that looks like a git option does not even reach git', () => {
    let called = false
    const r = describeStopRelation({
      headSha: HEAD, lastCommit: '--output=pwned', branch: 'main',
      git: () => { called = true; return { status: 0, stdout: HEAD } },
    })
    expect(r.kind).toBe('unresolvable')
    expect(called).toBe(false)
  })
  it('the same commit → same', () => {
    expect(rel(HEAD, { 'rev-parse': HEAD }).kind).toBe('same')
  })
  it('an ancestor of HEAD → behind, with the number of commits counted by git', () => {
    const r = rel(OTHER, { 'rev-parse': OTHER, [`is-ancestor:${OTHER}:${HEAD}`]: 0, 'rev-list': '3\n' })
    expect(r.kind).toBe('behind')
    expect(r.count).toBe(3)
  })
  it('HEAD is an ancestor of the state → ahead', () => {
    const r = rel(OTHER, {
      'rev-parse': OTHER,
      [`is-ancestor:${OTHER}:${HEAD}`]: 1,
      [`is-ancestor:${HEAD}:${OTHER}`]: 0,
      branch: 'otra\nmain\n',
    })
    expect(r.kind).toBe('ahead')
    expect(r.containers).toEqual(['otra'])
  })
  it('no ancestry in either direction → diverged, with a merge-base and the branch that contains it', () => {
    const r = rel(OTHER, {
      'rev-parse': OTHER,
      [`is-ancestor:${OTHER}:${HEAD}`]: 1,
      [`is-ancestor:${HEAD}:${OTHER}`]: 1,
      branch: 'polish-v2-geometria\n',
      'merge-base': 'c'.repeat(40),
    })
    expect(r.kind).toBe('diverged')
    expect(r.containers).toEqual(['polish-v2-geometria'])
    expect(r.mergeBase).toBe('c'.repeat(40))
  })
  // Local preferred over remote: `origin/*` is noise when there is already a
  // local branch that answers, and the only possible answer when there is
  // not.
  const notAncestor = { 'rev-parse': OTHER, [`is-ancestor:${OTHER}:${HEAD}`]: 1, [`is-ancestor:${HEAD}:${OTHER}`]: 1, 'merge-base': 'c'.repeat(40) }

  it('with a local branch that contains it, the remote ones are not even asked about', () => {
    const log = []
    const r = describeStopRelation({ headSha: HEAD, lastCommit: OTHER, branch: 'main', git: fakeGit({ ...notAncestor, branch: 'local-viva\n', 'branch-r': 'origin/local-viva\n' }, log) })
    expect(r.containers).toEqual(['local-viva'])
    expect(log.some((a) => a[0] === 'branch' && a[1] === '-r')).toBe(false)
  })
  it('with no local branch, it falls back to the remote ones and names origin/…', () => {
    const r = rel(OTHER, { ...notAncestor, branch: '', 'branch-r': 'origin/polish-v2\norigin/HEAD\n' })
    expect(r.kind).toBe('diverged')
    expect(r.containers).toEqual(['origin/polish-v2'])
    expect(r.containersKnown).toBe(true)
  })
  it('neither local nor remote contains it → orphan (whether it comes from ahead or from diverged)', () => {
    const fromDiverged = rel(OTHER, { ...notAncestor, branch: '', 'branch-r': '' })
    expect(fromDiverged.kind).toBe('orphan')
    expect(fromDiverged.fromKind).toBe('diverged')
    const fromAhead = rel(OTHER, { 'rev-parse': OTHER, [`is-ancestor:${OTHER}:${HEAD}`]: 1, [`is-ancestor:${HEAD}:${OTHER}`]: 0, branch: '', 'branch-r': '' })
    expect(fromAhead.kind).toBe('orphan')
    expect(fromAhead.fromKind).toBe('ahead')
  })
  // "git has not answered" is not "no branch contains it": declaring a commit
  // orphaned because `git branch` failed would be inventing the answer.
  it('if git fails while listing branches it is NOT declared orphaned', () => {
    const r = rel(OTHER, { ...notAncestor, branch: -1 })
    expect(r.kind).toBe('diverged')
    expect(r.containersKnown).toBe(false)
    expect(r.containers).toEqual([])
  })
  it('git fails to answer about ancestry (a code != 0/1) → unknown, nothing is assumed', () => {
    const r = rel(OTHER, { 'rev-parse': OTHER, [`is-ancestor:${OTHER}:${HEAD}`]: -1 })
    expect(r.kind).toBe('unknown')
  })
})

describe('classifyStopState', () => {
  const verdict = (kind, extra = {}) =>
    classifyStopState({ relation: { kind, headSha: HEAD, stateSha: OTHER, branch: 'main', count: 0, containers: [], raw: '', ...extra }, stopHookActive: false })

  it('behind blocks and says how many commits there are, because it has counted them', () => {
    const v = verdict('behind', { count: 2 })
    expect(v.block).toBe(true)
    expect(v.reason).toMatch(/2 commits/)
    expect(v.reason).toMatch(/`blocked`/)
  })
  it('behind with a single commit does not say "1 commits"', () => {
    // F15/H4: the count is now of WORK commits (the ones that only touch
    // .agent/STATE.md do not count), and the text says so.
    expect(verdict('behind', { count: 1 }).reason).toMatch(/hay 1 commit de trabajo en/)
  })
  it('behind with entries in between names them separately, so that the count squares with git log', () => {
    const v = verdict('behind', { count: 1, bookkeeping: 2 })
    expect(v.reason).toMatch(/1 commit de trabajo/)
    expect(v.reason).toMatch(/2 commits que solo tocan/)
  })
  it('behind-bookkeeping neither blocks nor warns: it is the normal state of a registered turn', () => {
    const v = verdict('behind-bookkeeping', { count: 0, bookkeeping: 1 })
    expect(v.block).toBe(false)
    expect(v.systemMessage).toBe('')
    expect(v.kind).toBe('behind-bookkeeping')
  })
  it('unresolvable blocks, quotes the value and does NOT claim that it is older', () => {
    const v = verdict('unresolvable', { raw: 'sha_viejo', stateSha: '' })
    expect(v.block).toBe(true)
    expect(v.reason).toMatch(/sha_viejo/)
    expect(v.reason).not.toMatch(/más nuevos|más viejo/)
    expect(v.reason).toMatch(/`blocked`/)
  })
  it('same and unset say nothing', () => {
    for (const k of ['same', 'unset']) {
      expect(verdict(k)).toMatchObject({ block: false, reason: '', systemMessage: '' })
    }
  })
  it('ahead does not block but warns, and advises against repointing last_commit', () => {
    const v = verdict('ahead', { containers: ['adelantada'] })
    expect(v.block).toBe(false)
    expect(v.systemMessage).toMatch(/descendant of HEAD/)
    expect(v.systemMessage).toMatch(/backwards/)
  })
  it('diverged does not block, explains why, and names the way out (one STATE.md per worktree)', () => {
    const v = verdict('diverged', { containers: ['polish-v2-geometria'], mergeBase: 'c'.repeat(40) })
    expect(v.block).toBe(false)
    expect(v.systemMessage).toMatch(/diverging/)
    expect(v.systemMessage).toMatch(/polish-v2-geometria/)
    expect(v.systemMessage).toMatch(/ct-next/)
    expect(v.systemMessage).not.toMatch(/más nuevos/)
  })
  // The warnings come out on EVERY turn for as long as the anomaly lasts.
  // That insistence is deliberate, and the price is paid in brevity: if they
  // put on weight again, this goes red.
  it('the warnings that repeat every turn stay short', () => {
    expect(verdict('diverged', { containers: ['polish-v2-geometria'], mergeBase: 'c'.repeat(40) }).systemMessage.length).toBeLessThan(340)
    expect(verdict('ahead', { containers: ['adelantada'] }).systemMessage.length).toBeLessThan(280)
    expect(verdict('orphan').systemMessage.length).toBeLessThan(340)
  })
  it('with no known branch at all (git kept quiet) the sentence is not left lame', () => {
    const v = verdict('diverged', { containers: [], containersKnown: false, mergeBase: 'c'.repeat(40) })
    expect(v.systemMessage).toMatch(/is not in the history of the branch `main`/)
    expect(v.systemMessage).not.toMatch(/lives in ,|lives in :/)
    expect(verdict('ahead', { containers: [] }).systemMessage).not.toMatch(/lives in /)
  })
  // A `last_commit` that reaches no ref is not "the state is ahead": it is
  // the state pointing at work that stopped existing.
  it('orphan does not block (a block does not resurrect a commit) and is not confused with ahead', () => {
    const v = verdict('orphan', { fromKind: 'ahead' })
    expect(v.block).toBe(false)
    expect(v.systemMessage).toMatch(/orphaned/)
    expect(v.systemMessage).toMatch(/neither local nor remote/)
    expect(v.systemMessage).toMatch(/git gc/)
    expect(v.systemMessage).not.toMatch(/is ahead of|backwards|diverging/)
  })
  it('unknown does not block and admits that it does not know', () => {
    const v = verdict('unknown')
    expect(v.block).toBe(false)
    expect(v.systemMessage).toMatch(/could not determine/)
  })
  it('anti-loop: with stop_hook_active it neither blocks NOR warns, whatever the case', () => {
    for (const kind of ['behind', 'unresolvable', 'diverged', 'ahead', 'orphan', 'unknown']) {
      const v = classifyStopState({ relation: { kind, headSha: HEAD, stateSha: OTHER, count: 9 }, stopHookActive: true })
      expect(v).toMatchObject({ block: false, reason: '', systemMessage: '' })
    }
  })
  it('a detached HEAD: it does not invent a branch', () => {
    const v = verdict('behind', { count: 1, branch: '' })
    expect(v.reason).toMatch(/detached/)
    expect(v.reason).not.toMatch(/branch `/)
  })
})

// ===========================================================================
// #95/H10 — the hydration injected the WHOLE frontmatter, comments included:
// some 1,200 B of `#` from the template that the model paid for on every
// startup|resume|clear|compact without being told anything `fieldReadingGuide`
// does not already say when it applies.
// ===========================================================================
describe('composeHydration: the frontmatter comments do not travel', () => {
  const WITH_COMMENTS = [
    '---',
    'task: "X"',
    '# role: quién eres en el loop. Hay DOS sesiones vivas por repo',
    '#   - Este fichero es el del CHECKOUT PRINCIPAL',
    'role: "coordinador"',
    'verify: "grep \'#\' fichero devuelve 3 líneas"',
    '---',
    '## Current State',
    '# esto es un encabezado del cuerpo, no un comentario',
    'voy por T7',
  ].join('\n')

  it('the lines that begin with # inside the frontmatter disappear', () => {
    const out = composeHydration(WITH_COMMENTS, '')
    expect(out).not.toContain('quién eres en el loop')
    expect(out).not.toContain('CHECKOUT PRINCIPAL')
  })
  it('the frontmatter fields and the body stay whole, including a # inside a value and a heading of the body', () => {
    const out = composeHydration(WITH_COMMENTS, '')
    expect(out).toContain('task: "X"')
    expect(out).toContain('role: "coordinador"')
    expect(out).toContain('verify: "grep \'#\' fichero devuelve 3 líneas"')
    expect(out).toContain('# esto es un encabezado del cuerpo, no un comentario')
    expect(out).toContain('voy por T7')
  })
  it('the empty template hydrates in less than 1,000 bytes', () => {
    const tpl = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'state-template', 'STATE.template.md'), 'utf8')
    expect(Buffer.byteLength(tpl, 'utf8')).toBeGreaterThan(1000)
    expect(Buffer.byteLength(composeHydration(tpl, ''), 'utf8')).toBeLessThan(1000)
  })
})

// ===========================================================================
// #95/H8 — the non-blocking warning came out on EVERY turn for as long as the
// anomaly lasted. The insistence was deliberate, but the project itself
// already has in writing the sentence that dismantles it: «a warning that
// always comes out is a warning nobody reads» (`blocked`'s header, in this
// very module).
// ===========================================================================
describe('noticeDecision: the warning comes out the first time, when it changes, and every N turns', () => {
  const rel = { kind: 'ahead', stateSha: OTHER }

  it('the first turn of the anomaly always warns', () => {
    expect(noticeDecision({ relation: rel, previous: null }).emit).toBe(true)
  })

  it('the following turns keep quiet until the period is up', () => {
    let previous = null
    const emitted = []
    for (let turn = 1; turn <= 5; turn++) {
      const d = noticeDecision({ relation: rel, previous })
      if (d.emit) emitted.push(turn)
      previous = d.next
    }
    expect(emitted).toEqual([1])
  })

  it('after N turns it comes out again, and the period starts over', () => {
    let previous = null
    const emitted = []
    for (let turn = 1; turn <= NOTICE_REPEAT_EVERY_TURNS * 2; turn++) {
      const d = noticeDecision({ relation: rel, previous })
      if (d.emit) emitted.push(turn)
      previous = d.next
    }
    expect(emitted).toEqual([1, NOTICE_REPEAT_EVERY_TURNS + 1])
  })

  it('changing relation warns even if the period is not up: it is another anomaly', () => {
    const first = noticeDecision({ relation: rel, previous: null })
    const second = noticeDecision({ relation: { kind: 'diverged', stateSha: OTHER }, previous: first.next })
    expect(second.emit).toBe(true)
  })

  it('the same kind pointing at ANOTHER commit is another anomaly too', () => {
    const first = noticeDecision({ relation: rel, previous: null })
    const second = noticeDecision({ relation: { kind: 'ahead', stateSha: HEAD }, previous: first.next })
    expect(second.emit).toBe(true)
  })

  it('a marker that is unreadable or of another shape silences nothing: it warns', () => {
    for (const previous of ['no es json', 42, {}, { kind: 'ahead' }]) {
      expect(noticeDecision({ relation: rel, previous }).emit).toBe(true)
    }
  })
})
