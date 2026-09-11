import { describe, it, expect } from 'vitest'
import { SLICE_REL_PATH } from '../../../plugin/scripts/state-paths.js'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PluginYardstick } from '../../../plugin/scripts/plugin-yardstick.js'
import { PlanIssueBody } from '../../src/infrastructure/gh-plan-issues.ts'

describe('PlanAgentBrief', () => {
  const errand = () => new PlanAgentBrief({
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    conventions: '/plugin/conventions',
    ctStep: '/plugin/scripts/ct-step.mjs',
  }).errandFor({
    issue: new PlanIssue({ number: 42, url: 'https://github.com/owner/name/issues/42' }),
    repository: new RepositoryName('owner/name'),
  })

  it('it_points_at_the_baseline_already_measured_in_the_state_file_instead_of_ordering_one', () => {
    expect(errand()).toMatch(/baseline/)
    expect(errand()).toContain(`\`baseline:\` field of ${SLICE_REL_PATH}`)
  })

  it('the_published_plan_ends_with_the_line_that_says_how_to_ask_it_for_changes', () => {
    expect(errand()).toContain(PlanIssueBody.CHANGES_LINE)
  })

  it('it_no_longer_orders_the_ground_checked_because_the_program_cut_and_measured_the_worktree_itself', () => {
    expect(errand()).not.toMatch(/pwd/)
    expect(errand()).not.toMatch(/green baseline BEFORE/)
  })

  it('it_names_the_skill_that_writes_the_plan_instead_of_describing_the_shape_of_one', () => {
    expect(errand()).toContain('control-tower-loop:writing-plans-prescriptive')
  })

  it('it_interpolates_the_absolute_path_of_dispatch_check_because_the_plugin_token_stays_literal_in_plain_text', () => {
    expect(errand()).toContain('node /plugin/scripts/dispatch-check.mjs 42 --repo owner/name --check-plan')
    expect(errand()).not.toContain('CLAUDE_PLUGIN_ROOT')
  })

  it('it_says_where_the_plan_file_goes_so_the_contract_can_find_it_by_name', () => {
    expect(errand()).toContain('docs/superpowers/plans/YYYY-MM-DD-issue-42-<slug>.md')
  })

  it('it_orders_the_plan_published_on_the_issue_because_that_is_where_a_human_reads_it_to_ask_for_changes', () => {
    expect(errand()).toContain('gh issue comment 42 --repo owner/name')
    expect(errand()).toMatch(/publ/i)
  })

  it('it_orders_the_session_to_stop_after_committing_instead_of_starting_the_work', () => {
    expect(errand()).toMatch(/STOP/)
    expect(errand()).toMatch(/do not implement/i)
  })

  it('it_carries_the_order_of_precedence_verbatim_from_the_plugin_instead_of_wording_it_again', () => {
    expect(errand()).toContain('/plugin/conventions')
    expect(errand()).toContain(PluginYardstick.precedenceHeader())
  })

  it('the_precedence_it_carries_cannot_be_read_the_other_way_round', () => {
    expect(errand()).not.toMatch(/convenciones de este repo tienen PREFERENCIA/)
    expect(errand()).not.toMatch(/las convenciones de este repo ganan/i)
  })

  it('it_does_not_override_the_scope_the_architecture_document_declares_for_itself', () => {
    expect(errand()).not.toMatch(/the architecture yardstick ALWAYS applies/)
    expect(errand()).not.toMatch(/the only yardstick rule this errand changes/i)
  })

  it('it_gives_the_planner_every_canonical_document_before_asking_for_the_plan', () => {
    const composed = errand()
    for (const file of PluginYardstick.FILES) {
      const path = `/plugin/conventions/${file}`
      expect(composed).toContain(path)
      expect(composed.indexOf(path)).toBeLessThan(composed.indexOf('control-tower-loop:writing-plans-prescriptive'))
    }
  })

  it('it_names_the_sections_that_carry_what_the_acceptance_criteria_cannot', () => {
    expect(errand()).toContain('Contexto del epic')
    expect(errand()).toContain('Contexto heredado')
    expect(errand()).toMatch(/do not look outside the issue/)
  })

  it('it_does_not_send_the_agent_to_a_section_the_body_never_writes', () => {
    expect(errand()).not.toMatch(/decisiones congeladas/i)
  })

  it('it_never_promises_a_permission_nobody_mints', () => {
    expect(errand()).not.toContain('-OK')
    expect(errand()).not.toContain('nonce')
  })

  it('it_sends_the_agent_to_the_section_where_a_person_wrote_by_hand_what_they_want_planned', () => {
    expect(errand()).toContain('Comentario de quien pide el plan')
    expect(errand()).toContain('plan input')
  })

  it('it_says_the_criteria_are_the_agents_to_propose_when_the_issue_declares_none_instead_of_leaving_it_stuck', () => {
    expect(errand()).toContain('there is no separate spec to supply them')
  })
})

