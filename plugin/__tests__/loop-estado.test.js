import { describe, it, expect } from 'vitest'
import { construirEstado } from '../scripts/loop-estado.js'

const base = {
  enProgreso: [], mergeados: [], cerradosConStatus: [],
  worktreesEnDisco: [], ramasEnDisco: [],
  procesos: { porSlice: new Map(), comprobado: true, motivo: null },
  edadClaimMs: new Map(), ventanaArranqueMs: 15000,
}

describe('construirEstado — in flight', () => {
  it('a slice with a live process comes out alive and with its pid', () => {
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 7, nombre: 'refresh' }],
      worktreesEnDisco: ['7'], ramasEnDisco: ['feat/7'],
      procesos: { porSlice: new Map([['7', '4242']]), comprobado: true, motivo: null },
      edadClaimMs: new Map([[7, 3_600_000]]),
    })
    expect(e.enVuelo[0]).toMatchObject({ n: 7, vivo: true, pid: '4242', arrancando: false })
    expect(e.hayHallazgos).toBe(false)
  })

  it('with no process and an OLD claim: it is a finding', () => {
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 7, nombre: 'refresh' }],
      worktreesEnDisco: ['7'],
      edadClaimMs: new Map([[7, 3 * 3_600_000]]),
    })
    expect(e.enVuelo[0]).toMatchObject({ vivo: false, arrancando: false })
    expect(e.hayHallazgos).toBe(true)
  })

  it('with no process but a JUST placed claim: starting up, and NOT a finding', () => {
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 7, nombre: 'refresh' }],
      worktreesEnDisco: ['7'],
      edadClaimMs: new Map([[7, 5_000]]),
    })
    expect(e.enVuelo[0]).toMatchObject({ vivo: false, arrancando: true })
    expect(e.hayHallazgos).toBe(false)
  })

  it('with no process and an UNKNOWN claim age: nobody is accused, and it goes into sinComprobar', () => {
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 7, nombre: 'refresh' }],
      worktreesEnDisco: ['7'],
      edadClaimMs: new Map([[7, null]]),
    })
    expect(e.enVuelo[0].arrancando).toBe(false)
    expect(e.enVuelo[0].vivo).toBe(false)
    expect(e.sinComprobar.join(' ')).toMatch(/#7/)
    // An unknown age is not the same as an old claim: if it counted as a
    // finding TOO, it would come out identical to a three-hour abandoned
    // claim.
    expect(e.hayHallazgos).toBe(false)
  })

  it('unchecked processes: NOBODY comes out as dead, and the reason travels', () => {
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 7, nombre: 'refresh' }],
      worktreesEnDisco: ['7'],
      edadClaimMs: new Map([[7, 3 * 3_600_000]]),
      procesos: { porSlice: new Map(), comprobado: false, motivo: 'lsof no está' },
    })
    expect(e.enVuelo[0].vivo).toBeNull()
    expect(e.sinComprobar.join(' ')).toMatch(/lsof no está/)
    // With `vivo: null` there is no ground to accuse: if a `null` were read as
    // a `false` at any point, this would fire as a finding even though nobody
    // has checked whether the process is still alive.
    expect(e.hayHallazgos).toBe(false)
  })

  it('unchecked processes and a just placed claim: it does NOT come out as starting up (that would also be asserting something unchecked)', () => {
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 7, nombre: 'refresh' }],
      worktreesEnDisco: ['7'],
      edadClaimMs: new Map([[7, 5_000]]),
      procesos: { porSlice: new Map(), comprobado: false, motivo: 'lsof no está' },
    })
    expect(e.enVuelo[0].vivo).toBeNull()
    expect(e.enVuelo[0].arrancando).toBe(false)
  })

  it('unchecked processes and an unknown age: sinComprobar carries only the real reason, with no contradictory age message', () => {
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 7, nombre: 'refresh' }],
      worktreesEnDisco: ['7'],
      edadClaimMs: new Map([[7, null]]),
      procesos: { porSlice: new Map(), comprobado: false, motivo: 'lsof no está' },
    })
    expect(e.sinComprobar).toEqual(['lsof no está'])
  })
})

