// The prescriptive plan's contract (scripts/plan-contract.js), tested as what
// it is: a pure module. The filesystem comes in by injection (`readFile`), so
// literality is tested without touching disk.
import { describe, it, expect } from 'vitest'
import {
  validatePlan, checkPlans, planFilesForIssue, ROLE_BUDGETS, COMMAND_BUDGET, CODE_BUDGETS,
} from '../scripts/plan-contract.js'

// Three backticks built at runtime: no line of THIS file may start with a real
// fence, or any tool that embeds this file inside a code block would break it
// (see the round's plan).
const F = '```'

const REAL_FILE = 'export function sum(a, b) {\n  return a + b\n}\n'

const VALID_PLAN = [
  '# #7 — sum() devuelve la suma',
  '',
  '> **This plan is written to be executed by task-scoped subagents with zero context.**',
  '',
  '## 1. Context and goal',
  'sum() existe y hay que cubrirla.',
  '### Desired end state',
  'sum() con test.',
  '### Out of scope',
  'N/A — nada que excluir.',
  '## 2. Closed decisions',
  '| Decision | Value |',
  '|---|---|',
  '| test runner | vitest |',
  '## 3. Reference patterns',
  'src/math.js',
  '## 4. Inventory',
  'src/math.js (modificar), tests/math.test.js (crear).',
  '## 5. Interfaces',
  'Consumes: nothing. Produces: sum(a, b) -> number.',
  '## 6. Test strategy',
  'Unit con vitest.',
  '## 7. Tasks',
  '### Task 1 — cover sum',
  '**Objective:** sum queda cubierta.',
  '**Files:** tests/math.test.js',
  'Current state (src/math.js):',
  F,
  'export function sum(a, b) {',
  '  return a + b',
  '}',
  F,
  '**TDD:** red first: expect(sum(2, 2)).toBe(4)',
  '**Tests:** add tests/math.test.js',
  '**Verification:** npm test, en verde.',
  F + 'bash',
  'npm test',
  F,
  '## 8. Global verification',
  'N/A — fixture.',
  '## 9. Assumptions',
  'Ninguna.',
  '',
].join('\n')

const readFile = (path) => {
  if (path === 'src/math.js') return REAL_FILE
  throw new Error(`ENOENT: ${path}`)
}

// ============================================================================
// F-jjponz-4 — fixtures of the block taxonomy.
//
// The plan of repo-pulse's slice #2 measured 73,868 characters with 1,271 lines
// of code (65% of the plan): module bodies and whole test files. Of its 14
// commits, 5 fixed defects that came pasted in the plan. At that size the human
// `plan` gate does not review, it skims. From this round on every block
// declares its ROLE and every role has a budget.
// ============================================================================

const HEADER = (title) => [
  `# ${title}`,
  '',
  '> **This plan is written to be executed by task-scoped subagents with zero context.**',
  '',
  '## 1. Context and goal',
  'Hay que exponer sum() por el barrel.',
  '### Desired end state',
  'El barrel exporta sum().',
  '### Out of scope',
  'N/A — nada que excluir.',
  '## 2. Closed decisions',
  '| Decision | Value |',
  '|---|---|',
  '| test runner | vitest |',
  '## 3. Reference patterns',
  'src/math.js',
  '## 4. Inventory',
  '| File | Action | Block |',
  '|---|---|---|',
  '| src/index.js | create | Contract |',
  '## 5. Interfaces',
  'Consumes: N/A. Produces: sum(a, b) -> number desde src/index.js.',
  '## 6. Test strategy',
  'Unit con vitest.',
]

const TAIL = [
  '## 8. Global verification',
  'N/A — fixture.',
  '## 9. Assumptions',
  'Ninguna.',
  '',
]

const block = ([label, body, lang = '']) => [label, F + lang, ...body, F]

// Builds a valid plan with one task per element of `tasks`. Each task is a
// list of blocks [label, body, lang?]; a task with no block carrying a
// role declares the escape `No code — <razón>`.
const planWithTasks = (tasks, { beforeTasks = [] } = {}) => [
  ...HEADER('#9 — el análisis expone su contrato'),
  ...beforeTasks.flatMap(block),
  '## 7. Tasks',
  ...tasks.flatMap((blocks, i) => [
    `### Task ${i + 1} — hacer el trabajo ${i + 1}`,
    `**Objective:** el trabajo ${i + 1} queda hecho.`,
    '**Files:** src/index.js',
    ...blocks.flatMap(block),
    ...(blocks.length ? [] : ['No code — la configuración se describe en prosa con el valor inline.']),
    '**TDD:** No TDD — fixture.',
    '**Tests:** N/A — fixture.',
    '**Verification:** npm test',
    F + 'bash',
    'npm test',
    F,
  ]),
  ...TAIL,
].join('\n')

