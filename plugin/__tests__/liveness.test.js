import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { assessLocalLiveness, liveSliceProcesses } from '../scripts/liveness.js'

// assessLocalLiveness answers "is there any trace of this slice on this
// machine?", which is NOT the same as "is anyone working on it right now?". The
// distinction matters and it is not theoretical: a slice that dies halfway
// leaves worktree and branch on disk, so this function keeps seeing it alive.
describe('assessLocalLiveness', () => {
  const withRepo = (fn) => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-liveness-'))
    try { return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
  }

  it('with a worktree on disk it does not query cmux: ONE signal is enough for no note to be emitted', () => {
    withRepo((repoRoot) => {
      mkdirSync(join(repoRoot, '.worktrees/7'), { recursive: true })
      let queried = false
      const r = assessLocalLiveness(7, () => { queried = true; return [] }, { repoRoot, timeoutMs: 1000 })
      expect(r.hasWorktree).toBe(true)
      expect(queried).toBe(false)
      expect(r.cmuxChecked).toBe(false)
    })
  })

  it('with neither worktree nor branch it DOES query cmux, and finds the window by its number', () => {
    withRepo((repoRoot) => {
      const r = assessLocalLiveness(7, () => ['algún-repo · #7 hacer cosas'], { repoRoot, timeoutMs: 1000 })
      expect(r.hasWorktree).toBe(false)
      expect(r.hasCmuxWorkspace).toBe(true)
      expect(r.cmuxChecked).toBe(true)
    })
  })

  it('#7 does not match #71: the number is compared as a whole token', () => {
    withRepo((repoRoot) => {
      const r = assessLocalLiveness(7, () => ['repo · #71 otra cosa'], { repoRoot, timeoutMs: 1000 })
      expect(r.hasCmuxWorkspace).toBe(false)
    })
  })

  it('cmux not queryable → cmuxChecked false, and it is NOT asserted that there is no session', () => {
    withRepo((repoRoot) => {
      const r = assessLocalLiveness(7, () => null, { repoRoot, timeoutMs: 1000 })
      expect(r.cmuxChecked).toBe(false)
      expect(r.hasCmuxWorkspace).toBe(false)
    })
  })
})

// The output of `lsof -Fpn` is triplets: p<pid> / fcwd / n<path>.
const fakeLsof = (pairs) => pairs.map(([pid, cwd]) => `p${pid}\nfcwd\nn${cwd}`).join('\n') + '\n'

// The output of `ps -o pid=,comm=`: the pid right-aligned, one space, and ALL
// the rest of the line is the path the process was invoked with — spaces
// included. Reproduced exactly as macOS emits it.
const fakePs = (pairs) => pairs.map(([pid, path]) => `${String(pid).padStart(6, ' ')} ${path}`).join('\n') + '\n'

// The REAL paths of the desktop app on this machine, copied from
// `ps -u <uid> -o pid=,comm=`. None of them is an agent working in a worktree:
// they are one open window and its Electron helpers.
const DESKTOP_APP = [
  [69229, '/Applications/Claude.app/Contents/MacOS/Claude'],
  [69266, '/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper'],
  [69292, '/Applications/Claude.app/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer)'],
  [69380, '/Applications/Claude.app/Contents/Frameworks/Claude Helper (Plugin).app/Contents/MacOS/Claude Helper (Plugin)'],
  [90823, '/Applications/Claude.app/Contents/Helpers/chrome-native-host'],
]

