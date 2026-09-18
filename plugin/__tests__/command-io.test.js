import { describe, expect, it } from 'vitest'
import { CommandFailure, CommandIo } from '../scripts/command-io.js'

class ToolMother {
  static recording(output) {
    const calls = []
    return { calls, run: (argv, options) => { calls.push({ argv, options }); return output } }
  }

  static ready(output = { code: 0, stdout: 'literal output\n', stderr: '' }) {
    return { git: ToolMother.recording(output), shell: ToolMother.recording(output), scripts: ToolMother.recording(output) }
  }
}

describe('command IO preserves the executable boundary contract', () => {
  it.each([['git', 'git'], ['sh', 'shell']])('%s uses its own port with literal argv and bounds', (bin, port) => {
    const io = ToolMother.ready()
    const options = { cwd: '/repo with spaces', input: 'input', timeout: 120000, maxBuffer: 67108864, killSignal: 'SIGKILL', stdio: ['pipe', 'pipe', 'pipe'] }
    expect(CommandIo.execFile(io, bin, ['one argument', '--', 'two'], options)).toBe('literal output\n')
    expect(io[port].calls).toEqual([{ argv: ['one argument', '--', 'two'], options }])
    expect(io.scripts.calls).toEqual([])
  })

  it('a plugin script names the executable inside the script port request', () => {
    const io = ToolMother.ready()
    CommandIo.execFile(io, '/plugin/task-brief', ['--with-plan-context', 'plan.md', '1', '/repo/brief.md'], { cwd: '/repo' })
    expect(io.scripts.calls).toEqual([{ argv: ['/plugin/task-brief', '--with-plan-context', 'plan.md', '1', '/repo/brief.md'], options: { cwd: '/repo' } }])
    expect(io.git.calls).toEqual([])
    expect(io.shell.calls).toEqual([])
  })

  it('an ordinary nonzero exit retains both output streams and numeric status', () => {
    const io = ToolMother.ready({ code: 127, stdout: 'partial', stderr: 'not found' })
    expect(() => CommandIo.execFile(io, 'sh', ['-c', 'missing'])).toThrow(CommandFailure)
    try { CommandIo.execFile(io, 'sh', ['-c', 'missing']) } catch (failure) {
      expect({ status: failure.status, stdout: failure.stdout, stderr: failure.stderr }).toEqual({ status: 127, stdout: 'partial', stderr: 'not found' })
    }
  })

  it('a timeout has no ordinary exit status and cannot be interpreted as a Git refusal', () => {
    const io = ToolMother.ready({ code: 1, stdout: '', stderr: '', signal: 'SIGKILL', error: { code: 'ETIMEDOUT', message: 'timed out' } })
    expect(() => CommandIo.execFile(io, 'git', ['merge'])).toThrow('timed out')
    try { CommandIo.execFile(io, 'git', ['merge']) } catch (failure) {
      expect(failure.status).toBeNull()
      expect(failure.code).toBe('ETIMEDOUT')
      expect(failure.signal).toBe('SIGKILL')
    }
  })
})
