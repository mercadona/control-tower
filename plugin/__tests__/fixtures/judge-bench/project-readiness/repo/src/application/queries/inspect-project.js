export class InspectProjectParams {
  constructor({ root }) {
    this.root = root
    Object.freeze(this)
  }
}

export class InspectProjectResult {
  constructor({ report }) {
    this.report = report
    Object.freeze(this)
  }
}

export class InspectProject {
  constructor({ setup }) {
    this.setup = setup
  }

  async execute({ root }) {
    return new InspectProjectResult({ report: await this.setup.inspect(root) })
  }
}
