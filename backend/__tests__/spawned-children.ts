import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

export type SpawnSite = {
  file: string,
  line: number,
  call: string,
}

export type AccountedFile = {
  file: string,
  calls: readonly string[],
  reason: string,
  child?: string,
}

export class SpawnedChildren {
  static readonly SOURCE = 'src'
  static readonly RELEASE = 'InheritedTerminals.ofThisProcess().released()'
  static readonly SHORT_LIVED = 'the child dies on its own'
  static readonly RELEASES_FIRST = 'this module releases before it can spawn anything'
  static readonly CHILD_RELEASES_FIRST = 'the child is ours and releases before it can spawn anything'
  static readonly OWNS_THE_MASTER = 'this spawn opens the terminal instead of inheriting one'
  static readonly DECLARES_ONLY = 'this module declares the verb and starts nothing'
  static readonly THE_BORDER = "the border starts what a caller asks, and the caller's entry says what happens to that child"

  static readonly SPAWNING =
    /(?:(?<=[.\s([{,=])|^)(spawn|spawnSync|execFile|execFileSync|fork)\s*\(|(?<![.\w])(exec)\s*\(|(?<=\bprocesses\.)(launch|runAndWait)\s*\(|(?:(?<=[.\s([{,=])|^)(launch|runAndWait)\s*\(binary:|(?:(?<=[.\s([{,=])|^)(openTerminal)\s*\(file:/g
  static readonly IMPORTING = /['"]node:child_process['"]|['"]node-pty['"]/
  static readonly ENTRYPOINT = /static async main\([^)]*\)[^{]*\{[^\n]*\n([^\n]*)/

  static readonly ACCOUNTED: readonly AccountedFile[] = [
    {
      file: join('infrastructure', 'tool-runner.ts'),
      calls: ['launch', 'runAndWait'],
      reason: SpawnedChildren.SHORT_LIVED,
    },
    {
      file: join('infrastructure', 'process-border.ts'),
      calls: ['execFile', 'execFile', 'launch', 'openTerminal', 'runAndWait', 'spawn'],
      reason: SpawnedChildren.THE_BORDER,
    },
    {
      file: join('infrastructure', 'process-runner.ts'),
      calls: ['launch', 'runAndWait'],
      reason: SpawnedChildren.DECLARES_ONLY,
    },
    {
      file: join('infrastructure', 'process-table.ts'),
      calls: ['openTerminal'],
      reason: SpawnedChildren.DECLARES_ONLY,
    },
    {
      file: join('infrastructure', 'pty-live-sessions.ts'),
      calls: ['spawn'],
      reason: SpawnedChildren.OWNS_THE_MASTER,
    },
    {
      file: join('infrastructure', 'headless-call-worker.ts'),
      calls: ['spawn'],
      reason: SpawnedChildren.RELEASES_FIRST,
      child: join('infrastructure', 'headless-call-worker.ts'),
    },
    {
      file: join('infrastructure', 'claude-calls.ts'),
      calls: ['spawn'],
      reason: SpawnedChildren.CHILD_RELEASES_FIRST,
      child: join('infrastructure', 'headless-call-worker.ts'),
    },
  ]

  static sitesIn(source: string, file: string): SpawnSite[] {
    return source.split('\n').flatMap((text, index) => (
      [...text.matchAll(SpawnedChildren.SPAWNING)]
        .map((found) => ({ file, line: index + 1, call: found[1] ?? found[2] ?? found[3] ?? found[4] ?? found[5] }))
    ))
  }

  static sitesUnder(backend: string): SpawnSite[] {
    return SpawnedChildren.#filesUnder(join(backend, SpawnedChildren.SOURCE))
      .flatMap((path) => SpawnedChildren.sitesIn(
        readFileSync(path, 'utf8'),
        relative(join(backend, SpawnedChildren.SOURCE), path)
      ))
  }

  static unaccountedIn(sites: readonly SpawnSite[]): string[] {
    const found = SpawnedChildren.#byFile(sites)
    const declared = new Map(SpawnedChildren.ACCOUNTED.map((entry) => [entry.file, [...entry.calls].sort()]))

    return [...found.entries()]
      .filter(([file, calls]) => {
        const expected = declared.get(file)

        return expected === undefined || expected.join(',') !== calls.join(',')
      })
      .map(([file, calls]) => `${file} starts a process with ${calls.join(', ')} and no entry of ACCOUNTED says what happens to that child`)
  }

  static declaredWithoutASite(sites: readonly SpawnSite[], importers: readonly string[]): string[] {
    const found = SpawnedChildren.#byFile(sites)
    const reaching = new Set(importers)

    return SpawnedChildren.ACCOUNTED
      .filter((entry) => (entry.calls.length === 0 ? !reaching.has(entry.file) : !found.has(entry.file)))
      .map((entry) => `${entry.file} is declared in ACCOUNTED and no longer starts or hands on any process`)
  }

  static childrenThatMustRelease(): string[] {
    return [...new Set(SpawnedChildren.ACCOUNTED
      .map((entry) => entry.child)
      .filter((child): child is string => child !== undefined))]
  }

  static releasesBeforeAnythingElseIn(source: string): boolean {
    const entrypoint = SpawnedChildren.ENTRYPOINT.exec(source)
    if (entrypoint === null) return false

    return entrypoint[1].trim() === SpawnedChildren.RELEASE
  }

  static importersUnder(backend: string): string[] {
    return SpawnedChildren.#filesUnder(join(backend, SpawnedChildren.SOURCE))
      .filter((path) => SpawnedChildren.IMPORTING.test(readFileSync(path, 'utf8')))
      .map((path) => relative(join(backend, SpawnedChildren.SOURCE), path))
  }

  static importersWithoutAnEntry(importers: readonly string[]): string[] {
    const declared = new Set(SpawnedChildren.ACCOUNTED.map((entry) => entry.file))

    return importers
      .filter((file) => !declared.has(file))
      .map((file) => `${file} reaches for a spawning module and no entry of ACCOUNTED says what happens to that child`)
  }

  static #byFile(sites: readonly SpawnSite[]): Map<string, string[]> {
    const found = new Map<string, string[]>()
    for (const site of sites) found.set(site.file, [...(found.get(site.file) ?? []), site.call].sort())

    return found
  }

  static #filesUnder(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return SpawnedChildren.#filesUnder(path)

      return entry.name.endsWith('.ts') ? [path] : []
    })
  }
}
