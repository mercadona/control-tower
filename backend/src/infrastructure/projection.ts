export class Projection<V = any, K = unknown> {
  readonly what: string
  readonly declared: Map<K, V>

  constructor(what: string, declared: Iterable<readonly [NoInfer<K>, NoInfer<V>]>) {
    this.what = what
    this.declared = new Map(declared)
  }

  of(member: unknown): V {
    const projected = this.declared.get(member as K)
    if (projected === undefined) {
      throw new Error(`no ${this.what} declared for ${(member as { name?: unknown }).name ?? member}`)
    }

    return projected
  }

  members(): K[] {
    return [...this.declared.keys()]
  }
}
