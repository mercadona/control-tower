import { describe, it, expect } from 'vitest'
import { MilestoneContextHeading } from '../scripts/milestone-context.js'
import { readEpicContext, buildIssueBody, EPIC_CONTEXT_REASONS } from '../scripts/groom.js'
import { diffIssue, formatDrift, buildReconcileBody } from '../scripts/reconcile.js'
import { extractSectionContent, mapGhIssue } from '../scripts/gh-issue-map.js'
import { renderKickoff } from '../scripts/kickoff.js'
import { parseScope } from '../scripts/scope.js'

class Fixture {
  static SPEC_LINK = '> Slice `#2` of the milestone. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)'
  static CONTEXT = '- una decision comun'
  static SLICE = Object.freeze({ n: 7, name: 'card', type: 'ui', ac: ['AC-7.1'], deps: [], issue: '#7' })
  static KICKOFF_OPTIONS = Object.freeze({ repo: 'o/r', conventionsDir: '/plugin/conventions' })

  static specUnder(...headings) {
    return [
      '# Spec',
      '',
      ...headings.flatMap((heading) => [heading, Fixture.CONTEXT, '']),
      '## Hipotesis',
      '',
      'Apuesta del fixture.',
      '',
      '## 9. Slices',
      '| # | Slice | Dep |',
      '|---|---|---|',
      '| 1 | card | – |',
    ].join('\n')
  }

  static bodyUnder(heading, content) {
    return [
      Fixture.SPEC_LINK,
      '',
      ...(heading ? [heading, content, ''] : []),
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-2.1',
      '',
      '## Out of scope / Protected',
      '- 🚫 nada',
    ].join('\n')
  }

  static bodyUnderBothSpellings(content) {
    return Fixture.bodyUnder(MilestoneContextHeading.WRITTEN, content)
      .replace('## Acceptance criteria', `${MilestoneContextHeading.LEGACY}\n- otra\n\n## Acceptance criteria`)
  }

  static wanted(over) {
    return {
      order: 2, title: '#2 card', labels: [], deps: [], ac: ['AC-2.1'],
      descripcion: null, protectedLine: '- 🚫 nada', gatesContent: '',
      specLink: Fixture.SPEC_LINK, epicContext: Fixture.CONTEXT, ...over,
    }
  }

  static existing(body) {
    return { number: 90, title: '#2 card', state: 'open', milestone: { title: 'M1' }, labels: [], body }
  }

  static issueCarrying(heading) {
    return { number: 7, title: '#7 card', labels: [], body: Fixture.bodyUnder(heading, Fixture.CONTEXT) }
  }

  static kickoffFor(milestoneContextHeading) {
    return renderKickoff({ ...Fixture.SLICE, milestoneContextHeading }, Fixture.KICKOFF_OPTIONS)
  }

  static specWithScopeUnder(heading) {
    return [heading, '- **Alcance:** `apps/web/**`', '', '## Out of scope / Protected'].join('\n')
  }
}

describe('MilestoneContextHeading — one spelling is written, two are accepted', () => {
  it('names the milestone in the heading the groom writes from now on', () => {
    expect(MilestoneContextHeading.WRITTEN).toBe('## Contexto del milestone')
  })

  it('keeps the spelling every frozen spec and every live issue still carries', () => {
    expect(MilestoneContextHeading.LEGACY).toBe('## Contexto del epic')
  })

  it('accepts both spellings, with the written one first and neither addable at runtime', () => {
    expect(MilestoneContextHeading.FORMS).toEqual([MilestoneContextHeading.WRITTEN, MilestoneContextHeading.LEGACY])
    expect(Object.isFrozen(MilestoneContextHeading.FORMS)).toBe(true)
    expect(Object.isFrozen(MilestoneContextHeading)).toBe(true)
  })
})

describe('what the groom writes is the milestone spelling', () => {
  it('emits the written heading and never the legacy one', () => {
    const body = buildIssueBody({ n: 2, name: 'card', ac: ['AC-2.1'], deps: [], protegido: 'nada' }, null, Fixture.CONTEXT)
    expect(body).toContain(MilestoneContextHeading.WRITTEN)
    expect(body).not.toContain(MilestoneContextHeading.LEGACY)
  })
})

describe('readEpicContext — either spelling is read, both together are a finding', () => {
  it('reads the section out of a spec that carries the written spelling', () => {
    const r = readEpicContext(Fixture.specUnder(MilestoneContextHeading.WRITTEN))
    expect(r.content).toBe(Fixture.CONTEXT)
    expect(r.reason).toBeNull()
    expect(r.warnings).toEqual([])
  })

  it('reads the section out of a frozen spec that still carries the legacy spelling, with no warning about the spelling', () => {
    const r = readEpicContext(Fixture.specUnder(MilestoneContextHeading.LEGACY))
    expect(r.content).toBe(Fixture.CONTEXT)
    expect(r.reason).toBeNull()
    expect(r.warnings).toEqual([])
  })

  it('refuses to choose between the two spellings in silence, and says which they are and where', () => {
    const r = readEpicContext(Fixture.specUnder(MilestoneContextHeading.WRITTEN, MilestoneContextHeading.LEGACY))
    expect(r.content).toBeNull()
    expect(r.reason).toBe(EPIC_CONTEXT_REASONS.MALFORMED)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain(MilestoneContextHeading.WRITTEN)
    expect(r.warnings[0]).toContain(MilestoneContextHeading.LEGACY)
    expect(r.warnings[0]).toMatch(/line 3/)
    expect(r.warnings[0]).toMatch(/line 6/)
  })

  it('names the written spelling when the spec carries no section at all', () => {
    const r = readEpicContext(Fixture.specUnder())
    expect(r.reason).toBe(EPIC_CONTEXT_REASONS.ABSENT)
    expect(r.warnings[0]).toContain(MilestoneContextHeading.WRITTEN)
  })
})

