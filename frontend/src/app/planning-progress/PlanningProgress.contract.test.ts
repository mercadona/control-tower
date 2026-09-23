import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PlanningActivityState } from 'app/planning-progress/PlanningProgress.types'

const BACKEND_VOCABULARY = join(process.cwd(), '..', 'backend', 'src', 'domain', 'value-objects', 'planning-activity.ts')
const DECLARATION = /export const PlanningActivityState = Object\.freeze\(\{([^}]*)\} as const\)/
const MEMBER = /^\s*[A-Z0-9_]+:\s*'([^']+)',?\s*$/

const backendStates = (): string[] => {
  const source = readFileSync(BACKEND_VOCABULARY, 'utf8')
  const declared = source.match(DECLARATION)
  if (declared === null) throw new Error(`${BACKEND_VOCABULARY} no longer declares PlanningActivityState as this reads it`)

  return declared[1]
    .split('\n')
    .map((line) => line.match(MEMBER))
    .filter((member): member is RegExpMatchArray => member !== null)
    .map((member) => member[1])
}

describe('the planning states this frontend paints and the backend sends', () => {
  it('should carry the same vocabulary on both halves, because a state the backend adds arrives here as a red refusal', () => {
    expect([...Object.values(PlanningActivityState)].sort()).toEqual(backendStates().sort())
  })

  it('should read the backend declaration it compares against, so a rename cannot leave this test vacuous', () => {
    expect(backendStates()).toContain(PlanningActivityState.FINISHED)
  })
})
