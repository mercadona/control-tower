export type PlanState = 'writing' | 'ready' | 'reviewing'

export type PlanEvent = {
  state: PlanState
}

export type PlanFailure = {
  code: string
  detail: string
}

export type PlanEventsListener = {
  onState: (state: PlanState) => void
  onFailure: (failure: PlanFailure) => void
  onRefused: () => void
  onUnreachable: () => void
}

export type PlanEventsSubscription = {
  close: () => void
}
