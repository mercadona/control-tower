import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type StartedEntrypoint = {
  port: number,
  pid: number,
  saidLater: () => string,
  descendants: () => number[],
  crash: () => Promise<void>,
}

export type Refusal = { status: number | null, said: string[] }

export class Entrypoint {
  static readonly #PATH = join(
    dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'infrastructure', 'ct-api.ts'
  )
  static readonly #ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
  static readonly #TIMEOUT_MS = 30_000
  static readonly #spawned: ChildProcess[] = []
  static readonly #configs: string[] = []

  static async isolated(environment: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
    let config = environment.CLAUDE_CONFIG_DIR
    if (config === undefined) {
      config = await mkdtemp(join(tmpdir(), 'ct-api-isolated-config-'))
      Entrypoint.#configs.push(config)
    }
    return { ...process.env, ...environment, CT_STATE_DIR: environment.CT_STATE_DIR, CLAUDE_CONFIG_DIR: config }
  }

  static async killAll(): Promise<void> {
    const pids = new Set<number>()
    for (const child of Entrypoint.#spawned.splice(0)) {
      for (const descendant of Entrypoint.descendantsOf(child.pid)) pids.add(descendant)
      if (child.pid !== undefined) pids.add(child.pid)
    }
    await Promise.all([...pids].map((pid) => Entrypoint.killPid(pid)))
    await Promise.all(Entrypoint.#configs.splice(0).map((config) => rm(config, { recursive: true, force: true })))
  }

  static descendantsOf(pid: number | undefined): number[] {
    if (pid === undefined) return []
    const direct = Entrypoint.#directChildrenOf(pid)

    return direct.flatMap((child) => [child, ...Entrypoint.descendantsOf(child)])
  }

  static #directChildrenOf(pid: number): number[] {
    try {
      return execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .map(Number)
    } catch {
      return []
    }
  }

  static alive(pid: number): boolean {
    try {
      process.kill(pid, 0)
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code === 'ESRCH') return false
      throw failure
    }

    return true
  }

  static async killPid(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code === 'ESRCH') return
      throw failure
    }
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (!Entrypoint.alive(pid)) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`fixture process ${pid} did not exit within 5000ms`)
  }

  static async refused(environment: NodeJS.ProcessEnv): Promise<Refusal> {
    const isolated = await Entrypoint.isolated(environment)
    const child = spawn(process.execPath, [Entrypoint.#PATH], {
      env: isolated,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    Entrypoint.#spawned.push(child)
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })

    return new Promise<Refusal>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`it never exited, and said ${JSON.stringify(stderr)}`)), Entrypoint.#TIMEOUT_MS
      )
      child.once('close', (status) => {
        clearTimeout(timer)
        resolve({ status, said: stderr.split('\n') })
      })
      child.once('error', reject)
    })
  }

  static async listening(environment: NodeJS.ProcessEnv): Promise<number> {
    return (await Entrypoint.started(environment)).port
  }

  static #asOverridesThatBeatALocalEnvFile(environment: NodeJS.ProcessEnv): string[] {
    return Object.entries(environment).map(([name, value]) => `${name}=${value ?? ''}`)
  }

  static async makeRunBackendWithoutReinstalling(environment: NodeJS.ProcessEnv): Promise<number> {
    const isolated = await Entrypoint.isolated(environment)
    const child = spawn('make', [
      '--silent', '-o', 'install-backend', 'run-backend',
      ...Entrypoint.#asOverridesThatBeatALocalEnvFile(environment),
      `CT_STATE_DIR=${isolated.CT_STATE_DIR ?? ''}`,
      `CLAUDE_CONFIG_DIR=${isolated.CLAUDE_CONFIG_DIR}`,
    ], {
      cwd: Entrypoint.#ROOT,
      env: isolated,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    Entrypoint.#spawned.push(child)
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    return new Promise<number>((resolve, reject) => {
      let stdout = ''
      const timer = setTimeout(
        () => reject(new Error(`make run-backend did not print a port: ${stderr}`)), Entrypoint.#TIMEOUT_MS
      )
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
        const line = stdout.split('\n').find((candidate) => candidate.startsWith('{"port":'))
        if (line === undefined) return
        clearTimeout(timer)
        resolve((JSON.parse(line) as { port: number }).port)
      })
      child.once('error', reject)
      child.once('close', (code) => reject(new Error(`make run-backend exited ${String(code)}: ${stderr}`)))
    })
  }

  static async makeRunBackendCommand(claudeConfigDirectory?: string): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), 'ct-api-make-run-backend-'))
    const environment = { ...process.env }
    delete environment.CLAUDE_CONFIG_DIR
    delete environment.MAKEFLAGS
    delete environment.MAKEOVERRIDES
    const argv = [
      '--dry-run', '-f', join(Entrypoint.#ROOT, 'Makefile'),
      'CT_API_PORT=8787', 'CT_HARVEST_BQ_TABLE=',
    ]
    if (claudeConfigDirectory !== undefined) argv.push(`CLAUDE_CONFIG_DIR=${claudeConfigDirectory}`)
    argv.push('run-backend')
    try {
      const output = execFileSync('make', argv, {
        cwd, env: environment, encoding: 'utf8', timeout: Entrypoint.#TIMEOUT_MS,
      })
      const command = output.split('\n').find((line) => line.includes('node backend/src/infrastructure/ct-api.ts'))
      if (command === undefined) throw new Error(`make run-backend did not print the backend invocation: ${output}`)
      return command
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }

  static async started(environment: NodeJS.ProcessEnv): Promise<StartedEntrypoint> {
    const isolated = await Entrypoint.isolated(environment)
    const child = spawn(process.execPath, [Entrypoint.#PATH], {
      env: isolated,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    Entrypoint.#spawned.push(child)
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })

    return new Promise<StartedEntrypoint>((resolve, reject) => {
      let stdout = ''
      const timer = setTimeout(() => reject(new Error(`no port line in ${stdout}`)), Entrypoint.#TIMEOUT_MS)
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
        const end = stdout.indexOf('\n')
        if (end === -1) return
        clearTimeout(timer)
        const pid = child.pid
        if (pid === undefined) {
          reject(new Error('the entrypoint bound a port without ever having a pid'))
          return
        }
        resolve({
          port: (JSON.parse(stdout.slice(0, end)) as { port: number }).port,
          pid,
          saidLater: () => stderr,
          descendants: () => Entrypoint.descendantsOf(pid),
          crash: () => Entrypoint.killPid(pid),
        })
      })
      child.once('error', reject)
    })
  }

  static async recovering(environment: NodeJS.ProcessEnv): Promise<StartedEntrypoint> {
    const started = await Entrypoint.started(environment)
    for (let waited = 0; waited < 60; waited += 1) {
      if (started.saidLater().includes('plans in flight:')) break
      await new Promise((wake) => setTimeout(wake, 100))
    }

    return started
  }
}

export class TheCoordinatingSession {
  static readonly #TRIES = 100
  static readonly #WAIT_MS = 100

  static async recoveredBy(port: number): Promise<{ status: string }> {
    for (let tried = 0; tried < TheCoordinatingSession.#TRIES; tried += 1) {
      const answered = await (await fetch(`http://127.0.0.1:${port}/coordinating-session`)).json() as { status: string }
      if (answered.status !== 'none') return answered
      await new Promise((wake) => setTimeout(wake, TheCoordinatingSession.#WAIT_MS))
    }
    throw new Error('the recorded conversation was never recovered')
  }
}
