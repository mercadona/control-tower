import type { CheckoutRoot } from '../value-objects/checkout-root.ts'

export class EpicBranch {
  async current(root: CheckoutRoot): Promise<string> {
    throw new Error(`${this.constructor.name} must implement current(root), asked about ${root}`)
  }

  async defaultBranch(root: CheckoutRoot): Promise<string> {
    throw new Error(
      `${this.constructor.name} must implement defaultBranch(root) and answer the branch the remote calls default, asked about ${root}`
    )
  }

  async publishing({ root, milestone }: { root: CheckoutRoot, milestone: string }): Promise<string> {
    throw new Error(
      `${this.constructor.name} must implement publishing({ root, milestone }) and answer the branch it publishes on, ` +
      `cutting ${milestone} in ${root} when the checkout sits on the branch the remote calls default`
    )
  }

  async restartFromDefault({ root, branch }: { root: CheckoutRoot, branch: string }): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement restartFromDefault({ root, branch }) and start ${branch} of ${root} ` +
      `again from the branch the remote calls default, carrying what is not committed yet`
    )
  }

  async committed({ root, paths }: { root: CheckoutRoot, paths: string[] }): Promise<boolean> {
    throw new Error(
      `${this.constructor.name} must implement committed({ root, paths }) and answer whether ${paths} have nothing left to commit in ${root}`
    )
  }

  async commit({ root, paths, message }: {
    root: CheckoutRoot, paths: string[], message: string,
  }): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement commit({ root, paths, message }), asked to commit ${paths} in ${root} as ${message}`
    )
  }

  async pushed({ root, branch }: { root: CheckoutRoot, branch: string }): Promise<boolean> {
    throw new Error(
      `${this.constructor.name} must implement pushed({ root, branch }) and answer whether ${branch} of ${root} is already on the remote`
    )
  }

  async push({ root, branch }: { root: CheckoutRoot, branch: string }): Promise<void> {
    throw new Error(`${this.constructor.name} must implement push({ root, branch }), asked to push ${branch} of ${root}`)
  }
}
