import { join } from 'node:path'
import { CheckoutRegistry } from '../domain/ports/checkout-registry.js'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.js'

export class DiskCheckoutRegistry extends CheckoutRegistry {
  static FILE = 'checkouts.json'

  constructor({ read, stat, write, root }) {
    super()
    this.read = read
    this.stat = stat
    this.write = write
    this.root = root
  }

  static pathFor(root) {
    return join(root, DiskCheckoutRegistry.FILE)
  }

  static contentFor(roots) {
    return `${JSON.stringify({ roots: roots.map((root) => root.text) }, null, 2)}\n`
  }

  remember(root) {
    const known = this.known()
    if (known.some((seen) => seen.text === root.text)) return

    this.write(DiskCheckoutRegistry.pathFor(this.root), DiskCheckoutRegistry.contentFor([...known, root]))
  }

  known() {
    const stored = this.#stored()
    if (stored === null) return []

    return stored
      .filter((text) => CheckoutRoot.isWellFormed(text))
      .map((text) => new CheckoutRoot(text))
  }

  #stored() {
    const path = DiskCheckoutRegistry.pathFor(this.root)
    try {
      if (!this.stat(path).isFile()) return null
      const record = JSON.parse(this.read(path))
      if (record === null || typeof record !== 'object' || !Array.isArray(record.roots)) return null

      return record.roots
    } catch {
      return null
    }
  }
}
