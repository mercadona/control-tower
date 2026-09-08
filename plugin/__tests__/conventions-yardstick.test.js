import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginYardstick } from '../scripts/plugin-yardstick.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

class Document {
  static text(name) {
    return readFileSync(join(root, 'conventions', name), 'utf8')
  }

  static headerOf(name) {
    return Document.text(name).split('\n').slice(0, 6).join('\n')
  }

  static clauseOf(name, heading) {
    return new RegExp(`${heading}[\\s\\S]*?(?=\\n## )`)
      .exec(Document.text(name))[0]
      .replace(/\s+/g, ' ')
  }
}

const SCOPES = {
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
  it('SCOPES names exactly what PluginYardstick.FILES declares, not one more and not one less', () => {
    expect(Object.keys(SCOPES).sort()).toEqual([...PluginYardstick.FILES].sort())
  })

  for (const [name, scope] of Object.entries(SCOPES)) {
    it(`${name} declares its scope in the header`, () => {
      const header = Document.headerOf(name)
      expect(header).toContain('Applies to:')
      expect(header).toContain(scope)
    })

    it(`${name} carries rules, not just headings`, () => {
      const substance = Document.text(name)
        .split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('#'))
      expect(substance.length).toBeGreaterThan(20)
    })
  }

  it('architecture.md closes the hole in the old-module exemption', () => {
    expect(Document.text('architecture.md')).toContain('a new concept is a new module and is born conforming')
  })

  it('style.md closes the same hole for its style exemption', () => {
    expect(Document.text('style.md')).toContain('a new concept is a new module and is born conforming')
  })

  it('every document it cites by name is a document that exists, so a split never leaves a citation nobody can follow', () => {
    const citationPattern = /`conventions\/([a-z-]+\.md)`/g
    for (const name of Object.keys(SCOPES)) {
      const matches = [...Document.text(name).matchAll(citationPattern)].map((found) => found[1])
      for (const citation of matches) {
        expect(Object.keys(SCOPES), `${name} cita conventions/${citation}, que no existe`).toContain(citation)
      }
    }
  })

  it('none repeats a rule that a rubric item already owns', () => {
    const allText = Object.keys(SCOPES).map(Document.text).join('\n')
    for (const [item, terms] of Object.entries({
      'manipulacion-tests': [/skip/i, /xfail/i, /pre-existing test/i, /flaky/i],
      'test-desiderata': [/deterministic/i, /\bisolated\b/i, /call count/i, /real behaviou?r/i],
      alcance: [/no sentence of the task/i, /speculative/i, /scaffolding/i],
    })) {
      for (const t of terms) {
        expect(allText, `${item} ya posee esta regla: ${t}`).not.toMatch(t)
      }
    }
  })
})

describe('the debt exemption lives in style.md and does NOT reach defects.md', () => {
  const styleClause = () => Document.clauseOf('style.md', 'A module that was already there')
  const defectsHeader = () =>
    Document.text('defects.md').split('\n## ')[0].replace(/\s+/g, ' ')

  const CLAIMS = {
    'style.md bounds the debt to its three rules, it does not declare it general':
      () => expect(styleClause()).toContain("the debt is exactly as wide as this document's three rules"),
    'style.md lists the three exempt rules: prose, the language of the identifiers, a function hanging off a type':
      () =>
        expect(styleClause()).toContain(
          'no prose, the language its identifiers are written in, and that every function hangs off a type'
        ),
    'style.md says its exemption ENDS at defects.md, naming it by its path':
      () => {
        expect(styleClause()).toContain('The exemption ends at this document')
        expect(styleClause()).toContain('`conventions/defects.md` bind on every diff')
      },
    'defects.md declares in its SCOPE LINE that there is no exemption, not only in the prose':
      () => expect(Document.headerOf('defects.md')).toContain('with no exemption'),
    'defects.md says the exemption of style.md stops at it':
      () => expect(defectsHeader()).toContain('That exemption stops at this document'),
    'defects.md says its rules bind in an old module just as in a new one':
      () =>
        expect(defectsHeader()).toContain(
          'in a module born today and in one that was already there'
        ),
  }

  for (const [claim, check] of Object.entries(CLAIMS)) {
    it(claim, () => {
      check()
    })
  }
})