describe('construirEstado — harvest and residue', () => {
  it('a merged slice that leaves a worktree or a branch goes into the harvest', () => {
    const e = construirEstado({ ...base, mergeados: [5], worktreesEnDisco: ['5'] })
    expect(e.cosecha).toEqual([{ n: 5, hasWorktree: true, hasBranch: false }])
    expect(e.hayHallazgos).toBe(true)
  })

  it('a worktree NO issue claims comes out as an orphan', () => {
    const e = construirEstado({ ...base, worktreesEnDisco: ['9'] })
    expect(e.residuo.worktreesHuerfanos).toEqual(['9'])
    expect(e.hayHallazgos).toBe(true)
  })

  it('with no attribution possible, no worktree is an orphan — but the one on disk IS STILL on disk', () => {
    // The two questions are different: "does .worktrees/N exist?" is a disk
    // read, and "does anybody claim it?" needs the issues. Turning the second
    // one off cannot wipe the answer to the first, or the in-flight block ends
    // up denying a directory the warning next to it has just named.
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 7, nombre: 'x' }],
      worktreesEnDisco: ['7', '9'],
      sePuedeAtribuirWorktree: false,
      edadClaimMs: new Map([[7, 3 * 3600_000]]),
    })
    expect(e.residuo.worktreesHuerfanos).toEqual([])
    expect(e.enVuelo[0].hasWorktree).toBe(true)
  })

  it('the worktree of an IN-FLIGHT slice is not an orphan', () => {
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 9, nombre: 'x' }], worktreesEnDisco: ['9'],
      procesos: { porSlice: new Map([['9', '1']]), comprobado: true, motivo: null },
      edadClaimMs: new Map([[9, 1000]]),
    })
    expect(e.residuo.worktreesHuerfanos).toEqual([])
  })

  it('a merged slice that left ONLY the branch (worktree already deleted by hand) goes into the harvest too', () => {
    const e = construirEstado({ ...base, mergeados: [5], ramasEnDisco: ['feat/5'] })
    expect(e.cosecha).toEqual([{ n: 5, hasWorktree: false, hasBranch: true }])
  })

  it('the worktree of a MERGED slice comes out through the harvest and is NOT duplicated among the orphans', () => {
    const e = construirEstado({ ...base, mergeados: [5], worktreesEnDisco: ['5'] })
    expect(e.residuo.worktreesHuerfanos).toEqual([])
    expect(e.cosecha).toHaveLength(1)
  })

  it('status: labels on closed issues go into the residue', () => {
    const e = construirEstado({ ...base, cerradosConStatus: [{ n: 3, statusLabels: ['status:in-review'] }] })
    expect(e.residuo.labels).toHaveLength(1)
    expect(e.hayHallazgos).toBe(true)
  })
})

describe('construirEstado — delivered, waiting for a merge', () => {
  it('an in-review comes out in its own bucket and does NOT count as a finding', () => {
    const e = construirEstado({ ...base, enRevision: [{ n: 11, nombre: 'refresh' }] })
    expect(e.enRevision).toEqual([{ n: 11, nombre: 'refresh', hasWorktree: false, hasBranch: false }])
    // A healthy loop with open PRs used to return 3 permanently: the
    // coordinator learns to ignore the exit code and a watcher that gates on it
    // becomes useless.
    expect(e.hayHallazgos).toBe(false)
  })

  it('the worktree of an in-review is NOT an orphan: its owner is alive and waiting for a merge', () => {
    const e = construirEstado({ ...base, enRevision: [{ n: 11, nombre: 'refresh' }], worktreesEnDisco: ['11'], ramasEnDisco: ['feat/11'] })
    expect(e.residuo.worktreesHuerfanos).toEqual([])
    expect(e.enRevision[0]).toMatchObject({ hasWorktree: true, hasBranch: true })
    expect(e.hayHallazgos).toBe(false)
  })

  it('it is not confused with the harvest: an in-review and a merged slice with remains come out through different buckets, at once', () => {
    const e = construirEstado({
      ...base,
      enRevision: [{ n: 11, nombre: 'refresh' }],
      mergeados: [5],
      worktreesEnDisco: ['11', '5'],
    })
    expect(e.enRevision.map((r) => r.n)).toEqual([11])
    expect(e.cosecha.map((c) => c.n)).toEqual([5])
    expect(e.residuo.worktreesHuerfanos).toEqual([])
    // The harvest IS a finding; the in-review does not cancel it out.
    expect(e.hayHallazgos).toBe(true)
  })

  it('with no `enRevision` in the input, the bucket comes out empty and nothing else changes', () => {
    const e = construirEstado(base)
    expect(e.enRevision).toEqual([])
  })
})

describe('construirEstado — a clean loop', () => {
  it('with nothing to review: zero findings and zero unchecked reasons', () => {
    const e = construirEstado(base)
    expect(e.hayHallazgos).toBe(false)
    expect(e.sinComprobar).toEqual([])
    expect(e.enVuelo).toEqual([])
  })
})
