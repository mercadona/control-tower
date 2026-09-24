import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import {
  mkdir, mkdtemp, readFile, readdir, rm, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { RoleBytes } from '../../../plugin/scripts/role-bytes.js'
import { STEPS } from '../../../plugin/scripts/run-machine.js'
import { INPUT_ROLES } from '../../../plugin/scripts/step-announcement.js'
import {
  ADVISOR_TOOLS, JUDGE_TOOLS, RECONCILER_TOOLS, SLICE_JUDGE_TOOLS,
} from '../../../plugin/scripts/step-contracts.js'
import { RunNotUnderstood } from '../../src/domain/exceptions.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { CtRunMachine } from '../../src/infrastructure/ct-run-machine.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import type { RunDispatch } from '../../src/infrastructure/run-dispatch.ts'
import { RunJournal } from '../../src/infrastructure/run-journal.ts'
import { ScriptedOracle, type ScriptedStep } from './fixtures/scripted-oracle.ts'

type DispatchRole = RunDispatch['role']

type ResponseExpectation = Readonly<{ kind: 'file' | 'structured' | 'edits', schema: boolean, agent: string | null }>

type AnnouncedDispatch = Readonly<{
  inputs?: readonly Readonly<{ role: string, kind: string, path: string }>[],
  response?: Readonly<{ kind: string, path: string | null }>,
}>

const RESPONSE_EXPECTATION_OF_ROLE: Readonly<Record<DispatchRole, ResponseExpectation>> = Object.freeze({
  implement: Object.freeze({ kind: 'structured', schema: true, agent: null }),
  judge: Object.freeze({ kind: 'file', schema: false, agent: 'ct-judge' }),
  advise: Object.freeze({ kind: 'structured', schema: true, agent: 'ct-advisor' }),
  'slice-judge': Object.freeze({ kind: 'file', schema: false, agent: 'ct-slice-judge' }),
  reconcile: Object.freeze({ kind: 'edits', schema: false, agent: 'ct-reconciler' }),
})

const HERE = dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = join(HERE, '..', '..', '..')
const PLUGIN_ROOT = join(REPOSITORY_ROOT, 'plugin')
const CT_STEP = join(PLUGIN_ROOT, 'scripts', 'ct-step.mjs')
const DISPATCH_CHECK = join(PLUGIN_ROOT, 'scripts', 'dispatch-check.mjs')
const CONVERSATION = '11111111-1111-4111-8111-111111111111'
const TICKET = '22222222-2222-4222-8222-222222222222'
const ISSUE = 7
const PLAN = 'docs/superpowers/plans/2026-09-17-issue-7-dispatch.md'

class EnvironmentSnapshot {
  readonly values: ReadonlyMap<string, string | undefined>

  constructor(names: readonly string[]) {
    this.values = new Map(names.map((name) => [name, process.env[name]]))
  }

  restore(): void {
    for (const [name, value] of this.values) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

class ProducerOutput {
  static of(stdout: string): AnnouncedDispatch {
    const announced = JSON.parse(stdout) as Readonly<{ dispatch?: AnnouncedDispatch }>
    if (announced.dispatch === undefined) {
      throw new Error(`the announcement carries no dispatch: ${JSON.stringify(stdout)}`)
    }
    return announced.dispatch
  }

  static responsePath(stdout: string): string {
    const path = ProducerOutput.of(stdout).response?.path
    if (typeof path !== 'string') {
      throw new Error(`the announcement declares no response path: ${JSON.stringify(stdout)}`)
    }
    return path
  }

  static pathOf(stdout: string, role: string): string {
    const input = (ProducerOutput.of(stdout).inputs ?? []).find((candidate) => candidate.role === role)
    if (input === undefined) throw new Error(`the announcement declares no ${role} input`)
    return input.path
  }

  static withConsuming(stdout: string, argv: readonly string[]): string {
    const announced = JSON.parse(stdout) as Record<string, unknown>
    return JSON.stringify({ ...announced, consuming: { argv: [...argv] } })
  }

  static implementPaths(stdout: string): readonly string[] {
    return Object.freeze(ProducerOutput.withRoleFiles(STEPS.IMPLEMENT, [
      ProducerOutput.pathOf(stdout, INPUT_ROLES.RUBRIC),
      ProducerOutput.pathOf(stdout, INPUT_ROLES.BRIEF),
    ]))
  }

  static paths(role: DispatchRole, stdout: string): readonly string[] {
    switch (role) {
      case 'implement':
        return ProducerOutput.implementPaths(stdout)
      case 'judge':
        return Object.freeze(ProducerOutput.withRoleFiles(STEPS.JUDGE, [
          ProducerOutput.pathOf(stdout, INPUT_ROLES.PACKAGE),
          ProducerOutput.pathOf(stdout, INPUT_ROLES.BRIEF),
        ]))
      case 'advise':
        return Object.freeze(ProducerOutput.withRoleFiles(STEPS.ADVISE, [
          ProducerOutput.pathOf(stdout, INPUT_ROLES.PACKAGE),
        ]))
      case 'slice-judge':
        return Object.freeze(ProducerOutput.withRoleFiles(STEPS.SLICE_JUDGE, [
          ProducerOutput.pathOf(stdout, INPUT_ROLES.PACKAGE),
          ProducerOutput.pathOf(stdout, INPUT_ROLES.PLAN),
          ProducerOutput.pathOf(stdout, INPUT_ROLES.GLOBAL_LOG),
          ProducerOutput.pathOf(stdout, INPUT_ROLES.VERDICTS),
        ]))
      case 'reconcile':
        return Object.freeze(ProducerOutput.withRoleFiles(STEPS.RECONCILE, [
          ProducerOutput.pathOf(stdout, INPUT_ROLES.RECONCILIATION_PACKAGE),
        ]))
    }
    return role satisfies never
  }

  static withRoleFiles(step: string, printed: readonly string[]): string[] {
    const paths = [...printed]
    for (const rolePath of RoleBytes.filesOf(step).map((path: string) => join(PLUGIN_ROOT, path))) {
      if (!paths.includes(rolePath)) paths.push(rolePath)
    }
    return paths
  }
}

class Fixture {
  readonly checkout: string
  readonly state: string
  readonly journal: RunJournal

  private constructor(checkout: string, state: string) {
    this.checkout = checkout
    this.state = state
    this.journal = new RunJournal({
      files: new HeadlessFiles({ root: state, fs, newId: () => 'temporary-record' }),
      newId: () => TICKET,
      now: () => { throw new Error('the journal clock is not asked') },
    })
  }

  static async create(): Promise<Fixture> {
    const checkout = await mkdtemp(join(tmpdir(), 'ct-run-dispatch-'))
    const state = await mkdtemp(join(tmpdir(), 'ct-run-dispatch-state-'))
    return new Fixture(checkout, state)
  }

  async remove(): Promise<void> {
    await Promise.all([
      rm(this.checkout, { recursive: true, force: true }),
      rm(this.state, { recursive: true, force: true }),
    ])
  }

  watch(): PlanWatch {
    return new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: ISSUE, url: 'https://github.com/mercadona/control-tower-plugin/issues/7' }),
      located: new WorkspaceLocation({ root: this.checkout, path: this.checkout, branch: 'feat/7' }),
      repository: new RepositoryName('mercadona/control-tower-plugin'),
      agent: CONVERSATION,
    })
  }

  oracle(steps: readonly ScriptedStep[] = [], pluginRoot: string = PLUGIN_ROOT): ScriptedOracle {
    return new ScriptedOracle({
      checkout: this.checkout, plan: PLAN, issue: ISSUE, pluginRoot, dispatchCheck: DISPATCH_CHECK, steps,
    })
  }

  machine(oracle: ScriptedOracle, pluginRoot: string = oracle.pluginRoot): CtRunMachine {
    return new CtRunMachine({
      journal: this.journal,
      node: oracle.run,
      git: async () => { throw new Error('dispatch resolution must not invoke git') },
      read: async (path) => readFile(path, 'utf8').catch((cause: unknown) => {
        if (Fixture.#hasCode(cause, 'ENOENT')) return null
        throw cause
      }),
      ctStep: CT_STEP,
      dispatchCheck: oracle.dispatchCheck,
      pluginRoot,
    })
  }

  async seed(stdout: string): Promise<void> {
    const watch = this.watch()
    await this.journal.establish(watch, `${JSON.stringify({
      version: 1,
      conversation: CONVERSATION,
      repository: 'mercadona/control-tower-plugin',
      issue: ISSUE,
      plan: PLAN,
      initialPlanSha256: Fixture.#digest(PLAN),
    })}\n`)
    const ticket = await this.journal.begin(watch, `${JSON.stringify({
      version: 1,
      previous: null,
      argv: [CT_STEP, 'next', '--plan', PLAN, '--issue', String(ISSUE), '--output-format', 'json'],
      cwd: this.checkout,
      planSha256: Fixture.#digest(PLAN),
    })}\n`)
    await this.journal.finish(watch, ticket, `${JSON.stringify({
      version: 1,
      code: 0,
      stdout,
      stderr: '',
      beforeRun: null,
      afterRun: null,
    })}\n`)
  }

  async material(): Promise<string | null> {
    return this.journal.material(this.watch(), TICKET)
  }

  static async bytes(paths: readonly string[], cwd: string): Promise<readonly Buffer[]> {
    return Promise.all(paths.map((path) => readFile(path.startsWith('/') ? path : join(cwd, path))))
  }

  static #digest(text: string): string {
    return createHash('sha256').update(text).digest('hex')
  }

  static #hasCode(cause: unknown, code: string): boolean {
    return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === code
  }
}

