import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { StepCaptureFormat } from './step-capture-format.mjs'

class StepConversationRecorder {
  static git = spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout.trim()
  static revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()

  constructor(scenario) {
    this.scenario = scenario
    this.requests = {}
  }

  snapshot() {
    const files = new Map()
    for (const root of this.scenario.roots) {
      if (existsSync(root)) StepConversationRecorder.walk(root, files)
    }
    return files
  }

  static walk(directory, files) {
    for (const name of readdirSync(directory)) {
      if (['.git', 'node_modules', 'objects', 'refs', 'logs', 'hooks'].includes(name)) continue
      const path = join(directory, name)
      const info = lstatSync(path)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) StepConversationRecorder.walk(path, files)
      else if (info.isFile()) files.set(path, { bytes: readFileSync(path).toString('base64'), mode: info.mode & 0o777 })
    }
  }

  request(bin, argv, options, key) {
    const changesFiles = bin !== 'git' || ['clone', 'checkout', 'switch', 'merge', 'clean'].includes(argv[0]) || (argv[0] === 'reset' && argv.includes('--hard'))
    const before = changesFiles ? this.snapshot() : new Map()
    const result = spawnSync(bin, argv, {
      encoding: 'utf8', ...options,
      env: { ...process.env, ...options.env, GIT_AUTHOR_DATE: '2026-09-18T00:00:00Z', GIT_COMMITTER_DATE: '2026-09-18T00:00:00Z', LC_ALL: 'C' },
    })
    const output = {
      code: result.status ?? 1,
      stdout: this.scenario.normalise(String(result.stdout ?? '')),
      stderr: this.scenario.normalise(String(result.stderr ?? '')),
      ...(result.signal ? { signal: result.signal } : {}),
      ...(result.error ? { error: { code: result.error.code, message: this.scenario.normalise(result.error.message) } } : {}),
    }
    const effects = []
    if (changesFiles) {
      const after = this.snapshot()
      for (const [path, value] of after) {
        if (before.get(path)?.bytes === value.bytes && before.get(path)?.mode === value.mode) continue
        const bytes = Buffer.from(value.bytes, 'base64')
        const text = bytes.toString('utf8')
        const content = Buffer.from(text).equals(bytes) ? { text: this.scenario.normalise(text) } : { bytes: value.bytes }
        effects.push({ path: this.scenario.normalise(path), mode: value.mode, ...content })
      }
      for (const path of before.keys()) if (!after.has(path)) effects.push({ path: this.scenario.normalise(path), bytes: null })
    }
    ;(this.requests[key] ??= []).push({ output, ...(effects.length ? { effects } : {}) })
    return this.scenario.restored(bin, argv, output)
  }

  finish() {
    const { file, name } = this.scenario
    const corpus = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {
      provenance: { revision: StepConversationRecorder.revision, git: StepConversationRecorder.git, node: process.version, platform: process.platform, clock: '2026-09-18T00:00:00Z', command: 'vitest run --config ../docs/testing/record-step-conversations.config.mjs' },
      cases: {},
    }
    corpus.provenance.commandSourceSha256 = createHash('sha256').update(readFileSync(fileURLToPath(new URL('../../plugin/scripts/ct-step.js', import.meta.url)))).digest('hex')
    corpus.cases[name] = { cuts: this.scenario.constructor.cutPoints(this.scenario.timeline), requests: this.requests }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(StepCaptureFormat.compact(corpus), null, 2) + '\n')
  }
}

globalThis[Symbol.for('control-tower.step-conversation-recorder')] = StepConversationRecorder
