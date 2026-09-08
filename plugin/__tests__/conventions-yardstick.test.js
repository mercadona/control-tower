import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginYardstick } from '../scripts/plugin-yardstick.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

class Documento {
  static texto(nombre) {
    return readFileSync(join(root, 'conventions', nombre), 'utf8')
  }

  static cabeceraDe(nombre) {
    return Documento.texto(nombre).split('\n').slice(0, 6).join('\n')
  }

  static clausulaDe(nombre, encabezado) {
    return new RegExp(`${encabezado}[\\s\\S]*?(?=\\n## )`)
      .exec(Documento.texto(nombre))[0]
      .replace(/\s+/g, ' ')
  }
}

const ALCANCES = {
  'defects.md': 'every diff',
  'style.md': 'every diff',
  'simplicity.md': 'every diff',
  'decisions.md': 'every diff',
  'testing.md': 'every diff',
  'architecture.md': 'every diff',
  'domain.md': 'every diff',
  'boundaries.md': 'every diff',
}

describe('the documents in conventions/', () => {
  it('ALCANCES names exactly what PluginYardstick.FILES declares, not one more and not one less', () => {
    expect(Object.keys(ALCANCES).sort()).toEqual([...PluginYardstick.FILES].sort())
  })

  for (const [nombre, alcance] of Object.entries(ALCANCES)) {
    it(`${nombre} declares its scope in the header`, () => {
      const cabecera = Documento.cabeceraDe(nombre)
      expect(cabecera).toContain('Applies to:')
      expect(cabecera).toContain(alcance)
    })

    it(`${nombre} carries rules, not just headings`, () => {
      const sustancia = Documento.texto(nombre)
        .split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('#'))
      expect(sustancia.length).toBeGreaterThan(20)
    })
  }

  it('architecture.md closes the hole in the old-module exemption', () => {
    expect(Documento.texto('architecture.md')).toContain('a new concept is a new module and is born conforming')
  })

  it('style.md closes the same hole for its style exemption', () => {
    expect(Documento.texto('style.md')).toContain('a new concept is a new module and is born conforming')
  })

  it('every document it cites by name is a document that exists, so a split never leaves a citation nobody can follow', () => {
    const citada = /`conventions\/([a-z-]+\.md)`/g
    for (const nombre of Object.keys(ALCANCES)) {
      const encontradas = [...Documento.texto(nombre).matchAll(citada)].map((found) => found[1])
      for (const cita of encontradas) {
        expect(Object.keys(ALCANCES), `${nombre} cita conventions/${cita}, que no existe`).toContain(cita)
      }
    }
  })

  it('none repeats a rule that a rubric item already owns', () => {
    const todo = Object.keys(ALCANCES).map(Documento.texto).join('\n')
    for (const [item, terminos] of Object.entries({
      'manipulacion-tests': [/skip/i, /xfail/i, /pre-existing test/i, /flaky/i],
      'test-desiderata': [/deterministic/i, /\bisolated\b/i, /call count/i, /real behaviou?r/i],
      alcance: [/no sentence of the task/i, /speculative/i, /scaffolding/i],
    })) {
      for (const t of terminos) {
        expect(todo, `${item} ya posee esta regla: ${t}`).not.toMatch(t)
      }
    }
  })
})

describe('the debt exemption lives in style.md and does NOT reach defects.md', () => {
  const clausulaDeEstilo = () => Documento.clausulaDe('style.md', 'A module that was already there')
  const cabeceraDeDefectos = () =>
    Documento.texto('defects.md').split('\n## ')[0].replace(/\s+/g, ' ')

  const AFIRMACIONES = {
    'style.md bounds the debt to its three rules, it does not declare it general':
      () => expect(clausulaDeEstilo()).toContain("the debt is exactly as wide as this document's three rules"),
    'style.md lists the three exempt rules: prose, the language of the identifiers, a function hanging off a type':
      () =>
        expect(clausulaDeEstilo()).toContain(
          'no prose, the language its identifiers are written in, and that every function hangs off a type'
        ),
    'style.md says its exemption ENDS at defects.md, naming it by its path':
      () => {
        expect(clausulaDeEstilo()).toContain('The exemption ends at this document')
        expect(clausulaDeEstilo()).toContain('`conventions/defects.md` bind on every diff')
      },
    'defects.md declares in its SCOPE LINE that there is no exemption, not only in the prose':
      () => expect(Documento.cabeceraDe('defects.md')).toContain('with no exemption'),
    'defects.md says the exemption of style.md stops at it':
      () => expect(cabeceraDeDefectos()).toContain('That exemption stops at this document'),
    'defects.md says its rules bind in an old module just as in a new one':
      () =>
        expect(cabeceraDeDefectos()).toContain(
          'in a module born today and in one that was already there'
        ),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(afirmacion, () => {
      comprobar()
    })
  }
})

