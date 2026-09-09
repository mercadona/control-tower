export class WorkspaceLocation {
  readonly root: string | undefined
  readonly path: string
  readonly branch: string

  constructor({ root, path, branch }: { root?: string, path: string, branch: string }) {
    this.root = root
    this.path = path
    this.branch = branch
    Object.freeze(this)
  }
}
