import { ExternalTool } from './external-tool.ts'

export class Gh extends ExternalTool {
  static readonly BIN = 'gh'

  static readonly #ALSO_TRANSIENT = [
    'no server is currently available to service your request',
    'error connecting to',
  ]

  static readonly #MISSING_LABEL = /'(.+?)' not found/

  isTransient(stderr: string): boolean {
    const lowered = String(stderr).toLowerCase()

    return super.isTransient(stderr) ||
      Gh.#ALSO_TRANSIENT.some((marker) => lowered.includes(marker))
  }

  static labelMissingIn(stderr: string): string | null {
    const found = String(stderr).match(Gh.#MISSING_LABEL)

    return found === null ? null : found[1]
  }
}