describe('defects.md carries the four defect rules as its own subject, each under its own heading', () => {
  const ENCABEZADOS = [
    '## Closed vocabulary instead of loose strings and booleans',
    '## No raw map as the return value of logic',
    '## Two fields that have to agree',
    '## Errors are named for what happens, not for where',
  ]

  for (const encabezado of ENCABEZADOS) {
    it(`has its own section: ${encabezado}`, () => {
      expect(Documento.texto('defects.md')).toContain(encabezado)
    })
  }

  it('none of the four stayed in style.md when the document was split', () => {
    const estilo = Documento.texto('style.md')
    for (const encabezado of ENCABEZADOS) {
      expect(estilo, `${encabezado} is still in style.md`).not.toContain(encabezado)
    }
  })

  it('closes the gap the judge caught in slice #7: the consumer serializing at the end does NOT exempt the map', () => {
    const seccion = Documento.clausulaDe('defects.md', '## No raw map as the return value of logic')
    expect(seccion).toContain('The boundary is the last step before the wire, and it is one step')
    expect(seccion).toContain('does not make a raw map its legitimate input')
    expect(seccion).toContain('however close to the wire it sits')
  })

  it('names the sentinel value as the second field in disguise, with the empty-message case measured', () => {
    const seccion = Documento.clausulaDe('defects.md', '## Two fields that have to agree')
    expect(seccion).toContain("A sentinel value is that second field wearing the first field's clothes")
    expect(seccion).toContain('The empty string standing for "no message"')
  })
})

describe('testing.md separates "seen to fail for its reason" from the cycle\'s red phase, and declares the asymmetry of who can run it', () => {
  const clausula = () => Documento.clausulaDe(
    'testing.md',
    '## An assertion is not finished until it has been seen to fail for the reason its name gives'
  )

  const AFIRMACIONES = {
    'explicitly declares that it is not the red phase of the cycle':
      () => expect(clausula(), 'testing.md no dice "This is not the red phase of the cycle"').toContain('This is not the red phase of the cycle'),
    'separates the red phase (the behaviour is missing) from this (the concrete thing the name names is broken)':
      () =>
        expect(
          clausula(),
          'testing.md no distingue "the behaviour is missing" de "the concrete thing its name promises is broken"'
        ).toContain('This proves a test fails when the concrete thing its name promises is broken.'),
    'says what gets fixed when the name promises more than the assertion can fail on':
      () =>
        expect(
          clausula(),
          'testing.md no dice que casi siempre lo que está mal es la aserción, no el nombre'
        ).toContain('it is almost always the assertion that'),
    'declares that whoever writes the assertion runs it':
      () => expect(clausula(), 'testing.md no dice "Whoever writes the assertion runs it"').toContain('Whoever writes the assertion runs it'),
    'declares that whoever judges has nothing to run it with and applies it by reading':
      () =>
        expect(
          clausula(),
          'testing.md no dice que quien juzga el diff no tiene con qué correr nada y lo aplica leyendo'
        ).toContain('Whoever judges the diff has nothing to run it'),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(`testing.md ${afirmacion}`, () => {
      comprobar()
    })
  }
})