describe('defects.md carries the four defect rules as its own subject, each under its own heading', () => {
  const HEADINGS = [
    '## Closed vocabulary instead of loose strings and booleans',
    '## No raw map as the return value of logic',
    '## Two fields that have to agree',
    '## Errors are named for what happens, not for where',
  ]

  for (const heading of HEADINGS) {
    it(`has its own section: ${heading}`, () => {
      expect(Document.text('defects.md')).toContain(heading)
    })
  }

  it('none of the four stayed in style.md when the document was split', () => {
    const style = Document.text('style.md')
    for (const heading of HEADINGS) {
      expect(style, `${heading} is still in style.md`).not.toContain(heading)
    }
  })

  it('closes the gap the judge caught in slice #7: the consumer serializing at the end does NOT exempt the map', () => {
    const section = Document.clauseOf('defects.md', '## No raw map as the return value of logic')
    expect(section).toContain('The boundary is the last step before the wire, and it is one step')
    expect(section).toContain('does not make a raw map its legitimate input')
    expect(section).toContain('however close to the wire it sits')
  })

  it('names the sentinel value as the second field in disguise, with the empty-message case measured', () => {
    const section = Document.clauseOf('defects.md', '## Two fields that have to agree')
    expect(section).toContain("A sentinel value is that second field wearing the first field's clothes")
    expect(section).toContain('The empty string standing for "no message"')
  })
})

describe('testing.md separates "seen to fail for its reason" from the cycle\'s red phase, and declares the asymmetry of who can run it', () => {
  const clause = () => Document.clauseOf(
    'testing.md',
    '## An assertion is not finished until it has been seen to fail for the reason its name gives'
  )

  const CLAIMS = {
    'explicitly declares that it is not the red phase of the cycle':
      () => expect(clause(), 'testing.md no dice "This is not the red phase of the cycle"').toContain('This is not the red phase of the cycle'),
    'separates the red phase (the behaviour is missing) from this (the concrete thing the name names is broken)':
      () =>
        expect(
          clause(),
          'testing.md no distingue "the behaviour is missing" de "the concrete thing its name promises is broken"'
        ).toContain('This proves a test fails when the concrete thing its name promises is broken.'),
    'says what gets fixed when the name promises more than the assertion can fail on':
      () =>
        expect(
          clause(),
          'testing.md no dice que casi siempre lo que está mal es la aserción, no el nombre'
        ).toContain('it is almost always the assertion that'),
    'declares that whoever writes the assertion runs it':
      () => expect(clause(), 'testing.md no dice "Whoever writes the assertion runs it"').toContain('Whoever writes the assertion runs it'),
    'declares that whoever judges has nothing to run it with and applies it by reading':
      () =>
        expect(
          clause(),
          'testing.md no dice que quien juzga el diff no tiene con qué correr nada y lo aplica leyendo'
        ).toContain('Whoever judges the diff has nothing to run it'),
  }

  for (const [claim, check] of Object.entries(CLAIMS)) {
    it(`testing.md ${claim}`, () => {
      check()
    })
  }
})

