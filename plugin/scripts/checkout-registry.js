import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { controlTowerDir } from './run-metrics.js'
import { repoOfRemoteUrl } from './dispatch.js'

export class CheckoutRegistry {
  static FILE = 'checkouts.json'
  static CHECKOUTS_KEY = 'checkouts'
  static LEGACY_KEY = 'roots'
  static REPO_KEY = 'repo'
  static PATH_KEY = 'path'

  static STATES = Object.freeze({
    CONFIRMED: 'confirmed',
    NOT_REGISTERED: 'not-registered',
    STALE: 'stale',
  })

  static directory(opts = {}) {
    return controlTowerDir(opts)
  }

  static path(opts = {}) {
    return join(CheckoutRegistry.directory(opts), CheckoutRegistry.FILE)
  }

  static read(opts = {}) {
    const directory = CheckoutRegistry.directory(opts)
    const path = CheckoutRegistry.path(opts)
    if (!isAbsolute(directory)) {
      return { error: `the registry of checkouts does not resolve to an absolute path ("${directory}")`, path }
    }
    let raw
    try {
      raw = readFileSync(path, 'utf8')
    } catch (failure) {
      if (failure && failure.code === 'ENOENT') return { missing: true, path }

      return { error: failure.message, path }
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (failure) {
      return { error: `${path} is not readable as json: ${failure.message}`, path }
    }

    return { entries: CheckoutRegistry.entriesIn(parsed), path }
  }

  static entriesIn(parsed) {
    if (parsed === null || typeof parsed !== 'object') return []
    const pairs = Array.isArray(parsed[CheckoutRegistry.CHECKOUTS_KEY]) ? parsed[CheckoutRegistry.CHECKOUTS_KEY] : []
    const legacy = Array.isArray(parsed[CheckoutRegistry.LEGACY_KEY]) ? parsed[CheckoutRegistry.LEGACY_KEY] : []

    return [
      ...pairs.filter((entry) => CheckoutRegistry.#isPair(entry))
        .map((entry) => ({ repo: entry[CheckoutRegistry.REPO_KEY], path: entry[CheckoutRegistry.PATH_KEY] })),
      ...legacy.filter((path) => typeof path === 'string' && path.length > 0)
        .map((path) => ({ repo: null, path })),
    ]
  }

  static resolve({ repo, entries, remoteOf }) {
    const registered = (entries || []).find((entry) => CheckoutRegistry.#names(entry, repo))
    if (registered === undefined) {
      return { state: CheckoutRegistry.STATES.NOT_REGISTERED, path: null, found: null, why: null }
    }
    const remote = remoteOf(registered.path)
    if (remote.url === undefined) {
      return { state: CheckoutRegistry.STATES.STALE, path: registered.path, found: null, why: remote.error }
    }
    const held = repoOfRemoteUrl(remote.url)
    if (held === null) {
      return {
        state: CheckoutRegistry.STATES.STALE,
        path: registered.path,
        found: null,
        why: `its "origin" remote ("${remote.url}") does not read as a GitHub owner/repo`,
      }
    }
    if (held.toLowerCase() !== String(repo).toLowerCase()) {
      return {
        state: CheckoutRegistry.STATES.STALE,
        path: registered.path,
        found: held,
        why: `it holds ${held}`,
      }
    }

    return { state: CheckoutRegistry.STATES.CONFIRMED, path: registered.path, found: held, why: null }
  }

  static #isPair(entry) {
    return entry !== null && typeof entry === 'object' &&
      typeof entry[CheckoutRegistry.REPO_KEY] === 'string' && entry[CheckoutRegistry.REPO_KEY].length > 0 &&
      typeof entry[CheckoutRegistry.PATH_KEY] === 'string' && entry[CheckoutRegistry.PATH_KEY].length > 0
  }

  static #names(entry, repo) {
    return typeof entry.repo === 'string' && entry.repo.toLowerCase() === String(repo).toLowerCase()
  }
}