const linesOf = (n) => Array.from({ length: n }, (_, i) => `export const c${i} = ${i}`)

const REAL_CITATION = ['Current state (src/math.js):', ['export function sum(a, b) {', '  return a + b', '}']]
const CONTRACT = ['Contract (src/index.js):', ["export { sum } from './math.js'"], 'js']
const CALL_SITE = ['Call site (src/app.js):', ["import { sum } from './index.js'"], 'js']
const TEXT = ['Final text (README.md):', ['## Uso', 'Importa `sum` desde `src/index.js`.']]

const PLAN_WITH_ROLES = planWithTasks([[REAL_CITATION, CONTRACT, CALL_SITE, TEXT], []])

describe('validatePlan — the reference valid plan', () => {
  it('passes whole, literality included', () => {
    const r = validatePlan(VALID_PLAN, { readFile })
    expect(r.violations).toEqual([])
    expect(r.ok).toBe(true)
  })
})

describe('validatePlan — structure', () => {
  it('detects a missing canonical section', () => {
    const r = validatePlan(VALID_PLAN.replace('## 5. Interfaces', '## 5. Iface'), { readFile })
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.rule === 'sections' && v.detail.includes('## 5. Interfaces'))).toBe(true)
  })

  it('detects an empty decisions table', () => {
    const withoutRow = VALID_PLAN.replace('| test runner | vitest |\n', '')
    const r = validatePlan(withoutRow, { readFile })
    expect(r.violations.some((v) => v.rule === 'decisions')).toBe(true)
  })

  it('detects a missing task marker', () => {
    const r = validatePlan(VALID_PLAN.replace('**TDD:** red first: expect(sum(2, 2)).toBe(4)\n', ''), { readFile })
    expect(r.violations.some((v) => v.rule === 'tasks' && v.detail.includes('**TDD:**'))).toBe(true)
  })

  it('detects non-consecutive task numbering', () => {
    const r = validatePlan(VALID_PLAN.replace('### Task 1 — cover sum', '### Task 2 — cover sum'), { readFile })
    expect(r.violations.some((v) => v.rule === 'tasks' && v.detail.includes('no consecutiva'))).toBe(true)
  })
})

describe('validatePlan — placeholders', () => {
  it('a TBD outside a fence is a violation; inside a fence, it is not', () => {
    const outside = validatePlan(VALID_PLAN.replace('Unit con vitest.', 'Unit con vitest. TBD'), { readFile })
    expect(outside.violations.some((v) => v.rule === 'placeholders')).toBe(true)

    const inside = VALID_PLAN.replace('  return a + b', '  return a + b // TBD')
    const real = REAL_FILE.replace('  return a + b', '  return a + b // TBD')
    const r = validatePlan(inside, { readFile: () => real })
    expect(r.violations.filter((v) => v.rule === 'placeholders')).toEqual([])
  })
})

describe('validatePlan — literality', () => {
  it('a citation that does not exist verbatim in the file is a violation', () => {
    const r = validatePlan(VALID_PLAN.replace('  return a + b', '  return a - b'), { readFile })
    expect(r.violations.some((v) => v.rule === 'literality' && v.detail.includes('src/math.js'))).toBe(true)
  })

  // F-jjponz-4: "Current state: does not exist." + the final content was the
  // idiom that produced the dumps. It still does not check literality (it does
  // not match the regex), but now the fence that follows it has no role and
  // that IS a violation — the case lives whole in the taxonomy describe.
  it('a label that does not match the convention does not check literality', () => {
    const relabelled = VALID_PLAN.replace(
      ['Current state (src/math.js):', F, 'export function sum(a, b) {', '  return a + b', '}', F].join('\n'),
      ['Current state: does not exist.', F, 'nuevo contenido', F].join('\n'),
    )
    const r = validatePlan(relabelled, { readFile })
    expect(r.violations.filter((v) => v.rule === 'literality')).toEqual([])
  })

  it('with no readFile injected, literality is neither asserted nor denied', () => {
    const r = validatePlan(VALID_PLAN.replace('  return a + b', '  return a - b'), {})
    expect(r.violations.filter((v) => v.rule === 'literality')).toEqual([])
  })
})