describe('testing.md pins how each layer is measured, and hunts what no test watches', () => {
  const tresReglas = () =>
    Documento.clausulaDe('testing.md', '## Three rules, and everything below follows from them')
  const tabla = () => Documento.clausulaDe('testing.md', '## How each layer is tested')

  const AFIRMACIONES = {
    'the use case is a black box and the domain has no tests of its own':
      () => expect(Documento.texto('testing.md')).toContain('A use case is a black box'),
    'the adapter is cut right before the external system':
      () => expect(Documento.texto('testing.md')).toContain('cutting right before the external system'),
    'the output of the adapter is declared in the test and comes from a real capture, without asking the service for it while the suite runs':
      () => {
        expect(
          tresReglas(),
          'testing.md no dice que la forma declarada se escribe en el test y jamas se pide mientras corre la suite'
        ).toContain('The shape is written in the test and never requested while the suite runs')
        expect(
          tresReglas(),
          'testing.md no exige que la forma declarada venga de una captura real y no de la imaginacion'
        ).toContain('the shape it declares comes from a real capture, never from imagination')
      },
    'the test says where its capture came from, so that whoever reads the diff judges that declaration':
      () => {
        expect(
          tresReglas(),
          'testing.md no obliga al test a decir de donde sale la captura de su forma declarada'
        ).toContain('the test names where its capture came from')
        expect(
          tresReglas(),
          'testing.md no dice que quien juzga lee esa declaracion, como en la barrida y en la asercion vista fallar'
        ).toContain('whoever judges reads that declaration, the same way the mutation sweep and the assertion seen to fail are read')
      },
    'the table measures the adapter against the same declared shape, with its capture and without asking the service for it while the suite runs':
      () =>
        expect(
          tabla(),
          'la tabla ya no mide el adaptador contra la forma declarada, su captura y el servicio al que no se le pide'
        ).toContain(
          '| Adapters | the external system, as a scripted conversation | the literal request sent, ' +
            'and the parse of a declared output shape — written in the test from a real capture it names, ' +
            'and never requested while the suite runs |'
        ),
    'declares the exception of the adapter that IS the call':
      () => expect(tresReglas()).toContain('an adapter that *is* the call'),
    'the integration from the edge covers the happy path only':
      () => expect(Documento.texto('testing.md')).toContain('covers the happy path, and only that'),
    'the controller is measured through a real server, not by calling the handler':
      () => expect(Documento.texto('testing.md')).toContain('never calling the handler as a function'),
    'a refusal never reaches a double':
      () => expect(Documento.texto('testing.md')).toContain('A refusal never reaches a double'),
    'the two failure causes of an adapter are told apart in its tests':
      () => expect(Documento.texto('testing.md')).toContain('proves one is not an instance of the other'),
    'demands the mutation sweep and says it hunts the line nobody watches':
      () => expect(Documento.texto('testing.md')).toContain('hunt **the mutations that leave it green**'),
    'carries the harness discipline: a substitution that does not fit fails loudly':
      () => expect(Documento.texto('testing.md')).toContain('a silent miss is a green that measured nothing'),
    'carries the harness discipline: the file is restored and verified':
      () => expect(Documento.texto('testing.md')).toContain('restored and verified identical afterwards'),
    'gives the two possible repairs for a mutation that survives':
      () => expect(Documento.texto('testing.md')).toContain('the test nobody wrote, or the line nobody needs'),
    'forces what is left unmeasured to be declared, with its reason':
      () => expect(Documento.texto('testing.md')).toContain('What stays unmeasured, on purpose'),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(`testing.md ${afirmacion}`, () => {
      comprobar()
    })
  }
})

describe('simplicity.md carries the burden of proof, and says where it ends', () => {
  const AFIRMACIONES = {
    'declares the single rule, and that it is discharged against the problem of today':
      () => expect(Documento.texto('simplicity.md')).toContain('the burden of proof is on what is added'),
    'names the question that decides a field, a branch or a public symbol':
      () => expect(Documento.texto('simplicity.md')).toContain('which call breaks without it'),
    'names the question that decides a line of observability':
      () => expect(Documento.texto('simplicity.md')).toContain('who reads this, and where'),
    'says that a request from a review or a judgement does not exempt':
      () => expect(Documento.texto('simplicity.md')).toContain('does not move when the addition is asked for by a reviewer'),
    'what cannot be discharged is declared in the report of the task and the decision is left to a person':
      () =>
        expect(
          Documento.clausulaDe('simplicity.md', '## A request from a review or a judgement is not exempt')
        ).toContain(
          "that is declared in the task's report, where whoever judges reads it, and the decision is left to a person."
        ),
    'carries the firebreak, so that it is not read as permission to skip a layer':
      () => expect(Documento.texto('simplicity.md')).toContain('Nothing here authorises dropping a layer'),
    'declares its boundary with the alcance item of the rubric, which asks something else':
      () => expect(Documento.texto('simplicity.md')).toContain('What the plan asked for is a different question from this one'),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(`simplicity.md ${afirmacion}`, () => {
      comprobar()
    })
  }
})