describe('diffIssue — a live issue under the legacy spelling is not drift', () => {
  it('finds the section under the legacy heading and reports no drift for the spelling alone', () => {
    const d = diffIssue(Fixture.existing(Fixture.bodyUnder(MilestoneContextHeading.LEGACY, Fixture.CONTEXT)), Fixture.wanted(), 'M1', [])
    expect(d.epicContextDiffers).toBe(false)
  })

  it('finds the section under the written heading too', () => {
    const d = diffIssue(Fixture.existing(Fixture.bodyUnder(MilestoneContextHeading.WRITTEN, Fixture.CONTEXT)), Fixture.wanted(), 'M1', [])
    expect(d.epicContextDiffers).toBe(false)
  })

  it('reports a body that carries both spellings as a finding that names both', () => {
    const d = diffIssue(Fixture.existing(Fixture.bodyUnderBothSpellings(Fixture.CONTEXT)), Fixture.wanted(), 'M1', [])
    expect(d.milestoneContextSpellings).toEqual([MilestoneContextHeading.WRITTEN, MilestoneContextHeading.LEGACY])
    const line = formatDrift(d).find((l) => l.includes(MilestoneContextHeading.LEGACY) && l.includes(MilestoneContextHeading.WRITTEN))
    expect(line).toMatch(/^note:/)
  })

  it('does not report two spellings when only one of them is in the body', () => {
    const d = diffIssue(Fixture.existing(Fixture.bodyUnder(MilestoneContextHeading.LEGACY, Fixture.CONTEXT)), Fixture.wanted(), 'M1', [])
    expect(d.milestoneContextSpellings).toEqual([])
  })
})

describe('buildReconcileBody — the content is brought up to date, the spelling on disk is left alone', () => {
  it('rewrites the content under the legacy heading without renaming the heading', () => {
    const r = buildReconcileBody(Fixture.bodyUnder(MilestoneContextHeading.LEGACY, '- una decision VIEJA'), Fixture.wanted({ epicContext: '- una decision NUEVA' }))
    expect(r.body).toContain(MilestoneContextHeading.LEGACY)
    expect(r.body).not.toContain(MilestoneContextHeading.WRITTEN)
    expect(extractSectionContent(r.body, MilestoneContextHeading.FORMS)).toBe('- una decision NUEVA')
  })

  it('writes the written spelling when it has to insert the section from scratch', () => {
    const r = buildReconcileBody(Fixture.bodyUnder(null, null), Fixture.wanted({ epicContext: '- una decision NUEVA' }))
    expect(r.body).toContain(MilestoneContextHeading.WRITTEN)
  })

  it('writes nothing at all when the body carries both spellings', () => {
    const r = buildReconcileBody(Fixture.bodyUnderBothSpellings('- una decision VIEJA'), Fixture.wanted({ epicContext: '- una decision NUEVA' }))
    expect(r.unresolvedEpicContext).toBe('duplicada')
    expect(r.body === null || r.body.includes('- una decision VIEJA')).toBe(true)
  })
})

describe('the kickoff names the spelling the issue actually carries', () => {
  it('names the legacy heading to an agent dispatched on an issue that carries it', () => {
    const mapped = mapGhIssue(Fixture.issueCarrying(MilestoneContextHeading.LEGACY))
    expect(mapped.milestoneContextHeading).toBe(MilestoneContextHeading.LEGACY)
    const k = Fixture.kickoffFor(mapped.milestoneContextHeading)
    expect(k).toContain(MilestoneContextHeading.LEGACY)
    expect(k).not.toContain(MilestoneContextHeading.WRITTEN)
  })

  it('names the written heading to an agent dispatched on an issue groomed from now on', () => {
    const mapped = mapGhIssue(Fixture.issueCarrying(MilestoneContextHeading.WRITTEN))
    expect(mapped.milestoneContextHeading).toBe(MilestoneContextHeading.WRITTEN)
    expect(Fixture.kickoffFor(mapped.milestoneContextHeading)).toContain(MilestoneContextHeading.WRITTEN)
  })

  it('claims no spelling when the body carries neither, and the kickoff falls back to the written one', () => {
    const mapped = mapGhIssue(Fixture.issueCarrying(null))
    expect(mapped.milestoneContextHeading).toBeNull()
    expect(Fixture.kickoffFor(mapped.milestoneContextHeading)).toContain(MilestoneContextHeading.WRITTEN)
  })

  it('claims no spelling when the body carries both of them', () => {
    const body = Fixture.bodyUnderBothSpellings(Fixture.CONTEXT)
    expect(mapGhIssue({ number: 7, title: '#7 card', labels: [], body }).milestoneContextHeading).toBeNull()
  })
})

describe('the scope gate reads the declared paths under either spelling', () => {
  it('finds the declaration under the written heading', () => {
    expect(parseScope(Fixture.specWithScopeUnder(MilestoneContextHeading.WRITTEN))).toMatchObject({ declared: true, patterns: ['apps/web/**'] })
  })

  it('finds the declaration under the legacy heading, so no frozen spec loses its gate', () => {
    expect(parseScope(Fixture.specWithScopeUnder(MilestoneContextHeading.LEGACY))).toMatchObject({ declared: true, patterns: ['apps/web/**'] })
  })
})
