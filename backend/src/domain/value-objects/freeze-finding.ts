export const FreezeFindingCode = Object.freeze({
  CLARIFICATION_MARKER: 'clarification-marker',
  HYPOTHESIS_ABSENT: 'hypothesis-absent',
  HYPOTHESIS_EMPTY: 'hypothesis-empty',
  DECISION_WITHOUT_PROVENANCE: 'decision-without-provenance',
} as const)

export type FreezeFindingCodeValue = (typeof FreezeFindingCode)[keyof typeof FreezeFindingCode]

export class FreezeFinding {
  static readonly #CODES: ReadonlySet<string> = new Set(Object.values(FreezeFindingCode))

  readonly code: FreezeFindingCodeValue
  readonly line: number | null
  readonly detail: string | null

  constructor({ code, line, detail }: { code: string, line: number | null, detail: string | null }) {
    if (!FreezeFinding.#CODES.has(code)) {
      throw new Error(`a freeze finding's code is one of ${[...FreezeFinding.#CODES].join(', ')}, got ${JSON.stringify(code)}`)
    }
    this.code = code as FreezeFindingCodeValue
    this.line = line
    this.detail = detail
    Object.freeze(this)
  }
}
