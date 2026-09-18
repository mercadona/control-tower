import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

class HeadlessChildFixture {
  static readonly #ERRAND = /^Read the file at (.+) and do exactly what it says\.$/

  static run(argv: readonly string[]): void {
    switch (argv[0]) {
      case 'errand': {
        const capturePath = argv[1]
        const conversation = argv[2]
        const errand = argv[argv.length - 1]
        const match = HeadlessChildFixture.#ERRAND.exec(errand)
        if (match === null) throw new Error(`expected the CLI errand as the last argument, got ${JSON.stringify(errand)}`)
        const prompt = readFileSync(match[1], 'utf8')
        writeFileSync(capturePath, JSON.stringify({
          argv: [...argv],
          prompt,
          promptVariable: process.env.CT_CALL_PROMPT ?? null,
        }), 'utf8')
        process.stdout.write(`${JSON.stringify({
          type: 'result', subtype: 'success', session_id: conversation, is_error: false,
          total_cost_usd: 0.5, num_turns: 1, duration_ms: 10,
        })}\n`)
        return
      }
      case 'success':
        process.stdout.write(`${JSON.stringify({
          type: 'result', subtype: 'success', session_id: argv[1], is_error: false,
          total_cost_usd: 0.5, num_turns: 1, duration_ms: 10,
        })}\n`)
        process.stderr.write('fixture stderr\n')
        return
      case 'resist':
        process.on('SIGTERM', () => {})
        writeFileSync(argv[1], String(process.pid), 'utf8')
        setInterval(() => {}, 1_000)
        return
      case 'descendant': {
        writeFileSync(argv[1], String(process.pid), 'utf8')
        const descendant = spawn(process.execPath, [import.meta.filename, 'resist', argv[2]], {
          stdio: 'ignore',
        })
        writeFileSync(argv[3], String(descendant.pid), 'utf8')
        process.stdout.write(`${JSON.stringify({
          type: 'result', subtype: 'success', session_id: argv[4], is_error: false,
          total_cost_usd: 0.75, num_turns: 1, duration_ms: 10,
        })}\n`)
        return
      }
      default:
        process.stderr.write(`unknown fixture mode: ${JSON.stringify(argv[0])}\n`)
        process.exitCode = 2
    }
  }
}

HeadlessChildFixture.run(process.argv.slice(2))
