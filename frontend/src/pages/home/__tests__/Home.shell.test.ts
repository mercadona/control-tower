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
})
