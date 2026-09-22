import { PlanRecoveryConflict } from '../domain/exceptions.ts'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import type { CheckoutRegistry } from '../domain/ports/checkout-registry.ts'
import type { PlanCalls } from '../domain/ports/plan-calls.ts'
import type { PlanRecords } from '../domain/ports/plan-records.ts'
import { PlanRecovery } from '../domain/policies/plan-recovery.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import { RecoveryCall } from '../domain/value-objects/recovery-call.ts'
import { RegisteredCheckout } from '../domain/value-objects/registered-checkout.ts'
import type { RunClosure } from '../domain/value-objects/run-instruction.ts'
import {
  ActivePlanPhase,
  type ActivePlanRecovery,
  type ActivePlans,
} from './active-plans-route.ts'
import type { ClaudeCalls } from './claude-calls.ts'
import type { CtRunMachine, RunInspection } from './ct-run-machine.ts'
import type { RecordedCall } from './recorded-call.ts'
import type { RecordedPlanRecovery } from './recorded-plan-recovery.ts'
import type { ReviewWatch } from './review-watch.ts'
import type { RunJournal } from './run-journal.ts'
import { RunPlanAgents, RunProvenance, type RunProvenanceValue } from './run-plan-agents.ts'

type PlanOutcome =
  | { readonly phase: typeof ActivePlanPhase.PLANNING }
  | {
    readonly phase: typeof ActivePlanPhase.IMPLEMENTING,
    readonly review: boolean,
    readonly acceptsChange: boolean,
  }
  | {
    readonly phase: typeof ActivePlanPhase.UNCERTAIN,
    readonly diagnostic: string,
    readonly recovery: ActivePlanRecovery,
    readonly refusal: RunClosure | null,
  }

type WatchProvenance =
  | { readonly kind: 'proven', readonly provenance: RunProvenanceValue }
  | { readonly kind: 'unproven', readonly diagnostic: string }

class RecoveredRunPlan {
  readonly watch: PlanWatch
  readonly outcome: PlanOutcome

  constructor(watch: PlanWatch, outcome: PlanOutcome) {
    this.watch = watch
    this.outcome = Object.freeze({ ...outcome })
    Object.freeze(this)
  }
}

export class RunPlanRecovery {
  static readonly LEGACY_ACCEPTS_CHANGE = true

  readonly legacy: RecordedPlanRecovery
  readonly records: PlanRecords
  readonly calls: PlanCalls
  readonly transport: ClaudeCalls
  readonly machine: CtRunMachine
  readonly journal: RunJournal
  readonly agents: RunPlanAgents
  readonly checkouts: CheckoutRegistry
  readonly activePlans: ActivePlans
  readonly reviews: ReviewWatch
  readonly nowMs: () => number
  readonly reviewing: Map<string, object>
  recovering: Promise<string | null> | null

  constructor(ports: {
    legacy: RecordedPlanRecovery,
    records: PlanRecords,
    calls: PlanCalls,
    transport: ClaudeCalls,
    machine: CtRunMachine,
    journal: RunJournal,
    agents: RunPlanAgents,
    checkouts: CheckoutRegistry,
    activePlans: ActivePlans,
    reviews: ReviewWatch,
    nowMs: () => number,
  }) {
    this.legacy = ports.legacy
    this.records = ports.records
    this.calls = ports.calls
    this.transport = ports.transport
    this.machine = ports.machine
    this.journal = ports.journal
    this.agents = ports.agents
    this.checkouts = ports.checkouts
    this.activePlans = ports.activePlans
    this.reviews = ports.reviews
    this.nowMs = ports.nowMs
    this.reviewing = new Map()
    this.recovering = null
  }

  async recover(): Promise<string | null> {
    this.recovering = this.recovering ?? this.#recover()
    const recovery = this.recovering
    try {
      return await recovery
    } finally {
      if (this.recovering === recovery) this.recovering = null
    }
  }

