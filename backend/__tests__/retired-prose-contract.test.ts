import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'

type Finding = { readonly file: string, readonly fragment: string }

class RetiredProseContract {
  static PACKAGE_LABELS = [
    '  - the rubric from ',
    "  - the task's brief: ",
    '  - that it write its report to: ',
    '  - the review package: ',
    '  - the logs of the controls, ALREADY green, in case it wants them: ',
    '  - that it write its verdict to: ',
    "  - the advisor's package: ",
    '  - that it write its advice to: ',
    "  - the slice's review package: ",
    '  - the plan: ',
    '  - the log of the Global verification, ALREADY green, in case it wants it: ',
    '  - the verdict of every task, already committed: ',
    '  - the reconciliation package: ',
  ]

  static ABSENCE_SENTINELS = ['(none)', '(N/A declared)']

  static DISPATCH_SENTENCES = [
    'DISPATCH AN IMPLEMENTER',
    'DISPATCH THE JUDGE',
    'DISPATCH THE ADVISOR',
    'DISPATCH THE SLICE JUDGE',
    "DISPATCH THE SLICE'S AGENT",
    'DISPATCH ct-reconciler',
  ]

  static STDOUT_PATTERNS = [
    String.raw`^step: (`,
    String.raw`next: task `,
    String.raw`(?:^|\\n)run `,
    'step: ${',
    'step: e2e (',
  ]

  static CONSUMING_LINES = ['When it comes back', 'Run it with:']

  static PROSE_DELEGATIONS = ['DispatchProse', 'StepProse', 'ConsumingProse']

  static FRAGMENTS: readonly string[] = [
    ...RetiredProseContract.PACKAGE_LABELS,
    ...RetiredProseContract.ABSENCE_SENTINELS,
    ...RetiredProseContract.DISPATCH_SENTENCES,
    ...RetiredProseContract.STDOUT_PATTERNS,
    ...RetiredProseContract.CONSUMING_LINES,
    ...RetiredProseContract.PROSE_DELEGATIONS,
  ]
}

class StdoutScanning {
  static MECHANISMS = [
    'stdout.includes(',
    'stdout.split(',
    'stdout.startsWith(',
    'exec(output.stdout)',
    'exec(asked.stdout)',
    '.test(stdout)',
    '.test(output.stdout)',
  ]

  static MODULES = [
    'infrastructure/ct-run-machine.ts',
    'infrastructure/run-announcement.ts',
    'infrastructure/run-dispatch.ts',
  ]

  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  findings(): Finding[] {
    return [...StdoutScanning.MODULES].sort().flatMap((file) => this.findingsIn(file))
  }

  findingsIn(file: string): Finding[] {
    const text = readFileSync(join(this.root, file), 'utf8')
    return StdoutScanning.MECHANISMS
      .filter((mechanism) => text.includes(mechanism))
      .map((mechanism) => ({ file, fragment: mechanism }))
  }
}

class ProseCensus {
  static MODULE_EXTENSION = '.ts'

  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  findings(): Finding[] {
    return this.modules().sort().flatMap((file) => this.findingsIn(file))
  }

  modules(directory: string = this.root): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) return this.modules(full)
      return entry.name.endsWith(ProseCensus.MODULE_EXTENSION) ? [ProseCensus.pathOf(this.root, full)] : []
    })
  }

  findingsIn(file: string): Finding[] {
    const text = readFileSync(join(this.root, file), 'utf8')
    return RetiredProseContract.FRAGMENTS
      .filter((fragment) => text.includes(fragment))
      .map((fragment) => ({ file, fragment }))
  }

  static pathOf(root: string, full: string): string {
    return relative(root, full).split(sep).join('/')
  }

  static named(findings: Finding[]): string {
    return findings.map((finding) => `${finding.file} carries ${JSON.stringify(finding.fragment)}`).join(', ')
  }
}