describe('RunDispatch', () => {
  const fixtures: Fixture[] = []

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.remove()))
  })

  it('announced oracle material reaches the dispatch without rewritten bytes', async () => {
    const fixture = await Fixture.create()
    fixtures.push(fixture)
    const oracle = fixture.oracle()
    const stdout = await oracle.announce('implement')
    const expectedPaths = ProducerOutput.implementPaths(stdout)
    const before = await Fixture.bytes(expectedPaths, fixture.checkout)
    const machine = fixture.machine(oracle)
    await fixture.seed(stdout)
    const watch = fixture.watch()

    const dispatch = await machine.dispatch(watch, TICKET)
    const after = await Fixture.bytes(dispatch.paths, fixture.checkout)
    const replayed = await machine.dispatch(watch, TICKET)

    expect(dispatch.paths).toEqual(expectedPaths)
    expect(after).toEqual(before)
    expect(await Fixture.bytes(replayed.paths, fixture.checkout)).toEqual(before)
    expect(replayed).toEqual(dispatch)
  })

  it('every supported role carries its agent, its channel and the schema it needs', async () => {
    const roles: readonly DispatchRole[] = ['implement', 'judge', 'advise', 'slice-judge', 'reconcile']
    const dispatchOfRole = new Map<DispatchRole, RunDispatch>()
    for (const role of roles) {
      const fixture = await Fixture.create()
      fixtures.push(fixture)
      const oracle = fixture.oracle()
      const stdout = await oracle.announce(role)
      const machine = fixture.machine(oracle)
      await fixture.seed(stdout)
      const watch = fixture.watch()

      const dispatch = await machine.dispatch(watch, TICKET)
      const expectation = RESPONSE_EXPECTATION_OF_ROLE[role]

      expect(dispatch.role).toBe(role)
      expect(dispatch.paths).toEqual(ProducerOutput.paths(role, stdout))
      expect(dispatch.response.kind).toBe(expectation.kind)
      if (expectation.schema) expect(dispatch.argv).toContain('--json-schema')
      else expect(dispatch.argv).not.toContain('--json-schema')
      expect(dispatch.argv).toContain('--model')
      if (expectation.agent === null) expect(dispatch.argv).not.toContain('--agent')
      else {
        expect(dispatch.argv).toContain('--agent')
        expect(dispatch.argv).toContain(expectation.agent)
      }
      expect(Object.isFrozen(dispatch)).toBe(true)
      expect(Object.isFrozen(dispatch.paths)).toBe(true)
      expect(Object.isFrozen(dispatch.argv)).toBe(true)
      expect(await fixture.material()).not.toBeNull()
      dispatchOfRole.set(role, dispatch)
    }
    const dispatched = (role: DispatchRole): RunDispatch => {
      const dispatch = dispatchOfRole.get(role)
      if (dispatch === undefined) throw new Error(`no dispatch was captured for role ${role}`)
      return dispatch
    }
    expect(dispatched('judge').argv).toContain(JUDGE_TOOLS)
    expect(dispatched('advise').argv).toContain(ADVISOR_TOOLS)
    expect(dispatched('slice-judge').argv).toContain(SLICE_JUDGE_TOOLS)
    expect(dispatched('reconcile').argv).toContain(RECONCILER_TOOLS)

    const malformedFixture = await Fixture.create()
    fixtures.push(malformedFixture)
    const malformedOracle = malformedFixture.oracle()
    const malformedStdout = await malformedOracle.announce('judge')
    const malformedPluginRoot = join(malformedFixture.checkout, 'malformed-plugin')
    await mkdir(join(malformedPluginRoot, 'agents'), { recursive: true })
    await writeFile(join(malformedPluginRoot, 'agents', 'ct-judge.md'), 'not an agent definition\n')
    const malformedMachine = malformedFixture.machine(malformedOracle, malformedPluginRoot)
    await malformedFixture.seed(malformedStdout)
    await expect(malformedMachine.dispatch(malformedFixture.watch(), TICKET))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await malformedFixture.material()).toBeNull()
  })

  it('unsupported E2E and slice fallback material starts no call', async () => {
    const e2eFixture = await Fixture.create()
    fixtures.push(e2eFixture)
    const e2eOracle = e2eFixture.oracle()
    const e2eStdout = await e2eOracle.announce('e2e')
    const e2eMachine = e2eFixture.machine(e2eOracle)
    await e2eFixture.seed(e2eStdout)
    await expect(e2eMachine.dispatch(e2eFixture.watch(), TICKET)).rejects.toThrow(/unsupported E2E material/)
    expect(await e2eFixture.material()).toBeNull()

    const fallbackFixture = await Fixture.create()
    fixtures.push(fallbackFixture)
    const fallbackOracle = fallbackFixture.oracle()
    const fallbackStdout = await fallbackOracle.announce('reconcile-clean')
    const fallbackMachine = fallbackFixture.machine(fallbackOracle)
    await fallbackFixture.seed(fallbackStdout)
    await expect(fallbackMachine.dispatch(fallbackFixture.watch(), TICKET))
      .rejects.toThrow(`ticket ${TICKET} does not carry dispatch material`)
    expect(await fallbackFixture.material()).toBeNull()
  })

  it('a changed judge definition goes out under a new versioned seal', async () => {
    const fixture = await Fixture.create()
    fixtures.push(fixture)
    const oracle = fixture.oracle()
    const stdout = await oracle.announce('judge')
    const copiedPluginRoot = join(fixture.checkout, 'copied-plugin')
    for (const file of RoleBytes.filesOf(STEPS.JUDGE)) {
      await mkdir(dirname(join(copiedPluginRoot, file)), { recursive: true })
      await writeFile(join(copiedPluginRoot, file), await readFile(join(PLUGIN_ROOT, file)))
    }
    const judgeFile = join(copiedPluginRoot, 'agents', 'ct-judge.md')
    const machine = fixture.machine(oracle, copiedPluginRoot)
    await fixture.seed(stdout)
    const watch = fixture.watch()
    const operation = join(fixture.state, 'harness', CONVERSATION, 'run', 'operations', TICKET)

    const first = await machine.dispatch(watch, TICKET)
    const sealed = await readFile(join(operation, 'material.json'), 'utf8')
    await machine.dispatch(watch, TICKET)
    const unchanged = (await readdir(operation)).sort()
    await writeFile(judgeFile, `${await readFile(judgeFile, 'utf8')}\nA line the judge prompt gained after the first dispatch.\n`)
    const second = await machine.dispatch(watch, TICKET)
    await machine.dispatch(watch, TICKET)

    expect(unchanged).toEqual(['material.json', 'receipt.json', 'request.json'])
    expect(second.argv).not.toEqual(first.argv)
    expect((await readdir(operation)).sort()).toEqual(['material-2.json', 'material.json', 'receipt.json', 'request.json'])
    expect(await readFile(join(operation, 'material.json'), 'utf8')).toBe(sealed)
    const resealed = await readFile(join(operation, 'material-2.json'), 'utf8')
    expect(resealed).not.toBe(sealed)
    expect(JSON.parse(resealed).argv).toEqual(second.argv)
    expect(await fixture.material()).toBe(resealed)
  })

  it('a dispatch whose input material is missing is refused', async () => {
    const fixture = await Fixture.create()
    fixtures.push(fixture)
    const oracle = fixture.oracle()
    const stdout = await oracle.announce('implement')
    const machine = fixture.machine(oracle)
    await fixture.seed(stdout)
    const missing = ProducerOutput.pathOf(stdout, INPUT_ROLES.BRIEF)
    await rm(missing)

    await expect(machine.dispatch(fixture.watch(), TICKET)).rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await fixture.material()).toBeNull()
  })

  it('literal producer paths and the declared verdict glob retain their different meanings', async () => {
    const environment = new EnvironmentSnapshot(['TMPDIR'])
    const parent = await mkdtemp(join(tmpdir(), 'ct-[literal]*?-'))
    try {
      process.env.TMPDIR = parent
      const literalFixture = await Fixture.create()
      fixtures.push(literalFixture)
      const literalOracle = literalFixture.oracle()
      const literalStdout = await literalOracle.announce('implement')
      const literalMachine = literalFixture.machine(literalOracle)
      await literalFixture.seed(literalStdout)
      const dispatch = await literalMachine.dispatch(literalFixture.watch(), TICKET)
      expect(dispatch.paths.some((path) => path.includes('[literal]*?'))).toBe(true)

      environment.restore()
      if (environment.values.get('TMPDIR') === undefined) expect('TMPDIR' in process.env).toBe(false)
      else expect(process.env.TMPDIR).toBe(environment.values.get('TMPDIR'))

      const verdictFixture = await Fixture.create()
      fixtures.push(verdictFixture)
      const verdictOracle = verdictFixture.oracle()
      const produced = await verdictOracle.announce('slice-judge')
      const relativeGlob = `docs/superpowers/verdicts/issue-${ISSUE}-*.json`
      const absoluteGlob = join(verdictFixture.checkout, relativeGlob)
      const verdictMachine = verdictFixture.machine(verdictOracle)
      await verdictFixture.seed(produced.replace(relativeGlob, absoluteGlob))
      const globDispatch = await verdictMachine.dispatch(verdictFixture.watch(), TICKET)
      expect(globDispatch.paths).toContain(absoluteGlob)
    } finally {
      environment.restore()
      await rm(parent, { recursive: true, force: true })
    }
    if (environment.values.get('TMPDIR') === undefined) expect('TMPDIR' in process.env).toBe(false)
    else expect(process.env.TMPDIR).toBe(environment.values.get('TMPDIR'))
  })

  it('conflicting response announcements and duplicate consuming commands are refused before sealing', async () => {
    const conflictingFixture = await Fixture.create()
    fixtures.push(conflictingFixture)
    const conflictingOracle = conflictingFixture.oracle()
    const produced = await conflictingOracle.announce('implement')
    const announced = ProducerOutput.responsePath(produced)
    const conflictMachine = conflictingFixture.machine(conflictingOracle)
    await conflictingFixture.seed(produced.replace(announced, `${announced}.other`))
    await expect(conflictMachine.dispatch(conflictingFixture.watch(), TICKET))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await conflictingFixture.material()).toBeNull()

    const duplicateFixture = await Fixture.create()
    fixtures.push(duplicateFixture)
    const duplicateOracle = duplicateFixture.oracle()
    const duplicateOutput = await duplicateOracle.announce('implement')
    const conflictingAnnouncement = ProducerOutput.withConsuming(duplicateOutput, [
      'report', 'wrong-report.json', '--plan', 'docs/superpowers/plans/wrong.md', '--issue', '999',
    ])
    const duplicateMachine = duplicateFixture.machine(duplicateOracle)
    await duplicateFixture.seed(`${conflictingAnnouncement}\n${duplicateOutput}`)
    await expect(duplicateMachine.dispatch(duplicateFixture.watch(), TICKET))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await duplicateFixture.material()).toBeNull()

    const differentStructuredVerbFixture = await Fixture.create()
    fixtures.push(differentStructuredVerbFixture)
    const structuredOracle = differentStructuredVerbFixture.oracle()
    const structuredOutput = await structuredOracle.announce('implement')
    const structuredMachine = differentStructuredVerbFixture.machine(structuredOracle)
    await differentStructuredVerbFixture.seed(ProducerOutput.withConsuming(structuredOutput, [
      'verdict', ProducerOutput.responsePath(structuredOutput),
      '--plan', PLAN, '--issue', String(ISSUE),
    ]))
    await expect(structuredMachine.dispatch(differentStructuredVerbFixture.watch(), TICKET))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await differentStructuredVerbFixture.material()).toBeNull()

    const differentEditsVerbFixture = await Fixture.create()
    fixtures.push(differentEditsVerbFixture)
    const editsOracle = differentEditsVerbFixture.oracle()
    const editsOutput = await editsOracle.announce('reconcile')
    const editsMachine = differentEditsVerbFixture.machine(editsOracle)
    await differentEditsVerbFixture.seed(ProducerOutput.withConsuming(editsOutput, [
      'report', 'other.json', '--plan', PLAN, '--issue', String(ISSUE),
    ]))
    await expect(editsMachine.dispatch(differentEditsVerbFixture.watch(), TICKET))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await differentEditsVerbFixture.material()).toBeNull()

    const mismatchedRubricFixture = await Fixture.create()
    fixtures.push(mismatchedRubricFixture)
    const rubricOracle = mismatchedRubricFixture.oracle()
    const rubricOutput = await rubricOracle.announce('implement')
    const declaredRubric = ProducerOutput.pathOf(rubricOutput, INPUT_ROLES.RUBRIC)
    const mismatchedMachine = mismatchedRubricFixture.machine(rubricOracle)
    await mismatchedRubricFixture.seed(
      rubricOutput.replace(declaredRubric, join(mismatchedRubricFixture.checkout, 'AGENTS.md')),
    )
    await expect(mismatchedMachine.dispatch(mismatchedRubricFixture.watch(), TICKET))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await mismatchedRubricFixture.material()).toBeNull()
  })
})
