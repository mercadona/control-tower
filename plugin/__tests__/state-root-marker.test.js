import { describe, expect, it } from 'vitest'
import { StateRootMarker } from '../scripts/state-root-marker.js'

class Machine {
  static ACCOUNT = '/account'
  static HOME = '/home/person'
  static DEFAULT_ROOT = '/account/control-tower'
  static SEPARATED = '/isolated/state'
  static BACKEND = 4242

  static account() { return { configDir: Machine.ACCOUNT, home: Machine.HOME } }
}

class Published {
  static AT = '2026-09-20T01:00:00.000Z'

  static by(root, pid = Machine.BACKEND) {
    return StateRootMarker.contentFor(root, { pid, at: Published.AT })
  }

  static missing() { return () => { const failure = new Error('no such file'); failure.code = 'ENOENT'; throw failure } }
  static unreadable() { return () => { throw new Error('permission denied') } }
  static garbage() { return () => 'not json at all' }
  static naming(root, pid = Machine.BACKEND) { return () => Published.by(root, pid) }
}

class Asked {
  static about(mine, read, { alive = () => true } = {}) {
    return StateRootMarker.disagreementWith(mine, { ...Machine.account(), read, alive })
  }
}

describe('where the backend publishes the root it resolved', () => {
  it('is_the_account_relative_default_which_every_reader_computes_without_the_variable_in_dispute', () => {
    expect(StateRootMarker.pathIn(Machine.account())).toBe('/account/control-tower/state-root.json')
    expect(StateRootMarker.pathIn({ home: Machine.HOME })).toBe('/home/person/.claude/control-tower/state-root.json')
  })

  it('names_the_root_the_pid_and_when_so_a_reader_can_tell_a_live_backend_from_a_leftover', () => {
    const published = JSON.parse(Published.by(Machine.SEPARATED))

    expect(published).toEqual({ root: Machine.SEPARATED, pid: Machine.BACKEND, at: Published.AT })
  })
})

describe('a command comparing its own root against the published one', () => {
  it('says_nothing_when_they_are_the_same_root', () => {
    expect(Asked.about(Machine.SEPARATED, Published.naming(Machine.SEPARATED))).toBe(null)
    expect(Asked.about(Machine.DEFAULT_ROOT, Published.naming(Machine.DEFAULT_ROOT))).toBe(null)
  })

  it('says_nothing_when_nobody_published_because_a_silence_is_not_a_disagreement', () => {
    expect(Asked.about(Machine.DEFAULT_ROOT, Published.missing())).toBe(null)
    expect(Asked.about(Machine.DEFAULT_ROOT, Published.unreadable())).toBe(null)
    expect(Asked.about(Machine.DEFAULT_ROOT, Published.garbage())).toBe(null)
  })

  it('names_both_roots_and_the_variable_when_a_live_backend_keeps_its_state_somewhere_else', () => {
    const said = Asked.about(Machine.DEFAULT_ROOT, Published.naming(Machine.SEPARATED))

    expect(said).toContain('CT_STATE_DIR')
    expect(said).toContain(Machine.SEPARATED)
    expect(said).toContain(Machine.DEFAULT_ROOT)
    expect(said).toContain(String(Machine.BACKEND))
  })

  it('ignores_a_leftover_of_a_backend_that_is_no_longer_running_which_is_the_limit_this_accepts', () => {
    expect(Asked.about(Machine.DEFAULT_ROOT, Published.naming(Machine.SEPARATED), { alive: () => false })).toBe(null)
  })

  it('does_not_trust_a_published_root_that_is_not_an_absolute_path', () => {
    for (const published of ['relative/state', '', null, 42]) {
      expect(Asked.about(Machine.DEFAULT_ROOT, Published.naming(published))).toBe(null)
    }
  })

  it('never_throws_whatever_is_on_disk_because_a_broken_marker_must_not_stop_a_command', () => {
    expect(() => Asked.about(Machine.DEFAULT_ROOT, Published.unreadable())).not.toThrow()
    expect(() => Asked.about(Machine.DEFAULT_ROOT, () => '{"root":{}}')).not.toThrow()
    expect(() => Asked.about(Machine.DEFAULT_ROOT, Published.naming(Machine.SEPARATED), {
      alive: () => { throw new Error('EPERM') },
    })).not.toThrow()
  })
})
