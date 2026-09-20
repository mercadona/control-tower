import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { ControlTowerState } from './control-tower-state.js'

// THE RENDEZVOUS between the two halves of the loop. `CT_STATE_DIR` travels
// through the `Makefile` and nothing else, so a command invoked from a Claude
// Code session does not see it: the backend then writes under the root it was
// given and the command reads the account's, and the registry comes back with
// no entries — which is word for word what it says when there really are no
// checkouts. The split was silent, and that is what #471 called the part that
// hurts.
//
// The file lives at the ACCOUNT-RELATIVE DEFAULT, never at the resolved root:
// that is the one location both halves compute without the variable they
// disagree about. When nobody separates anything the two are the same place
// and there is no second location at all.
//
// What it cannot do, accepted knowingly: with the backend stopped there is
// nothing to compare against. That is why the marker carries the pid — a
// leftover of a backend that is no longer running is not a disagreement, and
// refusing over one would be worse than the silence this replaces.
export class StateRootMarker {
  static FILE = 'state-root.json'
  static ROOT_KEY = 'root'
  static PID_KEY = 'pid'
  static AT_KEY = 'at'

  static pathIn(opts = {}) {
    return join(ControlTowerState.rootOf(ControlTowerState.accountDirectory(opts), null), StateRootMarker.FILE)
  }

  static contentFor(root, { pid, at }) {
    return `${JSON.stringify({
      [StateRootMarker.ROOT_KEY]: root,
      [StateRootMarker.PID_KEY]: pid,
      [StateRootMarker.AT_KEY]: at,
    }, null, 2)}\n`
  }

  // A sentence when a live backend keeps the state somewhere else, `null` every
  // other time. It never throws: the caller is a command that has work to do,
  // and a marker nobody can read is a silence, not a verdict.
  static disagreementWith(mine, { read = readFileSync, alive = StateRootMarker.#running, ...opts } = {}) {
    const published = StateRootMarker.#publishedIn(opts, read)
    if (published === null) return null
    if (published[StateRootMarker.ROOT_KEY] === mine) return null
    if (!StateRootMarker.#trustworthy(alive, published[StateRootMarker.PID_KEY])) return null

    return `${ControlTowerState.VARIABLE} disagreement: the backend (pid ${published[StateRootMarker.PID_KEY]}) keeps Control Tower's state in ${JSON.stringify(published[StateRootMarker.ROOT_KEY])}, and this command resolved ${JSON.stringify(mine)}. Give both the same absolute path in ${ControlTowerState.VARIABLE}, or stop the backend: reading one and writing the other reports an empty loop that is not empty.`
  }

  static #publishedIn(opts, read) {
    let parsed
    try {
      parsed = JSON.parse(read(StateRootMarker.pathIn(opts), 'utf8'))
    } catch {
      return null
    }
    if (parsed === null || typeof parsed !== 'object') return null
    const root = parsed[StateRootMarker.ROOT_KEY]
    if (typeof root !== 'string' || !isAbsolute(root)) return null

    return parsed
  }

  static #trustworthy(alive, pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      return alive(pid) === true
    } catch {
      return false
    }
  }

  static #running(pid) {
    try {
      process.kill(pid, 0)

      return true
    } catch (failure) {
      return failure.code === 'EPERM'
    }
  }
}
