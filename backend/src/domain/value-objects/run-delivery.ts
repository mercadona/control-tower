export type DeliveredPullRequest = {
  readonly number: number,
  readonly url: string,
}

export type RunDeliveryInspection =
  | { readonly kind: 'absent' }
  | { readonly kind: 'publishing', readonly pullRequest: DeliveredPullRequest | null, readonly diagnostic: string | null }
  | { readonly kind: 'uncertain', readonly pullRequest: DeliveredPullRequest | null, readonly diagnostic: string }
  | { readonly kind: 'delivered', readonly pullRequest: DeliveredPullRequest }

export class RunDeliveryFailure extends Error {}

export class RunDeliveryUncertain extends RunDeliveryFailure {}