describe('domain.md keeps the tools out of the domain', () => {
  const AFIRMACIONES = {
    'declares that the port says what the domain needs, not what the adapter knows how to do':
      () => expect(Documento.texto('domain.md')).toContain('The port declares what the domain needs, not what the adapter knows how to do'),
    'gives the test that decides a name: changing the adapter turns the name into a lie':
      () => expect(Documento.texto('domain.md')).toContain('makes the name a lie'),
    'cuts the port by who is on the other side and not by step of the flow':
      () => expect(Documento.texto('domain.md')).toContain('never by step of the flow'),
    'identifies the collaborator by what is asked of it, not by what it answers':
      () => expect(Documento.texto('domain.md')).toContain('identified by what is asked of it'),
    'says that what is never duplicated is the intention, not the shape':
      () => expect(Documento.texto('domain.md')).toContain('Repeated shape is not the subject'),
    'says what the guard of the value object is, and that it stays even if nobody needs it today':
      () => expect(Documento.texto('domain.md')).toContain('what makes them this value and not any value'),
    'excludes the second opinion about what another type already guarantees':
      () => expect(Documento.texto('domain.md')).toContain('re-verifies what another type already guarantees'),
    'separates the two failure causes because they are repaired in different places':
      () => expect(Documento.texto('domain.md')).toContain('they are repaired in different places'),
    'refers to simplicity.md for what happens downstream of a gate':
      () => expect(Documento.texto('domain.md')).toContain('`conventions/simplicity.md`'),
    'and simplicity.md already refers here for the guard of the value object itself':
      () => expect(Documento.texto('simplicity.md')).toContain('`conventions/domain.md`'),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(`domain.md ${afirmacion}`, () => {
      comprobar()
    })
  }
})

describe('boundaries.md owns the outer edge, in both shapes a program has', () => {
  const AFIRMACIONES = {
    'the caller declares whether its call is safe to repeat':
      () => expect(Documento.texto('boundaries.md')).toContain('The caller declares whether its call is safe to repeat'),
    'the trunk knows the language of the network and the specialisation that of its system':
      () => expect(Documento.texto('boundaries.md')).toContain("the subclass knows the tool's"),
    'a system with no measured language inherits the bare trunk':
      () => expect(Documento.texto('boundaries.md')).toContain('inventing markers nobody measured is a preference dressed as a rule'),
    'a rate limit is not a blip':
      () => expect(Documento.texto('boundaries.md')).toContain('A rate limit is not a blip'),
    'the failure of the external system comes back as data':
      () => expect(Documento.texto('boundaries.md')).toContain('is data, not an exception'),
    'no external system is called with no cap, and the adapter does not choose it':
      () => expect(Documento.texto('boundaries.md')).toContain('the adapter does not choose the cap'),
    'the conversion to the domain lives in the model of the edge, with a gate':
      () => expect(Documento.texto('boundaries.md')).toContain('The conversion to the domain lives in the'),
    'text from another system comes in with its active syntax quieted':
      () => expect(Documento.texto('boundaries.md')).toContain('gets its active syntax quieted'),
    'the projection of the vocabulary outwards is exhaustive and returns a value object':
      () => expect(Documento.texto('boundaries.md')).toContain('is exhaustive and returns a value object'),
    'the code of a response is declared and not derived from a class name':
      () => expect(Documento.texto('boundaries.md')).toContain("never derived from an exception's class name"),
    'the outer edge is the only one that assembles the graph':
      () => expect(Documento.texto('boundaries.md')).toContain('the only place that assembles the dependency graph'),
    'names BOTH shapes of the edge, not only the program that ends':
      () => {
        const texto = Documento.texto('boundaries.md')
        expect(texto).toContain('a program that ends')
        expect(texto).toContain('a service that answers')
      },
    'keeps the rule that holds in both shapes':
      () => expect(Documento.texto('boundaries.md')).toContain('One code per decision of whoever receives'),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(`boundaries.md ${afirmacion}`, () => {
      comprobar()
    })
  }
})

