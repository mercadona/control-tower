import { closeSync, readdirSync, readlinkSync } from 'node:fs'
import { basename, join } from 'node:path'

export type DescriptorTable = {
  list: () => readonly string[],
  target: (descriptor: number) => string,
  close: (descriptor: number) => void,
}

export class InheritedTerminals {
  static readonly MASTER = 'ptmx'
  static readonly FIRST_INHERITED = 3
  static readonly TABLE = '/proc/self/fd'

  readonly list: () => readonly string[]
  readonly target: (descriptor: number) => string
  readonly close: (descriptor: number) => void

  constructor({ list, target, close }: DescriptorTable) {
    this.list = list
    this.target = target
    this.close = close
    Object.freeze(this)
  }

  static ofThisProcess(): InheritedTerminals {
    return new InheritedTerminals({
      list: () => {
        try {
          return readdirSync(InheritedTerminals.TABLE)
        } catch {
          return []
        }
      },
      target: (descriptor) => {
        try {
          return readlinkSync(join(InheritedTerminals.TABLE, String(descriptor)))
        } catch {
          return ''
        }
      },
      close: (descriptor) => {
        try {
          closeSync(descriptor)
        } catch {}
      },
    })
  }

  released(): number[] {
    const released: number[] = []
    for (const descriptor of this.#inherited()) {
      if (basename(this.target(descriptor)) !== InheritedTerminals.MASTER) continue
      this.close(descriptor)
      released.push(descriptor)
    }

    return released
  }

  #inherited(): number[] {
    return this.list()
      .map((entry) => Number(entry))
      .filter((descriptor) => Number.isSafeInteger(descriptor) && descriptor >= InheritedTerminals.FIRST_INHERITED)
  }
}
