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
    return Fixture.bodyUnder(MilestoneContextHeading.MILESTONE, content)
      .replace('## Acceptance criteria', `${MilestoneContextHeading.EPIC}\n- otra\n\n## Acceptance criteria`)
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

describe('MilestoneContextHeading — two spellings are accepted, one of them is written', () => {
  it('carries both spellings, neither addable at runtime', () => {
    expect(MilestoneContextHeading.MILESTONE).toBe('## Contexto del milestone')
    expect(MilestoneContextHeading.EPIC).toBe('## Contexto del epic')
    expect(MilestoneContextHeading.FORMS).toEqual([MilestoneContextHeading.MILESTONE, MilestoneContextHeading.EPIC])
    expect(Object.isFrozen(MilestoneContextHeading.FORMS)).toBe(true)
    expect(Object.isFrozen(MilestoneContextHeading)).toBe(true)
  })

  it('still writes the epic spelling, because the gate vendored into a governed repo cannot read the other one', () => {
    expect(MilestoneContextHeading.WRITTEN).toBe(MilestoneContextHeading.EPIC)
  })
})

describe('what the groom writes is what an already vendored scope gate can read', () => {
  it('emits the epic spelling and not the milestone one, until the vendored gates accept both', () => {
    const body = buildIssueBody({ n: 2, name: 'card', ac: ['AC-2.1'], deps: [], protegido: 'nada' }, null, Fixture.CONTEXT)
    expect(body).toContain(MilestoneContextHeading.EPIC)
    expect(body).not.toContain(MilestoneContextHeading.MILESTONE)
  })

  it('writes whatever WRITTEN says, so flipping the constant is the whole switch', () => {
    const body = buildIssueBody({ n: 2, name: 'card', ac: ['AC-2.1'], deps: [], protegido: 'nada' }, null, Fixture.CONTEXT)
    expect(body).toContain(MilestoneContextHeading.WRITTEN)
  })
})

describe('readEpicContext — either spelling is read, both together are a finding', () => {
  it('reads the section out of a spec that carries the milestone spelling', () => {
    const r = readEpicContext(Fixture.specUnder(MilestoneContextHeading.MILESTONE))
    expect(r.content).toBe(Fixture.CONTEXT)
    expect(r.reason).toBeNull()
    expect(r.warnings).toEqual([])
  })

  it('reads the section out of a frozen spec that still carries the legacy spelling, with no warning about the spelling', () => {
    const r = readEpicContext(Fixture.specUnder(MilestoneContextHeading.EPIC))
    expect(r.content).toBe(Fixture.CONTEXT)
    expect(r.reason).toBeNull()
    expect(r.warnings).toEqual([])
  })

  it('refuses to choose between the two spellings in silence, and says which they are and where', () => {
    const r = readEpicContext(Fixture.specUnder(MilestoneContextHeading.MILESTONE, MilestoneContextHeading.EPIC))
    expect(r.content).toBeNull()
    expect(r.reason).toBe(EPIC_CONTEXT_REASONS.MALFORMED)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain(MilestoneContextHeading.MILESTONE)
    expect(r.warnings[0]).toContain(MilestoneContextHeading.EPIC)
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
    const d = diffIssue(Fixture.existing(Fixture.bodyUnder(MilestoneContextHeading.EPIC, Fixture.CONTEXT)), Fixture.wanted(), 'M1', [])
    expect(d.epicContextDiffers).toBe(false)
  })

  it('finds the section under the milestone heading too', () => {
    const d = diffIssue(Fixture.existing(Fixture.bodyUnder(MilestoneContextHeading.MILESTONE, Fixture.CONTEXT)), Fixture.wanted(), 'M1', [])
    expect(d.epicContextDiffers).toBe(false)
  })

  it('reports a body that carries both spellings as a finding that names both', () => {
    const d = diffIssue(Fixture.existing(Fixture.bodyUnderBothSpellings(Fixture.CONTEXT)), Fixture.wanted(), 'M1', [])
    expect(d.milestoneContextSpellings).toEqual([MilestoneContextHeading.MILESTONE, MilestoneContextHeading.EPIC])
    const line = formatDrift(d).find((l) => l.includes(MilestoneContextHeading.EPIC) && l.includes(MilestoneContextHeading.MILESTONE))
    expect(line).toMatch(/^note:/)
  })

  it('does not report two spellings when only one of them is in the body', () => {
    const d = diffIssue(Fixture.existing(Fixture.bodyUnder(MilestoneContextHeading.EPIC, Fixture.CONTEXT)), Fixture.wanted(), 'M1', [])
    expect(d.milestoneContextSpellings).toEqual([])
  })
})

