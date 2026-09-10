import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

class JavaScriptCensus {
  static EXTENSIONS = ['.js', '.mjs']
  static SKIPPED_DIRECTORIES = ['node_modules']

  static under(root: string, directory: string = root): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        return JavaScriptCensus.SKIPPED_DIRECTORIES.includes(entry.name)
          ? []
          : JavaScriptCensus.under(root, full)
      }
      return JavaScriptCensus.isJavaScript(entry.name) ? [JavaScriptCensus.pathOf(root, full)] : []
    })
  }

  static isJavaScript(name: string): boolean {
    return JavaScriptCensus.EXTENSIONS.some((extension) => name.endsWith(extension))
  }

  static pathOf(root: string, full: string): string {
    return relative(root, full).split(sep).join('/')
  }
}

class Backend {
  static HERE = dirname(fileURLToPath(import.meta.url))
  static ROOT = join(Backend.HERE, '..')

  static javaScriptModules(): string[] {
    return JavaScriptCensus.under(Backend.ROOT).sort()
  }
}

class TreeWithJavaScriptInIt {
  static make(): string {
    const root = mkdtempSync(join(tmpdir(), 'typescript-only-'))
    mkdirSync(join(root, 'src', 'domain'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'express'), { recursive: true })
    writeFileSync(join(root, 'src', 'domain', 'typed.ts'), 'export const typed = true\n')
    writeFileSync(join(root, 'src', 'domain', 'slipped-in.js'), 'export const slipped = true\n')
    writeFileSync(join(root, 'src', 'legacy.mjs'), 'export const legacy = true\n')
    writeFileSync(join(root, 'node_modules', 'express', 'index.js'), 'module.exports = {}\n')
    return root
  }
}

describe('the backend is TypeScript', () => {
  it('no_javascript_module_lives_under_the_backend', () => {
    const javaScript = Backend.javaScriptModules()

    expect(javaScript, `JavaScript under backend/: ${javaScript.join(', ')}`).toEqual([])
  })

  it('the_census_walks_the_tree_so_a_module_born_tomorrow_is_caught_without_anyone_listing_it', () => {
    const root = TreeWithJavaScriptInIt.make()

    try {
      expect(JavaScriptCensus.under(root).sort()).toEqual(['src/domain/slipped-in.js', 'src/legacy.mjs'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
