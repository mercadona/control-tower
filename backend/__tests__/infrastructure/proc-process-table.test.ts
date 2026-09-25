import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProcProcessTable } from '../../src/infrastructure/proc-process-table.ts'
import type { TableRead } from '../../src/infrastructure/process-table.ts'

class ProcTree {
  static make(): string {
    return mkdtempSync(join(tmpdir(), 'proc-process-table-'))
  }

  static withProcess(root: string, pid: number, command: string, processGroup: number, startTicks: number): void {
    mkdirSync(join(root, String(pid)))
    const afterCommand = ['S', '1', String(processGroup), String(processGroup), '0', '-1', '4194560',
      '0', '0', '0', '0', '0', '0', '0', '0', '20', '0', '1', '0', String(startTicks), '0', '0']
    writeFileSync(join(root, String(pid), 'stat'), `${pid} (${command}) ${afterCommand.join(' ')}\n`)
  }

  static withVanishedProcess(root: string, pid: number): void {
    mkdirSync(join(root, String(pid)))
  }

  static withEntry(root: string, name: string): void {
    mkdirSync(join(root, name))
  }
}

class Reads {
  static open(): TableRead {
    return { abort: new AbortController().signal, timeoutMs: 500, maxBufferBytes: 4_194_304 }
  }

  static aborted(): TableRead {
    const controller = new AbortController()
    controller.abort()

    return { abort: controller.signal, timeoutMs: 500, maxBufferBytes: 4_194_304 }
  }
}

describe('the process table read from /proc', () => {
  it('each process is reported with its process group and its start ticks', async () => {
    const root = ProcTree.make()
    try {
      ProcTree.withProcess(root, 67996, 'claude', 67996, 11585546)
      ProcTree.withProcess(root, 68001, 'node', 67996, 11585600)

      const table = await new ProcProcessTable({ root }).read(Reads.open())

      expect(table.trim().split('\n').sort()).toEqual(['67996 67996 @11585546', '68001 67996 @11585600'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a command name carrying spaces and parentheses does not shift the fields after it', async () => {
    const root = ProcTree.make()
    try {
      ProcTree.withProcess(root, 4101, 'tmux: server) (x', 4100, 900)

      const table = await new ProcProcessTable({ root }).read(Reads.open())

      expect(table).toBe('4101 4100 @900\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('entries that are not processes, and a process that exited while the table was read, are left out', async () => {
    const root = ProcTree.make()
    try {
      ProcTree.withProcess(root, 4101, 'claude', 4101, 900)
      ProcTree.withVanishedProcess(root, 4102)
      ProcTree.withEntry(root, 'self')
      ProcTree.withEntry(root, 'sys')

      const table = await new ProcProcessTable({ root }).read(Reads.open())

      expect(table).toBe('4101 4101 @900\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('an aborted read is refused instead of answering with a partial table', async () => {
    const root = ProcTree.make()
    try {
      ProcTree.withProcess(root, 4101, 'claude', 4101, 900)

      await expect(new ProcProcessTable({ root }).read(Reads.aborted())).rejects.toThrow('aborted')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