describe('testing.md pins how each layer is measured, and hunts what no test watches', () => {
  const threeRules = () =>
    Document.clauseOf('testing.md', '## Three rules, and everything below follows from them')
  const table = () => Document.clauseOf('testing.md', '## How each layer is tested')

  const CLAIMS = {
    'the use case is a black box and the domain has no tests of its own':
      () => expect(Document.text('testing.md')).toContain('A use case is a black box'),
    'the adapter is cut right before the external system':
      () => expect(Document.text('testing.md')).toContain('cutting right before the external system'),
    'the output of the adapter is declared in the test and comes from a real capture, without asking the service for it while the suite runs':
      () => {
        expect(
          threeRules(),
          'testing.md no dice que la forma declarada se escribe en el test y jamas se pide mientras corre la suite'
        ).toContain('The shape is written in the test and never requested while the suite runs')
        expect(
          threeRules(),
          'testing.md no exige que la forma declarada venga de una captura real y no de la imaginacion'
        ).toContain('the shape it declares comes from a real capture, never from imagination')
      },
    'the test says where its capture came from, so that whoever reads the diff judges that declaration':
      () => {
        expect(
          threeRules(),
          'testing.md no obliga al test a decir de donde sale la captura de su forma declarada'
        ).toContain('the test names where its capture came from')
        expect(
          threeRules(),
          'testing.md no dice que quien juzga lee esa declaracion, como en la barrida y en la asercion vista fallar'
        ).toContain('whoever judges reads that declaration, the same way the mutation sweep and the assertion seen to fail are read')
      },
    'the table measures the adapter against the same declared shape, with its capture and without asking the service for it while the suite runs':
      () =>
        expect(
          table(),
          'la tabla ya no mide el adaptador contra la forma declarada, su captura y el servicio al que no se le pide'
        ).toContain(
          '| Adapters | the external system, as a scripted conversation | the literal request sent, ' +
            'and the parse of a declared output shape — written in the test from a real capture it names, ' +
            'and never requested while the suite runs |'
        ),
    'declares the exception of the adapter that IS the call':
      () => expect(threeRules()).toContain('an adapter that *is* the call'),
    'the integration from the edge covers the happy path only':
      () => expect(Document.text('testing.md')).toContain('covers the happy path, and only that'),
    'the controller is measured through a real server, not by calling the handler':
      () => expect(Document.text('testing.md')).toContain('never calling the handler as a function'),
    'a refusal never reaches a double':
      () => expect(Document.text('testing.md')).toContain('A refusal never reaches a double'),
    'the two failure causes of an adapter are told apart in its tests':
      () => expect(Document.text('testing.md')).toContain('proves one is not an instance of the other'),
    'demands the mutation sweep and says it hunts the line nobody watches':
      () => expect(Document.text('testing.md')).toContain('hunt **the mutations that leave it green**'),
    'carries the harness discipline: a substitution that does not fit fails loudly':
      () => expect(Document.text('testing.md')).toContain('a silent miss is a green that measured nothing'),
    'carries the harness discipline: the file is restored and verified':
      () => expect(Document.text('testing.md')).toContain('restored and verified identical afterwards'),
    'gives the two possible repairs for a mutation that survives':
      () => expect(Document.text('testing.md')).toContain('the test nobody wrote, or the line nobody needs'),
    'forces what is left unmeasured to be declared, with its reason':
      () => expect(Document.text('testing.md')).toContain('What stays unmeasured, on purpose'),
  }

  for (const [claim, check] of Object.entries(CLAIMS)) {
    it(`testing.md ${claim}`, () => {
      check()
    })
  }
})

describe('simplicity.md carries the burden of proof, and says where it ends', () => {
  const CLAIMS = {
    'declares the single rule, and that it is discharged against the problem of today':
      () => expect(Document.text('simplicity.md')).toContain('the burden of proof is on what is added'),
    'names the question that decides a field, a branch or a public symbol':
      () => expect(Document.text('simplicity.md')).toContain('which call breaks without it'),
    'names the question that decides a line of observability':
      () => expect(Document.text('simplicity.md')).toContain('who reads this, and where'),
    'says that a request from a review or a judgement does not exempt':
      () => expect(Document.text('simplicity.md')).toContain('does not move when the addition is asked for by a reviewer'),
    'what cannot be discharged is declared in the report of the task and the decision is left to a person':
      () =>
        expect(
          Document.clauseOf('simplicity.md', '## A request from a review or a judgement is not exempt')
        ).toContain(
          "that is declared in the task's report, where whoever judges reads it, and the decision is left to a person."
        ),
    'carries the firebreak, so that it is not read as permission to skip a layer':
      () => expect(Document.text('simplicity.md')).toContain('Nothing here authorises dropping a layer'),
    'declares its boundary with the alcance item of the rubric, which asks something else':
      () => expect(Document.text('simplicity.md')).toContain('What the plan asked for is a different question from this one'),
  }

  for (const [claim, check] of Object.entries(CLAIMS)) {
    it(`simplicity.md ${claim}`, () => {
      check()
    })
  }
})

