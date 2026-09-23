import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

class ArgumentThatAnswersToAnything {
  static readonly VALUE: unknown = new Proxy(function argument() {}, {
    get: (_target, key) => {
      if (key === Symbol.toPrimitive) return () => 'an argument'
      if (key === 'then') return undefined

      return ArgumentThatAnswersToAnything.VALUE
    },
    apply: () => ArgumentThatAnswersToAnything.VALUE,
  })
}

type PortMethod = { readonly port: string, readonly method: string, readonly call: () => unknown }

class Ports {
  static readonly DIRECTORY = join(
    dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'domain', 'ports',
  )

  static modules(): string[] {
    return readdirSync(Ports.DIRECTORY).filter((file) => file.endsWith('.ts')).sort()
  }

  static async methodsOf(file: string): Promise<PortMethod[]> {
    const module: Record<string, unknown> = await import(join(Ports.DIRECTORY, file))

    return Object.entries(module).flatMap(([exported, value]) =>
      Ports.#isPortClass(exported, value) ? Ports.#methodsDeclaredBy(exported, value) : []
    )
  }

  static #isPortClass(exported: string, value: unknown): value is new () => object {
    return typeof value === 'function'
      && /^[A-Z]/.test(exported)
      && !/^(?:.*(?:Error|NotRead|NotLive|Refused|Failure))$/.test(exported)
      && !Object.prototype.isPrototypeOf.call(Error, value)
  }

  static #methodsDeclaredBy(port: string, value: new () => object): PortMethod[] {
    const instance = Ports.#instantiate(value)
    if (instance === null) return []

    return Object.getOwnPropertyNames(value.prototype)
      .filter((method) => method !== 'constructor')
      .filter((method) => typeof Reflect.get(value.prototype, method) === 'function')
      .map((method) => ({
        port,
        method,
        call: () => Reflect.get(instance, method).call(
          instance,
          ArgumentThatAnswersToAnything.VALUE,
          ArgumentThatAnswersToAnything.VALUE,
        ),
      }))
  }

  static #instantiate(value: new () => object): object | null {
    try {
      return new value()
    } catch {
      return null
    }
  }

  static async refusalOf(asked: PortMethod): Promise<string> {
    try {
      const answered = await asked.call()

      return `answered ${String(answered)} instead of refusing`
    } catch (thrown) {
      return thrown instanceof Error ? thrown.message : `threw ${String(thrown)}`
    }
  }
}

const modules = Ports.modules()

describe('every port refuses the method nobody implemented', () => {
  it('the_sweep_finds_the_ports_by_walking_so_one_born_tomorrow_is_covered_without_anyone_listing_it', () => {
    expect(modules).toContain('live-sessions.ts')
    expect(modules).toContain('plan-issues.ts')
    expect(modules.length).toBeGreaterThan(30)
  })

  it.each(modules)('%s answers no method of its own with undefined', async (file) => {
    const asked = await Ports.methodsOf(file)
    const silent: string[] = []

    for (const method of asked) {
      const refusal = await Ports.refusalOf(method)
      if (!refusal.includes(`must implement ${method.method}(`)) {
        silent.push(`${method.port}.${method.method}() → ${refusal}`)
      }
    }

    expect(silent, `${file} lets a fake answer without implementing:\n${silent.join('\n')}`).toEqual([])
  })

  it('the_sweep_really_calls_the_methods_so_it_cannot_pass_by_finding_none', async () => {
    const asked = await Ports.methodsOf('live-sessions.ts')

    expect(asked.map((method) => method.method)).toContain('terminationEvidence')
    expect(await Ports.refusalOf(asked[0])).toContain('must implement')
  })
})
