export class MetricsDelivery {
  static readonly VARIABLE = 'CT_HARVEST_BQ_TABLE'
  static readonly TOOL = 'bq'
  static readonly DESTINATION_SHAPE = 'project:dataset.table'

  readonly destination: string | null

  constructor({ destination }: { destination: unknown }) {
    if (!MetricsDelivery.#isDestination(destination)) {
      throw new Error(
        `a metrics delivery destination is a non-empty string like ${MetricsDelivery.DESTINATION_SHAPE}, or null when ${MetricsDelivery.VARIABLE} is unset, got ${JSON.stringify(destination)}`
      )
    }
    this.destination = destination
    Object.freeze(this)
  }

  static #isDestination(destination: unknown): destination is string | null {
    return destination === null || (typeof destination === 'string' && destination.length > 0)
  }

  static to(destination: string | null | undefined): MetricsDelivery {
    return new MetricsDelivery({ destination: destination === undefined ? null : destination })
  }

  static disabled(): MetricsDelivery {
    return new MetricsDelivery({ destination: null })
  }

  get enabled(): boolean {
    return this.destination !== null
  }

  demands(tool: string): boolean {
    return tool === MetricsDelivery.TOOL && this.enabled
  }
}
