import type { ActivePlanRecovering } from './active-plans-route.ts'

type Cancel = () => void
type Schedule = (run: () => void, milliseconds: number) => Cancel

export class WorkRecoveryClock {
  readonly recovery: ActivePlanRecovering
  readonly schedule: Schedule
  readonly intervalMs: number
  readonly report: (diagnostic: string) => void
  private running = false
  private cancel: Cancel | null = null
  private pending: Promise<void> | null = null

  constructor({ recovery, schedule, intervalMs, report }: {
    recovery: ActivePlanRecovering,
    schedule: Schedule,
    intervalMs: number,
    report: (diagnostic: string) => void,
  }) {
    this.recovery = recovery
    this.schedule = schedule
    this.intervalMs = intervalMs
    this.report = report
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.#next(0)
  }

  async stop(): Promise<void> {
    this.running = false
    this.cancel?.()
    this.cancel = null
    await this.pending
  }

  #next(delay: number): void {
    this.cancel = this.schedule(() => {
      this.cancel = null
      this.pending = this.#tick()
    }, delay)
  }

  async #tick(): Promise<void> {
    try {
      const diagnostic = await this.recovery.recover()
      if (diagnostic !== null) this.report(diagnostic)
    } catch (cause) {
      this.report(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (this.running) this.#next(this.intervalMs)
    }
  }
}
