import type { CheckoutRoot } from '../value-objects/checkout-root.ts'

export class EpicBranch {
  async current(root: CheckoutRoot): Promise<string> {
    throw new Error(`${this.constructor.name} must implement current(root), asked about ${root}`)
  }

  async publishable(root: CheckoutRoot): Promise<string> {
    throw new Error(
      `${this.constructor.name} must implement publishable(root) and answer the branch it would publish, asked about ${root}`
    )
  }

  async publish({ root, paths, message }: { root: CheckoutRoot, paths: string[], message: string }): Promise<string> {
    throw new Error(
      `${this.constructor.name} must implement publish({ root, paths, message }), asked to publish ${paths} on ${root}`
    )
  }
}
