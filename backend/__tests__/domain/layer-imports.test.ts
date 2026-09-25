import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type Offence = { readonly file: string, readonly specifier: string }
type FileRead = { readonly file: string, readonly specifiers: readonly string[] }

class LayerImports {
  static readonly SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
  static readonly LAYERS = ['domain', 'application'] as const

  static files(): string[] {
    return LayerImports.LAYERS.flatMap((layer) => LayerImports.#filesUnder(join(LayerImports.SRC, layer)))
  }

  static census(): Offence[] {
    return LayerImports.offencesAmong(
      LayerImports.files().map((file) => ({ file, specifiers: LayerImports.importsOf(file) })),
    )
  }

  static offencesAmong(reads: readonly FileRead[]): Offence[] {
    const offences: Offence[] = []
    for (const { file, specifiers } of reads) {
      for (const specifier of specifiers) {
        if (LayerImports.offends(specifier)) offences.push({ file, specifier })
      }
    }

    return offences
  }

  static importsOf(file: string): string[] {
    const text = readFileSync(file, 'utf8')

    return [...text.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1])
  }

  static offends(specifier: string): boolean {
    if (specifier.startsWith('node:')) return true
    if (specifier.includes('/infrastructure/')) return true

    return (specifier.split('/').pop() ?? '').startsWith('gh')
  }

  static #filesUnder(directory: string): string[] {
    const files: string[] = []
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) {
        files.push(...LayerImports.#filesUnder(path))
        continue
      }
      files.push(path)
    }

    return files
  }
}

describe('the layers the domain and the application do not know', () => {
  it('no module of the domain or the application imports node, the infrastructure or GitHub', () => {
    expect(LayerImports.files().length).toBeGreaterThan(100)
    expect(LayerImports.files()).toContain(join(LayerImports.SRC, 'application', 'queries', 'read-milestone-progress.ts'))
    expect(LayerImports.census()).toEqual([])
  })

  it('the matcher tells a disk import and a GitHub import apart from a port import', () => {
    expect(LayerImports.offends('node:fs')).toBe(true)
    expect(LayerImports.offends('../../infrastructure/disk-slice-baselines.ts')).toBe(true)
    expect(LayerImports.offends('../gh-cli.ts')).toBe(true)
    expect(LayerImports.offends('../../domain/ports/epic-specs.ts')).toBe(false)
  })

  it('the census reads the imports of read-milestone-progress.ts', () => {
    const file = join(LayerImports.SRC, 'application', 'queries', 'read-milestone-progress.ts')

    expect(LayerImports.importsOf(file)).toContain('../../domain/ports/epic-specs.ts')
  })

  it('the census turns an offending specifier found in a real file into an offence entry', () => {
    const file = join(LayerImports.SRC, 'application', 'queries', 'read-milestone-progress.ts')
    const specifiers = [...LayerImports.importsOf(file), 'node:fs']

    expect(LayerImports.offencesAmong([{ file, specifiers }])).toEqual([{ file, specifier: 'node:fs' }])
  })
})
