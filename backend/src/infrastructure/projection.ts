export class Projection<V = any> {
  readonly what: string
  readonly declared: Map<unknown, V>

  constructor(what: string, declared: Iterable<readonly [unknown, NoInfer<V>]>) {
    this.what = what
    this.declared = new Map(declared)
  }

  of(member: unknown): V {
    const projected = this.declared.get(member)
    if (projected === undefined) {
      throw new Error(`no ${this.what} declared for ${(member as { name?: unknown }).name ?? member}`)
    }

    return projected
  }

  members(): unknown[] {
    return [...this.declared.keys()]
  }
}
