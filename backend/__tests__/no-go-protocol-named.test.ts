import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

class SourceTree {
  static SKIPPED_DIRECTORIES = ['node_modules']

  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  modules(directory: string = this.root): { path: string, text: string }[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        return SourceTree.SKIPPED_DIRECTORIES.includes(entry.name) ? [] : this.modules(full)
      }

      return [{ path: SourceTree.pathOf(this.root, full), text: readFileSync(full, 'utf8') }]
    })
  }

  static pathOf(root: string, full: string): string {
    return relative(root, full).split(sep).join('/')
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

class RetiredGoProtocol {
  static readonly NAMED = /nonce|go[-_]?registry/i

  static fixture(): string {
    const root = mkdtempSync(join(tmpdir(), 'ct-retired-go-'))
    const nested = join(root, 'nested')
    mkdirSync(nested)
    writeFileSync(join(nested, 'disk-go-registry.ts'), 'export const kept = true\n')
    writeFileSync(join(nested, 'minted.ts'), 'export const minted = "a NONCE"\n')
    return root
  }
}

describe('the retired go protocol', () => {
  const temporaryDirectories: string[] = []

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('no_backend_source_path_or_content_names_a_nonce_or_a_go_registry', () => {
    const source = new SourceTree(join(import.meta.dirname, '..', 'src'))
    const fixtureRoot = RetiredGoProtocol.fixture()
    temporaryDirectories.push(fixtureRoot)
    const fixture = new SourceTree(fixtureRoot)

    expect(fixture.pathsMatching(RetiredGoProtocol.NAMED)).toEqual(['nested/disk-go-registry.ts'])
    expect(fixture.contentsMatching(RetiredGoProtocol.NAMED)).toEqual(['nested/minted.ts'])
    expect(source.pathsMatching(RetiredGoProtocol.NAMED)).toEqual([])
    expect(source.contentsMatching(RetiredGoProtocol.NAMED)).toEqual([])
  })
})
