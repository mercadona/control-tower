import { describe, expect, it } from 'vitest'
import { PhasePrompt } from '../../src/domain/value-objects/phase-prompt.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class Phase {
  static REPOSITORY = new RepositoryName('owner/name')
  static ROOT = new CheckoutRoot('/checkout')

  static brainstorming(): PhasePrompt {
    return PhasePrompt.brainstorming({
      story: null, comment: null, repository: Phase.REPOSITORY, root: Phase.ROOT,
    })
  }

  static groom(): PhasePrompt {
    return PhasePrompt.groom({
      spec: new EpicSpec({ path: 'docs/superpowers/specs/one.md', text: '# One\n' }),
      milestone: 'One',
      repository: Phase.REPOSITORY,
      root: Phase.ROOT,
    })
  }
}

describe('what the coordinating session is told about a change to a slice', () => {
  it('reaches_it_in_both_phases_because_a_change_can_be_asked_for_in_either', () => {
    expect(Phase.brainstorming().text).toContain(PhasePrompt.CHANGE_TO_A_SLICE)
    expect(Phase.groom().text).toContain(PhasePrompt.CHANGE_TO_A_SLICE)
  })

  it('names_both_doors_and_which_answer_of_active_plans_picks_each', () => {
    expect(PhasePrompt.CHANGE_TO_A_SLICE).toContain('GET /active-plans')
    expect(PhasePrompt.CHANGE_TO_A_SLICE).toContain('acceptsChange true')
    expect(PhasePrompt.CHANGE_TO_A_SLICE).toContain('/slices/<issue>/message')
    expect(PhasePrompt.CHANGE_TO_A_SLICE).toContain('/slices/<issue>/held-change')
  })

  it('closes_the_two_behaviours_the_issue_rejected_rather_than_leaving_them_to_judgement', () => {
    expect(PhasePrompt.CHANGE_TO_A_SLICE).toContain('Do not ask them to choose')
    expect(PhasePrompt.CHANGE_TO_A_SLICE).toContain('never report a raw refusal code')
  })

  it('promises_the_person_only_what_the_store_really_gives', () => {
    expect(PhasePrompt.CHANGE_TO_A_SLICE).toContain('survives a restart')
    expect(PhasePrompt.CHANGE_TO_A_SLICE).toContain('ticket')
  })

  it('travels_as_one_line_because_that_is_how_it_reaches_the_terminal', () => {
    expect(Phase.brainstorming().oneLine()).not.toContain('\n')
    expect(Phase.groom().oneLine()).not.toContain('\n')
  })
})

describe('what the coordinating session is told about a veto that blocks a run', () => {
  it('reaches_the_coordinating_session_in_both_phases_because_a_veto_lands_in_either', () => {
    expect(Phase.brainstorming().text).toContain(PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO)
    expect(Phase.groom().text).toContain(PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO)
  })

  it('names_the_closure_the_call_and_the_three_fields_the_backend_reads', () => {
    expect(PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO).toContain('blocked-judge')
    expect(PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO).toContain('POST /slices/<issue>/another-round')
    expect(PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO).toContain('{repo, agent, instruction}')
  })

  it('keeps_the_decision_with_the_person_so_no_session_grants_a_round_nobody_asked_for', () => {
    expect(PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO).toContain('you do not invent it')
    expect(PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO).toContain('you do not grant a round nobody asked for')
  })

  it('tells_the_session_what_to_do_when_the_grant_call_itself_is_refused', () => {
    expect(PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO).toContain('tell the person what the refusal said')
    expect(PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO).toContain('do not retry it in a loop')
  })
})
