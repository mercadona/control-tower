class FakeTerminal {
  static instances: FakeTerminal[] = []

  written: string[] = []
  disposed = false
  onDataHandler: ((text: string) => void) | null = null
  opened: Element | null = null

  constructor() {
    FakeTerminal.instances.push(this)
  }

  loadAddon() {}

  open(screen: Element) {
    this.opened = screen
  }

  write(data: string) {
    this.written.push(data)
  }

  reset() {
    this.written = []
  }

  onData(handler: (text: string) => void) {
    this.onDataHandler = handler
  }

  resize() {}

  dispose() {
    this.disposed = true
  }

  static install() {
    FakeTerminal.instances = []
  }

  static last(): FakeTerminal {
    const last = FakeTerminal.instances.at(-1)
    if (last === undefined) throw new Error('no terminal was created')

    return last
  }
}

class FakeFitAddon {
  static instances: FakeFitAddon[] = []
  static nextProposedDimensions: { cols: number; rows: number } | undefined = undefined

  disposed = false

  constructor() {
    FakeFitAddon.instances.push(this)
  }

  proposeDimensions() {
    return FakeFitAddon.nextProposedDimensions
  }

  fit() {}

  dispose() {
    this.disposed = true
  }

  static install() {
    FakeFitAddon.instances = []
    FakeFitAddon.nextProposedDimensions = undefined
  }

  static last(): FakeFitAddon {
    const last = FakeFitAddon.instances.at(-1)
    if (last === undefined) throw new Error('no fit addon was created')

    return last
  }
}

export { FakeTerminal, FakeFitAddon }
