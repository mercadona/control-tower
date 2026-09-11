import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

class SourceTree {
  static ROOT = join(import.meta.dirname, '..', '..', 'src')

  static modules(directory = SourceTree.ROOT) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return SourceTree.modules(path)

      return [{ path: relative(SourceTree.ROOT, path), text: readFileSync(path, 'utf8') }]
    })
  }

  static containing(fragment) {
    return SourceTree.modules()
      .filter((module) => module.text.includes(fragment))
      .map((module) => module.path)
      .sort()
  }
}

describe('the identity of a plan in flight does not come from the title of a window', () => {
  it('no_module_of_the_backend_names_a_cmux_workspace_now_that_nothing_opens_one', () => {
    expect(SourceTree.containing('ct-plan-')).toEqual([])
    expect(SourceTree.containing('plugin/scripts/cmux.js')).toEqual([])
    expect(SourceTree.containing('cmux')).toEqual([])
  })
})
