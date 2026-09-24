import { describe, expect, it } from 'vitest'
import { WorkRecoveryClock } from '../../src/infrastructure/work-recovery-clock.ts'
import { ApiServer } from '../../src/infrastructure/api-server.ts'

class ClockScenario {
  readonly scheduled: Array<{ run: () => void, delay: number, cancelled: boolean }> = []
  readonly diagnostics: string[] = []
  calls = 0
  finish: (diagnostic: string | null) => void = () => { throw new Error('no recovery is pending') }
  readonly clock = new WorkRecoveryClock({
    recovery: {
      recover: () => {
        this.calls += 1
        return new Promise<string | null>((resolve) => { this.finish = resolve })
      },
    },
    intervalMs: 2000,
    schedule: (run, delay) => {
      const scheduled = { run, delay, cancelled: false }
      this.scheduled.push(scheduled)
      return () => { scheduled.cancelled = true }
    },
    report: (diagnostic) => this.diagnostics.push(diagnostic),
  })

  async settle(diagnostic: string | null): Promise<void> {
    this.finish(diagnostic)
    await Promise.resolve()
  }
}

describe('WorkRecoveryClock', () => {
  it('the server owns recovery startup and shutdown even if nobody requests a page', async () => {
    const tested = new ClockScenario()
    const server = new ApiServer({ port: 0, frontendRoot: '/no-frontend', maintenance: tested.clock })
    try {
      await server.start()
      expect(tested.scheduled).toHaveLength(1)
      tested.scheduled[0].run()
      await tested.settle(null)
      expect(tested.calls).toBe(1)
    } finally {
      await server.stop()
    }
    expect(tested.scheduled[1].cancelled).toBe(true)
  })

  it('recovers without browser requests and schedules the next scan only after the current scan settles', async () => {
    const tested = new ClockScenario()
    tested.clock.start()
    tested.clock.start()
    expect(tested.scheduled).toHaveLength(1)
    expect(tested.scheduled[0].delay).toBe(0)

    tested.scheduled[0].run()
    expect(tested.calls).toBe(1)
    expect(tested.scheduled).toHaveLength(1)
    await tested.settle(null)
    expect(tested.scheduled[1].delay).toBe(2000)

    await tested.clock.stop()
    expect(tested.scheduled[1].cancelled).toBe(true)
  })

  it('reports a failed scan and keeps the lifecycle able to recover on its next tick', async () => {
    const tested = new ClockScenario()
    tested.clock.start()
    tested.scheduled[0].run()
    await tested.settle('records unavailable')
    expect(tested.diagnostics).toEqual(['records unavailable'])
    tested.scheduled[1].run()
    expect(tested.calls).toBe(2)
    await tested.settle(null)
    await tested.clock.stop()
  })

  it('shutdown drains an in-flight inspection without scheduling another one', async () => {
    const tested = new ClockScenario()
    tested.clock.start()
    tested.scheduled[0].run()
    const stopping = tested.clock.stop()
    await tested.settle(null)
    await stopping
    expect(tested.scheduled).toHaveLength(1)
  })
})
