import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const declarationsFor = (selector: string) => {
  const text = readFileSync(join(SOURCE_ROOT, 'workflow-step', 'WorkflowStep.css'), 'utf8')
  const opened = text.indexOf(`${selector} {`)
  if (opened === -1) throw new Error(`WorkflowStep.css no longer declares ${selector}`)
  return text.slice(text.indexOf('{', opened) + 1, text.indexOf('}', opened))
}

describe('the workflow step header', () => {
  it('should count its padding inside its width so a header that is not a button stays within the card', () => {
    const header = declarationsFor('.workflow-step__header')
    expect(header).toContain('box-sizing: border-box')
    expect(header).toContain('width: 100%')
    expect(header).toContain('padding: 24px')
  })
})
