import { link, mkdtemp, readFile, rm } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import type { PathLike } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'

describe('HeadlessFiles', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('publication is atomic and never replaces an existing file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-headless-files-'))
    roots.push(root)
    let linkedBytes: string | null = null
    const observed = {
      ...fs,
      link: async (existingPath: PathLike, newPath: PathLike) => {
        linkedBytes = await readFile(existingPath, 'utf8')
        await link(existingPath, newPath)
      },
    }
    const files = new HeadlessFiles({ root, fs: observed, newId: () => 'temporary-record' })
    const path = files.dispatchPath('11111111-1111-4111-8111-111111111111')

    await files.writeOnce(path, 'original')
    await expect(files.writeOnce(path, 'replacement')).rejects.toMatchObject({ code: 'EEXIST' })

    expect(linkedBytes).toBe('replacement')
    expect(await readFile(path, 'utf8')).toBe('original')
    expect(await files.list(join(root, 'harness', '11111111-1111-4111-8111-111111111111')))
      .toEqual(['dispatch.json'])
  })

  it('immutable publication accepts concurrent identical bytes and refuses different bytes without replacing them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-headless-files-'))
    roots.push(root)
    const files = new HeadlessFiles({ root, fs, newId: randomUUID })
    const path = files.dispatchPath('conversation')

    expect(await Promise.all([
      files.writeOnceOrMatch(path, 'original'), files.writeOnceOrMatch(path, 'original'),
    ])).toEqual(['accepted', 'accepted'])
    expect(await files.writeOnceOrMatch(path, 'replacement')).toBe('conflict')

    expect(await readFile(path, 'utf8')).toBe('original')
    expect(await files.list(join(root, 'harness', 'conversation'))).toEqual(['dispatch.json'])
  })

  it('a publication error is not mistaken for an immutable content conflict', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-headless-files-'))
    roots.push(root)
    const files = new HeadlessFiles({ root, fs, newId: randomUUID })
    const parentFile = join(root, 'a-file')
    await fs.writeFile(parentFile, 'not a directory', 'utf8')

    await expect(files.writeOnceOrMatch(join(parentFile, 'child'), 'bytes'))
      .rejects.toMatchObject({ code: 'ENOTDIR' })

    expect(await readFile(parentFile, 'utf8')).toBe('not a directory')
  })
})
