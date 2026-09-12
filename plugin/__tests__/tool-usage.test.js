import { describe, it, expect } from 'vitest'
import { IdentityCollapse, ToolIdentity, ToolUsage, ToolUsageFields, ToolUsageTotal, UsageStatus } from '../scripts/tool-usage.js'

describe('IdentityCollapse — the rule ToolUsageTotal and the harvest identity aggregates share', () => {
  it('one_distinct_value_across_every_entry_is_declared_as_itself', () => {
    expect(IdentityCollapse.of(['a@x.com', 'a@x.com'])).toBe('a@x.com')
  })

  it('two_distinct_values_collapse_to_mixed', () => {
    expect(IdentityCollapse.of(['a@x.com', 'b@x.com'])).toBe(IdentityCollapse.MIXED)
  })

  it('without_a_blank_option_a_null_counts_as_a_value_of_its_own_like_the_tool_identity_rule_needs', () => {
    expect(IdentityCollapse.of(['a@x.com', null])).toBe(IdentityCollapse.MIXED)
  })

  it('with_a_blank_option_the_blank_entries_are_dropped_before_collapsing', () => {
    expect(IdentityCollapse.of(['a@x.com', null, null], { blank: null })).toBe('a@x.com')
  })

  it('with_a_blank_option_a_sentinel_string_is_dropped_too', () => {
    expect(IdentityCollapse.of(['a@x.com', '(sin actor)', '(sin actor)'], { blank: '(sin actor)' })).toBe('a@x.com')
  })

  it('once_the_blanks_are_dropped_two_or_more_remaining_distinct_values_still_collapse_to_mixed', () => {
    expect(IdentityCollapse.of(['a@x.com', 'b@x.com', '(sin actor)'], { blank: '(sin actor)' })).toBe(IdentityCollapse.MIXED)
  })

  it('once_the_blanks_are_dropped_nothing_left_collapses_to_null_and_not_to_the_blank', () => {
    expect(IdentityCollapse.of(['(sin actor)', '(sin actor)'], { blank: '(sin actor)' })).toBeNull()
  })
})

class Identities {
  static claudeCode() {
    return new ToolIdentity({ tool: 'claude-code', version: '2.1.266' })
  }

  static olderClaudeCode() {
    return new ToolIdentity({ tool: 'claude-code', version: '2.0.9' })
  }

  static anotherTool() {
    return new ToolIdentity({ tool: 'another-tool', version: '1.0.0' })
  }

  static claudeCodeWithoutVersion() {
    return new ToolIdentity({ tool: 'claude-code', version: null })
  }
}

class Usages {
  static measured({ identity = Identities.claudeCode(), inputTokens = 30, cachedInputTokens = 12000, outputTokens = 900, evidence = ['req_1'] } = {}) {
    return ToolUsage.measured({
      identity, inputTokens, cachedInputTokens, outputTokens, evidence,
      durationStatus: UsageStatus.UNSUPPORTED, activeDurationMs: null,
    })
  }

  static withDuration() {
    return ToolUsage.measured({
      identity: Identities.claudeCode(), inputTokens: 30, cachedInputTokens: 0, outputTokens: 5, evidence: ['req_1'],
      durationStatus: UsageStatus.MEASURED, activeDurationMs: 4200,
    })
  }
}

class TelemetryFiles {
  static of(rows) {
    return rows.map((row) => `${JSON.stringify(row)}\n`).join('')
  }

  static measuredRow(overrides = {}) {
    return { step: 'implement', ...Usages.measured().measures(), ...overrides }
  }

  static rowWithEvidence(evidence, overrides = {}) {
    return TelemetryFiles.measuredRow({ [ToolUsageFields.EVIDENCE]: evidence, ...overrides })
  }
}

