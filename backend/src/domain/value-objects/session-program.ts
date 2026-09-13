export class SessionProgram {
  readonly name: string
  readonly file: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>

  constructor({ name, file, argv, cwd, env }: {
    name: unknown, file: unknown, argv: readonly string[], cwd: unknown,
    env: Readonly<Record<string, string>>,
  }) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(`a session program's name must be a non-empty string, got ${JSON.stringify(name)}`)
    }
    if (typeof file !== 'string' || file.trim().length === 0) {
      throw new Error(`a session program's file must be a non-empty string, got ${JSON.stringify(file)}`)
    }
    if (typeof cwd !== 'string' || cwd.trim().length === 0) {
      throw new Error(`a session program's cwd must be a non-empty string, got ${JSON.stringify(cwd)}`)
    }
    this.name = name
    this.file = file
    this.argv = argv
    this.cwd = cwd
    this.env = env
    Object.freeze(this)
  }
}
