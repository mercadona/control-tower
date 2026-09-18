import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

class MakeEntrypoint {
  static readonly ROOT = fileURLToPath(new URL('../../../', import.meta.url))
  static readonly roots: string[] = []
  static readonly children: { child: ChildProcess, exited: Promise<void> }[] = []

  static environment(): NodeJS.ProcessEnv {
    const environment = { ...process.env }
    delete environment.CLAUDE_CONFIG_DIR
    delete environment.MAKEFLAGS
    delete environment.MAKEOVERRIDES
    return environment
  }

  static async directory(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'ct-api-make-'))
    MakeEntrypoint.roots.push(root)
    return root
  }

  static async command(claudeConfigDirectory?: string): Promise<string> {
    const cwd = await MakeEntrypoint.directory()
    const argv = ['--dry-run', '-f', join(MakeEntrypoint.ROOT, 'Makefile'), 'CT_API_PORT=8787', 'CT_HARVEST_BQ_TABLE=']
    if (claudeConfigDirectory !== undefined) argv.push(`CLAUDE_CONFIG_DIR=${claudeConfigDirectory}`)
    argv.push('run-backend')
    const output = execFileSync('make', argv, { cwd, env: MakeEntrypoint.environment(), encoding: 'utf8', timeout: 30000 })
    const command = output.split('\n').find((line) => line.includes('node backend/src/infrastructure/ct-api.ts'))
    if (command === undefined) throw new Error(`make run-backend did not print the backend invocation: ${output}`)
    return command
  }

  static async start(): Promise<number> {
    const root = await MakeEntrypoint.directory()
    const child = spawn('make', ['--silent', 'start'], {
      cwd: MakeEntrypoint.ROOT, detached: true,
      env: { ...MakeEntrypoint.environment(), CT_API_PORT: '0', CLAUDE_CONFIG_DIR: root, CT_HARVEST_BQ_TABLE: '', SHELL: '/bin/sh' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exited = new Promise<void>((resolve) => { child.once('close', () => resolve()) })
    MakeEntrypoint.children.push({ child, exited })
    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => reject(new Error(`make start did not print a port: ${stderr}`)), 30000)
      child.stderr.on('data', (chunk) => { stderr += String(chunk) })
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
        const line = stdout.split('\n').find((line) => line.startsWith('{"port":'))
        if (line === undefined) return
        clearTimeout(timer)
        try { resolve((JSON.parse(line) as { port: number }).port) } catch (failure) { reject(failure) }
      })
      child.once('error', (failure) => { clearTimeout(timer); reject(failure) })
      child.once('close', (code) => { clearTimeout(timer); reject(new Error(`make start exited ${code}: ${stderr}`)) })
    })
  }

  static async clean(): Promise<void> {
    for (const { child, exited } of MakeEntrypoint.children.splice(0)) {
      if (child.pid !== undefined) {
        try { process.kill(-child.pid, 'SIGTERM') } catch (failure) {
          if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') throw failure
        }
      }
      await exited
    }
    for (const root of MakeEntrypoint.roots.splice(0)) await rm(root, { recursive: true, force: true })
  }
}

describe('the supported Make entrypoints', () => {
  afterEach(() => MakeEntrypoint.clean())

  it('existing entrypoints start without an activation setting', async () => {
    expect(await MakeEntrypoint.start()).toBeGreaterThan(0)
  })

  it('run-backend omits an absent Claude configuration directory', async () => {
    expect(await MakeEntrypoint.command()).toBe('CT_API_PORT=8787  CT_HARVEST_BQ_TABLE= node backend/src/infrastructure/ct-api.ts')
  })

  it('run-backend preserves an explicitly configured Claude directory', async () => {
    expect(await MakeEntrypoint.command('/tmp/ct-explicit-config')).toBe('CT_API_PORT=8787 CLAUDE_CONFIG_DIR=/tmp/ct-explicit-config CT_HARVEST_BQ_TABLE= node backend/src/infrastructure/ct-api.ts')
  })
})