describe('a normalized tool usage never estimates and never counts a cached token twice', () => {
  it('the_total_adds_the_cached_input_exactly_once_beside_the_fresh_input_and_the_output', () => {
    const usage = Usages.measured({ inputTokens: 30, cachedInputTokens: 12000, outputTokens: 900 })

    expect(usage.totalTokens).toBe(12930)
    expect(usage.totalTokens).toBe(usage.inputTokens + usage.cachedInputTokens + usage.outputTokens)
  })

  it('the_total_is_derived_and_not_stored_so_no_writer_can_land_a_sum_that_double_counts', () => {
    const measures = Usages.measured({ inputTokens: 1, cachedInputTokens: 1000, outputTokens: 2 }).measures()

    expect(measures[ToolUsageFields.TOTAL_TOKENS]).toBe(1003)
    expect(ToolUsage.ofRow({ ...measures, [ToolUsageFields.TOTAL_TOKENS]: 999999 }).totalTokens).toBe(1003)
  })

  it('a_tool_that_reported_zero_tokens_carries_zeros_and_a_measured_status', () => {
    const usage = Usages.measured({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, evidence: [] })

    expect(usage.status).toBe(UsageStatus.MEASURED)
    expect(usage.totalTokens).toBe(0)
    expect(usage.measures()[ToolUsageFields.INPUT_TOKENS]).toBe(0)
  })

  it('an_unsupported_runtime_carries_no_tool_no_numbers_and_says_which_case_it_is', () => {
    const measures = ToolUsage.unsupported().measures()

    expect(measures[ToolUsageFields.STATUS]).toBe(UsageStatus.UNSUPPORTED)
    expect(measures[ToolUsageFields.TOOL]).toBeNull()
    expect(measures[ToolUsageFields.TOTAL_TOKENS]).toBeNull()
    expect(measures[ToolUsageFields.INPUT_TOKENS]).toBeNull()
  })

  it('a_source_that_could_not_be_read_keeps_the_tool_identity_and_nulls_every_count', () => {
    const measures = ToolUsage.notRead({ identity: Identities.claudeCode() }).measures()

    expect(measures[ToolUsageFields.STATUS]).toBe(UsageStatus.NOT_READ)
    expect(measures[ToolUsageFields.TOOL]).toBe('claude-code')
    expect(measures[ToolUsageFields.TOTAL_TOKENS]).toBeNull()
    expect(measures[ToolUsageFields.GAPS]).toBeNull()
  })

  it('a_status_that_contributes_numbers_cannot_be_built_without_them', () => {
    expect(() => new ToolUsage({
      identity: Identities.claudeCode(), status: UsageStatus.MEASURED,
      inputTokens: null, cachedInputTokens: null, outputTokens: null,
      durationStatus: UsageStatus.UNSUPPORTED, activeDurationMs: null, evidence: [], gaps: 0,
    })).toThrow(/disagrees with the token counts/)
  })

  it('a_measured_duration_cannot_be_declared_without_the_milliseconds_it_measured', () => {
    expect(() => ToolUsage.measured({
      identity: Identities.claudeCode(), inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, evidence: ['req_1'],
      durationStatus: UsageStatus.MEASURED, activeDurationMs: null,
    })).toThrow(/durationStatus measured disagrees with the duration given/)
  })

  it('a_duration_nobody_measured_cannot_smuggle_in_a_number_under_a_non_measured_status', () => {
    for (const status of [UsageStatus.UNSUPPORTED, UsageStatus.NOT_READ, UsageStatus.UNMEASURED, UsageStatus.PARTIAL, UsageStatus.ABSENT]) {
      expect(() => ToolUsage.measured({
        identity: Identities.claudeCode(), inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, evidence: ['req_1'],
        durationStatus: status, activeDurationMs: 4200,
      })).toThrow(/disagrees with the duration given/)
    }
  })

  it('a_duration_the_tool_measured_at_zero_is_a_zero_and_not_a_hole', () => {
    const usage = ToolUsage.measured({
      identity: Identities.claudeCode(), inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, evidence: ['req_1'],
      durationStatus: UsageStatus.MEASURED, activeDurationMs: 0,
    })

    expect(usage.activeDurationMs).toBe(0)
    expect(usage.measures()[ToolUsageFields.ACTIVE_DURATION_MS]).toBe(0)
  })

  it('a_negative_duration_is_refused_at_the_boundary_instead_of_landing_in_the_row', () => {
    expect(() => ToolUsage.measured({
      identity: Identities.claudeCode(), inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, evidence: ['req_1'],
      durationStatus: UsageStatus.MEASURED, activeDurationMs: -1,
    })).toThrow(/tool_active_duration_ms must be a non-negative integer or null/)
  })

  it('a_row_that_claims_a_measured_duration_and_carries_none_is_read_back_as_unmeasured_rather_than_raising', () => {
    const measures = Usages.measured().measures()
    const inconsistent = ToolUsage.ofRow({ ...measures, [ToolUsageFields.DURATION_STATUS]: UsageStatus.MEASURED })

    expect(inconsistent.durationStatus).toBe(UsageStatus.UNMEASURED)
    expect(inconsistent.activeDurationMs).toBeNull()
    expect(inconsistent.totalTokens).toBe(12930)
  })

  it('a_row_that_carries_a_duration_under_a_status_that_measured_none_is_read_back_as_unmeasured_too', () => {
    const measures = Usages.measured().measures()
    const inconsistent = ToolUsage.ofRow({ ...measures, [ToolUsageFields.ACTIVE_DURATION_MS]: 4200 })

    expect(measures[ToolUsageFields.DURATION_STATUS]).toBe(UsageStatus.UNSUPPORTED)
    expect(inconsistent.durationStatus).toBe(UsageStatus.UNMEASURED)
    expect(inconsistent.activeDurationMs).toBeNull()
  })

  it('a_row_whose_duration_the_tool_really_measured_is_read_back_whole', () => {
    const readBack = ToolUsage.ofRow(Usages.withDuration().measures())

    expect(readBack.durationStatus).toBe(UsageStatus.MEASURED)
    expect(readBack.activeDurationMs).toBe(4200)
  })

  it('a_status_outside_the_vocabulary_raises_instead_of_landing_in_the_row', () => {
    expect(() => new ToolUsage({
      identity: Identities.claudeCode(), status: 'cheap',
      inputTokens: null, cachedInputTokens: null, outputTokens: null,
      durationStatus: UsageStatus.UNSUPPORTED, activeDurationMs: null, evidence: [], gaps: null,
    })).toThrow(/status must be a UsageStatus member/)
  })
})

