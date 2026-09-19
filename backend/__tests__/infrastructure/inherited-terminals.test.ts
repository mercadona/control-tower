import { describe, expect, it } from 'vitest'
import { InheritedTerminals } from '../../src/infrastructure/inherited-terminals.ts'

class ADescriptorTable {
  readonly closed: number[]
  readonly #targets: ReadonlyMap<number, string>
  readonly #listed: readonly string[]

  private constructor(targets: ReadonlyMap<number, string>, listed: readonly string[]) {
    this.closed = []
    this.#targets = targets
    this.#listed = listed
  }

  static holding(targets: Readonly<Record<number, string>>): ADescriptorTable {
    const entries = Object.entries(targets).map(([descriptor, target]) => [Number(descriptor), target] as const)

    return new ADescriptorTable(new Map(entries), entries.map(([descriptor]) => String(descriptor)))
  }

  static unreadable(): ADescriptorTable {
    return new ADescriptorTable(new Map(), [])
  }

  terminals(): InheritedTerminals {
    return new InheritedTerminals({
      list: () => this.#listed,
      target: (descriptor) => this.#targets.get(descriptor) ?? '',
      close: (descriptor) => { this.closed.push(descriptor) },
    })
  }
}

describe('the terminals a process inherited from the one that spawned it', () => {
  it('releases every descriptor that still points at a terminal master', () => {
    const table = ADescriptorTable.holding({ 3: '/dev/pts/ptmx', 4: '/dev/pts/ptmx' })

    expect(table.terminals().released()).toEqual([3, 4])
    expect(table.closed).toEqual([3, 4])
  })

  it('leaves alone a descriptor that points at anything else', () => {
    const table = ADescriptorTable.holding({
      3: '/dev/pts/7', 4: 'socket:[14219]', 5: '/var/log/ct.json', 6: '/dev/null', 7: '/dev/pts/ptmx',
    })

    expect(table.terminals().released()).toEqual([7])
    expect(table.closed).toEqual([7])
  })

  it('leaves alone the three descriptors a process was given rather than inherited', () => {
    const table = ADescriptorTable.holding({ 0: '/dev/pts/ptmx', 1: '/dev/pts/ptmx', 2: '/dev/pts/ptmx' })

    expect(table.terminals().released()).toEqual([])
    expect(table.closed).toEqual([])
  })

  it('releases nothing where there is no descriptor table to read, which is every platform but Linux', () => {
    const table = ADescriptorTable.unreadable()

    expect(table.terminals().released()).toEqual([])
    expect(table.closed).toEqual([])
  })
})
