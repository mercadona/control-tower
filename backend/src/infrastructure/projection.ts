export class Projection<V = any, K = unknown> {
  readonly what: string
  readonly declared: Map<K, V>

  constructor(what: string, declared: Iterable<readonly [NoInfer<K>, NoInfer<V>]>) {
    this.what = what
    this.declared = new Map(declared)
    for (const [member, value] of this.declared) {
      if (value === undefined) {
        throw new Error(`${what} declares undefined for ${Projection.#nameOf(member)}`)
      }
    }
  }

  static #nameOf(member: unknown): unknown {
    return (member as { name?: unknown }).name ?? member
  }

  of(member: unknown): V {
    const projected = this.declared.get(member as K)
    if (projected === undefined) {
      throw new Error(`no ${this.what} declared for ${Projection.#nameOf(member)}`)
    }

    return projected
  }

  members(): K[] {
    return [...this.declared.keys()]
  }
}