describe('planFilesForIssue — the issue-<n>- convention', () => {
  it('matches the exact issue and not a prefix', () => {
    const paths = [
      'docs/superpowers/plans/2026-08-12-issue-1-foo.md',
      'docs/superpowers/plans/2026-08-12-issue-12-bar.md',
      'docs/otro/2026-08-12-issue-1-x.md',
    ]
    expect(planFilesForIssue(1, paths)).toEqual(['docs/superpowers/plans/2026-08-12-issue-1-foo.md'])
    expect(planFilesForIssue(12, paths)).toEqual(['docs/superpowers/plans/2026-08-12-issue-12-bar.md'])
  })
})

describe("checkPlans — the gate's decision", () => {
  const PLAN_PATH = 'docs/superpowers/plans/2026-08-12-issue-7-sum.md'
  const fsOf = (content) => (path) => {
    if (path === PLAN_PATH) return content
    if (path === 'src/math.js') return REAL_FILE
    throw new Error(`ENOENT: ${path}`)
  }

  it('with no candidate: code 6 with a remedy', () => {
    const r = checkPlans({ issue: 7, candidates: ['src/app.js'], readFile: fsOf(VALID_PLAN) })
    expect(r.code).toBe(6)
    expect(r.message).toContain('writing-plans-prescriptive')
  })

  it('a valid candidate: code 0', () => {
    const r = checkPlans({ issue: 7, candidates: [PLAN_PATH], readFile: fsOf(VALID_PLAN) })
    expect(r).toMatchObject({ ok: true, code: 0 })
  })

  it('an invalid candidate: code 6 with the violations in the message', () => {
    const broken = VALID_PLAN.replace('## 9. Assumptions', '## 9. Assumption')
    const r = checkPlans({ issue: 7, candidates: [PLAN_PATH], readFile: fsOf(broken) })
    expect(r.code).toBe(6)
    expect(r.message).toContain('## 9. Assumptions')
  })

  // F-jjponz-3 — the plan and the files it cites are NOT read in the same
  // snapshot: the plan is introduced by the branch (it only exists where it is
  // now) and the citations are checked against the base, where the slice had
  // not touched anything yet.
  it('reads the PLAN with readFile and the CITATIONS with readCitedFile', () => {
    const onlyThePlan = (path) => {
      if (path === PLAN_PATH) return VALID_PLAN
      throw new Error(`el plan no está en la base: ${path}`)
    }
    const onlyWhatIsCited = (path) => {
      if (path === 'src/math.js') return REAL_FILE
      throw new Error(`ENOENT: ${path}`)
    }
    expect(checkPlans({
      issue: 7, candidates: [PLAN_PATH], readFile: onlyThePlan, readCitedFile: onlyWhatIsCited,
    })).toMatchObject({ ok: true, code: 0 })
  })

  it('with no readCitedFile, the citations are read with readFile — the --check-plan mode does not change', () => {
    const r = checkPlans({ issue: 7, candidates: [PLAN_PATH], readFile: fsOf(VALID_PLAN) })
    expect(r).toMatchObject({ ok: true, code: 0 })
  })

  it("a citation the citation reader cannot find is a violation carrying THAT reader's reason", () => {
    const r = checkPlans({
      issue: 7,
      candidates: [PLAN_PATH],
      readFile: fsOf(VALID_PLAN),
      readCitedFile: () => { throw new Error('no existe en la base de la rama (abc123def456)') },
    })
    expect(r.code).toBe(6)
    expect(r.message).toContain('src/math.js')
    expect(r.message).toContain('no existe en la base de la rama')
  })

  it('a dump with no role label comes out with code 6 and the message carries the remedy (F-jjponz-4)', () => {
    const dump = PLAN_WITH_ROLES.replace('Contract (src/index.js):', 'Final content:')
    const r = checkPlans({ issue: 7, candidates: [PLAN_PATH], readFile: fsOf(dump) })
    expect(r.code).toBe(6)
    expect(r.message).toContain('Contract (path):')
  })
})

// ============================================================================
// F-jjponz-4 — the block taxonomy
// ============================================================================

const violationsOf = (plan, rule) =>
  validatePlan(plan, { readFile }).violations.filter((v) => v.rule === rule)

