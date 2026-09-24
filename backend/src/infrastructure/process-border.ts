import { execFile, spawn } from 'node:child_process'
import { spawn as ptySpawn } from 'node-pty'
import { ProcessRunner } from './process-runner.ts'
import type { LaunchedProcess, LaunchOptions, RunAndWaitOptions, RunOutcome } from './process-runner.ts'
import { ProcessTable } from './process-table.ts'
import type { TableRead, Terminal, TerminalOptions } from './process-table.ts'

export class SystemProcesses extends ProcessRunner implements ProcessTable {
  runAndWait(binary: string, argv: readonly string[], options: RunAndWaitOptions): Promise<RunOutcome> {
    return new Promise((resolve) => {
      execFile(binary, [...argv], { cwd: options.cwd, env: options.env, timeout: options.timeoutMs }, (failure, stdout, stderr) => {
        resolve({
          failure: failure === null ? null : {
            code: failure.code ?? null,
            killed: failure.killed,
            signal: failure.signal,
            message: failure.message,
          },
          stdout,
          stderr,
        })
      })
    })
  }

  launch(binary: string, argv: readonly string[], options: LaunchOptions): LaunchedProcess {
    return spawn(binary, [...argv], {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
      detached: options.detached,
      stdio: [...options.stdio],
    })
  }

  signal(pid: number, signal: NodeJS.Signals | 0): void {
    process.kill(pid, signal)
  }

  readTable(read: TableRead): Promise<string> {
    return new Promise((resolve, reject) => {
      let callbackSettled = false
      let childClosed = false
      let failure: Error | null = null
      let stdout = ''
      const settle = (): void => {
        if (!callbackSettled || !childClosed) return
        if (failure !== null) reject(failure)
        else resolve(stdout)
      }
      let child
      try {
        child = execFile('/bin/ps', ['-axo', 'pid=,pgid=,lstart='], {
          encoding: 'utf8',
          timeout: read.timeoutMs,
          killSignal: 'SIGKILL',
          maxBuffer: read.maxBufferBytes,
          env: { ...process.env, LC_ALL: 'C' },
          signal: read.abort,
        }, (error, output) => {
          failure = error
          stdout = output
          callbackSettled = true
          settle()
        })
      } catch (cause) {
        reject(cause)
        return
      }
      child.once('close', () => {
        childClosed = true
        settle()
      })
    })
  }

  openTerminal(file: string, argv: string[], options: TerminalOptions): Terminal {
    return ptySpawn(file, argv, options)
  }
}
