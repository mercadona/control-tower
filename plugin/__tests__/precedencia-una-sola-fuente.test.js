// THE PRECEDENCE RULE, ONCE ONLY IN THE WHOLE REPOSITORY.
//
// It was written in five files —`plugin-yardstick.js`, `kickoff.js`,
// `prompts/task-implementer.md`, `agents/ct-judge.md` and, in the backend,
// `plan-agent-brief.js`— and the judge read it three times in a single call.
// What two copies buy is that they diverge, and that is not a hypothesis: the
// one in the backend ended up saying that `architecture.md` applies ALWAYS,
// exactly the opposite of what the header of the plugin says and of what the
// `Applies to:` header of the document itself declares.
//
// This test is the only thing that keeps it from happening again:
// `conventions/decisions.md` says that a rule is written once, and a rule
// written in prose is caught by no duplicate detector that works by
// resemblance — it is caught only by whoever looks for its sentence.
//
// THE SENTENCE IS NOT TYPED HERE: it is extracted from the header itself,
// which is the source. Writing it by hand would be the second copy, and on top
// of that the one that decides whether there is a second copy.
//
// `plugin/` AND `backend/src/` ARE WALKED, which is where the text the agents
// read lives. The `__tests__` are left out on purpose: a test that pins the
// sentence —the one of the header, or the one of the kickoff that checks it
// does NOT state it any more— contains it of necessity, and counting them
// would make this test impossible to pass.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginYardstick } from '../scripts/plugin-yardstick.js'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(pluginRoot, '..')

// THE WORDS ONLY. Everything that is not a letter or a space is thrown away
// and the rest is collapsed: the quote marks of the markdown, the asterisks of
// the emphasis and —this is what forces going this far— the quotes and the
// commas with which the module itself breaks the sentence into the lines of an
// array. Searching for the raw text would not find the rule even in the file
// that writes it, and neither would a copy somewhere else with different
// punctuation.
const soloPalabras = (texto) => String(texto)
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()

class ReglaDePrecedencia {
  static frase() {
    const cabecera = String(PluginYardstick.precedenceHeader()).replace(/^>\s?/gm, '').replace(/\s+/g, ' ')
    const enunciado = /\*\*Tiene preferencia sobre[^*]+\*\*/.exec(cabecera)
    return enunciado ? soloPalabras(enunciado[0]) : null
  }
}

class TextoDelRepo {
  static DIRECTORIOS_FUERA = ['node_modules', '.git', '__tests__', 'dist', 'coverage']

  static EXTENSIONES = ['.js', '.mjs', '.md', '.sh', '.json']

  static #ficherosDe(raiz) {
    if (!existsSync(raiz)) return []
    const encontrados = []
    for (const entrada of readdirSync(raiz)) {
      const ruta = join(raiz, entrada)
      if (statSync(ruta).isDirectory()) {
        if (TextoDelRepo.DIRECTORIOS_FUERA.includes(entrada)) continue
        encontrados.push(...TextoDelRepo.#ficherosDe(ruta))
        continue
      }
      if (TextoDelRepo.EXTENSIONES.some((ext) => entrada.endsWith(ext))) encontrados.push(ruta)
    }
    return encontrados
  }

  static todos() {
    return [
      ...TextoDelRepo.#ficherosDe(pluginRoot),
      ...TextoDelRepo.#ficherosDe(join(repoRoot, 'backend', 'src')),
    ].map((ruta) => relative(repoRoot, ruta))
  }

  static losQueContienen(frase) {
    return TextoDelRepo.todos()
      .filter((ruta) => soloPalabras(readFileSync(join(repoRoot, ruta), 'utf8')).includes(frase))
  }
}

describe('the precedence rule is written in a single place in the whole repository', () => {
  it('the sentence that states it is extracted from the header, it is not typed in this test', () => {
    expect(ReglaDePrecedencia.frase()).not.toBeNull()
    expect(ReglaDePrecedencia.frase().length).toBeGreaterThan(60)
  })

  it('only the module that composes the header writes it: neither plugin/ nor backend/src/ repeat it', () => {
    expect(TextoDelRepo.losQueContienen(ReglaDePrecedencia.frase()))
      .toEqual(['plugin/scripts/plugin-yardstick.js'])
  })

  it('the walk really looks at both trees, or the one above would be passing on emptiness', () => {
    const todos = TextoDelRepo.todos()
    expect(todos).toContain('plugin/agents/ct-judge.md')
    expect(todos).toContain('plugin/prompts/task-implementer.md')
    expect(todos).toContain('plugin/scripts/kickoff.js')
    expect(todos).toContain('backend/src/infrastructure/plan-agent-brief.js')
  })
})
