import type { EnvironmentConfiguration } from './environment-configuration.ts'
import type { EnvironmentContainer } from './environment-container.ts'

export class EnvironmentObservations {
  readonly hostEvidence: readonly string[] | null
  readonly configuration: EnvironmentConfiguration | null
  readonly containers: readonly EnvironmentContainer[] | null
  readonly #images: ReadonlyMap<string, string> | null

  constructor({ hostEvidence, configuration, containers, images }: {
    hostEvidence: readonly string[] | null, configuration: EnvironmentConfiguration | null,
    containers: readonly EnvironmentContainer[] | null, images: ReadonlyMap<string, string> | null,
  }) {
    this.hostEvidence = hostEvidence === null ? null : Object.freeze([...hostEvidence])
    this.configuration = configuration
    this.containers = containers === null ? null : Object.freeze([...containers])
    this.#images = images === null ? null : new Map(images)
    Object.freeze(this)
  }

  get imagesKnown(): boolean { return this.#images !== null }
  imageIdentity(name: string): string | null { return this.#images?.get(name) ?? null }
}
