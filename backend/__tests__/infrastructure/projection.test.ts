import { describe, expect, it } from 'vitest'
import { Projection } from '../../src/infrastructure/projection.ts'

class Alpha {}
class Beta {}

class ProjectionMother {
  static readonly WHAT = 'fixture line'

  static declaring(entries: Iterable<readonly [unknown, string | undefined]>): Projection<string | undefined> {
    return new Projection(ProjectionMother.WHAT, entries)
  }
}

describe('Projection', () => {
  it('projects a declared member and lists the members it knows', () => {
    const projection = ProjectionMother.declaring([[Alpha, 'a'], [Beta, 'b']])

    expect(projection.of(Alpha)).toBe('a')
    expect(projection.members()).toEqual([Alpha, Beta])
  })

  it('refuses a member nobody declared, naming what was asked for and who asked', () => {
    const projection = ProjectionMother.declaring([[Alpha, 'a']])

    expect(() => projection.of(Beta)).toThrow('no fixture line declared for Beta')
  })

  it('refuses to be built with undefined as a value, so a declared undefined can never read as an undeclared member', () => {
    expect(() => ProjectionMother.declaring([[Alpha, 'a'], [Beta, undefined]]))
      .toThrow('fixture line declares undefined for Beta')
  })
})