class TreeCarryingEveryFragmentOfTheContract {
  static MODULES = [
    { path: 'labelled-package.ts', fragments: RetiredProseContract.PACKAGE_LABELS },
    { path: 'sentinel.ts', fragments: RetiredProseContract.ABSENCE_SENTINELS },
    { path: 'infrastructure/dispatched-role.ts', fragments: RetiredProseContract.DISPATCH_SENTENCES },
    { path: 'infrastructure/stdout-pattern.ts', fragments: RetiredProseContract.STDOUT_PATTERNS },
    { path: 'infrastructure/consuming-line.ts', fragments: RetiredProseContract.CONSUMING_LINES },
    { path: 'infrastructure/prose-delegation.ts', fragments: RetiredProseContract.PROSE_DELEGATIONS },
  ]

  static make(): string {
    const root = mkdtempSync(join(tmpdir(), 'retired-prose-contract-'))
    for (const module of TreeCarryingEveryFragmentOfTheContract.MODULES) {
      const full = join(root, module.path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, TreeCarryingEveryFragmentOfTheContract.textOf(module.fragments))
    }
    return root
  }

  static textOf(fragments: readonly string[]): string {
    return fragments.map((fragment) => `out("${fragment}")\n`).join('')
  }
}

class TreeCarryingEveryScanningMechanism {
  static make(): string {
    const root = mkdtempSync(join(tmpdir(), 'stdout-scanning-mechanisms-'))
    for (const module of StdoutScanning.MODULES) {
      const full = join(root, module)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, TreeCarryingEveryScanningMechanism.textOf())
    }
    return root
  }

  static textOf(): string {
    return StdoutScanning.MECHANISMS.map((mechanism) => `${mechanism}\n`).join('')
  }
}

