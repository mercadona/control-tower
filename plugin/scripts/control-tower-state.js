import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

// THE ONE DOOR where an environment decides where Control Tower keeps its own
// state. It is one door and not four because the alternative was measured: with
// every command reading `CT_STATE_DIR` for itself, a malformed value reached
// `/ct-status` and `/ct-next` as a stack trace while the backend answered the
// same mistake with a sentence, and the fifth command would have had to
// remember on its own (#471).
//
// Nothing below throws. A configuration mistake is an answer —a `StateRoot`
// carrying a reason and no path— because the caller is an entrypoint that has
// to print it and stop, not a caller that can be rescued. `Invocation` in the
// backend turns that same reason into its `unknown-state-home` outcome, so the
// two halves of the loop refuse the same value with the same words.
export class ControlTowerState {
  static VARIABLE = 'CT_STATE_DIR'
  static DIRECTORY = 'control-tower'
  static ACCOUNT_DIRECTORY = '.claude'

  // The account's own directory, with no `control-tower` suffix: `configuredDir`
  // in run-metrics.js and `configuredIn` in the backend's invocation.ts are the
  // same rule, and this is where it lives so there is one copy and not three.
  static accountDirectory({ configDir = null, home = null } = {}) {
    return configDir || join(home || homedir(), ControlTowerState.ACCOUNT_DIRECTORY)
  }

  // The rule alone, over a value somebody has ALREADY checked. Unset means the
  // account-relative default; a root that was asked for is the exact root, with
  // nothing appended to it.
  static rootOf(account, checked) {
    return checked ? checked : join(account, ControlTowerState.DIRECTORY)
  }

  static resolveIn(environment, opts = {}) {
    const requested = environment[ControlTowerState.VARIABLE]
    const account = ControlTowerState.accountDirectory(opts)
    if (!ControlTowerState.#asked(requested)) return StateRoot.at(ControlTowerState.rootOf(account, null))
    if (!ControlTowerState.#isRoot(requested)) return StateRoot.refusing(ControlTowerState.reasonFor(requested))

    return StateRoot.at(requested)
  }

  static reasonFor(requested) {
    return `${ControlTowerState.VARIABLE} must be an absolute path without null bytes, got ${JSON.stringify(requested)}`
  }

  static #asked(requested) {
    return requested !== undefined && requested !== null && requested !== ''
  }

  // Refused rather than quietly resolved: somebody who sets this variable is
  // asking to stop writing under the account, and a fallback would write there
  // anyway and say nothing.
  static #isRoot(requested) {
    return typeof requested === 'string' && isAbsolute(requested) && !requested.includes('\0')
  }
}

// Either a path or a reason, never both and never neither.
export class StateRoot {
  static at(path) {
    return new StateRoot({ path, reason: null })
  }

  static refusing(reason) {
    return new StateRoot({ path: null, reason })
  }

  constructor({ path, reason }) {
    this.path = path
    this.reason = reason
    Object.freeze(this)
  }
}