  async #recover(): Promise<string | null> {
    const found = await this.records.inFlight()
    if (!found.wereListed) return found.reason
    const watches = found.watches ?? []
    let provenances: WatchProvenance[]
    try {
      provenances = await Promise.all(watches.map((watch) => this.#provenanceOf(watch)))
    } catch (cause) {
      return RunPlanRecovery.#diagnostic(cause)
    }
    if (watches.length > 0
      && provenances.every((entry) => entry.kind === 'proven' && entry.provenance === RunProvenance.LEGACY)) {
      return this.legacy.recover()
    }

    const recovered: RecoveredRunPlan[] = []
    try {
      for (let index = 0; index < watches.length; index += 1) {
        const provenance = provenances[index]
        if (provenance.kind === 'unproven') {
          recovered.push(this.#inspect(watches[index], provenance.diagnostic))
          continue
        }
        recovered.push(provenance.provenance === RunProvenance.LEGACY
          ? await this.#legacy(watches[index])
          : await this.#driver(watches[index]))
      }
    } catch (cause) {
      return RunPlanRecovery.#diagnostic(cause)
    }

    const foundKeys = new Set(watches.map((watch) => this.#key(watch)))
    for (const watch of this.activePlans.watches()) {
      const key = this.#key(watch)
      if (foundKeys.has(key)) continue
      this.reviews.stop({ issue: watch.issue.number, repository: watch.repository })
      this.#forgetReviewing(key)
      this.activePlans.forget({ issue: watch.issue.number, repository: watch.repository })
    }
    for (const plan of recovered) {
      this.checkouts.remember(new RegisteredCheckout({
        repository: plan.watch.repository,
        root: new CheckoutRoot(plan.watch.located.root),
      }))
      this.#remember(plan)
    }
    return null
  }

  async #provenanceOf(watch: PlanWatch): Promise<WatchProvenance> {
    try {
      return { kind: 'proven', provenance: await this.agents.provenance(watch) }
    } catch (cause) {
      if (cause instanceof PlanRecoveryConflict) return { kind: 'unproven', diagnostic: cause.message }
      throw cause
    }
  }

  async #legacy(watch: PlanWatch): Promise<RecoveredRunPlan> {
    const recovery = await this.calls.recoveryFor(watch)
    if (recovery.successfulExecution() !== null) {
      return new RecoveredRunPlan(watch, {
        phase: ActivePlanPhase.IMPLEMENTING, review: true, acceptsChange: RunPlanRecovery.LEGACY_ACCEPTS_CHANGE,
      })
    }
    if (recovery.action === 'observe' && this.transport.owns(recovery.call())) {
      return this.#owned(watch, recovery.purposeOf(recovery.call()), RunPlanRecovery.LEGACY_ACCEPTS_CHANGE)
    }
    return this.#uncertain(
      watch,
      recovery.action === 'observe'
        ? `incomplete call ${recovery.call().id} is not owned by this API process; ${recovery.detail}`
        : recovery.detail,
      recovery,
    )
  }

  async #driver(watch: PlanWatch): Promise<RecoveredRunPlan> {
    const history = await this.transport.history(watch.agent)
    const inspection = await this.machine.inspect(watch)
    const fact = inspection.fact
    const entries = await this.journal.entries(watch)
    const facts = await this.#facts(history)
    const identityConflict = fact.kind === 'absent'
      ? null
      : await this.#identityConflict(history, entries.map((entry) => entry.ticket))
    if (identityConflict !== null) return this.#inspect(watch, identityConflict)

    const unfinished = history.filter((recorded) => recorded.completion === null)
    switch (fact.kind) {
      case 'absent':
        return this.#beforeManifest(watch)
      case 'delivered':
        if (unfinished.some((recorded) => recorded.purpose !== 'fix')) {
          return this.#inspect(watch, `incomplete call ${unfinished[0].call.id} is not the current machine work`)
        }
        return this.#delivered(watch, facts.filter((recorded) => recorded.purpose === 'fix'))
      case 'uncertain':
        return this.#inspect(watch, fact.detail, fact.closure)
      case 'active':
      case 'unstarted':
        break
    }
    if (unfinished.length > 1) return this.#inspect(watch, 'multiple unfinished calls are recorded')
    if (unfinished.length === 1) {
      const current = await this.#current(unfinished[0], inspection)
      if (!current) {
        return this.#inspect(watch, `incomplete call ${unfinished[0].call.id} is not the current machine work`)
      }
      if (!this.transport.owns(unfinished[0].call)) {
        return this.#inspect(watch, `incomplete call ${unfinished[0].call.id} is not owned by this API process`)
      }
      return this.#owned(watch, unfinished[0].purpose)
    }
    if (this.agents.owns(watch)) {
      return new RecoveredRunPlan(watch, {
        phase: ActivePlanPhase.IMPLEMENTING, review: false, acceptsChange: true,
      })
    }
    return fact.kind === 'unstarted'
      ? this.#continuable(watch, 'the established run has not issued its first command')
      : this.#continuable(watch, 'completed machine work remains ready for explicit continuation')
  }

  async #beforeManifest(watch: PlanWatch): Promise<RecoveredRunPlan> {
    const recovery = await this.calls.recoveryFor(watch)
    if (recovery.action === 'observe' && this.transport.owns(recovery.call())) {
      return this.#owned(watch, recovery.purposeOf(recovery.call()))
    }
    if (recovery.action === 'observe') {
      return this.#inspect(
        watch,
        `incomplete call ${recovery.call().id} is not owned by this API process; ${recovery.detail}`,
      )
    }
    return this.#uncertain(
      watch,
      recovery.detail,
      recovery,
    )
  }

  #delivered(watch: PlanWatch, fixes: readonly RecoveryCall[]): RecoveredRunPlan {
    if (fixes.length === 0) {
      return new RecoveredRunPlan(watch, {
        phase: ActivePlanPhase.IMPLEMENTING, review: true, acceptsChange: true,
      })
    }
    const recovery = PlanRecovery.from({ calls: fixes, proof: null, cleanup: null, nowMs: this.nowMs() })
    if (recovery.successfulExecution() !== null) {
      return new RecoveredRunPlan(watch, {
        phase: ActivePlanPhase.IMPLEMENTING, review: true, acceptsChange: true,
      })
    }
    if (recovery.action === 'observe' && this.transport.owns(recovery.call())) {
      return new RecoveredRunPlan(watch, {
        phase: ActivePlanPhase.IMPLEMENTING, review: false, acceptsChange: false,
      })
    }
    if (recovery.action === 'observe') {
      return this.#inspect(
        watch,
        `incomplete call ${recovery.call().id} is not owned by this API process; ${recovery.detail}`,
      )
    }
    return this.#uncertain(
      watch,
      recovery.detail,
      recovery,
    )
  }

  async #facts(history: readonly RecordedCall[]): Promise<readonly RecoveryCall[]> {
    const facts: RecoveryCall[] = []
    for (const recorded of history) facts.push(new RecoveryCall({
      call: recorded.call,
      purpose: recorded.purpose,
      startedAt: recorded.startedAt,
      deadlineMs: await this.transport.deadlineOf(recorded.call),
      completion: recorded.completion,
    }))
    return Object.freeze(facts)
  }

  async #identityConflict(history: readonly RecordedCall[], tickets: readonly string[]): Promise<string | null> {
    const journal = new Set(tickets)
    const matched = new Set<string>()
    for (const recorded of history) {
      if (recorded.purpose !== 'implementation') continue
      const requestId = (await this.transport.descriptorOf(recorded.call)).requestId
      if (requestId === null || !requestId.startsWith('run:')) continue
      const ticket = requestId.slice('run:'.length)
      if (!journal.has(ticket)) return `implementation call ${recorded.call.id} names journal ticket ${ticket} that is absent`
      if (matched.has(ticket)) return `journal ticket ${ticket} has multiple implementation calls`
      matched.add(ticket)
    }
    return null
  }

  async #current(recorded: RecordedCall, inspection: RunInspection): Promise<boolean> {
    if (inspection.fact.kind === 'absent') return recorded.purpose === 'plan'
    if (inspection.fact.kind === 'delivered') return recorded.purpose === 'fix'
    if (inspection.fact.kind !== 'active' || inspection.fact.instruction.work.kind !== 'call') return false
    if (recorded.purpose !== 'implementation') return false
    const requestId = (await this.transport.descriptorOf(recorded.call)).requestId
    return requestId === `run:${inspection.fact.instruction.work.ticket}`
  }

  #continuable(watch: PlanWatch, detail: string): RecoveredRunPlan {
    return new RecoveredRunPlan(watch, {
      phase: ActivePlanPhase.UNCERTAIN,
      diagnostic: detail,
      recovery: Object.freeze({ action: 'continue', detail }),
      refusal: null,
    })
  }

  #owned(
    watch: PlanWatch, purpose: RecordedCall['purpose'], acceptsChange: boolean = false,
  ): RecoveredRunPlan {
    return purpose === 'plan'
      ? new RecoveredRunPlan(watch, { phase: ActivePlanPhase.PLANNING })
      : new RecoveredRunPlan(watch, { phase: ActivePlanPhase.IMPLEMENTING, review: false, acceptsChange })
  }

  #inspect(watch: PlanWatch, detail: string, refusal: RunClosure | null = null): RecoveredRunPlan {
    return new RecoveredRunPlan(watch, {
      phase: ActivePlanPhase.UNCERTAIN,
      diagnostic: detail,
      recovery: Object.freeze({ action: 'inspect', detail }),
      refusal,
    })
  }

  #uncertain(watch: PlanWatch, diagnostic: string, recovery: PlanRecovery): RecoveredRunPlan {
    return new RecoveredRunPlan(watch, {
      phase: ActivePlanPhase.UNCERTAIN,
      diagnostic,
      recovery: Object.freeze({ action: recovery.action, detail: recovery.detail }),
      refusal: null,
    })
  }

  #remember(recovered: RecoveredRunPlan): void {
    const key = this.#key(recovered.watch)
    switch (recovered.outcome.phase) {
      case ActivePlanPhase.PLANNING:
        this.reviews.stop({ issue: recovered.watch.issue.number, repository: recovered.watch.repository })
        this.#forgetReviewing(key)
        this.activePlans.rememberPlanning(recovered.watch)
        return
      case ActivePlanPhase.UNCERTAIN:
        this.reviews.stop({ issue: recovered.watch.issue.number, repository: recovered.watch.repository })
        this.#forgetReviewing(key)
        this.activePlans.rememberUncertain(
          recovered.watch,
          recovered.outcome.diagnostic,
          recovered.outcome.recovery,
          recovered.outcome.refusal,
        )
        return
      case ActivePlanPhase.IMPLEMENTING:
        if (!recovered.outcome.review) {
          this.reviews.stop({ issue: recovered.watch.issue.number, repository: recovered.watch.repository })
          this.#forgetReviewing(key)
          this.activePlans.rememberImplementing(recovered.watch, recovered.outcome.acceptsChange)
          return
        }
        if (this.reviewing.has(key)) {
          this.activePlans.rememberImplementing(recovered.watch, recovered.outcome.acceptsChange)
          return
        }
        this.reviews.stop({ issue: recovered.watch.issue.number, repository: recovered.watch.repository })
        this.#forgetReviewing(key)
        const registration = Object.freeze({})
        this.reviewing.set(key, registration)
        const watching = this.reviews.startRecovered(recovered.watch)
        this.activePlans.rememberImplementing(recovered.watch, recovered.outcome.acceptsChange)
        void watching.finally(() => {
          if (this.reviewing.get(key) === registration) this.reviewing.delete(key)
        })
        return
    }
  }

  #key(watch: PlanWatch): string {
    return `${watch.repository.text}#${watch.issue.number}`
  }

  #forgetReviewing(key: string): void {
    this.reviewing.delete(key)
  }

  static #diagnostic(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
  }
}