describe('validatePlan — block taxonomy', () => {
  it('the plan with the four roles passes whole', () => {
    expect(validatePlan(PLAN_WITH_ROLES, { readFile })).toMatchObject({ ok: true, violations: [] })
  })

  it('a block with no role label is a violation, and the message lists the four roles', () => {
    const broken = PLAN_WITH_ROLES.replace('Contract (src/index.js):', 'Así queda el fichero:')
    const [v] = violationsOf(broken, 'roles')
    expect(v.detail).toContain('Así queda el fichero:')
    for (const role of ['Current state (path):', 'Contract (path):', 'Call site (path):', 'Final text (path.md):']) {
      expect(v.detail).toContain(role)
    }
  })

  it('"Final content:" — the label that produced the dumps — no longer counts', () => {
    const broken = PLAN_WITH_ROLES.replace('Contract (src/index.js):', 'Final content:')
    expect(violationsOf(broken, 'roles')[0].detail).toContain('Final content:')
  })

  it('"Current state: does not exist." followed by a fence is a violation: the dump idiom is dead', () => {
    const broken = PLAN_WITH_ROLES.replace('Contract (src/index.js):', 'Current state: does not exist.')
    expect(violationsOf(broken, 'roles')).toHaveLength(1)
  })

  it('a Contract is NOT checked verbatim: the file does not exist yet', () => {
    // `readFile` throws ENOENT for anything that is not src/math.js, and the
    // contract points at src/index.js, which this plan creates.
    expect(violationsOf(PLAN_WITH_ROLES, 'literality')).toEqual([])
  })

  it('"Final text" counts over a text file and not over code', () => {
    expect(violationsOf(PLAN_WITH_ROLES, 'roles')).toEqual([])
    const broken = planWithTasks([[['Final text (src/index.js):', ["export const x = 1"]]]])
    const [v] = violationsOf(broken, 'roles')
    expect(v.detail).toContain('.md')
  })

  it('a command block needs no label: its language gives it away', () => {
    const plan = planWithTasks([[CONTRACT, ['Y se comprueba así:', ['npm run build'], 'bash']]])
    expect(violationsOf(plan, 'roles')).toEqual([])
  })

  it('a heredoc in a command block is a file smuggled in through the back door', () => {
    const plan = planWithTasks([[CONTRACT, ['Y se siembra así:', ['cat > f.txt <<EOF', 'hola', 'EOF'], 'bash']]])
    expect(violationsOf(plan, 'commands')).toHaveLength(1)
  })

  it('a block with a role outside a task is a violation and it names the task brief', () => {
    const plan = planWithTasks([[REAL_CITATION]], { beforeTasks: [CONTRACT] })
    const [v] = violationsOf(plan, 'roles')
    expect(v.detail).toContain('task brief')
  })

  it('two Contract blocks of the same file in the same task is a violation', () => {
    const plan = planWithTasks([[CONTRACT, CONTRACT]])
    expect(violationsOf(plan, 'roles')).toHaveLength(1)
  })

  it('two different tasks may carry a Contract of the same file: one creates it, the other extends it', () => {
    expect(violationsOf(planWithTasks([[CONTRACT], [CONTRACT]]), 'roles')).toEqual([])
  })
})

describe('validatePlan — budget per role', () => {
  const pathOf = { 'Current state': 'src/math.js', Contract: 'src/index.js', 'Call site': 'src/app.js', 'Final text': 'README.md' }

  it.each(Object.entries(ROLE_BUDGETS))('a %s block of budget+1 lines is a violation', (role, budget) => {
    const plan = planWithTasks([[[`${role} (${pathOf[role]}):`, linesOf(budget + 1)]]])
    const [v] = violationsOf(plan, 'budget')
    expect(v.detail).toContain(String(budget))
  })

  it('a Contract right on its budget passes: the real example is ~10 lines', () => {
    const plan = planWithTasks([[['Contract (src/index.js):', linesOf(ROLE_BUDGETS.Contract)]]])
    expect(violationsOf(plan, 'budget')).toEqual([])
  })

  it('a task that accumulates more than the task budget is a violation and says that one commit is two', () => {
    const half = Math.ceil(CODE_BUDGETS.task / 2) + 1
    const plan = planWithTasks([[
      ['Contract (src/index.js):', linesOf(Math.min(half, ROLE_BUDGETS.Contract))],
      ['Contract (src/otro.js):', linesOf(Math.min(half, ROLE_BUDGETS.Contract))],
    ]])
    const [v] = violationsOf(plan, 'budget')
    expect(v.detail).toContain('commit')
  })

  // F-jjponz-5: there is NO plan budget. A global cap forced the agent to
  // shave characters —14 of the 24 --check-plan runs of slice #3 failed on
  // `size`— and its only real way out (splitting the slice) is not one it can
  // pull: it comes dispatched for a frozen issue. What it CAN split is a task,
  // so the ceiling goes per task.
  it('six tasks, each one within ITS budget, do not accumulate a plan violation', () => {
    const tasks = Array.from({ length: 6 }, () => [['Contract (src/index.js):', linesOf(ROLE_BUDGETS.Contract)]])
    expect(violationsOf(planWithTasks(tasks), 'budget')).toEqual([])
  })

  it('command blocks do not count towards the accumulated total', () => {
    const commands = Array.from({ length: 40 }, (_, i) => [`Se comprueba (${i}):`, ['npm test'], 'bash'])
    expect(violationsOf(planWithTasks([[CONTRACT, ...commands]]), 'budget')).toEqual([])
  })

  it('a command block longer than its budget is a violation', () => {
    const plan = planWithTasks([[CONTRACT, ['Se comprueba así:', linesOf(COMMAND_BUDGET + 1), 'bash']]])
    expect(violationsOf(plan, 'commands')).toHaveLength(1)
  })
})