describe('domain.md keeps the tools out of the domain', () => {
  const CLAIMS = {
    'declares that the port says what the domain needs, not what the adapter knows how to do':
      () => expect(Document.text('domain.md')).toContain('The port declares what the domain needs, not what the adapter knows how to do'),
    'gives the test that decides a name: changing the adapter turns the name into a lie':
      () => expect(Document.text('domain.md')).toContain('makes the name a lie'),
    'cuts the port by who is on the other side and not by step of the flow':
      () => expect(Document.text('domain.md')).toContain('never by step of the flow'),
    'identifies the collaborator by what is asked of it, not by what it answers':
      () => expect(Document.text('domain.md')).toContain('identified by what is asked of it'),
    'says that what is never duplicated is the intention, not the shape':
      () => expect(Document.text('domain.md')).toContain('Repeated shape is not the subject'),
    'says what the guard of the value object is, and that it stays even if nobody needs it today':
      () => expect(Document.text('domain.md')).toContain('what makes them this value and not any value'),
    'excludes the second opinion about what another type already guarantees':
      () => expect(Document.text('domain.md')).toContain('re-verifies what another type already guarantees'),
    'separates the two failure causes because they are repaired in different places':
      () => expect(Document.text('domain.md')).toContain('they are repaired in different places'),
    'refers to simplicity.md for what happens downstream of a gate':
      () => expect(Document.text('domain.md')).toContain('`conventions/simplicity.md`'),
    'and simplicity.md already refers here for the guard of the value object itself':
      () => expect(Document.text('simplicity.md')).toContain('`conventions/domain.md`'),
  }

  for (const [claim, check] of Object.entries(CLAIMS)) {
    it(`domain.md ${claim}`, () => {
      check()
    })
  }
})

describe('boundaries.md owns the outer edge, in both shapes a program has', () => {
  const CLAIMS = {
    'the caller declares whether its call is safe to repeat':
      () => expect(Document.text('boundaries.md')).toContain('The caller declares whether its call is safe to repeat'),
    'the trunk knows the language of the network and the specialisation that of its system':
      () => expect(Document.text('boundaries.md')).toContain("the subclass knows the tool's"),
    'a system with no measured language inherits the bare trunk':
      () => expect(Document.text('boundaries.md')).toContain('inventing markers nobody measured is a preference dressed as a rule'),
    'a rate limit is not a blip':
      () => expect(Document.text('boundaries.md')).toContain('A rate limit is not a blip'),
    'the failure of the external system comes back as data':
      () => expect(Document.text('boundaries.md')).toContain('is data, not an exception'),
    'no external system is called with no cap, and the adapter does not choose it':
      () => expect(Document.text('boundaries.md')).toContain('the adapter does not choose the cap'),
    'the conversion to the domain lives in the model of the edge, with a gate':
      () => expect(Document.text('boundaries.md')).toContain('The conversion to the domain lives in the'),
    'text from another system comes in with its active syntax quieted':
      () => expect(Document.text('boundaries.md')).toContain('gets its active syntax quieted'),
    'the projection of the vocabulary outwards is exhaustive and returns a value object':
      () => expect(Document.text('boundaries.md')).toContain('is exhaustive and returns a value object'),
    'the code of a response is declared and not derived from a class name':
      () => expect(Document.text('boundaries.md')).toContain("never derived from an exception's class name"),
    'the outer edge is the only one that assembles the graph':
      () => expect(Document.text('boundaries.md')).toContain('the only place that assembles the dependency graph'),
    'names BOTH shapes of the edge, not only the program that ends':
      () => {
        const text = Document.text('boundaries.md')
        expect(text).toContain('a program that ends')
        expect(text).toContain('a service that answers')
      },
    'keeps the rule that holds in both shapes':
      () => expect(Document.text('boundaries.md')).toContain('One code per decision of whoever receives'),
  }

  for (const [claim, check] of Object.entries(CLAIMS)) {
    it(`boundaries.md ${claim}`, () => {
      check()
    })
  }
})

