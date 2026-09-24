import { execFile, spawn } from 'node:child_process'
import { ProcessRunner } from './process-runner.ts'
import type { LaunchedProcess, LaunchOptions, RunAndWaitOptions, RunOutcome } from './process-runner.ts'

export class SystemProcesses extends ProcessRunner {
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
}
