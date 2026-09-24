import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

export class ProcessRatchet {
  static readonly MARKER = '-real-process'
  static readonly SPAWNING: readonly string[] = ['node:child_process', 'child_process', 'node-pty']
  static readonly BORDER = '/process-border.ts'

  static readonly LISTED: readonly string[] = [
    'infrastructure/checked-run-delivery-real-process.test.ts',
    'infrastructure/claude-calls-real-process.test.ts',
    'infrastructure/claude-calls.test.ts',
    'infrastructure/claude-conversations-real-process.test.ts',
    'infrastructure/claude-run-calls.test.ts',
    'infrastructure/ct-api-real-process.test.ts',
    'infrastructure/ct-run-machine-real-process.test.ts',
    'infrastructure/git-workspace-real-process.test.ts',
    'infrastructure/headless-dispatch-dry-run.test.ts',
    'infrastructure/headless-plan-agents.test.ts',
    'infrastructure/makefile-local-env.test.ts',
    'infrastructure/pty-live-sessions-real-process.test.ts',
    'infrastructure/pty-live-sessions.test.ts',
    'infrastructure/recorded-plan-recovery.test.ts',
    'infrastructure/run-dispatch-real-process.test.ts',
    'infrastructure/run-driver-runtime-real-process.test.ts',
    'infrastructure/run-plan-recovery.test.ts',
    'infrastructure/run-recovery-real-process.test.ts',
    'infrastructure/session-channel-real-process.test.ts',
    'infrastructure/state-directory-real-process.test.ts',
    'infrastructure/tool-runner-real-process.test.ts',
    'infrastructure/tool-runner-whole-output-real-process.test.ts',
    'yardstick-real-process.test.ts',
  ]

  static spawningUnder(tests: string): string[] {
    const spawning = new Map<string, boolean>()

    return ProcessRatchet.#filesUnder(tests)
      .filter((file) => file.endsWith('.test.ts'))
      .filter((file) => ProcessRatchet.#spawns(file, tests, spawning, new Set()))
      .map((file) => ProcessRatchet.#pathOf(tests, file))
      .sort()
  }

  static unlisted(spawning: readonly string[], listed: readonly string[]): string[] {
    const named = new Set(listed)

    return spawning
      .filter((file) => !named.has(file))
      .map((file) => `${file} launches a process and ProcessRatchet.LISTED does not name it`)
  }

  static stale(spawning: readonly string[], listed: readonly string[]): string[] {
    const stillSpawning = new Set(spawning)

    return listed
      .filter((file) => !stillSpawning.has(file))
      .map((file) => `${file} is in ProcessRatchet.LISTED and launches no process any more`)
  }

  static #spawns(file: string, root: string, memo: Map<string, boolean>, chain: Set<string>): boolean {
    const known = memo.get(file)
    if (known !== undefined) return known
    if (chain.has(file)) return false

    chain.add(file)
    const result = file.includes(ProcessRatchet.MARKER) || ProcessRatchet.#namesASpawningModule(file, root, memo, chain)
    memo.set(file, result)
    return result
  }

  static #namesASpawningModule(file: string, root: string, memo: Map<string, boolean>, chain: Set<string>): boolean {
    return ProcessRatchet.#specifiersIn(readFileSync(file, 'utf8'))
      .some((specifier) => ProcessRatchet.#specifierSpawns(specifier, file, root, memo, chain))
  }

  static #specifierSpawns(specifier: string, file: string, root: string, memo: Map<string, boolean>, chain: Set<string>): boolean {
    if (ProcessRatchet.SPAWNING.includes(specifier) || specifier.endsWith(ProcessRatchet.BORDER)) return true
    if (!specifier.startsWith('.')) return false

    const resolved = ProcessRatchet.#resolved(file, specifier)
    return resolved !== null && resolved.startsWith(root + sep) && ProcessRatchet.#spawns(resolved, root, memo, chain)
  }

  static #resolved(file: string, specifier: string): string | null {
    const candidate = resolve(dirname(file), specifier)
    const withExtension = candidate.endsWith('.ts') ? candidate : `${candidate}.ts`
    return existsSync(withExtension) ? withExtension : null
  }

  static #specifiersIn(source: string): string[] {
    return source.split('\n').flatMap((line) => ProcessRatchet.#specifiersInLine(line))
  }

  static #specifiersInLine(line: string): string[] {
    const found: string[] = []
    const anchored = /^(?:import\b.*?from\s+|import\s+|\}\s*from\s+)['"]([^'"]+)['"]/.exec(line.trimStart())
    if (anchored !== null) found.push(anchored[1])

    for (const dynamic of line.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const before = line.slice(0, dynamic.index ?? 0)
      const quotesBefore = before.match(/"/g)?.length ?? 0
      if (quotesBefore % 2 === 0) found.push(dynamic[1])
    }

    return found
  }

  static #pathOf(root: string, file: string): string {
    return relative(root, file).split(sep).join('/')
  }

  static #filesUnder(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) return ProcessRatchet.#filesUnder(full)

      return entry.name.endsWith('.ts') ? [full] : []
    })
  }
}