describe('PlanAgentBrief resuming the agent', () => {
  const errand = () => new PlanAgentBrief({
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    conventions: '/plugin/conventions',
    ctStep: '/plugin/scripts/ct-step.mjs',
  }).implementationErrandFor({ issueNumber: 42, repository: new RepositoryName('owner/name') })

  it('it_is_one_single_line_because_a_newline_would_run_the_order_half_written', () => {
    expect(errand()).not.toContain('\n')
  })

  it('it_hands_the_driving_to_ct_step_by_absolute_path_instead_of_describing_the_sequence', () => {
    expect(errand()).toContain('node /plugin/scripts/ct-step.mjs next --plan')
    expect(errand()).toContain('--issue 42')
    expect(errand()).not.toContain('CLAUDE_PLUGIN_ROOT')
  })

  it('it_translates_ct_step_to_node_by_absolute_path_because_ct_step_is_not_a_command', () => {
    expect(errand()).toContain('where it says `ct-step`, use `node /plugin/scripts/ct-step.mjs`')
  })

  it('it_orders_rewriting_slice_md_role_task_and_next_action_before_asking_for_the_first_step', () => {
    const composed = errand()
    expect(composed).toContain('.agent/SLICE.md')
    expect(composed).toContain('role, task and next_action')
    expect(composed.indexOf('.agent/SLICE.md')).toBeLessThan(composed.indexOf('Ask for the step'))
  })

  it('it_orders_the_release_that_moves_the_issue_to_review_instead_of_forbidding_it', () => {
    expect(errand()).toContain(
      'node /plugin/scripts/dispatch-check.mjs 42 --repo owner/name --release'
    )
    expect(errand()).not.toMatch(/do not execute/i)
    expect(errand()).not.toContain('would exit 9')
  })

  it('the_release_it_orders_waives_the_merge_watcher_because_this_flow_has_no_coordinator_to_notify', () => {
    expect(errand()).toContain('--release --no-watch-merge')
  })

  it('it_still_stops_before_the_merge_because_that_is_the_second_human_decision', () => {
    expect(errand()).toMatch(/do not merge/i)
    expect(errand()).toMatch(/STOP/)
  })
})

describe('PlanAgentBrief asking the agent for changes', () => {
  const CHANGES = 'add the case\nfor an issue without\ta description'
  const errand = (changes = CHANGES) => new PlanAgentBrief({
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    conventions: '/plugin/conventions',
    ctStep: '/plugin/scripts/ct-step.mjs',
  }).reviewErrandFor({ issueNumber: 42, repository: new RepositoryName('owner/name'), changes })

  it('the_reworked_plan_ends_with_that_line_too_because_it_can_be_reviewed_again', () => {
    expect(errand()).toContain(PlanIssueBody.CHANGES_LINE)
  })

  it('the_errand_is_one_line_even_when_the_person_wrote_the_change_across_several', () => {
    expect(errand()).not.toContain('\n')
    expect(errand()).not.toContain('\t')
    expect(errand()).toContain('add the case for an issue without a description')
  })

  it('the_errand_names_the_issue_the_plan_and_the_command_that_validates_it', () => {
    expect(errand()).toContain('#42')
    expect(errand()).toContain('node /plugin/scripts/dispatch-check.mjs 42 --repo owner/name --check-plan')
    expect(errand()).toMatch(/do not implement/i)
  })

  it('the_errand_orders_the_reworked_plan_back_onto_the_issue_so_the_next_change_can_be_asked_for', () => {
    expect(errand()).toMatch(/publish/i)
    expect(errand()).toMatch(/comment/i)
  })

  it('it_never_promises_a_permission_nobody_mints', () => {
    expect(errand()).not.toContain('-OK')
    expect(errand()).not.toContain('nonce')
  })
})

describe('PlanAgentBrief asking the agent to fix its pull request', () => {
  const CHANGES = 'several changes\nsrc/foo.ts:42: fails\twith []'
  const errand = (changes = CHANGES) => new PlanAgentBrief({
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    conventions: '/plugin/conventions',
    ctStep: '/plugin/scripts/ct-step.mjs',
  }).fixErrandFor({ issueNumber: 42, repository: new RepositoryName('owner/name'), changes })

  it('the_errand_is_one_line_even_when_the_review_spread_the_anchors_across_several', () => {
    expect(errand()).not.toContain('\n')
    expect(errand()).not.toContain('\t')
    expect(errand()).toContain('several changes src/foo.ts:42: fails with []')
  })

  it('the_errand_orders_correcting_over_the_branch_and_the_pull_request_that_already_exist', () => {
    expect(errand()).toContain('without reworking the plan')
    expect(errand()).toContain('do not open another pull request')
    expect(errand()).toContain(PlanAgentBrief.NO_NEW_WORKTREES)
  })

  it('the_errand_orders_the_release_that_puts_the_issue_back_in_review', () => {
    expect(errand()).toContain('#42')
    expect(errand()).toContain(
      'node /plugin/scripts/dispatch-check.mjs 42 --repo owner/name --release --no-watch-merge'
    )
  })

  it('the_errand_forbids_merging_because_that_gate_stays_human', () => {
    expect(errand()).toMatch(/do not merge/i)
  })
})
