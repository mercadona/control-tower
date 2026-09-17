import { WorkspaceLocation } from './workspace-location.ts'

export class RootedWorkspaceLocation extends WorkspaceLocation {
  declare readonly root: string

  constructor({ root, path, branch }: { root: string, path: string, branch: string }) {
    super({ root, path, branch })
  }
}
