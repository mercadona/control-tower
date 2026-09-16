import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

class SourceTree {
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  modules(directory: string = this.root): { path: string, text: string }[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return this.modules(path)

      return [{ path: relative(this.root, path), text: readFileSync(path, 'utf8') }]
    })
  }

  pathsMatching(pattern: RegExp): string[] {
    return this.modules()
      .filter((module) => pattern.test(module.path))
      .map((module) => module.path)
      .sort()
  }

  contentsMatching(pattern: RegExp): string[] {
    return this.modules()
      .filter((module) => pattern.test(module.text))
      .map((module) => module.path)
      .sort()
  }
}

describe('retired window transport', () => {
  const temporaryDirectories: string[] = []

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('no backend source path or content names the retired window transport', () => {
    const source = new SourceTree(join(import.meta.dirname, '..', '..', 'src'))
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'ct-retired-transport-'))
    temporaryDirectories.push(fixtureRoot)
    const fixtureDirectory = join(fixtureRoot, 'nested')
    mkdirSync(fixtureDirectory)
    writeFileSync(join(fixtureDirectory, 'cMuX-source.ts'), 'const transport = "CMux"\n')
    const fixture = new SourceTree(fixtureRoot)
    const retiredTransport = /cmux/i

    expect(fixture.pathsMatching(retiredTransport)).toEqual(['nested/cMuX-source.ts'])
    expect(fixture.contentsMatching(retiredTransport)).toEqual(['nested/cMuX-source.ts'])
    expect(source.pathsMatching(retiredTransport)).toEqual([])
    expect(source.contentsMatching(retiredTransport)).toEqual([])
  })
})
