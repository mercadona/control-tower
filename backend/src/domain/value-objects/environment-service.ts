import type { WorkspaceMount } from './workspace-mount.ts'

export class EnvironmentService {
  readonly name: string
  readonly image: string | null
  readonly cpuLimited: boolean
  readonly memoryLimited: boolean
  readonly healthcheck: boolean
  readonly database: 'postgresql' | null
  readonly healthDependencies: readonly string[]
  readonly startupDependencies: readonly string[]
  readonly mounts: readonly WorkspaceMount[]
  readonly publishedPorts: boolean
  readonly fixedName: boolean
  readonly sharedVolumes: boolean
  readonly buildContext: string | null

  constructor(values: {
    name: string, image: string | null, cpuLimited: boolean, memoryLimited: boolean, healthcheck: boolean,
    database: 'postgresql' | null, healthDependencies: readonly string[], startupDependencies: readonly string[],
    mounts: readonly WorkspaceMount[], publishedPorts: boolean, fixedName: boolean, sharedVolumes: boolean,
    buildContext: string | null,
  }) {
    this.name = values.name
    this.image = values.image
    this.cpuLimited = values.cpuLimited
    this.memoryLimited = values.memoryLimited
    this.healthcheck = values.healthcheck
    this.database = values.database
    this.healthDependencies = Object.freeze([...values.healthDependencies])
    this.startupDependencies = Object.freeze([...values.startupDependencies])
    this.mounts = Object.freeze([...values.mounts])
    this.publishedPorts = values.publishedPorts
    this.fixedName = values.fixedName
    this.sharedVolumes = values.sharedVolumes
    this.buildContext = values.buildContext
    Object.freeze(this)
  }
}