// The check that pins the suite's total. Measured on rust-monitoring's slice
// #7: `52 passed` in four checks, the judge rightly demanded one more test, and
// with the total pinned there was no gap left to drive in red the assertion
// conventions/testing.md demands — two branches were delivered with no test so
// that the check stayed green. It is ct's yardstick fighting a ct check, and
// here is the only place where it can be stopped.
describe('validatePlan — no check pins the suite total of tests', () => {
  const withCheck = (command) => planWithTasks([[CONTRACT, ['Se comprueba así:', [command], 'bash']]])

  it('rejects the cargo test total', () => {
    expect(violationsOf(withCheck(`test "$(cargo test 2>&1 | grep -c 'test result: ok. 52 passed')" -eq 1`), 'commands'))
      .toHaveLength(1)
  })

  it('rejects the pytest total and the jest one, which write it the same way', () => {
    expect(violationsOf(withCheck(`test "$(pytest -q | grep -c '41 passed')" -eq 1`), 'commands')).toHaveLength(1)
    expect(violationsOf(withCheck(`npm test 2>&1 | grep 'Tests:       12 passed'`), 'commands')).toHaveLength(1)
  })

  it('rejects the mocha total, which says "passing" and not "passed"', () => {
    expect(violationsOf(withCheck(`npm test | grep '7 passing'`), 'commands')).toHaveLength(1)
  })

  it("the message offers the alternative: count the task's tests by their module prefix", () => {
    const [violation] = violationsOf(withCheck(`test "$(cargo test | grep -c '52 passed')" -eq 1`), 'commands')
    expect(violation.detail).toMatch(/prefijo de módulo/)
    expect(violation.detail).toMatch(/conventions\/testing\.md/)
  })

  it('it does NOT reject the count scoped to the task module, which is the alternative it offers', () => {
    expect(violationsOf(withCheck(`test "$(cargo test log_timestamp 2>&1 | grep -c '^test log_timestamp::')" -eq 2`), 'commands'))
      .toEqual([])
  })

  it('it does NOT reject a command that runs the suite without pinning its number', () => {
    expect(violationsOf(withCheck('cargo test'), 'commands')).toEqual([])
    expect(violationsOf(withCheck('npm test'), 'commands')).toEqual([])
  })

  it('it points at the line of the check, not at the one of the fence that opens it', () => {
    const plan = planWithTasks([[CONTRACT, ['Se comprueba así:', ['cargo build', `grep -c '52 passed'`], 'bash']]])
    const [violation] = violationsOf(plan, 'commands')
    const checkLine = plan.split('\n').findIndex((l) => l.includes('52 passed')) + 1
    expect(violation.detail).toMatch(new RegExp(`^línea ${checkLine}:`))
  })
})

describe('validatePlan — configurations carry no block', () => {
  it.each([
    'package.json', 'server/tsconfig.json', '.github/workflows/ci.yml',
    'pnpm-lock.yaml', '.gitignore', 'Dockerfile',
  ])('a block over %s is a violation and the remedy is prose with the value inline', (path) => {
    const plan = planWithTasks([[[`Contract (${path}):`, ['{ "a": 1 }']]]])
    const [v] = violationsOf(plan, 'config')
    expect(v.detail).toContain('prosa')
  })

  it('a code file with a config name (vite.config.ts) is NOT configuration', () => {
    const plan = planWithTasks([[['Contract (vite.config.ts):', ['export default {}']]]])
    expect(violationsOf(plan, 'config')).toEqual([])
  })
})

