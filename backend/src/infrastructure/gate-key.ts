import { Browsers } from './http.ts'

export class GateKey {
  static readonly HEADER = 'x-gate-key'
  static readonly SITE_HEADER = 'sec-fetch-site'
  static readonly SAME_ORIGIN = 'same-origin'
  static readonly BYTES = 32

  readonly #minted: string

  constructor({ random }: { random: (size: number) => Buffer }) {
    this.#minted = random(GateKey.BYTES).toString('hex')
  }

  forThePage(asked: { origin: unknown, host: unknown, site: unknown }): string | null {
    return GateKey.#isTheBrowserOnThisOrigin(asked) ? this.#minted : null
  }

  static #isTheBrowserOnThisOrigin(asked: { origin: unknown, host: unknown, site: unknown }): boolean {
    if (Browsers.isOurOwnPage(asked.origin, asked.host)) return true

    return asked.site === GateKey.SAME_ORIGIN && Browsers.isOurOwnHost(asked.host)
  }

  holds(offered: unknown): boolean {
    return offered === this.#minted
  }
}
