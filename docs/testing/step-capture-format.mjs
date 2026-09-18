import { createHash } from 'node:crypto'

export class StepCaptureFormat {
  static expanded(corpus) {
    return Object.fromEntries(Object.entries(corpus.cases).map(([name, scenario]) => [name, {
      ...scenario,
      requests: Object.fromEntries(Object.entries(scenario.requests).map(([key, replies]) => [key,
        replies.map((reply) => {
          if (typeof reply !== 'string') return reply
          const found = corpus.responses?.[reply]
          if (!found) throw new Error(`Capture ${name} refers to absent response ${reply}`)
          return found
        }),
      ])),
    }]))
  }

  static compact(corpus) {
    const responses = {}
    const cases = StepCaptureFormat.expanded(corpus)
    for (const scenario of Object.values(cases)) {
      for (const [key, replies] of Object.entries(scenario.requests)) {
        scenario.requests[key] = replies.map((reply) => {
          const id = createHash('sha256').update(JSON.stringify(reply)).digest('hex').slice(0, 24)
          if (responses[id] && JSON.stringify(responses[id]) !== JSON.stringify(reply)) throw new Error(`Capture response hash collision: ${id}`)
          responses[id] = reply
          return id
        })
      }
    }
    return { provenance: corpus.provenance, responses, cases }
  }
}