describe('validatePlan — test files carry no final-state block', () => {
  it.each(['src/git.test.ts', 'src/git.spec.js', '__tests__/plan-contract.test.js'])(
    'Contract over %s is a violation and points at TDD/Tests',
    (path) => {
      const plan = planWithTasks([[[`Contract (${path}):`, ['it("x", () => {})']]]])
      const [v] = violationsOf(plan, 'tests')
      expect(v.detail).toContain('**TDD:**')
    },
  )

  it("Current state over a test file DOES count: hardening an assertion demands citing today's one", () => {
    const testCitation = ['Current state (src/math.test.js, lines 1-2):', ['expect(sum(2, 2)).toBe(4)']]
    const plan = planWithTasks([[testCitation]])
    const readFileWithTest = (p) => {
      if (p === 'src/math.test.js') return 'expect(sum(2, 2)).toBe(4)\n'
      throw new Error(`ENOENT: ${p}`)
    }
    const r = validatePlan(plan, { readFile: readFileWithTest })
    expect(r.violations.filter((v) => v.rule === 'tests')).toEqual([])
    expect(r.violations.filter((v) => v.rule === 'literality')).toEqual([])
  })
})

describe('validatePlan — "at least one block with a role" per task', () => {
  it('a task whose only block is the bash verification is a violation', () => {
    const plan = planWithTasks([[CONTRACT], []]).replace(
      'No code — la configuración se describe en prosa con el valor inline.', 'Aquí no hay nada.',
    )
    const [v] = violationsOf(plan, 'tasks')
    expect(v.detail).toContain('No code — ')
  })

  it('…unless it declares the exact line "No code — <razón>"', () => {
    expect(violationsOf(planWithTasks([[CONTRACT], []]), 'tasks')).toEqual([])
  })
})

describe('validatePlan — every TASK fits on an A4 sheet', () => {
  const fatTask = (n) => [
    ['Contract (src/index.js):', ['export const x = 1']],
    ...Array.from({ length: n }, (_, i) => [`Se comprueba (${i}):`, [`npm test -- caso-${i}`], 'bash']),
  ]

  it(`a task of more than ${CODE_BUDGETS.chars} characters is a violation, it names it, says how many sheets it takes and that the task is two`, () => {
    const filler = Array.from({ length: 100 }, (_, i) => `Detalle cerrado número ${i} de esta tarea.`)
    const plan = planWithTasks([[CONTRACT]]).replace(
      '**TDD:** No TDD — fixture.', `${filler.join('\n')}\n**TDD:** No TDD — fixture.`,
    )
    const [v] = violationsOf(plan, 'size')
    expect(v.detail).toMatch(/Task 1/)
    expect(v.detail).toMatch(/folio/)
    expect(v.detail).toMatch(/la tarea son dos/)
  })

  it('the budget is PER TASK: two big tasks, but each one within the sheet, pass', () => {
    const plan = planWithTasks([fatTask(45), fatTask(45)])
    expect(plan.length).toBeGreaterThan(CODE_BUDGETS.chars)
    expect(violationsOf(plan, 'size')).toEqual([])
  })

  it('the reference plan triggers nothing about size', () => {
    expect(violationsOf(PLAN_WITH_ROLES, 'size')).toEqual([])
  })
})

