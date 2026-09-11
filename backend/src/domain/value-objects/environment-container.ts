import type { WorkspaceMount } from './workspace-mount.ts'

export class EnvironmentContainer {
  readonly name: string
  readonly service: string
  readonly running: boolean
  readonly mounts: readonly WorkspaceMount[]
  readonly image: string | null

  constructor({ name, service, running, mounts, image }: {
    name: string, service: string, running: boolean, mounts: readonly WorkspaceMount[], image: string | null,
  }) {
    this.name = name
    this.service = service
    this.running = running
    this.mounts = Object.freeze([...mounts])
    this.image = image
    Object.freeze(this)
  }
}
