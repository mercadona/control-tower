import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

class Stylesheet {
  private readonly text: string

  constructor(path: string) {
    this.text = readFileSync(join(SOURCE_ROOT, path), 'utf8')
  }

  static home() {
    return new Stylesheet(join('pages', 'home', 'Home.css'))
  }

  static navigation() {
    return new Stylesheet(join('system-ui', 'navigation', 'Navigation.css'))
  }

  declarationsFor(selector: string) {
    return this.blocksFor(this.text, selector)
  }

  narrowDeclarationsFor(selector: string, query: string) {
    return this.blocksFor(this.mediaQuery(query), selector)
  }

  mediaQuery(query: string) {
    const opened = this.text.indexOf(query)
    if (opened === -1) throw new Error(`Home.css no longer declares ${query}`)
    let depth = 0
    for (let cursor = this.text.indexOf('{', opened); cursor < this.text.length; cursor += 1) {
      if (this.text[cursor] === '{') depth += 1
      if (this.text[cursor] === '}') depth -= 1
      if (depth === 0) return this.text.slice(opened, cursor + 1)
    }
    throw new Error(`${query} of Home.css is not closed`)
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

describe('the application shell gives the Navigation shell a height to fill', () => {
  it('makes the shell exactly one viewport tall, because a min-height alone is not a height a percentage can resolve against', () => {
    const home = Stylesheet.home().declarationsFor('.home')

    expect(home).toMatch(/height:\s*100dvh/)
    expect(home).toMatch(/overflow:\s*hidden/)
  })

  it('gives the Navigation shell a full height so its own content can resolve a percentage against it', () => {
    const navigation = Stylesheet.navigation().declarationsFor('.navigation')

    expect(navigation).toMatch(/height:\s*100%/)
  })

  it('scrolls the content column of Navigation independently from the chrome around it', () => {
    const content = Stylesheet.navigation().declarationsFor('.navigation__content')

    expect(content).toMatch(/flex:\s*1 1 auto/)
    expect(content).toMatch(/min-height:\s*0/)
  })

  it('splits the content into the work area and a fixed panel the width token controls', () => {
    const columns = Stylesheet.home().declarationsFor('.home__columns')

    expect(columns).toMatch(/display:\s*grid/)
    expect(columns).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*var\(--layout-panel-width\)/)
  })

  it('scrolls the work area and the right column on their own', () => {
    const content = Stylesheet.home().declarationsFor('.home__content')
    const side = Stylesheet.home().declarationsFor('.home__side')

    expect(content).toMatch(/overflow:\s*auto/)
    expect(side).toMatch(/overflow:\s*auto/)
  })
})

describe('the right column stacks under the content below 1180px without becoming a layer', () => {
  it('turns the grid into a single stacked column', () => {
    const columns = Stylesheet.home().narrowDeclarationsFor('.home__columns', '@media (width < 1180px)')

    expect(columns).toMatch(/flex-direction:\s*column/)
  })

  it('gives the right column the full width below the content instead of an overlay', () => {
    const narrow = Stylesheet.home().mediaQuery('@media (width < 1180px)')

    expect(narrow).not.toMatch(/position:\s*(fixed|absolute|sticky)/)
    expect(narrow).not.toMatch(/z-index/)
    expect(narrow).not.toMatch(/inset/)
  })
})
