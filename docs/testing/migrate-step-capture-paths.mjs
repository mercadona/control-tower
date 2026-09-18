import { deepStrictEqual } from 'node:assert'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

class CapturePathMigration {
  static request(key) {
    const request = JSON.parse(key)
    request[1] = request[1].replace('/skills/subagent-driven-development/', '/skills/ct-subagent-driven-development/')
    return JSON.stringify(request)
  }

  static run() {
    const directory = fileURLToPath(new URL('../../plugin/__tests__/fixtures/step-captures/', import.meta.url))
    for (const name of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
      const path = join(directory, name)
      const corpus = JSON.parse(readFileSync(path, 'utf8'))
      const responses = JSON.stringify(corpus.responses)
      for (const scenario of Object.values(corpus.cases)) {
        const entries = Object.entries(scenario.requests)
        scenario.requests = Object.fromEntries(entries.map(([key, replies]) => [CapturePathMigration.request(key), replies]))
        if (Object.keys(scenario.requests).length !== entries.length) throw new Error('Request-path migration collapsed distinct requests')
        for (const cut of scenario.cuts) {
          cut.reads = cut.reads.map(CapturePathMigration.request).sort()
          for (const boundary of cut.boundaries) {
            boundary.request = CapturePathMigration.request(boundary.request)
            boundary.reads = boundary.reads.map(CapturePathMigration.request).sort()
          }
        }
      }
      corpus.provenance.requestPathMigration = {
        revision: '8425c55c',
        from: 'skills/subagent-driven-development/scripts/task-brief',
        to: 'skills/ct-subagent-driven-development/scripts/task-brief',
        responses: 'Original captured responses and file effects retained verbatim.',
      }
      deepStrictEqual(JSON.stringify(corpus.responses), responses)
      writeFileSync(path, JSON.stringify(corpus, null, 2) + '\n')
    }
  }
}

CapturePathMigration.run()
