import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

export class Yardstick {
  static SPANISH_WORDS = [
    'cita', 'citas', 'nombre', 'nombres', 'texto', 'fila', 'filas', 'vara', 'documento', 'documentos',
    'encontrados', 'medir', 'medida', 'paso', 'pasos', 'regla', 'reglas', 'hallazgo', 'hallazgos',
    'intento', 'cuerpo', 'previos', 'comentario', 'comentarios', 'recorrido', 'alcance', 'sujeto',
    'servidor', 'puerto', 'puertos', 'peticion', 'peticiones', 'respuesta', 'respuestas', 'arranque',
    'identificador', 'ruta', 'rutas', 'fichero', 'ficheros', 'longitud', 'tamano', 'devuelve',
    'lanzar', 'lanzado', 'guardian', 'prueba', 'pruebas', 'campo', 'campos', 'clave', 'claves',
  ]

  static MEASURED_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']
  static UNMEASURED_EXTENSIONS = ['.md', '.json', '.txt', '.snap']
  static SKIPPED_DIRECTORIES = ['node_modules', 'dist', 'build', 'coverage', '.git']

  static #STRINGS = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g
  static #REGEXES = /\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^\\/\n])+\/[dgimsuvy]*/g
  static #PROSE = /\/\/|\/\*|^\s*\*(?!\/)/
  static #LOOSE = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b/
  static #DISGUISED =
    /^(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?(?:\(|[\w$]+\s*=>|function\b)/
  static #IDENTIFIER = /[A-Za-z_$][\w$]*/g
  static #TEST_NAME = /^\s*(?:describe|it|test)(?:\.\w+)?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/
  static #INVERTED_MARKS = ['¿', '¡']

  static filesUnder(root: string, directory: string = root): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        return Yardstick.SKIPPED_DIRECTORIES.includes(entry.name) ? [] : Yardstick.filesUnder(root, full)
      }
      return [relative(root, full)]
    })
  }

  static measuredUnder(root: string): string[] {
    return Yardstick.filesUnder(root).filter((file) =>
      Yardstick.MEASURED_EXTENSIONS.includes(extname(file))
    )
  }

  static unclassifiedUnder(root: string): string[] {
    return Yardstick.filesUnder(root).filter((file) =>
      !Yardstick.MEASURED_EXTENSIONS.includes(extname(file)) &&
      !Yardstick.UNMEASURED_EXTENSIONS.includes(extname(file))
    )
  }

  static #read(root: string, file: string): string {
    return readFileSync(join(root, file), 'utf8')
  }

  static #numbered(source: string): [number, string][] {
    return source.split('\n').map((line, index) => [index + 1, line])
  }

  static #bare(line: string): string {
    return line.replace(Yardstick.#STRINGS, '""').replace(Yardstick.#REGEXES, 'RE')
  }

  static proseIn(root: string, file: string): number[] {
    return Yardstick.proseInSource(Yardstick.#read(root, file))
  }

  static proseInSource(source: string): number[] {
    return Yardstick.#numbered(source)
      .filter(([, line]) => Yardstick.#PROSE.test(Yardstick.#bare(line)))
      .map(([number]) => number)
  }

  static looseFunctionsIn(root: string, file: string): number[] {
    return Yardstick.looseFunctionsInSource(Yardstick.#read(root, file))
  }

  static looseFunctionsInSource(source: string): number[] {
    return Yardstick.#numbered(source)
      .filter(([, line]) => Yardstick.#LOOSE.test(line) || Yardstick.#DISGUISED.test(line))
      .map(([number]) => number)
  }

  static spanishIdentifiersIn(root: string, file: string): string[] {
    return Yardstick.spanishIdentifiersInSource(Yardstick.#read(root, file))
  }

  static spanishIdentifiersInSource(source: string): string[] {
    const bare = Yardstick.#numbered(source)
      .map(([, line]) => Yardstick.#bare(line))
      .join('\n')
    const used = bare.match(Yardstick.#IDENTIFIER) ?? []
    return [...new Set(used.filter((name) => Yardstick.SPANISH_WORDS.includes(name.toLowerCase())))]
  }

  static #testNames(source: string): [number, string][] {
    return Yardstick.#numbered(source)
      .map(([number, line]): [number, RegExpMatchArray | null] => [number, line.match(Yardstick.#TEST_NAME)])
      .filter(([, found]) => found !== null)
      .map(([number, found]) => [number, found![2].replace(/\$\{[^}]*\}/g, ' ')])
  }

  static foreignTestNamesIn(root: string, file: string): number[] {
    return Yardstick.foreignTestNamesInSource(Yardstick.#read(root, file))
  }

  static foreignTestNamesInSource(source: string): number[] {
    return Yardstick.#testNames(source)
      .filter(([, name]) =>
        [...name].some((character) =>
          Yardstick.#INVERTED_MARKS.includes(character) ||
          (character.codePointAt(0)! > 127 && /\p{L}/u.test(character))
        ) ||
        name.split(/[^A-Za-z]+/).some((word) => Yardstick.SPANISH_WORDS.includes(word.toLowerCase()))
      )
      .map(([number]) => number)
  }
}
