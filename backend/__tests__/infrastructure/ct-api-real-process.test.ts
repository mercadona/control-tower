import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

class Entrypoint {
  static readonly opened: Entrypoint[] = []
  readonly child: ChildProcess
  readonly root: string
  readonly exited: Promise<void>
  readonly listening: Promise<number>

  constructor(root: string, script: string) {
    this.root = root
    this.child = spawn(process.execPath, [script], {
      env: { ...process.env, CT_API_PORT: '0', CLAUDE_CONFIG_DIR: root, CT_HARVEST_BQ_TABLE: '', PATH: '', SHELL: '/bin/sh' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.exited = new Promise((resolve) => { this.child.once('close', () => resolve()) })
    this.listening = new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const deadline = setTimeout(() => reject(new Error(`API did not print a port: ${stderr}`)), 30_000)
      this.child.stderr!.on('data', (chunk) => { stderr += String(chunk) })
      this.child.stdout!.on('data', (chunk) => {
        stdout += String(chunk)
        const newline = stdout.indexOf('\n')
        if (newline < 0) return
        clearTimeout(deadline)
        try { resolve((JSON.parse(stdout.slice(0, newline)) as { port: number }).port) }
        catch (failure) { reject(failure) }
      })
      this.child.once('error', (failure) => { clearTimeout(deadline); reject(failure) })
      this.child.once('close', (code) => {
        clearTimeout(deadline)
        reject(new Error(`API exited ${code}: ${stderr}`))
      })
    })
  }

  static async start(throughSymlink = false): Promise<Entrypoint> {
    const root = await mkdtemp(join(tmpdir(), 'ct-api-edge-'))
    const source = fileURLToPath(new URL('../../src/infrastructure/ct-api.ts', import.meta.url))
    const script = throughSymlink ? join(root, 'api entrypoint.ts') : source
    if (throughSymlink) await symlink(source, script)
    const started = new Entrypoint(root, script)
    Entrypoint.opened.push(started)
    return started
  }

  static async closeAll(): Promise<void> {
    for (const started of Entrypoint.opened.splice(0)) {
      if (started.child.exitCode === null && started.child.signalCode === null) started.child.kill('SIGTERM')
      await started.exited
      await rm(started.root, { recursive: true, force: true })
    }
  }
}

describe('the API executable edge', () => {
  afterEach(() => Entrypoint.closeAll())

  it('prints the port it actually bound', async () => {
    const started = await Entrypoint.start()
    expect(await started.listening).toBeGreaterThan(0)
  })

  it('a request through the symlinked executable reaches the real session query', async () => {
    const started = await Entrypoint.start(true)
    const port = await started.listening
    const response = await fetch(`http://127.0.0.1:${port}/sessions`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sessions: [] })
  })
})
