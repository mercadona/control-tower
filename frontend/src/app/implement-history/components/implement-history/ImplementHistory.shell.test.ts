import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

class Stylesheet {
  private readonly text: string

  constructor(path: string) {
    this.text = readFileSync(join(HERE, path), 'utf8')
  }

  static implementHistory() {
    return new Stylesheet('ImplementHistory.css')
  }

  declarationsFor(selector: string) {
    return this.blocksFor(this.text, selector)
  }

  narrowDeclarationsFor(selector: string, query: string) {
    return this.blocksFor(this.mediaQuery(query), selector)
  }

  mediaQuery(query: string) {
    const opened = this.text.indexOf(query)
    if (opened === -1) throw new Error(`ImplementHistory.css no longer declares ${query}`)
    let depth = 0
    for (let cursor = this.text.indexOf('{', opened); cursor < this.text.length; cursor += 1) {
      if (this.text[cursor] === '{') depth += 1
      if (this.text[cursor] === '}') depth -= 1
      if (depth === 0) return this.text.slice(opened, cursor + 1)
    }
    throw new Error(`${query} of ImplementHistory.css is not closed`)
  }

  private blocksFor(text: string, selector: string) {
    const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '')
    const found: string[] = []
    for (const [, selectors, declarations] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const named = selectors.split(',').map((one) => one.trim().replace(/^@media[^{]*$/, ''))
      if (named.includes(selector)) found.push(declarations)
    }
    if (found.length === 0) throw new Error(`no rule declares ${selector}`)
    return found.join(';')
  }
}

describe('the summary tiles form one row of three equal columns at the panel width', () => {
  it('lays the three tiles out as a grid row instead of stacking or wrapping', () => {
    const tiles = Stylesheet.implementHistory().declarationsFor('.implement-history__tiles')

    expect(tiles).toMatch(/display:\s*grid/)
    expect(tiles).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/)
  })

  it('wraps back to a single column only once the panel is narrower than 360px', () => {
    const narrow = Stylesheet.implementHistory().narrowDeclarationsFor('.implement-history__tiles', '@media (width < 360px)')

    expect(narrow).toMatch(/grid-template-columns:\s*1fr/)
  })
})
