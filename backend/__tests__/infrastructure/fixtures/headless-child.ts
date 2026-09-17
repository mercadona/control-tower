import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

class HeadlessChildFixture {
  static run(argv: readonly string[]): void {
    switch (argv[0]) {
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
