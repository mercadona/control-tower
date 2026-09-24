import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Yardstick } from './yardstick.ts'

class Subjects {
  static HERE = dirname(fileURLToPath(import.meta.url))
  static BACKEND = join(Subjects.HERE, '..')
  static REPOSITORY = join(Subjects.BACKEND, '..')
  static ROOT_GUARD = join('plugin', '__tests__', 'conforming-modules.test.js')

  static measured(): string[] {
    return Yardstick.measuredUnder(Subjects.BACKEND)
  }

  static rootGuardWords(): string[] {
    const source = readFileSync(join(Subjects.REPOSITORY, Subjects.ROOT_GUARD), 'utf8')
    const declared = source.match(/SPANISH_WORDS\s*=\s*\[([\s\S]*?)\]/)
    if (declared === null) throw new Error('the root guard no longer declares SPANISH_WORDS')
    return [...declared[1].matchAll(/'([^']+)'/g)].map((found) => found[1])
  }
}

describe('every file under backend keeps being born conforming', () => {
  const measured = Subjects.measured()

  it('the_guard_finds_its_subjects_by_walking_so_a_new_file_is_covered_without_anyone_listing_it', () => {
    expect(measured).toContain(join('src', 'domain', 'value-objects', 'user-story-key.ts'))
    expect(measured).toContain(join('src', 'application', 'actions', 'start-milestone-plan.ts'))
    expect(measured).toContain(join('src', 'infrastructure', 'api-server.ts'))
    expect(measured).toContain(join('__tests__', 'yardstick.test.ts'))
  })

  it('a_file_with_an_extension_nobody_classified_fails_instead_of_being_skipped_in_silence', () => {
    expect(Yardstick.unclassifiedUnder(Subjects.BACKEND)).toEqual([])
  })

  it.each(measured)('%s explains itself with names instead of prose', (file) => {
    expect(Yardstick.proseIn(Subjects.BACKEND, file)).toEqual([])
  })

  it.each(measured)('%s hangs every function off a type', (file) => {
    expect(Yardstick.looseFunctionsIn(Subjects.BACKEND, file)).toEqual([])
  })

  it.each(measured)('%s names things in english', (file) => {
    expect(Yardstick.spanishIdentifiersIn(Subjects.BACKEND, file)).toEqual([])
    expect(Yardstick.foreignTestNamesIn(Subjects.BACKEND, file)).toEqual([])
  })

  it('the_prose_detector_really_fires_so_the_guard_cannot_pass_by_detecting_nothing', () => {
    expect(Yardstick.proseInSource('const trap = 1 ' + '/' + '/ trailing')).toEqual([1])
    expect(Yardstick.proseInSource('const clean = String.raw`' + '/' + '/ inside a string`')).toEqual([])
  })

  it('the_loose_function_detector_really_fires_on_every_shape_a_function_can_hide_in', () => {
    expect(Yardstick.looseFunctionsInSource('export default function loose() {}')).toEqual([1])
    expect(Yardstick.looseFunctionsInSource('export const loose = x => x')).toEqual([1])
    expect(Yardstick.looseFunctionsInSource('const loose = async () => 1')).toEqual([1])
    expect(Yardstick.looseFunctionsInSource('class Kept { static go() { return 1 } }')).toEqual([])
  })

  it('the_english_detector_really_fires_on_a_spanish_name_wherever_it_sits', () => {
    expect(Yardstick.spanishIdentifiersInSource('class Trap { static go({ puerto }) { return puerto } }'))
      .toEqual(['puerto'])
    expect(Yardstick.spanishIdentifiersInSource('class Trap { static go({ port }) { return port } }'))
      .toEqual([])
  })

  it('the_test_name_detector_really_fires_on_spanish_and_on_an_inverted_mark', () => {
    expect(Yardstick.foreignTestNamesInSource("it('el servidor devuelve la respuesta', () => {})")).toEqual([1])
    expect(Yardstick.foreignTestNamesInSource("it('\u00bfwhat now?', () => {})")).toEqual([1])
    expect(Yardstick.foreignTestNamesInSource("it('a plain english name', () => {})")).toEqual([])
  })

  it('the_test_name_detector_reads_a_parameterised_test_whose_table_sits_between_the_call_and_its_name', () => {
    expect(Yardstick.foreignTestNamesInSource("describe.each([[1, 2]])('la fila %s', () => {})")).toEqual([1])
    expect(Yardstick.foreignTestNamesInSource("it.each(rows)('el servidor responde a %s', () => {})")).toEqual([1])
    expect(Yardstick.foreignTestNamesInSource("test.each([{ a: f(1) }])('la respuesta con %s', () => {})")).toEqual([1])
    expect(Yardstick.foreignTestNamesInSource("it.each([['a']])('an english name for %s', () => {})")).toEqual([])
  })

  it('the_test_name_detector_reads_the_name_that_closes_a_table_spread_over_several_lines', () => {
    const source = [
      'describe.each([',
      "  ['a', 1],",
      "  ['b', 2],",
      "])('la fila %s vale %d', () => {})",
    ].join('\n')

    expect(Yardstick.foreignTestNamesInSource(source)).toEqual([4])
  })

  it('the_test_name_detector_still_takes_the_first_argument_as_the_name_and_never_a_string_inside_the_body', () => {
    expect(Yardstick.foreignTestNamesInSource("it('a plain english name', () => expect(f('la respuesta')).toBe(1))")).toEqual([])
    expect(Yardstick.foreignTestNamesInSource("it.only('a plain english name', () => f('el servidor'))")).toEqual([])
  })

  it('the_word_list_covers_the_one_the_root_guard_declares_so_the_two_copies_cannot_drift_apart', () => {
    const missing = Subjects.rootGuardWords().filter((word) => !Yardstick.SPANISH_WORDS.includes(word))

    expect(missing).toEqual([])
  })
})
