import { deepStrictEqual } from 'node:assert'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StepCaptureFormat } from './step-capture-format.mjs'

class CompactStepCaptures {
  static run() {
    const directory = fileURLToPath(new URL('../../plugin/__tests__/fixtures/step-captures/', import.meta.url))
    let before = 0
    let after = 0
    for (const name of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
      const path = join(directory, name)
      const original = readFileSync(path, 'utf8')
      const corpus = JSON.parse(original)
      const compact = StepCaptureFormat.compact(corpus)
      deepStrictEqual(StepCaptureFormat.expanded(compact), StepCaptureFormat.expanded(corpus))
      deepStrictEqual(compact.provenance, corpus.provenance)
      const text = JSON.stringify(compact, null, 2) + '\n'
      writeFileSync(path, text)
      before += Buffer.byteLength(original)
      after += Buffer.byteLength(text)
    }
    console.log(JSON.stringify({ beforeBytes: before, afterBytes: after, savedBytes: before - after }))
  }
}

CompactStepCaptures.run()
