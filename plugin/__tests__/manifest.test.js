import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('plugin manifest', () => {
  it('plugin.json has a name and a version', () => {
    const m = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
    expect(m.name).toBe('control-tower-loop')
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
  // The version lives in TWO files because two different consumers read it:
  // Claude Code reads `.claude-plugin/plugin.json` and npm reads `package.json`.
  // Nothing in the runtime forces them to agree, and for a long time they did
  // not agree (0.1.0 against 0.2x): whoever opened the repo and looked at
  // `package.json` first walked away with a version that was not the plugin's.
  // This test is what makes it impossible for the duplicate to diverge in
  // silence — if a truth has to be repeated in two places, something has to tie
  // them together.
  it('package.json and plugin.json declare the SAME version', () => {
    const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.version).toBe(plugin.version)
  })
  // A THIRD PLACE where the same version lives, and for the same reason as the
  // two above: `.release-please-manifest.json` is the state release-please
  // computes the next number from. If that file said a version other than the
  // one the plugin declares, the first release after it would jump from a point
  // that never existed — and it would do so in silence, because release-please
  // does not read `plugin.json`, it WRITES it. The manifest lives at the root of
  // the repo, outside what gets distributed, just like marketplace.json.
  it('the release-please manifest starts from the version the plugin declares', () => {
    const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
    const manifest = JSON.parse(readFileSync(join(root, '..', '.release-please-manifest.json'), 'utf8'))
    expect(manifest.plugin).toBe(plugin.version)
  })
  // And a FOURTH file of the plugin itself repeats it: `package-lock.json`
  // copies the version of `package.json` into two places, and npm does not keep
  // it in sync on its own — it stayed at 0.54.0 while the plugin was already at
  // 0.56.0, two releases behind, without anything complaining. release-please
  // does not care (it rewrites all three), but a lockfile that lies is what
  // whoever clones the repo reads today, before the first release.
  it('the lockfile copies the version of the package.json that generated it', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages[''].version).toBe(pkg.version)
  })
  it('the README that gets distributed announces the version that gets installed', () => {
    const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
    const readme = readFileSync(join(root, 'README.md'), 'utf8')
    expect(
      readme.includes(`\`${plugin.version}\``),
      `README.md no nombra la version ${plugin.version}: quien lo lee se lleva otra`
    ).toBe(true)
  })
  // The marketplace lives at the ROOT OF THE REPO, not at the plugin's: ever
  // since the plugin moved to `plugin/`, the `source` of its entry is WHAT
  // DECIDES what gets distributed (the whole subdir, and nothing outside it).
  // backend/ and frontend/ stay out of the installation precisely because that
  // field says "./plugin" — if someone put it back to "./", every installation
  // would again take the whole repo, and this test is the only thing that would
  // notice.
  it('marketplace.json references the plugin and distributes only plugin/', () => {
    const mk = JSON.parse(readFileSync(join(root, '..', '.claude-plugin/marketplace.json'), 'utf8'))
    const entry = mk.plugins.find((p) => p.name === 'control-tower-loop')
    expect(entry).toBeDefined()
    expect(entry.source).toBe('./plugin')
  })
})