describe('the totals of a slice add up the attempts and refuse to count the same evidence twice', () => {
  it('two_attempts_with_disjoint_evidence_add_up_their_tokens_and_count_as_two', () => {
    const text = TelemetryFiles.of([
      TelemetryFiles.rowWithEvidence(['req_1'], { tool_input_tokens: 10, tool_cached_input_tokens: 100, tool_output_tokens: 1, tool_total_tokens: 111 }),
      TelemetryFiles.rowWithEvidence(['req_2'], { tool_input_tokens: 20, tool_cached_input_tokens: 200, tool_output_tokens: 2, tool_total_tokens: 222 }),
    ])

    const total = ToolUsageTotal.of(text)

    expect(total.attempts).toBe(2)
    expect(total.measured).toBe(2)
    expect(total.inputTokens).toBe(30)
    expect(total.cachedInputTokens).toBe(300)
    expect(total.outputTokens).toBe(3)
    expect(total.totalTokens).toBe(333)
  })

  it('a_row_repeated_with_the_same_evidence_is_counted_once_and_never_inflates_the_total', () => {
    const row = TelemetryFiles.rowWithEvidence(['req_1', 'req_2'])
    const once = ToolUsageTotal.of(TelemetryFiles.of([row]))
    const twice = ToolUsageTotal.of(TelemetryFiles.of([row, row, row]))

    expect(twice.attempts).toBe(once.attempts)
    expect(twice.totalTokens).toBe(once.totalTokens)
  })

  it('the_same_evidence_written_in_a_different_order_is_still_the_same_evidence', () => {
    const text = TelemetryFiles.of([
      TelemetryFiles.rowWithEvidence(['req_1', 'req_2']),
      TelemetryFiles.rowWithEvidence(['req_2', 'req_1']),
    ])

    expect(ToolUsageTotal.of(text).attempts).toBe(1)
  })

  it('telemetry_older_than_the_contract_is_absent_and_not_a_zero', () => {
    const total = ToolUsageTotal.of(TelemetryFiles.of([{ step: 'implement', paths: 3 }, { step: 'judge', ruling: 'PASS' }]))

    expect(total.status).toBe(UsageStatus.ABSENT)
    expect(total.attempts).toBe(0)
    expect(total.totalTokens).toBeNull()
    expect(total.inputTokens).toBeNull()
    expect(total.gaps).toBeNull()
  })

  it('a_slice_whose_every_attempt_measured_zero_lands_a_zero_and_never_a_null', () => {
    const total = ToolUsageTotal.of(TelemetryFiles.of([
      TelemetryFiles.rowWithEvidence([], { tool_input_tokens: 0, tool_cached_input_tokens: 0, tool_output_tokens: 0, tool_total_tokens: 0 }),
    ]))

    expect(total.status).toBe(UsageStatus.MEASURED)
    expect(total.totalTokens).toBe(0)
  })

  it('an_attempt_the_runtime_could_not_measure_leaves_the_slice_partial_and_the_measured_count_below_the_attempts', () => {
    const text = TelemetryFiles.of([
      TelemetryFiles.rowWithEvidence(['req_1']),
      { step: 'judge', ...ToolUsage.notRead({ identity: Identities.claudeCode() }).measures(), tool_usage_evidence: [] },
    ])

    const total = ToolUsageTotal.of(text)

    expect(total.attempts).toBe(2)
    expect(total.measured).toBe(1)
    expect(total.status).toBe(UsageStatus.PARTIAL)
    expect(total.totalTokens).toBe(12930)
  })

  it('a_slice_where_nothing_could_be_read_keeps_that_status_and_no_number', () => {
    const text = TelemetryFiles.of([
      { step: 'implement', ...ToolUsage.notRead({ identity: Identities.claudeCode() }).measures() },
      { step: 'judge', ...ToolUsage.notRead({ identity: Identities.claudeCode() }).measures() },
    ])

    const total = ToolUsageTotal.of(text)

    expect(total.status).toBe(UsageStatus.NOT_READ)
    expect(total.measured).toBe(0)
    expect(total.totalTokens).toBeNull()
  })

  it('the_tool_identity_travels_so_the_figures_can_be_grouped_by_whose_cost_they_are', () => {
    const total = ToolUsageTotal.of(TelemetryFiles.of([TelemetryFiles.rowWithEvidence(['req_1'])]))

    expect(total.identity.tool).toBe('claude-code')
    expect(total.identity.version).toBe('2.1.266')
  })

  it('two_versions_of_the_same_tool_keep_the_tool_and_declare_only_the_version_mixed', () => {
    const text = TelemetryFiles.of([
      TelemetryFiles.rowWithEvidence(['req_1']),
      { step: 'judge', ...Usages.measured({ identity: Identities.olderClaudeCode(), evidence: ['req_2'] }).measures() },
    ])

    const total = ToolUsageTotal.of(text)

    expect(total.identity.tool).toBe('claude-code')
    expect(total.identity.version).toBe(ToolIdentity.MIXED)
  })

  it('a_version_one_attempt_could_not_publish_leaves_the_version_mixed_and_the_tool_standing', () => {
    const text = TelemetryFiles.of([
      TelemetryFiles.rowWithEvidence(['req_1']),
      { step: 'judge', ...Usages.measured({ identity: Identities.claudeCodeWithoutVersion(), evidence: ['req_2'] }).measures() },
    ])

    const total = ToolUsageTotal.of(text)

    expect(total.identity.tool).toBe('claude-code')
    expect(total.identity.version).toBe(ToolIdentity.MIXED)
  })

  it('two_different_tools_on_the_same_slice_declare_the_tool_mixed_instead_of_one_being_picked', () => {
    const text = TelemetryFiles.of([
      TelemetryFiles.rowWithEvidence(['req_1']),
      { step: 'judge', ...Usages.measured({ identity: Identities.anotherTool(), evidence: ['req_2'] }).measures() },
    ])

    const total = ToolUsageTotal.of(text)

    expect(total.identity.tool).toBe(ToolIdentity.MIXED)
    expect(total.identity.version).toBe(ToolIdentity.MIXED)
  })

  it('one_tool_at_one_version_across_every_attempt_is_declared_as_itself_and_never_mixed', () => {
    const text = TelemetryFiles.of([
      TelemetryFiles.rowWithEvidence(['req_1']),
      TelemetryFiles.rowWithEvidence(['req_2']),
    ])

    const total = ToolUsageTotal.of(text)

    expect(total.identity.tool).toBe('claude-code')
    expect(total.identity.version).toBe('2.1.266')
  })

  it('a_duration_no_attempt_reported_stays_null_with_its_own_status_beside_the_tokens', () => {
    const total = ToolUsageTotal.of(TelemetryFiles.of([TelemetryFiles.rowWithEvidence(['req_1'])]))

    expect(total.status).toBe(UsageStatus.MEASURED)
    expect(total.durationStatus).toBe(UsageStatus.UNSUPPORTED)
    expect(total.durationMeasured).toBe(0)
    expect(total.activeDurationMs).toBeNull()
  })

  it('a_tool_that_does_report_a_duration_adds_it_up_and_says_it_measured_it', () => {
    const total = ToolUsageTotal.of(TelemetryFiles.of([
      { step: 'implement', ...Usages.withDuration().measures() },
    ]))

    expect(total.durationStatus).toBe(UsageStatus.MEASURED)
    expect(total.activeDurationMs).toBe(4200)
  })

  it('a_line_that_is_not_json_does_not_take_the_good_ones_with_it', () => {
    const text = `${JSON.stringify(TelemetryFiles.rowWithEvidence(['req_1']))}\nnot json\n[]\n`

    expect(ToolUsageTotal.of(text).attempts).toBe(1)
  })

  it('the_claimed_requests_of_a_slice_are_every_request_id_its_rows_already_carry', () => {
    const text = TelemetryFiles.of([
      TelemetryFiles.rowWithEvidence(['req_1', 'req_2']),
      TelemetryFiles.rowWithEvidence(['req_3']),
      { step: 'controls', outcome: 'done' },
    ])

    expect([...ToolUsage.claimedIn(text)].sort()).toEqual(['req_1', 'req_2', 'req_3'])
  })
})
