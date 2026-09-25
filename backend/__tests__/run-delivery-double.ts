import { RunDelivery } from '../src/domain/ports/run-delivery.ts'
import type { PlanWatch } from '../src/domain/value-objects/plan-watch.ts'
import {
  RunDeliveryFailure, type DeliveredPullRequest, type RunDeliveryInspection,
} from '../src/domain/value-objects/run-delivery.ts'

export class CompletedRunDelivery extends RunDelivery {
  readonly delivered: PlanWatch[] = []
  inspection: RunDeliveryInspection = {
    kind: 'delivered',
    pullRequest: { number: 1, url: 'https://github.com/owner/name/pull/1' },
  }

  override async deliver(watch: PlanWatch): Promise<void> {
    this.delivered.push(watch)
  }

  override async inspect(): Promise<RunDeliveryInspection> {
    return this.inspection
  }

  override async recordedPullRequest(watch: PlanWatch): Promise<DeliveredPullRequest | null> {
    throw new Error(`nobody scripted the recorded pull request of ${watch.agent}`)
  }
}

export class RefusedRunDelivery extends CompletedRunDelivery {
  static readonly REFUSAL = 'the scripted checked release refused the delivery'

  readonly asked: PlanWatch[] = []
  override inspection: RunDeliveryInspection = { kind: 'publishing', pullRequest: null, diagnostic: null }

  override async deliver(watch: PlanWatch): Promise<void> {
    this.asked.push(watch)
    throw new RunDeliveryFailure(RefusedRunDelivery.REFUSAL)
  }
}
