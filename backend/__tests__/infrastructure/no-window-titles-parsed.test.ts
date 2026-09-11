import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

class SourceTree {
  static ROOT = join(import.meta.dirname, '..', '..', 'src')

  static modules(directory: string = SourceTree.ROOT): { path: string, text: string }[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return SourceTree.modules(path)

      return [{ path: relative(SourceTree.ROOT, path), text: readFileSync(path, 'utf8') }]
    })
  }

  static containing(fragment: string): string[] {
    return SourceTree.modules()
      .filter((module) => module.text.includes(fragment))
      .map((module) => module.path)
      .sort()
  }
}

describe('the identity of a plan in flight does not come from the title of a window', () => {
  it('no_module_of_the_backend_opens_a_cmux_window_now_that_nothing_types_into_one', () => {
    expect(SourceTree.containing('ct-plan-')).toEqual([])
    expect(SourceTree.containing('cmux-plan-agents')).toEqual([])
    expect(SourceTree.containing('plugin/scripts/cmux.js')).toEqual(['infrastructure/ct-api.ts'])
  })
})
