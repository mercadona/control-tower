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

  static drawer() {
    return new Stylesheet(join('system-ui', 'drawer', 'Drawer.css'))
  }

  declarationsFor(selector: string) {
    return this.blocksFor(this.text, selector)
  }

  narrowDeclarationsFor(selector: string) {
    return this.blocksFor(this.narrowMediaQuery(), selector)
  }

  narrowMediaQuery() {
    const opened = this.text.indexOf('@media (width < 768px)')
    if (opened === -1) throw new Error('Home.css no longer declares the narrow media query')
    let depth = 0
    for (let cursor = this.text.indexOf('{', opened); cursor < this.text.length; cursor += 1) {
      if (this.text[cursor] === '{') depth += 1
      if (this.text[cursor] === '}') depth -= 1
      if (depth === 0) return this.text.slice(opened, cursor + 1)
    }
    throw new Error('the narrow media query of Home.css is not closed')
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

describe('the application shell gives the drawer a height to fill', () => {
  it('makes the shell exactly one viewport tall, because a min-height alone is not a height a percentage can resolve against', () => {
    const home = Stylesheet.home().declarationsFor('.home')

    expect(home).toMatch(/height:\s*100dvh/)
    expect(home).toMatch(/overflow:\s*hidden/)
  })

  it('lets the work area be shorter than its content so its scrollers do not push the shell taller', () => {
    const workArea = Stylesheet.home().declarationsFor('.home__work-area')

    expect(workArea).toMatch(/flex:\s*1 1 auto/)
    expect(workArea).toMatch(/min-height:\s*0/)
  })

  it('scrolls the main column on its own instead of scrolling the whole page', () => {
    const content = Stylesheet.home().declarationsFor('.home__content')

    expect(content).toMatch(/flex:\s*1 1 0/)
    expect(content).toMatch(/overflow:\s*auto/)
  })

  it('keeps the authoritative drawer column: a full-height 390px surface that folds to a 48px rail', () => {
    const drawer = Stylesheet.drawer()

    expect(drawer.declarationsFor('.drawer')).toMatch(/width:\s*390px/)
    expect(drawer.declarationsFor('.drawer')).toMatch(/height:\s*100%/)
    expect(drawer.declarationsFor('.drawer--collapsed')).toMatch(/width:\s*48px/)
    expect(drawer.declarationsFor('.drawer__header')).toMatch(/min-height:\s*72px/)
  })

  it('keeps the drawer body filling what the header leaves and scrolling on its own', () => {
    const body = Stylesheet.drawer().declarationsFor('.drawer__content')

    expect(body).toMatch(/flex:\s*1 1 0/)
    expect(body).toMatch(/overflow:\s*auto/)
  })
})

describe('the narrow work area stacks without clipping and without becoming a layer', () => {
  it('hands the scrolling back to the page when the shell stops being one viewport tall', () => {
    const home = Stylesheet.home().narrowDeclarationsFor('.home')

    expect(home).toMatch(/height:\s*auto/)
    expect(home).toMatch(/overflow:\s*visible/)
  })

  it('stacks the row and gives the drawer the full width below the content', () => {
    const sheet = Stylesheet.home()

    expect(sheet.narrowDeclarationsFor('.home__work-area')).toMatch(/flex-direction:\s*column/)
    expect(sheet.narrowDeclarationsFor('.home .drawer')).toMatch(/width:\s*100%/)
  })

  it('never leaves the drawer body at a zero flex basis while it is the one that has to size the column', () => {
    const body = Stylesheet.home().narrowDeclarationsFor('.home .drawer__content')

    expect(body).toMatch(/overflow:\s*visible/)
    expect(body).toMatch(/flex:\s*0 0 auto/)
    expect(body).not.toMatch(/flex:\s*1 1 0/)
  })

  it('stays a column of the layout and never turns into an overlay over the content', () => {
    const narrow = Stylesheet.home().narrowMediaQuery()

    expect(narrow).not.toMatch(/position:\s*(fixed|absolute|sticky)/)
    expect(narrow).not.toMatch(/z-index/)
    expect(narrow).not.toMatch(/inset/)
  })
})
