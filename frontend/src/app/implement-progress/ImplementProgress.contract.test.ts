import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ImplementationStep } from 'app/implement-progress/ImplementProgress.types'

const REPOSITORY_FOUND_FROM_THIS_FILE_AND_NEVER_FROM_THE_WORKING_DIRECTORY =
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const BACKEND_VOCABULARY = join(
  REPOSITORY_FOUND_FROM_THIS_FILE_AND_NEVER_FROM_THE_WORKING_DIRECTORY,
  'backend', 'src', 'domain', 'value-objects', 'implementation-state.ts',
)
const DECLARATION = /export const ImplementationStep = Object\.freeze\(\{([^}]*)\} as const\)/
const MEMBER = /^\s*[A-Z0-9_]+:\s*'([^']+)',?\s*$/

const backendSteps = (): string[] => {
  const source = readFileSync(BACKEND_VOCABULARY, 'utf8')
  const declared = source.match(DECLARATION)
  if (declared === null) throw new Error(`${BACKEND_VOCABULARY} no longer declares ImplementationStep as this reads it`)

  return declared[1]
    .split('\n')
    .map((line) => line.match(MEMBER))
    .filter((member): member is RegExpMatchArray => member !== null)
    .map((member) => member[1])
}

describe('the steps this frontend paints and the backend sends', () => {
  it('should carry the same vocabulary on both halves, because a step the backend adds arrives here as a red refusal', () => {
    expect([...Object.values(ImplementationStep)].sort()).toEqual(backendSteps().sort())
  })

  it('should read the backend declaration it compares against, so a rename cannot leave this test vacuous', () => {
    expect(backendSteps()).toContain(ImplementationStep.IN_REVIEW)
  })
})
