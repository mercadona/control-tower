export class RepositoryIdentity {
  readonly root: string
  readonly name: string | null
  readonly evidence: readonly string[]

  constructor({ root, name, evidence }: { root: string, name: string | null, evidence: readonly string[] }) {
    this.root = root
    this.name = name
    this.evidence = Object.freeze([...evidence])
    Object.freeze(this)
  }
}
