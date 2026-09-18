import { afterEach, beforeEach, expect } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CtStep } from '../../scripts/ct-step.js'
import { CommandFailure } from '../../scripts/command-io.js'

export class StepScenario {
  static #current
  static #tracking = false
  static #corpora = new Map()
  static ROOT = fileURLToPath(new URL('../../', import.meta.url))
  static CAPTURES = fileURLToPath(new URL('./step-captures/', import.meta.url))
  static RECORDING = Symbol.for('control-tower.step-conversation-recorder')

  constructor(name, file, captured = null) {
    this.name = name
    this.file = file
    this.roots = []
    this.turn = 0
    this.phase = 'fixture'
    this.failures = []
    this.timeline = []
    this.responses = captured?.responses ?? {}
    const Recorder = globalThis[StepScenario.RECORDING]
    if (Recorder) {
      this.recorder = new Recorder(this)
      return
    }
    if (captured === null) {
      if (!StepScenario.#corpora.has(file)) StepScenario.#corpora.set(file, JSON.parse(readFileSync(file, 'utf8')))
      const corpus = StepScenario.#corpora.get(file)
      captured = corpus.cases[name]
      this.responses = corpus.responses ?? {}
    }
    if (!captured) throw new Error(`No captured tool conversation for ${name}`)
    if (!Array.isArray(captured.cuts)) throw new Error(`No ordering cut points captured for ${name}`)
    this.expectedCuts = captured.cuts
    this.answers = new Map(Object.entries(captured.requests).map(([key, replies]) => [key, [...replies]]))
  }

  static track() {
    if (StepScenario.#tracking) return
    StepScenario.#tracking = true
    beforeEach(() => StepScenario.begin())
    afterEach((context) => StepScenario.finish(context.task.result?.state))
  }

  static begin() {
    const { currentTestName, testPath } = expect.getState()
    StepScenario.#current = new StepScenario(currentTestName, join(StepScenario.CAPTURES, `${basename(testPath)}.json`))
  }

  static finish(state) {
    const scenario = StepScenario.#current
    if (!scenario) return
    try {
      if (scenario.recorder) {
        if (state === 'fail') throw new Error(`Refusing to publish a capture from a failing test: ${scenario.name}`)
        scenario.recorder.finish()
      }
      else {
        const unused = [...scenario.answers].filter(([, replies]) => replies.length > 0).map(([key, replies]) => `${replies.length} × ${key}`)
        expect(scenario.failures, 'undeclared external requests').toEqual([])
        expect(unused, 'external requests the scenario must make').toEqual([])
        expect(StepScenario.cutPoints(scenario.timeline), 'reads and mutations remain on the same side of each cut point').toEqual(scenario.expectedCuts)
      }
    } finally {
      for (const root of scenario.roots) rmSync(root, { recursive: true, force: true })
      StepScenario.#current = null
    }
  }

  static mkdtempSync = (prefix, options) => {
    const root = realpathSync(mkdtempSync(prefix, options))
    StepScenario.#current.roots.push(root)
    return root
  }

  normalise(text) {
    let named = text.replaceAll(StepScenario.ROOT.replace(/\/$/, ''), '$PLUGIN')
    for (const [index, root] of [...this.roots.entries()].sort((left, right) => right[1].length - left[1].length)) {
      named = named.replaceAll(root, `$TEMP${index}`)
    }
    return named.replaceAll(process.execPath, '$NODE')
  }

  expand(text) {
    return text.replaceAll('$PLUGIN', StepScenario.ROOT.replace(/\/$/, ''))
      .replaceAll('$NODE', process.execPath)
      .replace(/\$TEMP(\d+)/g, (_, index) => {
        if (!this.roots[Number(index)]) throw new Error(`Temporary root ${index} was not arranged`)
        return this.roots[Number(index)]
      })
  }

  key(bin, argv, options) {
    const selected = Object.fromEntries(['cwd', 'input', 'stdio', 'timeout', 'killSignal', 'maxBuffer'].filter((key) => options[key] !== undefined).map((key) => [key, options[key]]))
    return this.normalise(JSON.stringify([this.phase, bin, argv, selected]))
  }

  static cutPoints(timeline) {
    const turns = new Map()
    for (const request of timeline) {
      const [phase, bin, argv] = JSON.parse(request)
      if (!phase.startsWith('command ')) continue
      const turn = turns.get(phase) ?? { boundaries: [], reads: [] }
      turns.set(phase, turn)
      const mutation = bin !== 'git' || ['reset', 'add', 'commit', 'read-tree', 'checkout', 'restore', 'clean', 'merge', 'fetch'].includes(argv[0])
      if (mutation) {
        turn.boundaries.push({ reads: turn.reads.sort(), request })
        turn.reads = []
      } else turn.reads.push(request)
    }
    return [...turns].map(([phase, turn]) => ({ phase, boundaries: turn.boundaries, reads: turn.reads.sort() }))
  }

  request(bin, argv, options = {}) {
    const key = this.key(bin, argv, options)
    this.timeline.push(key)
    if (this.recorder) return this.recorder.request(bin, argv, options, key)
    const replies = this.answers.get(key)
    if (!replies?.length) {
      this.failures.push(key)
      throw new Error(`No external answer declared for ${key}`)
    }
    const reply = replies.shift()
    const answer = typeof reply === 'string' ? this.responses[reply] : reply
    if (!answer) throw new Error(`No captured response ${reply} for ${key}`)
    const { output, effects = [] } = answer
    for (const effect of effects) {
      const path = resolve(this.expand(effect.path))
      if (!this.roots.some((root) => path.startsWith(root + '/'))) throw new Error(`Captured write escapes its temporary roots: ${path}`)
      if (effect.bytes === null) rmSync(path, { force: true })
      else {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, effect.text === undefined ? Buffer.from(effect.bytes, 'base64') : this.expand(effect.text), { mode: effect.mode })
        if (effect.mode !== undefined) chmodSync(path, effect.mode)
      }
    }
    return this.restored(bin, argv, output)
  }

  restored(bin, argv, output) {
    const paths = bin === 'git' && argv[0] === 'rev-parse' && argv.some((arg) => ['--show-toplevel', '--git-common-dir', '--git-dir'].includes(arg))
    return { ...output, stdout: paths ? this.expand(output.stdout) : output.stdout }
  }

  static execFileSync = (bin, argv, options = {}) => {
    const result = StepScenario.#current.request(bin, argv, options)
    if (result.code !== 0 || result.error || result.signal) throw new CommandFailure(bin, argv, result)
    if (options.stdio === 'ignore') return null
    return options.encoding ? result.stdout : Buffer.from(result.stdout)
  }

  static spawnSync = (bin, argv, options = {}) => {
    if (basename(argv[0] ?? '') === 'ct-step.mjs') return StepScenario.invoke(argv[0], argv.slice(1), options)
    const output = StepScenario.#current.request(bin, argv, options)
    return { ...output, status: output.error || output.signal ? null : output.code }
  }

  static invoke(script, argv, options) {
    const scenario = StepScenario.#current
    scenario.phase = `command ${++scenario.turn}`
    let stdout = ''
    let stderr = ''
    const cwd = options.cwd ?? process.cwd()
    const env = { ...(options.env ?? process.env), CLAUDE_CONFIG_DIR: options.env?.CLAUDE_CONFIG_DIR ?? join(cwd, '.telemetry') }
    const port = (bin) => ({ run: (args, settings = {}) => scenario.request(bin, args, { ...settings, cwd: settings.cwd ?? cwd, env }) })
    const io = {
      cwd, env, home: join(cwd, '.home'), pluginRoot: dirname(dirname(script)),
      now: () => Date.parse('2026-09-18T00:00:00Z'),
      out: (text) => { stdout += text }, err: (text) => { stderr += text },
      git: port('git'), shell: port('sh'),
      scripts: { run: ([bin, ...args], settings) => port(bin).run(args, settings) },
    }
    try {
      return { status: CtStep.run(argv, io), stdout, stderr }
    } finally {
      scenario.phase = 'fixture'
    }
  }
}