describe('the prose contract that slices 2, 3 and 4 retire', () => {
  const temporaryTrees: string[] = []

  afterEach(() => {
    for (const tree of temporaryTrees.splice(0)) rmSync(tree, { recursive: true, force: true })
  })

  it('no_module_under_backend_src_carries_a_fragment_of_the_retired_prose_contract', () => {
    const alive = new ProseCensus(join(import.meta.dirname, '..', 'src')).findings()

    expect(alive, ProseCensus.named(alive)).toEqual([])
  })

  it('the_census_fires_on_a_tree_that_carries_every_fragment_of_the_contract', () => {
    const root = TreeCarryingEveryFragmentOfTheContract.make()
    temporaryTrees.push(root)

    expect(new ProseCensus(root).findings()).toEqual([
      { file: 'infrastructure/consuming-line.ts', fragment: 'When it comes back' },
      { file: 'infrastructure/consuming-line.ts', fragment: 'Run it with:' },
      { file: 'infrastructure/dispatched-role.ts', fragment: 'DISPATCH AN IMPLEMENTER' },
      { file: 'infrastructure/dispatched-role.ts', fragment: 'DISPATCH THE JUDGE' },
      { file: 'infrastructure/dispatched-role.ts', fragment: 'DISPATCH THE ADVISOR' },
      { file: 'infrastructure/dispatched-role.ts', fragment: 'DISPATCH THE SLICE JUDGE' },
      { file: 'infrastructure/dispatched-role.ts', fragment: "DISPATCH THE SLICE'S AGENT" },
      { file: 'infrastructure/dispatched-role.ts', fragment: 'DISPATCH ct-reconciler' },
      { file: 'infrastructure/prose-delegation.ts', fragment: 'DispatchProse' },
      { file: 'infrastructure/prose-delegation.ts', fragment: 'StepProse' },
      { file: 'infrastructure/prose-delegation.ts', fragment: 'ConsumingProse' },
      { file: 'infrastructure/stdout-pattern.ts', fragment: String.raw`^step: (` },
      { file: 'infrastructure/stdout-pattern.ts', fragment: String.raw`next: task ` },
      { file: 'infrastructure/stdout-pattern.ts', fragment: String.raw`(?:^|\\n)run ` },
      { file: 'infrastructure/stdout-pattern.ts', fragment: 'step: ${' },
      { file: 'infrastructure/stdout-pattern.ts', fragment: 'step: e2e (' },
      { file: 'labelled-package.ts', fragment: '  - the rubric from ' },
      { file: 'labelled-package.ts', fragment: "  - the task's brief: " },
      { file: 'labelled-package.ts', fragment: '  - that it write its report to: ' },
      { file: 'labelled-package.ts', fragment: '  - the review package: ' },
      { file: 'labelled-package.ts', fragment: '  - the logs of the controls, ALREADY green, in case it wants them: ' },
      { file: 'labelled-package.ts', fragment: '  - that it write its verdict to: ' },
      { file: 'labelled-package.ts', fragment: "  - the advisor's package: " },
      { file: 'labelled-package.ts', fragment: '  - that it write its advice to: ' },
      { file: 'labelled-package.ts', fragment: "  - the slice's review package: " },
      { file: 'labelled-package.ts', fragment: '  - the plan: ' },
      {
        file: 'labelled-package.ts',
        fragment: '  - the log of the Global verification, ALREADY green, in case it wants it: ',
      },
      { file: 'labelled-package.ts', fragment: '  - the verdict of every task, already committed: ' },
      { file: 'labelled-package.ts', fragment: '  - the reconciliation package: ' },
      { file: 'sentinel.ts', fragment: '(none)' },
      { file: 'sentinel.ts', fragment: '(N/A declared)' },
    ])
  })

  it('neither_module_of_the_dispatch_path_scans_ct_step_stdout_as_text', () => {
    const scanning = new StdoutScanning(join(import.meta.dirname, '..', 'src')).findings()

    expect(scanning, ProseCensus.named(scanning)).toEqual([])
  })

  it('the_mechanism_census_fires_on_modules_that_carry_every_scan_it_names', () => {
    const root = TreeCarryingEveryScanningMechanism.make()
    temporaryTrees.push(root)

    expect(new StdoutScanning(root).findings()).toEqual([
      { file: 'infrastructure/ct-run-machine.ts', fragment: 'stdout.includes(' },
      { file: 'infrastructure/ct-run-machine.ts', fragment: 'stdout.split(' },
      { file: 'infrastructure/ct-run-machine.ts', fragment: 'stdout.startsWith(' },
      { file: 'infrastructure/ct-run-machine.ts', fragment: 'exec(output.stdout)' },
      { file: 'infrastructure/ct-run-machine.ts', fragment: 'exec(asked.stdout)' },
      { file: 'infrastructure/ct-run-machine.ts', fragment: '.test(stdout)' },
      { file: 'infrastructure/ct-run-machine.ts', fragment: '.test(output.stdout)' },
      { file: 'infrastructure/run-announcement.ts', fragment: 'stdout.includes(' },
      { file: 'infrastructure/run-announcement.ts', fragment: 'stdout.split(' },
      { file: 'infrastructure/run-announcement.ts', fragment: 'stdout.startsWith(' },
      { file: 'infrastructure/run-announcement.ts', fragment: 'exec(output.stdout)' },
      { file: 'infrastructure/run-announcement.ts', fragment: 'exec(asked.stdout)' },
      { file: 'infrastructure/run-announcement.ts', fragment: '.test(stdout)' },
      { file: 'infrastructure/run-announcement.ts', fragment: '.test(output.stdout)' },
      { file: 'infrastructure/run-dispatch.ts', fragment: 'stdout.includes(' },
      { file: 'infrastructure/run-dispatch.ts', fragment: 'stdout.split(' },
      { file: 'infrastructure/run-dispatch.ts', fragment: 'stdout.startsWith(' },
      { file: 'infrastructure/run-dispatch.ts', fragment: 'exec(output.stdout)' },
      { file: 'infrastructure/run-dispatch.ts', fragment: 'exec(asked.stdout)' },
      { file: 'infrastructure/run-dispatch.ts', fragment: '.test(stdout)' },
      { file: 'infrastructure/run-dispatch.ts', fragment: '.test(output.stdout)' },
    ])
  })
})
