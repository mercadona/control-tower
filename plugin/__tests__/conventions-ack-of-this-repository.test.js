import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRepoDocs, readAck } from '../scripts/conventions-io.js'
import { detectConventions } from '../scripts/conventions.js'

// Repository root reached the same way as the LICENSE comparison in
// distribution-boundary.test.js: two levels up from this file
// (__tests__ -> plugin -> repository root).
const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

describe('the acknowledgement of this repository', () => {
  it('this repository acknowledges the claim signal, so a dispatch prints no ATTENTION about it', () => {
    const { docs } = readRepoDocs(REPO_ROOT)
    const { acks, problems } = readAck(REPO_ROOT)
    const findings = detectConventions({ docs, files: [], acks })

    expect(problems).toEqual([])

    const claim = findings.find((f) => f.id === 'claim')
    expect(claim?.silenced).toBeTruthy()
  })
})
