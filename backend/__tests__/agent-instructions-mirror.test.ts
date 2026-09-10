import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

class AgentInstructions {
  static HERE = dirname(fileURLToPath(import.meta.url))
  static ROOT = join(AgentInstructions.HERE, '..', '..')
  static AGENTS = 'AGENTS.md'
  static CLAUDE = 'CLAUDE.md'
  static PLACEHOLDER = '`THE OTHER DOCUMENT`'

  static RULES_NEITHER_DOCUMENT_MAY_LOSE = [
    'A repository control is not an obstacle to route around',
    'does not shape a command so that one stops',
    '`--no-verify` on a commit or a push',
    'any invocation that moves the hooks aside',
    'is a finding, not an obstacle',
    'it does not say the repository stopped deciding',
    'resolves the current branch by running `git rev-parse`',
    'hands the push back instead of getting past the hook another way',
  ]

  static of(name: string): string {
    return readFileSync(join(AgentInstructions.ROOT, name), 'utf8')
  }

  static withoutTheSelfReference(other: string, text: string): string {
    return text.split(`\`${other}\``).join(AgentInstructions.PLACEHOLDER)
  }

  static driftBetween({ agents, claude }: { agents: string, claude: string }): boolean {
    return AgentInstructions.withoutTheSelfReference(AgentInstructions.CLAUDE, agents)
      !== AgentInstructions.withoutTheSelfReference(AgentInstructions.AGENTS, claude)
  }
}

describe('the two agent-instruction documents say the same thing', () => {
  it('they_differ_only_in_which_of_the_two_they_name_as_the_other', () => {
    const drifted = AgentInstructions.driftBetween({
      agents: AgentInstructions.of(AgentInstructions.AGENTS),
      claude: AgentInstructions.of(AgentInstructions.CLAUDE),
    })

    expect(drifted, 'AGENTS.md and CLAUDE.md have drifted apart').toBe(false)
  })

  it('a_rule_that_reaches_only_one_of_them_is_drift_and_the_detector_says_so', () => {
    const agents = AgentInstructions.of(AgentInstructions.AGENTS)

    expect(
      AgentInstructions.driftBetween({
        agents: `${agents}\n- a rule only one of them carries\n`,
        claude: AgentInstructions.of(AgentInstructions.CLAUDE),
      })
    ).toBe(true)
  })

  it('a_rule_that_left_only_one_of_them_is_drift_too', () => {
    const dropped = AgentInstructions.of(AgentInstructions.CLAUDE)
      .split('is a finding, not an obstacle')
      .join('is an obstacle')

    expect(dropped).not.toEqual(AgentInstructions.of(AgentInstructions.CLAUDE))
    expect(
      AgentInstructions.driftBetween({ agents: AgentInstructions.of(AgentInstructions.AGENTS), claude: dropped })
    ).toBe(true)
  })

  it('the_self_reference_alone_is_not_drift_so_the_normalisation_is_not_over_eager', () => {
    const shared = 'This document and `THE OTHER`, and nothing else.\n'

    expect(
      AgentInstructions.driftBetween({
        agents: shared.replace('`THE OTHER`', `\`${AgentInstructions.CLAUDE}\``),
        claude: shared.replace('`THE OTHER`', `\`${AgentInstructions.AGENTS}\``),
      })
    ).toBe(false)
  })

  it('each_document_still_names_the_other_as_carrying_the_same_text', () => {
    expect(AgentInstructions.of(AgentInstructions.AGENTS))
      .toContain('This document and `CLAUDE.md` carry the same text')
    expect(AgentInstructions.of(AgentInstructions.CLAUDE))
      .toContain('This document and `AGENTS.md` carry the same text')
  })

  it('neither_document_may_lose_the_rule_that_a_control_is_not_routed_around', () => {
    for (const name of [AgentInstructions.AGENTS, AgentInstructions.CLAUDE]) {
      for (const rule of AgentInstructions.RULES_NEITHER_DOCUMENT_MAY_LOSE) {
        expect(AgentInstructions.of(name), `${name} no longer carries: ${rule}`).toContain(rule)
      }
    }
  })
})
