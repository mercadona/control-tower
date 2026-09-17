export type RunWork =
  | { readonly kind: 'call' | 'command'; readonly ticket: string }
  | { readonly kind: 'delivered' }
  | { readonly kind: 'refused'; readonly detail: string }

export class RunInstruction {
  readonly work: RunWork

  constructor(work: RunWork) {
    this.work = RunInstruction.#freeze(work)
    Object.freeze(this)
  }

  static #freeze(work: RunWork): RunWork {
    switch (work.kind) {
      case 'call':
      case 'command':
        RunInstruction.#requireText('ticket', work.ticket)
        return Object.freeze({ kind: work.kind, ticket: work.ticket })
      case 'delivered':
        return Object.freeze({ kind: work.kind })
      case 'refused':
        RunInstruction.#requireText('detail', work.detail)
        return Object.freeze({ kind: work.kind, detail: work.detail })
    }
    return work satisfies never
  }

  static #requireText(field: 'ticket' | 'detail', value: string): void {
    if (value.trim().length === 0) throw new TypeError(`${field} must be nonempty, got ${JSON.stringify(value)}`)
  }
}
