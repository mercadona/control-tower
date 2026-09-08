import { describe, it, expect } from 'vitest'
import { SurveyExternalTools } from '../../src/application/queries/survey-external-tools.js'
import { ToolSessions } from '../../src/domain/ports/tool-sessions.js'
import { ToolSession, SessionState } from '../../src/domain/value-objects/tool-session.js'

class ToolSessionMother {
  static ready(tool) {
    return new ToolSession({ tool, installed: true, state: SessionState.READY, fix: null })
  }

  static missing(tool) {
    return new ToolSession({ tool, installed: true, state: SessionState.MISSING, fix: `${tool} auth login` })
  }

  static unknown(tool) {
    return new ToolSession({ tool, installed: true, state: SessionState.UNKNOWN, fix: `${tool}, then /login` })
  }

  static notInstalled(tool) {
    return new ToolSession({ tool, installed: false, state: SessionState.READY, fix: null })
  }
}

class ToolSessionsDouble extends ToolSessions {
  constructor(sessions) {
    super()
    this.sessions = sessions
    this.asks = 0
  }

  static allReady() {
    return ToolSessionsDouble.with([
      ToolSessionMother.ready('gh'),
      ToolSessionMother.ready('acli'),
      ToolSessionMother.ready('bq'),
    ])
  }

  static with(sessions) {
    return new ToolSessionsDouble(sessions)
  }

  static raising() {
    return ToolSessionsDouble.allReady()
  }

  async all() {
    this.asks += 1
    if (this.asks > 1) {
      throw new Error('ToolSessionsDouble.all() was asked twice, a survey must ask its port once')
    }

    return this.sessions
  }

  asked() {
    return new SurveyExternalTools({ toolSessions: this }).execute()
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
    const toolSessions = ToolSessionsDouble.with([ToolSessionMother.notInstalled('bq')])

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

  it('a_state_outside_the_vocabulary_cannot_be_constructed', () => {
    expect(() => new ToolSession({ tool: 'gh', installed: true, state: 'expired', fix: null }))
      .toThrow(/"expired"/)
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new ToolSessions().all()).rejects.toThrow(/must implement all/)
  })
})
