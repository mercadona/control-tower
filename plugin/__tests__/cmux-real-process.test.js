import { describe, it, expect, afterEach } from 'vitest'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { CmuxWorkspaceQuery } from '../scripts/cmux.js'

class ARealCmux {
  static ACCESS_DENIED = 'Error: ERROR: Access denied - only processes started inside cmux can connect'
  static UNKNOWN_COMMAND = 'Unknown command: workspace'
  static #made = []
  static #path = null

  static refusingTheConnection() {
    return ARealCmux.#onThePath([
      '#!/bin/sh',
      `echo "${ARealCmux.ACCESS_DENIED}" >&2`,
      'exit 1',
    ])
  }

  static withoutTheWorkspaceCommand() {
    return ARealCmux.#onThePath([
      '#!/bin/sh',
      'if [ "$1" = "list-windows" ]; then echo \'[{"id":"w1"}]\'; exit 0; fi',
      `echo "${ARealCmux.UNKNOWN_COMMAND}" >&2`,
      'exit 1',
    ])
  }

  static #onThePath(script) {
    const directory = mkdtempSync(join(tmpdir(), 'ct-cmux-real-'))
    ARealCmux.#made.push(directory)
    const binary = join(directory, 'cmux')
    writeFileSync(binary, `${script.join('\n')}\n`)
    chmodSync(binary, 0o755)
    ARealCmux.#path = ARealCmux.#path ?? process.env.PATH
    process.env.PATH = `${directory}:${ARealCmux.#path}`

    return CmuxWorkspaceQuery.ask({ requireComplete: true })
  }

  static sweep() {
    if (ARealCmux.#path !== null) process.env.PATH = ARealCmux.#path
    ARealCmux.#path = null
    for (const directory of ARealCmux.#made.splice(0)) rmSyncBestEffort(directory)
  }
}

describe('what a real cmux writes on its error channel', () => {
  afterEach(() => {
    ARealCmux.sweep()
  })

  it('reaches_the_reason_instead_of_being_discarded_with_the_childs_error_channel', () => {
    const asked = ARealCmux.refusingTheConnection()

    expect(asked.wasAnswered).toBe(false)
    expect(asked.reason).toContain(ARealCmux.ACCESS_DENIED)
  })

  it('names_the_command_a_cmux_too_old_for_this_query_does_not_have', () => {
    const asked = ARealCmux.withoutTheWorkspaceCommand()

    expect(asked.wasAnswered).toBe(false)
    expect(asked.reason).toContain(ARealCmux.UNKNOWN_COMMAND)
  })
})
