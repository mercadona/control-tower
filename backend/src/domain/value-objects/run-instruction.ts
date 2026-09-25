export type RunFailure = {
  readonly command: string | null,
  readonly code: number | null,
  readonly log: string,
}

export type RunClosure = {
  readonly state: string,
  readonly outcome: string,
  readonly exit: number,
  readonly task: number | null,
  readonly findings: string | null,
  readonly verdict: string | null,
  readonly vetoed: string | null,
  readonly failure: RunFailure | null,
}

export type RunWork =
  | { readonly kind: 'call' | 'command'; readonly ticket: string }
  | { readonly kind: 'delivered' }
  | { readonly kind: 'refused'; readonly detail: string; readonly closure: RunClosure | null }

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
        return Object.freeze({
          kind: work.kind,
          detail: work.detail,
          closure: work.closure === null ? null : Object.freeze({ ...work.closure }),
        })
    }
    return work satisfies never
  }

  static #requireText(field: 'ticket' | 'detail', value: string): void {
    if (value.trim().length === 0) throw new TypeError(`${field} must be nonempty, got ${JSON.stringify(value)}`)
  }
}
