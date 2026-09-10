import { describe, it, expect } from 'vitest'
import {
  SurveyExternalTools,
  SurveyExternalToolsResult,
} from '../../src/application/queries/survey-external-tools.ts'
import { ToolSessions } from '../../src/domain/ports/tool-sessions.ts'
import { MetricsDelivery } from '../../src/domain/value-objects/metrics-delivery.ts'
import { ToolSession, SessionState } from '../../src/domain/value-objects/tool-session.ts'

class ToolSessionMother {
  static ready(tool: string) {
    return new ToolSession({ tool, installed: true, state: SessionState.READY, fix: null })
  }

  static missing(tool: string) {
    return new ToolSession({ tool, installed: true, state: SessionState.MISSING, fix: `${tool} auth login` })
  }

  static unknown(tool: string) {
    return new ToolSession({ tool, installed: true, state: SessionState.UNKNOWN, fix: `${tool}, then /login` })
  }

  static notInstalled(tool: string) {
    return new ToolSession({ tool, installed: false, state: SessionState.READY, fix: null })
  }
}

class Deliveries {
  static readonly DESTINATION = 'fixture-project:fixture_dataset.fixture_table'

  static enabled() {
    return MetricsDelivery.to(Deliveries.DESTINATION)
  }

  static disabled() {
    return MetricsDelivery.disabled()
  }
}

class ToolSessionsDouble extends ToolSessions {
  readonly sessions: ToolSession[]

  constructor(sessions: ToolSession[]) {
    super()
    this.sessions = sessions
  }

  static allReady() {
    return ToolSessionsDouble.with([
      ToolSessionMother.ready('gh'),
      ToolSessionMother.ready('acli'),
      ToolSessionMother.ready('bq'),
    ])
  }

  static with(sessions: ToolSession[]) {
    return new ToolSessionsDouble(sessions)
  }

  async all() {
    return this.sessions
  }

  asked(metricsDelivery: MetricsDelivery = Deliveries.disabled()) {
    return new SurveyExternalTools({ toolSessions: this, metricsDelivery }).execute()
  }
}

describe('SurveyExternalTools', () => {
  it('nothing_blocks_when_every_session_is_ready', async () => {
    const result = await ToolSessionsDouble.allReady().asked()

    expect(result.ready).toBe(true)
  })

  it('an_installed_tool_whose_session_is_unknown_does_not_block', async () => {
    const toolSessions = ToolSessionsDouble.with([ToolSessionMother.unknown('claude')])

    const result = await toolSessions.asked()

    expect(result.ready).toBe(true)
  })

  it('an_installed_tool_whose_session_is_missing_blocks', async () => {
    const toolSessions = ToolSessionsDouble.with([ToolSessionMother.missing('gh')])

    const result = await toolSessions.asked()

    expect(result.ready).toBe(false)
  })

  it('a_tool_that_is_not_installed_blocks_however_ready_its_session_reads', async () => {
    const toolSessions = ToolSessionsDouble.with([ToolSessionMother.notInstalled('acli')])

    const result = await toolSessions.asked()

    expect(result.ready).toBe(false)
  })

  it('the_sessions_come_back_in_the_order_the_port_gave_them', async () => {
    const gh = ToolSessionMother.ready('gh')
    const acli = ToolSessionMother.missing('acli')
    const bq = ToolSessionMother.unknown('bq')
    const toolSessions = ToolSessionsDouble.with([gh, acli, bq])

    const result = await toolSessions.asked()

    expect(result.sessions.map((session) => session.tool)).toEqual(['gh', 'acli', 'bq'])
  })

  it('bq_does_not_block_when_no_metrics_destination_is_configured_because_nothing_is_delivered', async () => {
    const toolSessions = ToolSessionsDouble.with([
      ToolSessionMother.ready('gh'),
      ToolSessionMother.missing('bq'),
    ])

    const result = await toolSessions.asked(Deliveries.disabled())

    expect(result.ready).toBe(true)
    expect(result.metricsDelivery.enabled).toBe(false)
  })

  it('bq_that_is_not_even_installed_does_not_block_either_when_metrics_delivery_is_disabled', async () => {
    const toolSessions = ToolSessionsDouble.with([ToolSessionMother.notInstalled('bq')])

    const result = await toolSessions.asked(Deliveries.disabled())

    expect(result.ready).toBe(true)
  })

  it('bq_blocks_once_a_metrics_destination_is_configured_and_its_session_is_missing', async () => {
    const toolSessions = ToolSessionsDouble.with([
      ToolSessionMother.ready('gh'),
      ToolSessionMother.missing('bq'),
    ])

    const result = await toolSessions.asked(Deliveries.enabled())

    expect(result.ready).toBe(false)
    expect(result.metricsDelivery.destination).toBe(Deliveries.DESTINATION)
  })

  it('bq_that_is_not_installed_blocks_once_a_metrics_destination_is_configured', async () => {
    const toolSessions = ToolSessionsDouble.with([ToolSessionMother.notInstalled('bq')])

    const result = await toolSessions.asked(Deliveries.enabled())

    expect(result.ready).toBe(false)
  })

  it('an_enabled_delivery_with_bq_ready_is_ready_and_an_unknown_claude_beside_it_still_does_not_block', async () => {
    const toolSessions = ToolSessionsDouble.with([
      ToolSessionMother.ready('bq'),
      ToolSessionMother.unknown('claude'),
    ])

    const result = await toolSessions.asked(Deliveries.enabled())

    expect(result.ready).toBe(true)
  })

  it('every_other_tool_keeps_blocking_whatever_the_metrics_delivery_says', async () => {
    const toolSessions = ToolSessionsDouble.with([ToolSessionMother.missing('gh')])

    expect((await toolSessions.asked(Deliveries.disabled())).ready).toBe(false)
    expect((await toolSessions.asked(Deliveries.enabled())).ready).toBe(false)
  })

  it('a_survey_that_does_not_know_whether_metrics_delivery_is_configured_cannot_be_constructed', () => {
    expect(() => new SurveyExternalToolsResult({ sessions: [], metricsDelivery: null }))
      .toThrow(/without knowing whether metrics delivery is configured/)
  })

  it('a_destination_that_is_neither_a_table_nor_an_absence_cannot_be_constructed', () => {
    expect(() => MetricsDelivery.to('')).toThrow(/non-empty string/)
    expect(() => new MetricsDelivery({ destination: 7 })).toThrow(/got 7/)
  })

  it('an_unset_variable_reads_as_disabled_with_no_destination_and_never_as_an_empty_table', () => {
    const absent = MetricsDelivery.to(undefined)

    expect(absent.enabled).toBe(false)
    expect(absent.destination).toBe(null)
    expect(MetricsDelivery.disabled().enabled).toBe(false)
  })

  it('a_configured_delivery_demands_bq_and_demands_nothing_else', () => {
    const enabled = Deliveries.enabled()

    expect(enabled.demands('bq')).toBe(true)
    expect(enabled.demands('gh')).toBe(false)
    expect(Deliveries.disabled().demands('bq')).toBe(false)
  })

  it('a_state_outside_the_vocabulary_cannot_be_constructed', () => {
    expect(() => new ToolSession({ tool: 'gh', installed: true, state: 'expired', fix: null }))
      .toThrow(/"expired"/)
  })

  it('a_ready_session_carrying_a_fix_cannot_be_constructed', () => {
    expect(() => new ToolSession({ tool: 'gh', installed: true, state: SessionState.READY, fix: 'gh auth login' }))
      .toThrow(/"gh auth login"/)
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new ToolSessions().all()).rejects.toThrow(/must implement all/)
  })
})
