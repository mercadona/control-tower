import { describe, expect, it, vi } from 'vitest'
import { listCmuxWorkspaces } from '../scripts/cmux.js'

const WORKSPACE = {
  custom_title: 'ct-plan-owner__repo-ABC-123',
  current_directory: '/repo/.worktrees/7',
  ref: 'workspace:7',
}

function partialRun(argv) {
  if (argv[0] === 'list-windows') return JSON.stringify([{ id: 'one' }, { id: 'two' }])
  if (argv[3] === 'one') return JSON.stringify({ workspaces: [WORKSPACE] })
  throw new Error('window query failed')
}

describe('listCmuxWorkspaces', () => {
  it('keeps_partial_window_results_by_default', () => {
    expect(listCmuxWorkspaces({ run: partialRun })).toEqual([{
      title: WORKSPACE.custom_title,
      cwd: WORKSPACE.current_directory,
      cwdKnown: true,
      ref: WORKSPACE.ref,
    }])
  })

  it('returns_null_when_a_required_window_query_fails', () => {
    expect(listCmuxWorkspaces({ run: partialRun, requireComplete: true })).toBe(null)
  })

  it('returns_a_conclusive_empty_list_when_there_are_no_windows', () => {
    const run = vi.fn(() => '[]')

    expect(listCmuxWorkspaces({ run, requireComplete: true })).toEqual([])
    expect(run).toHaveBeenCalledOnce()
  })

  // El caso del arranque normal: hay una workspace de verdad, cmux expone
  // `custom_title` y su valor es `null` porque esa terminal no tiene título
  // puesto. Eso NO es un cambio de esquema: es cmux contestando que ahí no hay
  // ningún plan. Confundirlo con el rename degradaba a NO CONCLUYENTE la
  // consulta de CUALQUIER usuario con una terminal abierta y ningún plan en
  // marcha — es decir, siempre al arrancar.
  it('returns_a_conclusive_empty_list_when_a_workspace_has_no_custom_title', () => {
    const run = (argv) => (argv[0] === 'list-windows'
      ? JSON.stringify([{ id: 'one' }])
      : JSON.stringify({
        workspaces: [{
          custom_title: null, has_custom_title: false, current_directory: '/Users/me/code/repo', ref: 'workspace:1',
        }],
      }))

    expect(listCmuxWorkspaces({ run, requireComplete: true })).toEqual([])
  })

  // La otra mitad de la distinción, que el arreglo de arriba NO puede aflojar:
  // el campo AUSENTE (un rename de cmux) sigue siendo no concluyente.
  it('returns_null_when_entries_never_expose_the_title_field', () => {
    const run = (argv) => (argv[0] === 'list-windows'
      ? JSON.stringify([{ id: 'one' }])
      : JSON.stringify({ workspaces: [{ title: 'ct-plan-owner__repo-ABC-123', current_directory: '/repo/.worktrees/7' }] }))

    expect(listCmuxWorkspaces({ run, requireComplete: true })).toBe(null)
  })
})
