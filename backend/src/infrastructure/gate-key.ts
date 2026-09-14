import { Browsers } from './http.ts'

export class GateKey {
  static readonly HEADER = 'x-gate-key'
  static readonly BYTES = 32

  readonly #minted: string

  constructor({ random }: { random: (size: number) => Buffer }) {
    this.#minted = random(GateKey.BYTES).toString('hex')
  }

  forThePage(asked: { origin: unknown, host: unknown }): string | null {
    return Browsers.isOurOwnPage(asked.origin, asked.host) ? this.#minted : null
  }

  holds(offered: unknown): boolean {
    return offered === this.#minted
  }
}