describe('architecture.md kept nothing of the edge, so no rule is written twice', () => {
  const ENCABEZADOS_QUE_DESAPARECEN = ['## The boundary', '## The entrypoint']

  const REGLAS_QUE_SE_MUDAN = [
    'exit codes',
    'assembles the dependency graph',
    'An unknown key is a rejection',
    'validated by projection',
    'a cast checks nothing',
    'without a cap',
    'is data, not an exception',
    'An adapter is named after its implementation',
    'An adapter does not decide policy',
    "the contract's name",
    'mapping helper inside a use case',
  ]

  for (const encabezado of ENCABEZADOS_QUE_DESAPARECEN) {
    it(`architecture.md no longer has the section ${encabezado}`, () => {
      expect(Documento.texto('architecture.md')).not.toContain(encabezado)
    })
  }

  for (const regla of REGLAS_QUE_SE_MUDAN) {
    it(`does not remain in architecture.md: ${regla}`, () => {
      expect(Documento.texto('architecture.md')).not.toContain(regla)
    })

    it(`and is in boundaries.md: ${regla}`, () => {
      expect(Documento.texto('boundaries.md')).toContain(regla)
    })
  }
})

describe('architecture.md says where a new thing goes, and makes the layers visible', () => {
  const AFIRMACIONES = {
    'demands that the layers and their inhabitants be visible in the tree':
      () => expect(Documento.texto('architecture.md')).toContain('the folder is the discriminator, never a suffix on the name'),
    'puts the burden of proof on the new type, with the method as the default answer':
      () => expect(Documento.texto('architecture.md')).toContain('a method on a type that already exists'),
    'says that a test is not a consumer':
      () => expect(Documento.texto('architecture.md')).toContain('a test double is not a consumer'),
    'leaves the payload of a single owner in the file of that owner':
      () => expect(Documento.texto('architecture.md')).toContain("shares the owner's file"),
    'says that a class nobody instantiates is a namespace and that does not earn it a module':
      () => expect(Documento.texto('architecture.md')).toContain('A class nobody instantiates is a namespace'),
    'demands one client per external system, never one per call':
      () => expect(Documento.texto('architecture.md')).toContain('never a client per call'),
    'demands one controller per endpoint, with its model and its projections inside':
      () => expect(Documento.texto('architecture.md')).toContain('One controller per endpoint'),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(`architecture.md ${afirmacion}`, () => {
      comprobar()
    })
  }
})

describe('the yardstick names no language and no tool', () => {
  const PROHIBIDOS = [
    /vitest/i, /pytest/i, /jest/i, /execFile/, /\bnpx\b/, /\bnpm\b/, /\bnode\b/i,
    /Object\.freeze/, /\bfetch\b/, /\.m?jsx?\b/, /\.tsx?\b/, /\bnode_modules\b/,
    /\bpython\b/i, /\bjavascript\b/i, /\btypescript\b/i, /\bruby\b/i, /\brust\b/i,
    /\bjava\b/i, /\bkotlin\b/i, /\bswift\b/i, /\bgolang\b/i, /\bphp\b/i, /\bperl\b/i,
    /c\+\+/i, /\bc#/i,
  ]

  for (const nombre of Object.keys(ALCANCES)) {
    for (const prohibido of PROHIBIDOS) {
      it(`${nombre} does not name ${prohibido}`, () => {
        expect(Documento.texto(nombre)).not.toMatch(prohibido)
      })
    }
  }

  it('when an exit code is talked about, the other shape of the edge is named too', () => {
    for (const nombre of Object.keys(ALCANCES)) {
      const texto = Documento.texto(nombre)
      if (!/exit code/i.test(texto)) continue
      expect(texto, `${nombre} habla de exit code sin nombrar el servicio que atiende`)
        .toContain('a service that answers')
    }
  })

  it('nobody in the plugin still says there are five', () => {
    const fuentes = ['scripts/run-metrics.js', 'scripts/ct-next.mjs', 'scripts/kickoff.js', 'scripts/ct-step.mjs',
      'agents/ct-reconciler.md', 'skills/writing-plans-prescriptive/SKILL.md']
    for (const ruta of fuentes) {
      const texto = readFileSync(join(root, ruta), 'utf8')
      expect(texto, `${ruta} sigue diciendo cinco`).not.toMatch(/cinco documentos|five documents/i)
    }
  })
})
