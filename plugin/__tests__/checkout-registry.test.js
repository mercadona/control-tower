import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CheckoutRegistry } from '../scripts/checkout-registry.js'
import { repoOfRemoteUrl } from '../scripts/dispatch.js'

class Machine {
  static #made = []

  static with(content) {
    const configDir = mkdtempSync(join(tmpdir(), 'ct-registry-'))
    Machine.#made.push(configDir)
    if (content !== null) {
      const dir = join(configDir, 'control-tower')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, CheckoutRegistry.FILE), content)
    }
    return { configDir, home: configDir }
  }

  static clean() {
    for (const made of Machine.#made.splice(0)) {
      try { chmodSync(join(made, 'control-tower'), 0o700) } catch { /* it may not exist */ }
      rmSync(made, { recursive: true, force: true })
    }
  }
}

class Remotes {
  static holding(byPath) {
    return (path) => (byPath[path] === undefined
      ? { error: `no such directory: ${path}` }
      : { url: byPath[path] })
  }
}

afterEach(() => Machine.clean())

describe('CheckoutRegistry.read — three answers, never a crash', () => {
  it('a registry with pairs answers its entries', () => {
    const asked = CheckoutRegistry.read(Machine.with(JSON.stringify({
      checkouts: [{ repo: 'o/a', path: '/checkouts/a' }],
    })))

    expect(asked.entries).toEqual([{ repo: 'o/a', path: '/checkouts/a' }])
    expect(asked.path).toMatch(/checkouts\.json$/)
  })

  it('a missing registry is an answer, not an error', () => {
    const asked = CheckoutRegistry.read(Machine.with(null))

    expect(asked.missing).toBe(true)
    expect(asked.entries).toBeUndefined()
  })

  it('an unreadable registry is not an empty one', () => {
    const asked = CheckoutRegistry.read(Machine.with('{ this is not json'))

    expect(asked.error).toBeTruthy()
    expect(asked.entries).toBeUndefined()
  })

  it('a legacy roots path is an entry with no repository', () => {
    const asked = CheckoutRegistry.read(Machine.with(JSON.stringify({
      roots: ['/checkouts/old'],
      checkouts: [{ repo: 'o/a', path: '/checkouts/a' }],
    })))

    expect(asked.entries).toEqual([
      { repo: 'o/a', path: '/checkouts/a' },
      { repo: null, path: '/checkouts/old' },
    ])
  })

  it('an entry that is not a pair is dropped instead of being read as half a pair', () => {
    const asked = CheckoutRegistry.read(Machine.with(JSON.stringify({
      checkouts: [{ repo: 'o/a' }, { path: '/checkouts/b' }, { repo: 'o/c', path: '/checkouts/c' }],
    })))

    expect(asked.entries).toEqual([{ repo: 'o/c', path: '/checkouts/c' }])
  })
})

describe('CheckoutRegistry.resolve — where a repository is checked out, and whether it still is', () => {
  const entries = [{ repo: 'o/a', path: '/checkouts/a' }, { repo: null, path: '/checkouts/old' }]

  it('a repository with no entry answers not-registered and never a path', () => {
    const answered = CheckoutRegistry.resolve({
      repo: 'o/missing', entries, remoteOf: Remotes.holding({}),
    })

    expect(answered.state).toBe(CheckoutRegistry.STATES.NOT_REGISTERED)
    expect(answered.path).toBe(null)
  })

  it('an entry whose path holds another repository answers stale naming what it found', () => {
    const answered = CheckoutRegistry.resolve({
      repo: 'o/a', entries, remoteOf: Remotes.holding({ '/checkouts/a': 'git@github.com:o/b.git' }),
    })

    expect(answered.state).toBe(CheckoutRegistry.STATES.STALE)
    expect(answered.path).toBe('/checkouts/a')
    expect(answered.found).toBe('o/b')
  })

  it('a confirmed entry answers its path', () => {
    const answered = CheckoutRegistry.resolve({
      repo: 'o/a', entries, remoteOf: Remotes.holding({ '/checkouts/a': 'https://github.com/o/a' }),
    })

    expect(answered.state).toBe(CheckoutRegistry.STATES.CONFIRMED)
    expect(answered.path).toBe('/checkouts/a')
  })

  it('a registered path that is not there any more is stale with the reason, not confirmed', () => {
    const answered = CheckoutRegistry.resolve({
      repo: 'o/a', entries, remoteOf: Remotes.holding({}),
    })

    expect(answered.state).toBe(CheckoutRegistry.STATES.STALE)
    expect(answered.found).toBe(null)
    expect(answered.why).toMatch(/no such directory/)
  })

  it('a legacy path answers not-registered: a path whose repository was never recorded cannot say what it holds', () => {
    const answered = CheckoutRegistry.resolve({
      repo: 'o/old', entries, remoteOf: Remotes.holding({ '/checkouts/old': 'https://github.com/o/old' }),
    })

    expect(answered.state).toBe(CheckoutRegistry.STATES.NOT_REGISTERED)
  })

  it('the repository is matched case-insensitively, as GitHub does', () => {
    const answered = CheckoutRegistry.resolve({
      repo: 'O/A', entries, remoteOf: Remotes.holding({ '/checkouts/a': 'https://github.com/o/a.git' }),
    })

    expect(answered.state).toBe(CheckoutRegistry.STATES.CONFIRMED)
  })
})

describe('repoOfRemoteUrl — the one reading of a GitHub remote', () => {
  it('it reads ssh, https and a trailing .git', () => {
    expect(repoOfRemoteUrl('git@github.com:mercadona/control-tower.git')).toBe('mercadona/control-tower')
    expect(repoOfRemoteUrl('https://github.com/mercadona/control-tower')).toBe('mercadona/control-tower')
    expect(repoOfRemoteUrl('https://github.com/mercadona/control-tower.git/')).toBe('mercadona/control-tower')
  })

  it('a remote that is not GitHub is not a repository', () => {
    expect(repoOfRemoteUrl('git@gitlab.com:o/r.git')).toBe(null)
    expect(repoOfRemoteUrl('')).toBe(null)
    expect(repoOfRemoteUrl(null)).toBe(null)
  })
})
