import { join } from 'node:path'
import { CheckoutRegistry } from '../domain/ports/checkout-registry.js'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.js'

export class DiskCheckoutRegistry extends CheckoutRegistry {
  static FILE = 'checkouts.json'

  constructor({ read, stat, write, stderr, root }) {
    super()
    this.read = read
    this.stat = stat
    this.write = write
    this.stderr = stderr
    this.root = root
  }

  static #pathFor(root) {
    return join(root, DiskCheckoutRegistry.FILE)
  }

  static #contentFor(roots) {
    return `${JSON.stringify({ roots: roots.map((root) => root.text) }, null, 2)}\n`
  }

  remember(root) {
    const known = this.known()
    if (known === null) {
      this.stderr(
        `checkout registry: ${DiskCheckoutRegistry.#pathFor(this.root)} cannot be read, so ${root.text} is not registered and nothing is overwritten\n`
      )

      return
    }
    if (known.some((seen) => seen.text === root.text)) return
    const path = DiskCheckoutRegistry.#pathFor(this.root)
    try {
      this.write(path, DiskCheckoutRegistry.#contentFor([...known, root]))
    } catch (failure) {
      this.stderr(
        `checkout registry: ${root.text} could not be written to ${path}, so the sweep will not survey it until it is: ${failure.message}\n`
      )
    }
  }

  known() {
    const stored = this.#stored()
    if (stored === null) return null

    return stored
      .filter((text) => CheckoutRoot.isWellFormed(text))
      .map((text) => new CheckoutRoot(text))
  }

  #stored() {
    const path = DiskCheckoutRegistry.#pathFor(this.root)
    if (!this.#present(path)) return []
    try {
      const record = JSON.parse(this.read(path))

      return Array.isArray(record?.roots) ? record.roots : null
    } catch {
      return null
    }
  }

  #present(path) {
    try {
      return this.stat(path).isFile()
    } catch {
      return false
    }
  }
}
