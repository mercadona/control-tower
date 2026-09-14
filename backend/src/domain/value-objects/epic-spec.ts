import { analyzeSpecFreeze, HYPOTHESIS_REASONS } from '../../../../plugin/scripts/groom.js'
import { FreezeFinding, FreezeFindingCode } from './freeze-finding.ts'

export class EpicSpec {
  static readonly TITLE_SUFFIX = ' — Execution spec'
  static readonly HANDOFF_LINE = '**Handoff origen:**'
  static readonly DATE_LINE = '**Fecha de congelación:**'
  static readonly STATE_LINE = '**Estado:**'
  static readonly DRAFT = 'DRAFT'
  static readonly FROZEN = 'CONGELADA'
  static readonly #UNSET_DATE = '—'
  static readonly #DESIGN_QUOTED = /`([^`]+)`/
  static readonly #HEADING = '# '

  readonly path: string
  readonly text: string

  constructor({ path, text }: { path: string, text: string }) {
    this.path = path
    this.text = text
    Object.freeze(this)
  }

  static dateOf(now: Date): string {
    const year = String(now.getFullYear())
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  title(): string | null {
    const heading = EpicSpec.#lines(this.text).find((line) => line.startsWith(EpicSpec.#HEADING))
    if (heading === undefined) return null
    const named = heading.slice(EpicSpec.#HEADING.length).trim()
    return named.endsWith(EpicSpec.TITLE_SUFFIX)
      ? named.slice(0, named.length - EpicSpec.TITLE_SUFFIX.length)
      : named
  }

  design(): string | null {
    const value = EpicSpec.#valueOf(this.text, EpicSpec.HANDOFF_LINE)
    if (value === null) return null
    const quoted = value.match(EpicSpec.#DESIGN_QUOTED)
    return quoted === null ? null : quoted[1]
  }

  isFrozen(): boolean {
    return EpicSpec.#valueOf(this.text, EpicSpec.STATE_LINE) === EpicSpec.FROZEN
  }

  frozenOn(): string | null {
    if (!this.isFrozen()) return null
    const value = EpicSpec.#valueOf(this.text, EpicSpec.DATE_LINE)
    return value === null || value === EpicSpec.#UNSET_DATE ? null : value
  }

  findings(): FreezeFinding[] {
    const analyzed = analyzeSpecFreeze(this.text)
    const clarifications = analyzed.clarifications.map((clarification) => new FreezeFinding({
      code: FreezeFindingCode.CLARIFICATION_MARKER,
      line: clarification.line,
      detail: clarification.raw,
    }))
    switch (analyzed.hypothesis) {
      case HYPOTHESIS_REASONS.OK:
        return clarifications
      case HYPOTHESIS_REASONS.ABSENT:
        return [...clarifications, new FreezeFinding({ code: FreezeFindingCode.HYPOTHESIS_ABSENT, line: null, detail: null })]
      case HYPOTHESIS_REASONS.EMPTY:
        return [...clarifications, new FreezeFinding({ code: FreezeFindingCode.HYPOTHESIS_EMPTY, line: null, detail: null })]
      default:
        throw new Error(`no freeze finding is declared for the hypothesis reason ${JSON.stringify(analyzed.hypothesis)}`)
    }
  }

  isFreezable(): boolean {
    return this.findings().length === 0
  }

  frozenAt(on: string): string {
    return EpicSpec.#lines(this.text)
      .map((line) => {
        if (line.startsWith(EpicSpec.STATE_LINE)) return `${EpicSpec.STATE_LINE} ${EpicSpec.FROZEN}`
        if (line.startsWith(EpicSpec.DATE_LINE)) return `${EpicSpec.DATE_LINE} ${on}`
        return line
      })
      .join('\n')
  }

  static #lines(text: string): string[] {
    return text.split('\n')
  }

  static #valueOf(text: string, prefix: string): string | null {
    const line = EpicSpec.#lines(text).find((raw) => raw.startsWith(prefix))
    return line === undefined ? null : line.slice(prefix.length).trim()
  }
}
