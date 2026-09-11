type CommandName = 'build' | 'test' | 'lint'
type SourceReading = { readonly path: string, readonly state: 'read', readonly body: string }
  | { readonly path: string, readonly state: 'missing' | 'unreadable' }

export class RepositoryObservations {
  static readonly RUNTIME_PATHS = Object.freeze(['.worktrees/__readiness__/probe', '.agent/SLICE.md', '.agent/run-1.json'])
  static readonly PLAN_PATH = 'docs/superpowers/plans/__readiness__.md'
  readonly root: string
  readonly workerCount: number | 'automatic' | null
  readonly workerEvidence: readonly string[]
  readonly composeFiles: readonly string[] | null
  readonly changedPaths: readonly string[] | null
  readonly ignoredPaths: readonly string[] | null
  readonly #base: Readonly<{ reference: string, revision: string }> | null
  readonly #commands: Readonly<Record<CommandName, string | null>> | null
  readonly #sources: readonly SourceReading[] | null

  constructor({ root, base, commands, sources, workerCount, workerEvidence, composeFiles, changedPaths, ignoredPaths }: {
    root: string, base: { reference: string, revision: string } | null,
    commands: Record<CommandName, string | null> | null,
    sources: readonly SourceReading[] | null,
    workerCount: number | 'automatic' | null, workerEvidence: readonly string[],
    composeFiles: readonly string[] | null, changedPaths: readonly string[] | null, ignoredPaths: readonly string[] | null,
  }) {
    this.root = root
    this.#base = base === null ? null : Object.freeze({ ...base })
    this.#commands = commands === null ? null : Object.freeze({ ...commands })
    this.#sources = sources === null ? null : Object.freeze(sources.map((source) => Object.freeze({ ...source })))
    this.workerCount = workerCount
    this.workerEvidence = Object.freeze([...workerEvidence])
    this.composeFiles = composeFiles === null ? null : Object.freeze([...composeFiles])
    this.changedPaths = changedPaths === null ? null : Object.freeze([...changedPaths])
    this.ignoredPaths = ignoredPaths === null ? null : Object.freeze([...ignoredPaths])
    Object.freeze(this)
  }

  get baseRevision(): string | null { return this.#base?.revision ?? null }
  get baseReference(): string | null { return this.#base?.reference ?? null }
  get commandsKnown(): boolean { return this.#commands !== null }

  get missingCommands(): readonly CommandName[] {
    const names: CommandName[] = ['build', 'test', 'lint']
    return names.filter((name) => {
      const value = this.#commands?.[name]
      return value === null || value === undefined || /<[^>]+>|TODO|\.\.\./i.test(value)
    })
  }

  get conventionState(): 'complete' | 'incomplete' | 'unverified' {
    if (this.#sources === null || this.#sources.some((source) => source.state === 'unreadable')) return 'unverified'
    return this.#sources.length > 0 && this.#sources.every((source) => source.state === 'read' && RepositoryObservations.#hasContent(source.body)) ? 'complete' : 'incomplete'
  }

  get conventionPaths(): readonly string[] {
    return this.#sources?.filter((source) => source.state === 'read' && RepositoryObservations.#hasContent(source.body)).map((source) => source.path) ?? []
  }

  get environmentFile(): string | null {
    return this.baseRevision !== null && this.composeFiles?.length === 1 ? this.composeFiles[0] : null
  }

  static #hasContent(body: string): boolean {
    const content = body.trim()
    return content.length > 0 && !/^(?:TODO|TBD|<[^>]+>|\.\.\.)$/i.test(content)
  }
}
