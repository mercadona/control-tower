export class WorkspaceMount {
  readonly source: string
  readonly target: string

  constructor(source: string, target: string) {
    this.source = source
    this.target = target
    Object.freeze(this)
  }

  matches(other: WorkspaceMount): boolean {
    return this.source === other.source && this.target === other.target
  }

  static contains(root: string, path: string): boolean {
    return path === root || path.startsWith(`${root.replace(/\/+$/, '')}/`)
  }
}