describe('liveSliceProcesses', () => {
  const root = '/repo'

  it('it maps every process to its slice by the segment that follows .worktrees/', () => {
    const run = (cmd) => cmd === 'ps' ? fakePs([[100, '/Users/x/.local/bin/claude'], [200, '/Users/x/.local/bin/claude']]) : fakeLsof([
      ['100', '/repo/.worktrees/7'],
      ['200', '/otro/sitio'],
    ])
    const r = liveSliceProcesses(root, { run })
    expect(r.comprobado).toBe(true)
    expect([...r.porSlice]).toEqual([['7', '100']])
  })

  it('a cwd DEEPER than the root of the worktree counts just the same', () => {
    const run = (cmd) => cmd === 'ps' ? fakePs([[100, '/Users/x/.local/bin/claude']]) : fakeLsof([['100', '/repo/.worktrees/9/apps/backend']])
    expect([...liveSliceProcesses(root, { run }).porSlice]).toEqual([['9', '100']])
  })

  it('what identifies it is the invoked PATH, not the process name: the one from the native installer is the version number', () => {
    // Measured on macOS: `~/.local/bin/claude` is a symlink to
    // `~/.local/share/claude/versions/<version>`, and the process name
    // (`ps -o ucomm=`) comes out as "2.1.221" — the version number, which
    // changes with every update. The `comm` column keeps the invoked path, and
    // that one does say `claude`. It is the case `pgrep -x claude` did not
    // cover.
    const run = (cmd) => cmd === 'ps' ? fakePs([[18539, '/Users/jpereag/.local/bin/claude']]) : fakeLsof([['18539', '/repo/.worktrees/7']])
    expect([...liveSliceProcesses(root, { run }).porSlice]).toEqual([['7', '18539']])
  })

  it('the DESKTOP app does not count as an agent, and does not even reach lsof', () => {
    // `Claude` (capitalised) and `Claude Helper` do not have basename
    // `claude`, so the exact match leaves them out with no special rule at all.
    // A lax match would assert there is an agent where there is only an open
    // window.
    const calls = []
    const run = (cmd) => {
      calls.push(cmd)
      return cmd === 'ps' ? fakePs(DESKTOP_APP) : ''
    }
    const r = liveSliceProcesses(root, { run })
    expect(calls).toEqual(['ps'])
    expect(r.comprobado).toBe(true)
    expect(r.porSlice.size).toBe(0)
  })

  it('a path WITH SPACES is not split: only its basename counts', () => {
    // The `ps` line cannot be chopped up on spaces (the paths of the desktop
    // helpers carry them inside). The pid is the first field and everything
    // else is the path.
    const run = (cmd) => cmd === 'ps'
      ? fakePs([...DESKTOP_APP, [777, '/Users/x/Mis Herramientas/claude']])
      : fakeLsof([['777', '/repo/.worktrees/4']])
    expect([...liveSliceProcesses(root, { run }).porSlice]).toEqual([['4', '777']])
  })

  it('with no claude process at all it is a VALID answer, not a failure', () => {
    const run = (cmd) => {
      if (cmd === 'ps') return fakePs([[1, '/sbin/launchd'], [2, '/usr/bin/ssh']])
      throw new Error('no se debe llamar a lsof con la lista vacía')
    }
    const r = liveSliceProcesses(root, { run })
    expect(r.comprobado).toBe(true)
    expect(r.porSlice.size).toBe(0)
    expect(r.motivo).toBeNull()
  })

  it('a ps that fails is "could not be checked", never an empty list taken as good', () => {
    const run = () => { const e = new Error('ps: not found'); e.status = 127; throw e }
    const r = liveSliceProcesses(root, { run })
    expect(r.comprobado).toBe(false)
    expect(r.motivo).toMatch(/ps/)
  })

  it('an lsof that fails is "could not be checked", never "nobody is alive"', () => {
    const run = (cmd) => {
      if (cmd === 'ps') return fakePs([[100, '/Users/x/.local/bin/claude']])
      const e = new Error('lsof: command not found'); e.status = 127; throw e
    }
    const r = liveSliceProcesses(root, { run })
    expect(r.comprobado).toBe(false)
    expect(r.porSlice.size).toBe(0)
    expect(r.motivo).toMatch(/lsof/)
  })

  it('it never calls lsof with an empty pid list', () => {
    // Measured: `lsof -a -p "" -d cwd -Fpn` does NOT return anything empty —
    // it returns the cwd of every readable process on the machine, with rc=0
    // (399 entries in the measured run), because an empty PID list restricts
    // nothing. Without this guard, every worktree would come out with a "live"
    // process inside.
    const calls = []
    const run = (cmd) => { calls.push(cmd); return cmd === 'ps' ? '\n' : '' }
    liveSliceProcesses(root, { run })
    expect(calls).toEqual(['ps'])
  })

  it('ps is narrowed to the current user and asks for pid+comm, with timeout and killSignal', () => {
    // `-u <uid>`: without narrowing, the list would bring in processes of
    // other users, and that is exactly what makes reading lsof's partial stdout
    // safe. `timeout`+`killSignal`: `lsof` hangs on a dead network mount, and a
    // command meant to run in a loop cannot end up returning no exit code at
    // all.
    const calls = []
    const run = (cmd, args, options) => {
      calls.push([cmd, args, options])
      return cmd === 'ps' ? fakePs([[100, '/Users/x/.local/bin/claude']]) : fakeLsof([['100', '/repo/.worktrees/7']])
    }
    liveSliceProcesses(root, { run })
    expect(calls[0][0]).toBe('ps')
    expect(calls[0][1]).toEqual(['-u', String(process.getuid()), '-o', 'pid=,comm='])
    expect(calls[1][0]).toBe('lsof')
    for (const [, , options] of calls) {
      expect(options.killSignal).toBe('SIGKILL')
      expect(options.timeout).toBeGreaterThan(0)
    }
  })

  it('with no process.getuid available it degrades to "could not be checked", never to an unnarrowed listing', () => {
    const original = process.getuid
    try {
      process.getuid = undefined
      const calls = []
      const run = (cmd) => { calls.push(cmd); return '' }
      const r = liveSliceProcesses(root, { run })
      expect(r.comprobado).toBe(false)
      expect(r.motivo).toMatch(/getuid|usuario/)
      expect(calls).toEqual([])
    } finally {
      process.getuid = original
    }
  })

  it('a PID that dies between ps and lsof does not break the signal: the partial stdout of rc=1 is read', () => {
    // Measured: `lsof -a -p <alive,dead> -d cwd -Fpn` exits with rc=1 but
    // brings in stdout the PIDs that are still alive.
    const run = (cmd) => {
      if (cmd === 'ps') return fakePs([[100, '/Users/x/.local/bin/claude'], [999999, '/Users/x/.local/bin/claude']])
      const e = new Error('lsof: no such process (999999)')
      e.status = 1
      e.stdout = fakeLsof([['100', '/repo/.worktrees/7']])
      throw e
    }
    const r = liveSliceProcesses(root, { run })
    expect(r.comprobado).toBe(true)
    expect([...r.porSlice]).toEqual([['7', '100']])
  })

  it('only rc=1 enables reading the partial stdout: an lsof killed by the timeout is NOT taken as good', () => {
    // A `timeout` from execFileSync arrives with `status: null` and can bring
    // a `stdout` cut in half. Without the `status === 1` half of the condition,
    // that truncated stdout would be read as a complete read and the report
    // would assert "nobody is alive" over half the data.
    const run = (cmd) => {
      if (cmd === 'ps') return fakePs([[100, '/Users/x/.local/bin/claude'], [200, '/Users/x/.local/bin/claude']])
      const e = new Error('spawnSync lsof ETIMEDOUT')
      e.status = null
      e.killed = true
      e.stdout = fakeLsof([['100', '/repo/.worktrees/7']])
      throw e
    }
    const r = liveSliceProcesses(root, { run })
    expect(r.comprobado).toBe(false)
    expect(r.porSlice.size).toBe(0)
    expect(r.motivo).toMatch(/lsof/)
  })

  it('if ALL the pids die before lsof (rc=1, empty stdout), it is "nobody alive", not a failure', () => {
    const run = (cmd) => {
      if (cmd === 'ps') return fakePs([[999999, '/Users/x/.local/bin/claude']])
      const e = new Error('lsof: no such process (999999)')
      e.status = 1
      e.stdout = ''
      throw e
    }
    const r = liveSliceProcesses(root, { run })
    expect(r.comprobado).toBe(true)
    expect(r.porSlice.size).toBe(0)
    expect(r.motivo).toBeNull()
  })
})
