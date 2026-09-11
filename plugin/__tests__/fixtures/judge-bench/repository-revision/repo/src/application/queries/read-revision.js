export class ReadRevisionParams {
  constructor({ root }) {
    this.root = root
    Object.freeze(this)
  }
}

export class ReadRevisionResult {
  constructor({ revision }) {
    this.revision = revision
    Object.freeze(this)
  }
}

export class ReadRevision {
  constructor({ history }) {
    this.history = history
  }

  async execute({ root }) {
    return new ReadRevisionResult({ revision: await this.history.current(root) })
  }
}
