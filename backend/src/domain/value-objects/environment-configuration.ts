import type { EnvironmentService } from './environment-service.ts'

export class EnvironmentConfiguration {
  readonly name: string
  readonly services: readonly EnvironmentService[]

  constructor(name: string, services: readonly EnvironmentService[]) {
    this.name = name
    this.services = Object.freeze([...services])
    Object.freeze(this)
  }

  get imageNames(): readonly (string | null)[] {
    return [...new Set(this.services.map((service) => service.image))]
  }
}
