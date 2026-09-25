import { ExternalTool } from './external-tool.ts'

export class Gh extends ExternalTool {
  static readonly BIN = 'gh'

  static readonly #ALSO_TRANSIENT = [
    'no server is currently available to service your request',
    'error connecting to',
  ]

  static readonly #NOT_FOUND = /\(HTTP 404\)/

  isTransient(stderr: string): boolean {
    const lowered = String(stderr).toLowerCase()

    return super.isTransient(stderr) ||
      Gh.#ALSO_TRANSIENT.some((marker) => lowered.includes(marker))
  }

  static isNotFound(stderr: string): boolean {
    return Gh.#NOT_FOUND.test(String(stderr))
  }
}
