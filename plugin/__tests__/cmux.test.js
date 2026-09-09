import { describe, expect, it, vi } from 'vitest'
import { CmuxAnswer, CmuxWorkspaceQuery, listCmuxWorkspaces } from '../scripts/cmux.js'

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

class ACmuxThatRefuses {
  static ACCESS_DENIED = 'Error: ERROR: Access denied - only processes started inside cmux can connect'
  static NOT_JSON = '* 0: 4C3418DA-8B2E-4D4F-BBA3-69FD3EE61ED2 selected_workspace=E9835433 workspaces=3\n'

  static onItsErrorChannel() {
    return () => {
      const refusal = new Error('Command failed: cmux list-windows --json')
      refusal.stderr = `${ACmuxThatRefuses.ACCESS_DENIED}\n`
      throw refusal
    }
  }

  static withText() {
    return () => ACmuxThatRefuses.NOT_JSON
  }

  static withAnUnrecognisedSchema() {
    return (argv) => (argv[0] === 'list-windows'
      ? JSON.stringify([{ id: 'one' }])
      : JSON.stringify({ workspaces: [{ title: 'ct-plan-owner__repo-ABC-123', current_directory: '/repo/.worktrees/7' }] }))
  }

  static thatWarnsAndThenHangs() {
    return () => {
      const refusal = new Error('spawnSync cmux ETIMEDOUT')
      refusal.stderr = 'warning: reconnecting to daemon...\n'
      refusal.code = 'ETIMEDOUT'
      throw refusal
    }
  }
}

describe('CmuxWorkspaceQuery', () => {
  it('a_conclusive_answer_carries_no_reason', () => {
    const asked = CmuxWorkspaceQuery.ask({ run: () => '[]', requireComplete: true })

    expect(asked.entries).toEqual([])
    expect(asked.reason).toBe(null)
  })

  it('the_reason_a_required_window_left_the_answer_incomplete_names_that_window', () => {
    const asked = CmuxWorkspaceQuery.ask({ run: partialRun, requireComplete: true })

    expect(asked.entries).toBe(null)
    expect(asked.reason).toContain('window two')
    expect(asked.reason).toContain('window query failed')
  })

  it('the_reason_carries_what_cmux_wrote_on_its_error_channel_when_it_refused_the_connection', () => {
    const asked = CmuxWorkspaceQuery.ask({ run: ACmuxThatRefuses.onItsErrorChannel(), requireComplete: true })

    expect(asked.entries).toBe(null)
    expect(asked.reason).toContain(ACmuxThatRefuses.ACCESS_DENIED)
  })

  it('a_cmux_that_answers_text_instead_of_json_is_a_reason_and_never_an_empty_list', () => {
    const asked = CmuxWorkspaceQuery.ask({ run: ACmuxThatRefuses.withText(), requireComplete: true })

    expect(asked.entries).toBe(null)
    expect(asked.reason).toContain('* 0: 4C341')
  })

  it('the_reason_an_unrecognised_schema_gives_says_the_title_field_was_never_exposed', () => {
    const asked = CmuxWorkspaceQuery.ask({ run: ACmuxThatRefuses.withAnUnrecognisedSchema(), requireComplete: true })

    expect(asked.entries).toBe(null)
    expect(asked.reason).toContain('custom_title')
  })

  it('a_cmux_that_warned_before_hanging_says_it_hung_and_not_only_what_it_warned', () => {
    const asked = CmuxWorkspaceQuery.ask({ run: ACmuxThatRefuses.thatWarnsAndThenHangs(), requireComplete: true })

    expect(asked.reason).toContain('ETIMEDOUT')
    expect(asked.reason).toContain('warning: reconnecting to daemon...')
  })

  it('an_answer_and_a_refusal_are_told_apart_by_the_same_question_every_consumer_asks', () => {
    expect(CmuxAnswer.answered([]).wasAnswered).toBe(true)
    expect(CmuxAnswer.refused('cmux said no').wasAnswered).toBe(false)
    expect(CmuxWorkspaceQuery.ask({ run: () => '[]' }).wasAnswered).toBe(true)
    expect(CmuxWorkspaceQuery.ask({ run: ACmuxThatRefuses.withText() }).wasAnswered).toBe(false)
  })
})