describe('buildReconcileBody — the content is brought up to date, the spelling on disk is left alone', () => {
  it('rewrites the content under the legacy heading without renaming the heading', () => {
    const r = buildReconcileBody(Fixture.bodyUnder(MilestoneContextHeading.EPIC, '- una decision VIEJA'), Fixture.wanted({ epicContext: '- una decision NUEVA' }))
    expect(r.body).toContain(MilestoneContextHeading.EPIC)
    expect(r.body).not.toContain(MilestoneContextHeading.MILESTONE)
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
    const mapped = mapGhIssue(Fixture.issueCarrying(MilestoneContextHeading.EPIC))
    expect(mapped.milestoneContextHeading).toBe(MilestoneContextHeading.EPIC)
    const k = Fixture.kickoffFor(mapped.milestoneContextHeading)
    expect(k).toContain(MilestoneContextHeading.EPIC)
    expect(k).not.toContain(MilestoneContextHeading.MILESTONE)
  })

  it('names the milestone heading to an agent dispatched on an issue that carries it', () => {
    const mapped = mapGhIssue(Fixture.issueCarrying(MilestoneContextHeading.MILESTONE))
    expect(mapped.milestoneContextHeading).toBe(MilestoneContextHeading.MILESTONE)
    expect(Fixture.kickoffFor(mapped.milestoneContextHeading)).toContain(MilestoneContextHeading.MILESTONE)
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

describe('the vendored scope gate names the spelling the spec really carries', () => {
  const withoutScope = (heading) => [heading, '- nothing declared here', '', '## Out of scope / Protected'].join('\n')

  it('reports which heading it found when that section declares no paths', () => {
    const under = parseScope(withoutScope(MilestoneContextHeading.EPIC))
    expect(under.declared).toBe(false)
    expect(under.heading).toBe(MilestoneContextHeading.EPIC)
    expect(under.reason).toContain(MilestoneContextHeading.EPIC)
    expect(under.reason).not.toContain(MilestoneContextHeading.MILESTONE)
  })

  it('names the milestone heading when that is the one the spec carries', () => {
    const under = parseScope(withoutScope(MilestoneContextHeading.MILESTONE))
    expect(under.heading).toBe(MilestoneContextHeading.MILESTONE)
    expect(under.reason).toContain(MilestoneContextHeading.MILESTONE)
  })

  it('falls back to the heading the groom writes when the body carries no section at all', () => {
    const none = parseScope('## Out of scope / Protected\n- nada')
    expect(none.heading).toBeNull()
    expect(none.reason).toContain(MilestoneContextHeading.WRITTEN)
  })

  it('reports the heading it found even when the paths ARE declared', () => {
    expect(parseScope(Fixture.specWithScopeUnder(MilestoneContextHeading.EPIC)).heading)
      .toBe(MilestoneContextHeading.EPIC)
  })
})

describe('the scope gate reads the declared paths under either spelling', () => {
  it('finds the declaration under the milestone heading, which a re-vendored gate will meet', () => {
    expect(parseScope(Fixture.specWithScopeUnder(MilestoneContextHeading.MILESTONE))).toMatchObject({ declared: true, patterns: ['apps/web/**'] })
  })

  it('finds the declaration under the legacy heading, so no frozen spec loses its gate', () => {
    expect(parseScope(Fixture.specWithScopeUnder(MilestoneContextHeading.EPIC))).toMatchObject({ declared: true, patterns: ['apps/web/**'] })
  })
})