// ===========================================================================
// D-4 — the task's yardstick has to be EXECUTABLE.
//
// The contract already demanded that **Verification:** be there. What it did
// not demand is that it say something that can be run, and that difference is
// the one that decides whether a program can execute the plan or a human is
// needed interpreting prose. The fixture of the real case lives in
// plan-tasks.test.js; here the contract's edge is pinned.
// ===========================================================================
describe('the **Verification:** commands go in a block, not in the sentence', () => {
  const planWith = (verification) => [
    '# #7 — sum() devuelve la suma',
    '',
    '> **This plan is written to be executed by task-scoped subagents with zero context.**',
    '',
    '## 1. Context and goal',
    'sum() existe y hay que cubrirla.',
    '### Desired end state',
    'sum() con test.',
    '### Out of scope',
    'N/A — nada que excluir.',
    '## 2. Closed decisions',
    '| Decision | Value |',
    '|---|---|',
    '| test runner | vitest |',
    '## 3. Reference patterns',
    'src/math.js',
    '## 4. Inventory',
    'tests/math.test.js (crear).',
    '## 5. Interfaces',
    'Consumes: nothing. Produces: sum(a, b) -> number.',
    '## 6. Test strategy',
    'Unit con vitest.',
    '## 7. Tasks',
    '### Task 1 — cover sum',
    '**Objective:** sum queda cubierta.',
    '**Files:** tests/math.test.js',
    'No code — el test se describe por nombre y aserción.',
    '**TDD:** red first: expect(sum(2, 2)).toBe(4)',
    '**Tests:** add tests/math.test.js',
    ...verification,
    '## 8. Global verification',
    'N/A — fixture.',
    '## 9. Assumptions',
    'Ninguna.',
    '',
  ].join('\n')

  const rulesOf = (plan) => validatePlan(plan, { readFile: () => null })
    .violations.filter((v) => v.rule === 'verification')

  it('a task that verifies with inline prose does NOT pass the contract', () => {
    // This is exactly the shape of the real plan of repo-pulse's slice #5, and
    // the one the template asked for until this round.
    const plan = planWith(['**Verification:** `npm test` → exit 0. `npm run lint` → exit 0.'])
    expect(rulesOf(plan)).toHaveLength(1)
    expect(rulesOf(plan)[0].detail).toMatch(/no ejecuta prosa/)
  })

  it('the same task with the commands in a block does pass', () => {
    expect(rulesOf(planWith([
      '**Verification:** los dos en verde.',
      F + 'bash',
      'npm test   # exit 0',
      'npm run lint   # exit 0',
      F,
    ]))).toEqual([])
  })

  // Step 2 of the spec of the first run in somebody else's repo: the block can
  // be there and its commands measure the wrong way round. `--check-plan` is
  // the gate that let jjponz/rust-monitoring#10's inverted check through, so
  // the rule has to reach ALL THE WAY HERE and not stop at the extractor.
  it("rust-monitoring's inverted check, block and all, does NOT pass the contract", () => {
    const plan = planWith([
      '**Verification:** la sección protegida no se toca.',
      F + 'bash',
      "git diff HEAD -- AGENTS.md | grep -c 'ct-init:slices-contract'   # expected: 0",
      F,
    ])
    expect(rulesOf(plan)).toHaveLength(1)
    expect(rulesOf(plan)[0].detail).toMatch(/no puede afirmar lo que el control dice medir/)
  })

  it('the same check written as a predicate does pass', () => {
    expect(rulesOf(planWith([
      '**Verification:** la sección protegida no se toca.',
      F + 'bash',
      'test "$(git diff HEAD -- AGENTS.md | grep -c \'ct-init:slices-contract\')" -eq 0',
      F,
    ]))).toEqual([])
  })

  it('it accepts the block even if the **Verification:** paragraph carries prose in front', () => {
    expect(rulesOf(planWith([
      '**Verification:** primero `npm install`, y después:',
      F + 'bash',
      'npm test   # exit 0',
      F,
    ]))).toEqual([])
  })

  it("the task's Current state block does NOT count as a command block", () => {
    // Without the rule of "the IMMEDIATELY following block", a plan with any
    // loose fence in the task would pass, taking as verified a task whose
    // yardstick is still prose.
    const plan = planWith([
      '**Verification:** `npm test` → exit 0.',
      '',
      'Current state (src/math.js):',
      F,
      'export function sum(a, b) {',
      '}',
      F,
    ])
    expect(rulesOf(plan)).toHaveLength(1)
  })

  it('a plan with several tasks names which ones fail, not how many', () => {
    const plan = planWith(['**Verification:** `npm test` → exit 0.'])
      .replace('## 8. Global verification', [
        '### Task 2 — otra',
        '**Objective:** otra cosa.',
        '**Files:** tests/otra.test.js',
        'No code — descrito en prosa.',
        '**TDD:** No TDD — fixture.',
        '**Tests:** N/A — fixture.',
        '**Verification:** `npm test` otra vez, en prosa.',
        '## 8. Global verification',
      ].join('\n'))
    expect(rulesOf(plan).map((v) => v.detail.match(/tarea (\d+)/)[1])).toEqual(['1', '2'])
  })

  // §3.7-A of the handoff: the same pair of rules (block / predicate), applied
  // to "## 8. Global verification" instead of to a task's **Verification:**.
  // Both come out through `verification` in the gate, just like the task ones.
  const goodVerification = ['**Verification:** en verde.', F + 'bash', 'npm test   # exit 0', F]
  const withGlobal = (globalBlock) => planWith(goodVerification)
    .replace('## 8. Global verification\nN/A — fixture.', globalBlock)

  it('§8 in prose (not "N/A") is a "verification" violation', () => {
    const plan = withGlobal('## 8. Global verification\nQue todo siga en verde.')
    expect(rulesOf(plan)).toHaveLength(1)
    expect(rulesOf(plan)[0].detail).toMatch(/no ejecuta prosa/)
  })

  it('§8 with its command block is valid', () => {
    const plan = withGlobal(['## 8. Global verification', '', F + 'bash', 'npm run build && npm test', F].join('\n'))
    expect(rulesOf(plan)).toEqual([])
  })

  it('§8 whose last stretch is `grep -c` is a predicate violation', () => {
    const plan = withGlobal(['## 8. Global verification', '', F + 'bash', "grep -c 'algo' AGENTS.md", F].join('\n'))
    expect(rulesOf(plan)).toHaveLength(1)
    expect(rulesOf(plan)[0].detail).toMatch(/no puede afirmar lo que el control dice medir/)
  })
})

