export class LiveSession {
  readonly id: string
  readonly name: string

  constructor({ id, name }: { id: unknown, name: unknown }) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(`a live session's id must be a non-empty string, got ${JSON.stringify(id)}`)
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(`a live session's name must be a non-empty string, got ${JSON.stringify(name)}`)
    }
    this.id = id
    this.name = name
    Object.freeze(this)
  }
}