describe('architecture.md kept nothing of the edge, so no rule is written twice', () => {
  const HEADINGS_THAT_DISAPPEAR = ['## The boundary', '## The entrypoint']

  const RULES_THAT_MOVE = [
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

  for (const heading of HEADINGS_THAT_DISAPPEAR) {
    it(`architecture.md no longer has the section ${heading}`, () => {
      expect(Document.text('architecture.md')).not.toContain(heading)
    })
  }

  for (const rule of RULES_THAT_MOVE) {
    it(`does not remain in architecture.md: ${rule}`, () => {
      expect(Document.text('architecture.md')).not.toContain(rule)
    })

    it(`and is in boundaries.md: ${rule}`, () => {
      expect(Document.text('boundaries.md')).toContain(rule)
    })
  }
})

describe('architecture.md says where a new thing goes, and makes the layers visible', () => {
  const CLAIMS = {
    'demands that the layers and their inhabitants be visible in the tree':
      () => expect(Document.text('architecture.md')).toContain('the folder is the discriminator, never a suffix on the name'),
    'puts the burden of proof on the new type, with the method as the default answer':
      () => expect(Document.text('architecture.md')).toContain('a method on a type that already exists'),
    'says that a test is not a consumer':
      () => expect(Document.text('architecture.md')).toContain('a test double is not a consumer'),
    'leaves the payload of a single owner in the file of that owner':
      () => expect(Document.text('architecture.md')).toContain("shares the owner's file"),
    'says that a class nobody instantiates is a namespace and that does not earn it a module':
      () => expect(Document.text('architecture.md')).toContain('A class nobody instantiates is a namespace'),
    'demands one client per external system, never one per call':
      () => expect(Document.text('architecture.md')).toContain('never a client per call'),
    'demands one controller per endpoint, with its model and its projections inside':
      () => expect(Document.text('architecture.md')).toContain('One controller per endpoint'),
  }

  for (const [claim, check] of Object.entries(CLAIMS)) {
    it(`architecture.md ${claim}`, () => {
      check()
    })
  }
})

describe('the yardstick names no language and no tool', () => {
  const FORBIDDEN = [
    /vitest/i, /pytest/i, /jest/i, /execFile/, /\bnpx\b/, /\bnpm\b/, /\bnode\b/i,
    /Object\.freeze/, /\bfetch\b/, /\.m?jsx?\b/, /\.tsx?\b/, /\bnode_modules\b/,
    /\bpython\b/i, /\bjavascript\b/i, /\btypescript\b/i, /\bruby\b/i, /\brust\b/i,
    /\bjava\b/i, /\bkotlin\b/i, /\bswift\b/i, /\bgolang\b/i, /\bphp\b/i, /\bperl\b/i,
    /c\+\+/i, /\bc#/i,
  ]

  for (const name of Object.keys(SCOPES)) {
    for (const forbidden of FORBIDDEN) {
      it(`${name} does not name ${forbidden}`, () => {
        expect(Document.text(name)).not.toMatch(forbidden)
      })
    }
  }

  it('when an exit code is talked about, the other shape of the edge is named too', () => {
    for (const name of Object.keys(SCOPES)) {
      const text = Document.text(name)
      if (!/exit code/i.test(text)) continue
      expect(text, `${name} habla de exit code sin nombrar el servicio que atiende`)
        .toContain('a service that answers')
    }
  })

  it('nobody in the plugin still says there are five', () => {
    const sources = ['scripts/run-metrics.js', 'scripts/ct-next.mjs', 'scripts/kickoff.js', 'scripts/ct-step.mjs',
      'agents/ct-reconciler.md', 'skills/writing-plans-prescriptive/SKILL.md']
    for (const path of sources) {
      const text = readFileSync(join(root, path), 'utf8')
      expect(text, `${path} sigue diciendo cinco`).not.toMatch(/cinco documentos|five documents/i)
    }
  })
})