// ---------------------------------------------------------------------------
// §3 IS THE REPO'S YARDSTICK, AND A YARDSTICK THAT DOES NOT EXIST DOES NOT
// MEASURE.
//
// `## 3. Reference patterns` stopped being just "files to look like": it is the
// only thing in the plan that tells the implementer how things are written here
// and tells the judge what to block against. And it is written by an AGENT,
// which may cite `docs/conventions/domain.md` because it sounds to it like a
// repo of that kind would have one — and then neither of the two opens anything
// and both carry on as if they had measured. Same rule as `Current state`'s
// literality, applied to the other class of citation: there the cited text
// exists verbatim, here the file exists.
// ---------------------------------------------------------------------------
describe('validatePlan — the §3 paths exist', () => {
  const withSection3 = (content) => VALID_PLAN.replace('## 3. Reference patterns\nsrc/math.js', `## 3. Reference patterns\n${content}`)

  it('a real path between backticks passes', () => {
    expect(violationsOf(withSection3('Files to imitate: `src/math.js`'), 'reference-paths')).toEqual([])
  })

  it('a path the repo does not have fails, and the message names it', () => {
    const v = violationsOf(withSection3('Rules to obey: `docs/conventions/domain.md`'), 'reference-paths')
    expect(v).toHaveLength(1)
    expect(v[0].detail).toMatch(/docs\/conventions\/domain\.md/)
  })

  it('AGENTS.md counts as a path even without a slash: it is the most likely place for the yardstick', () => {
    expect(violationsOf(withSection3('Rules to obey: `AGENTS.md`'), 'reference-paths')).toHaveLength(1)
  })

  it('a skill is not checked on disk: it is not a file of the repo', () => {
    // It carries a colon and no slash. If it were treated as a path, every
    // skill cited would veto the plan and the secondary yardstick would be
    // impossible to declare.
    expect(violationsOf(withSection3('Rules to obey: `backend-engineering:backend-best-practices`'), 'reference-paths')).toEqual([])
  })

  it('a token that is not a path is not looked at', () => {
    // §3 describes idioms, and describing them demands citing code: `test(...)`
    // and `describe` are technical prose, not files.
    expect(violationsOf(withSection3('Files to imitate: `src/math.js` — tests planos con `test(...)`, sin `describe`'), 'reference-paths')).toEqual([])
  })

  it('a directory is skipped: the only port this module receives reads files', () => {
    expect(violationsOf(withSection3('Rules to obey: `docs/conventions/`'), 'reference-paths')).toEqual([])
  })

  it('the rule is scoped to §3: in the rest of the plan there are paths the slice is going to create', () => {
    // Demanding that they exist outside §3 would veto every plan: `## 4.
    // Inventory` names precisely the files the slice creates.
    const plan = VALID_PLAN.replace('src/math.js (modificar), tests/math.test.js (crear).', '`src/aun-no-existe.js` (crear).')
    expect(violationsOf(plan, 'reference-paths')).toEqual([])
  })

  it('with no readFile injected it is neither asserted nor denied, just like literality', () => {
    const r = validatePlan(withSection3('Rules to obey: `docs/conventions/domain.md`'), {})
    expect(r.violations.filter((v) => v.rule === 'reference-paths')).toEqual([])
  })
})
