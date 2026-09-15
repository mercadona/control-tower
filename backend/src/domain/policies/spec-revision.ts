export class SpecRevision {
  static readonly #BLOB = 'blob'

  readonly digest: (text: string) => string

  constructor({ digest }: { digest: (text: string) => string }) {
    this.digest = digest
    Object.freeze(this)
  }

  of(text: string): string {
    return this.digest(SpecRevision.#envelopeOf(text))
  }

  static #envelopeOf(text: string): string {
    return `${SpecRevision.#BLOB} ${Buffer.byteLength(text, 'utf8')}\0${text}`
  }
}
