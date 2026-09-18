import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'

class SuiteMeasurement {
  static launches(path, seen = new Set()) {
    if (seen.has(path) || !existsSync(path)) return false
    seen.add(path)
    const source = readFileSync(path, 'utf8')
    if (/from\s+['"](?:node:)?child_process['"]/.test(source)) return true
    return [...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)]
      .map((match) => resolve(dirname(path), match[1]))
      .filter((dependency) => dependency.includes('/__tests__/'))
      .some((dependency) => SuiteMeasurement.launches(dependency, seen))
  }

  static family(name) {
    if (/(?:ct-step|e2e-ct-step)/.test(name)) return 'ct-step'
    for (const family of ['ct-next', 'ct-groom', 'dispatch-check', 'ct-init', 'ct-watch', 'ct-api', 'dist-matches-sources']) {
      if (name.includes(family)) return family
    }
    return 'others'
  }

  static run(argv) {
    const [reportPath, root = process.cwd(), mode = 'summary'] = argv
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    if (mode === 'failures') {
      for (const file of report.testResults) {
        if (file.status !== 'failed') continue
        console.log(file.name, file.message)
        for (const test of file.assertionResults.filter((test) => test.status === 'failed')) console.log(test.fullName, test.failureMessages)
      }
      return
    }
    const rows = report.testResults.map((file) => ({
      name: relative(root, file.name),
      tests: file.assertionResults.length,
      seconds: (file.endTime - file.startTime) / 1000,
      process: SuiteMeasurement.launches(file.name),
      marked: file.name.endsWith('-real-process.test.js') || file.name.endsWith('-real-process.test.ts'),
    }))
    if (mode === 'cases') {
      for (const file of report.testResults) {
        if (!/(?:ct-step|ct-api)/.test(file.name)) continue
        for (const test of file.assertionResults) console.log(`| ${relative(root, file.name)} | ${test.fullName.replaceAll('|', '\\|')} | ${test.status} |`)
      }
      return
    }
    console.log(JSON.stringify({ tests: report.numTotalTests, failed: report.numFailedTests, pending: report.numPendingTests, success: report.success, files: rows.length, summedSeconds: rows.reduce((sum, row) => sum + row.seconds, 0), observedSpanSeconds: (Math.max(...report.testResults.map((file) => file.endTime)) - report.startTime) / 1000 }))
    if (mode === 'inventory') {
      for (const row of rows.filter((row) => row.process || row.marked).sort((a, b) => a.name.localeCompare(b.name))) {
        console.log(`| ${row.name} | ${row.tests} | ${row.seconds.toFixed(3)} | ${row.marked ? 'marked' : 'unmarked'} | ${SuiteMeasurement.family(row.name)} |`)
      }
      return
    }
    const families = new Map()
    for (const row of rows) {
      const family = SuiteMeasurement.family(row.name)
      const total = families.get(family) ?? { files: 0, tests: 0, seconds: 0 }
      total.files += 1
      total.tests += row.tests
      total.seconds += row.seconds
      families.set(family, total)
    }
    console.log(JSON.stringify(Object.fromEntries(families), null, 2))
  }
}

SuiteMeasurement.run(process.argv.slice(2))
