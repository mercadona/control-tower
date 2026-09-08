// The plan read as an EXECUTABLE task list (scripts/plan-tasks.js).
//
// The main fixture is NOT the template: it is the REAL plan of slice #5 of
// repo-pulse, 534 lines and 8 tasks, exactly as a dispatched agent wrote it.
// That is deliberate — not one of the three traps this parser dodges appears in
// `plan-template.md`, so a test against the template would go green with a
// broken parser.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractTasks, stripParenthesised } from '../scripts/plan-tasks.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8')

// Three backticks at runtime, as in plan-contract.test.js: no line of this
// file may start with a real fence.
const F = '```'

// The real plan exactly as it was written: its **Verification:** is inline prose.
const REAL = fixture('plan-real-issue-5.md')
// The same plan with the commands already in a block, which is what the new
// rule of the contract asks of the plans from now on.
const EXECUTABLE = fixture('plan-real-issue-5-ejecutable.md')

const taskOf = (plan, n) => extractTasks(plan).tasks.find((t) => t.n === n)

describe('the tasks of the plan', () => {
  it('it finds the eight tasks of the real plan, numbered and named', () => {
    const { tasks } = extractTasks(REAL)
    expect(tasks.map((t) => t.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(tasks[0].name).toBe('el entorno de test DOM y el proxy de dev')
  })

  it('a text with no tasks says so instead of returning an empty list and keeping quiet', () => {
    const { tasks, problems } = extractTasks('# un plan sin tareas\n')
    expect(tasks).toEqual([])
    expect(problems.map((p) => p.rule)).toContain('tasks')
  })
})

// ---------------------------------------------------------------------------
// TRAP 1 — the commands live in the fenced block, not on the line
// ---------------------------------------------------------------------------
describe('the yardstick of the task: the block of commands', () => {
  it('it takes the commands out of the block that goes after **Verification:**', () => {
    expect(taskOf(EXECUTABLE, 2).commands).toEqual([
      'npm test -w web   # exit 0',
      'npm run build && npm run lint   # exit 0',
    ])
  })

  it('it accepts the block even when the **Verification:** paragraph carries inline text in front', () => {
    // Task 1 of the real plan says: "**Verification:** `npm install` y después:"
    // and only then opens the block.
    expect(taskOf(REAL, 1).commands).toEqual([
      'npm test -w web   # exit 0, 1 test',
      'npm run build && npm run lint   # exit 0',
    ])
  })

  it('it accepts the block even when the **Verification:** paragraph spans two lines', () => {
    // Task 8 of the real plan spans two lines before the paragraph ends.
    expect(taskOf(EXECUTABLE, 8).commands).toEqual([
      'npm test && npm run lint && npm run build   # exit 0',
      'test "$(wc -l < AGENTS.md)" -le 150',
    ])
  })

  it('it does NOT confuse the block of commands with the Contract and Current state blocks of the task', () => {
    // Real tasks carry their own fences of quoted code. Only the one that goes
    // immediately after **Verification:** counts, and that is why no task of
    // the executable plan brings TypeScript among its commands.
    for (const t of extractTasks(EXECUTABLE).tasks) {
      expect(t.commands.every((c) => /^(npm|test|git|node|npx)\b/.test(c))).toBe(true)
    }
  })

  it('the REAL plan is not executable: seven of its eight tasks verify with prose', () => {
    // This is the measurement that justifies the new rule of the contract. The
    // real plan is faithful to `plan-template.md` ("**Verification:** {{exact
    // command and expected output}}", inline), and even so no program can
    // execute it.
    const { problems } = extractTasks(REAL)
    const withoutBlock = problems.filter((p) => p.rule === 'verification-block')
    expect(withoutBlock.map((p) => p.task)).toEqual([2, 3, 4, 5, 6, 7, 8])
  })

  it('the same plan with the commands in a block does not have a single problem', () => {
    expect(extractTasks(EXECUTABLE).problems).toEqual([])
  })

  it('an empty block of commands is a problem, not a task without a yardstick', () => {
    const plan = [
      '### Task 1 — vacía',
      '**Tests:** N/A — nada.',
      '**Verification:**',
      '',
      F + 'bash',
      F,
    ].join('\n')
    const { tasks, problems } = extractTasks(plan)
    expect(tasks[0].commands).toEqual([])
    expect(problems.map((p) => p.rule)).toContain('verification-block')
  })
})

// ---------------------------------------------------------------------------
// TRAP 2 — the parentheses are swept BY DEPTH
// ---------------------------------------------------------------------------
describe('the test names', () => {
  it('the explanatory parenthesis with parentheses inside does not sneak in a false test name', () => {
    // The real plan, task 6:
    //   'a zero series sits on the baseline' (polylinePoints([0, 0], 1) es
    //   '0.0,199.0 600.0,199.0')
    // With a single-level sweep, `0.0,199.0 600.0,199.0` goes in as a test
    // name, exists in no file and blocks the task with a false positive.
    const t6 = taskOf(REAL, 6)
    expect(t6.testsAdded).toEqual([
      'both series share one scale',
      'a zero series sits on the baseline',
      'the area closes on the baseline',
      'the pulse draws the previous window behind the current one',
      'on the full window there is no overlay',
    ])
    expect(t6.testsAdded).not.toContain('0.0,199.0 600.0,199.0')
  })

  it('the single-level sweep —the one that does NOT hold— would let the false name through', () => {
    // The proof that the trap is real and not an imaginary precaution.
    const line = "'a zero series sits on the baseline' (polylinePoints([0, 0], 1) es '0.0,199.0 600.0,199.0')"
    const oneLevel = line.replace(/\([^()]*\)/g, '')
    expect(oneLevel).toContain('0.0,199.0 600.0,199.0')
    expect(stripParenthesised(line)).not.toContain('0.0,199.0 600.0,199.0')
  })

  it('what goes between backticks with no single quotes are identifiers, not tests', () => {
    // Task 2 mentions `window=all` and task 6 mentions `pulse-previous`.
    expect(taskOf(REAL, 2).testsAdded).not.toContain('window=all')
    expect(taskOf(REAL, 6).testsAdded).not.toContain('pulse-previous')
    expect(taskOf(REAL, 2).testsAdded).toEqual([
      'lists the clones',
      'asks the summary for the window it is given',
      'surfaces the code of the error envelope',
      'a body that is not the envelope is internal',
    ])
  })

  it('it joins up the **Tests:** line when it spans several lines', () => {
    expect(taskOf(REAL, 3).testsAdded).toHaveLength(5)
    expect(taskOf(REAL, 3).testsAdded).toContain('a day ago reads hace 1 día')
  })

  it('"N/A — <reason>" is a legitimate declaration: it neither adds nor removes', () => {
    for (const n of [4, 8]) {
      expect(taskOf(REAL, n).testsAdded).toEqual([])
      expect(taskOf(REAL, n).testsRemoved).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// TRAP 3 — the removal marker has three forms
// ---------------------------------------------------------------------------
describe('the tests the task removes on purpose', () => {
  it('it splits on "retira a propósito" (the form of the real plan)', () => {
    const t1 = taskOf(REAL, 1)
    expect(t1.testsAdded).toEqual(['renders the app title in a DOM'])
    expect(t1.testsRemoved).toEqual(['App exporta un componente de React'])
  })

  it('it splits on "removed on purpose:" (the form of the template, in English)', () => {
    const plan = [
      '### Task 1 — dos formas',
      "**Tests:** added `'el que entra'`; removed on purpose: `'el que sale'`",
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const t = extractTasks(plan).tasks[0]
    expect(t.testsAdded).toEqual(['el que entra'])
    expect(t.testsRemoved).toEqual(['el que sale'])
  })

  it('it splits on a bare "retira"', () => {
    const plan = [
      '### Task 1 — forma corta',
      "**Tests:** añade `'el que entra'`; retira `'el que sale'`",
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const t = extractTasks(plan).tasks[0]
    expect(t.testsAdded).toEqual(['el que entra'])
    expect(t.testsRemoved).toEqual(['el que sale'])
  })

  it('with no removal marker, every name is an addition', () => {
    expect(taskOf(REAL, 2).testsRemoved).toEqual([])
  })

  it('a test one task removes may have been added by an earlier one', () => {
    // Task 5 of the real plan removes the test task 1 added. If the marker did
    // not split, that name would go into the list of the ones that MUST exist
    // after task 5: exactly the opposite of what is right.
    expect(taskOf(REAL, 1).testsAdded).toContain('renders the app title in a DOM')
    expect(taskOf(REAL, 5).testsRemoved).toContain('renders the app title in a DOM')
    expect(taskOf(REAL, 5).testsAdded).not.toContain('renders the app title in a DOM')
  })
})

// ---------------------------------------------------------------------------
// THE PATHS THE PLAN DECLARES — **Files:**
// ---------------------------------------------------------------------------
describe('the paths the task declares in **Files:**', () => {
  it('it reads the paths of **Files:** with their action', () => {
    // Task 1 of the executable plan:
    //   **Files:** `web/package.json` (modify), `web/vite.config.ts` (modify),
    //   `web/src/testing/setup.ts` (create), `web/src/App.test.tsx` (modify)
    expect(taskOf(EXECUTABLE, 1).files).toEqual([
      { path: 'web/package.json', action: 'modify' },
      { path: 'web/vite.config.ts', action: 'modify' },
      { path: 'web/src/testing/setup.ts', action: 'create' },
      { path: 'web/src/App.test.tsx', action: 'modify' },
    ])
  })

  it('a path with no declared action is left at null', () => {
    const plan = [
      '### Task 1 — sin acción',
      '**Files:** `web/src/App.test.tsx`',
      '**Tests:** N/A — nada.',
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const t = extractTasks(plan).tasks[0]
    expect(t.files).toEqual([{ path: 'web/src/App.test.tsx', action: null }])
  })

  it('an action that is neither "create" nor "modify" also leaves the path at null', () => {
    // `declaredScope`, in ct-step.mjs, only has branches for 'create' and
    // 'modify'. A different value ("renombra", a typo, whatever it is) must not
    // sneak through as it is: it is treated as if no action had been declared.
    const plan = [
      '### Task 1 — acción rara',
      '**Files:** `web/src/App.test.tsx` (renombra)',
      '**Tests:** N/A — nada.',
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const t = extractTasks(plan).tasks[0]
    expect(t.files).toEqual([{ path: 'web/src/App.test.tsx', action: null }])
  })

  it('a **Files:** paragraph with text that yields no path at all is a problem of the plan', () => {
    // The wrong format (with no backticks): `splitFiles` extracts nothing, and
    // without this warning `declaredScope` would report ALL the paths
    // touched as out of scope without saying why.
    const plan = [
      '### Task 1 — sin backticks',
      '**Files:** uno.txt (create)',
      '**Tests:** N/A — nada.',
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const { tasks, problems } = extractTasks(plan)
    expect(tasks[0].files).toEqual([])
    expect(problems.map((p) => p.rule)).toContain('files-line')
  })

  it('the two real plans are still without a single "files-line" problem', () => {
    expect(extractTasks(REAL).problems.map((p) => p.rule)).not.toContain('files-line')
    expect(extractTasks(EXECUTABLE).problems.map((p) => p.rule)).not.toContain('files-line')
  })
})

// ---------------------------------------------------------------------------
// THE TEST NAME THAT **TDD:** DECLARES
// ---------------------------------------------------------------------------
describe('the name of the test that **TDD:** declares', () => {
  it('it reads the name of the test that **TDD:** declares', () => {
    // Task 1 of the executable plan: **TDD:** `test('renders the app title in a DOM')` — ...
    expect(taskOf(EXECUTABLE, 1).tddName).toBe('renders the app title in a DOM')
  })

  it('a No TDD declares no test at all', () => {
    // Task 4 says "No TDD — son los tokens de marca..." and task 8 "No TDD — es documentación.
    expect(taskOf(EXECUTABLE, 4).tddName).toBeNull()
    expect(taskOf(EXECUTABLE, 8).tddName).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// THE ROLE LABELS OF THE BLOCKS — Current state / Contract / Call site / Final text
// ---------------------------------------------------------------------------
describe('the role labels of the blocks of the task', () => {
  it('it reads the files each role label names', () => {
    expect(taskOf(EXECUTABLE, 5).blockPaths).toEqual([
      { role: 'Current state', path: 'web/src/App.tsx' },
      { role: 'Contract', path: 'web/src/Header.tsx' },
    ])
    expect(taskOf(EXECUTABLE, 4).blockPaths).toEqual([
      { role: 'Contract', path: 'web/src/tokens.css' },
      { role: 'Call site', path: 'web/src/main.tsx' },
    ])
    expect(taskOf(EXECUTABLE, 8).blockPaths).toEqual([
      { role: 'Current state', path: 'AGENTS.md' },
      { role: 'Final text', path: 'AGENTS.md' },
    ])
  })

  it('it reads the literal text of a Final text block', () => {
    const plan = [
      '### Task 1 — reescribe una nota',
      '**Files:** `docs/nota.md` (modify)',
      'Final text (docs/nota.md):',
      '',
      F + 'md',
      'primera línea',
      'segunda línea',
      F,
      '**TDD:** No TDD — es documentación.',
      '**Tests:** N/A — no hay código nuevo.',
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const t = extractTasks(plan).tasks[0]
    expect(t.finalTexts).toEqual([{ path: 'docs/nota.md', text: 'primera línea\nsegunda línea' }])
  })

  it('it extracts whole, untrimmed, the Final text (AGENTS.md) of task 8 of the real plan', () => {
    // The only test of finalTexts so far was a synthetic markdown of two
    // lines. Task 8 of the real plan is the real case: multi-line, with
    // backticks inside the text itself.
    const t8 = taskOf(EXECUTABLE, 8)
    expect(t8.finalTexts).toEqual([
      {
        path: 'AGENTS.md',
        text: [
          '## Frontera `web/` ↔ `server/`',
          'Las abrió el esqueleto (#1) y las cerró el primer slice de UI (#5):',
          '- **En dev, `web/` llega al server por el proxy** — `web/vite.config.ts` encamina',
          '  `/api` a `http://127.0.0.1:3000`. El server no lleva CORS y no debe llevarlo:',
          '  la foto de los repos locales no sale de `127.0.0.1`.',
          '- **`web/` NO importa de `server/`** — los tipos del payload se declaran en',
          '  `web/src/api/types.ts`. Un tipo importado del server puede arrastrar campos de',
          '  autor hasta el DOM, y eso es justo lo que no puede pasar.',
        ].join('\n'),
      },
    ])
  })
})

// Step 2 of the spec of the first run in somebody else's repo: THE YARDSTICK
// HAS TO BE ABLE TO MEASURE WHAT IT SAYS IT MEASURES.
//
// `verification-block` (5b97fdd) closed "the verification is prose". The hole
// right next to it is left, measured in jjponz/rust-monitoring#10: the
// verification is an executable command, it is in its block, and its exit code
// says the OPPOSITE of what its comment says it measures. `ct-step controls`
// scores only by exit code, and `grep -c` exits with 1 when it finds nothing
// and with 0 when it finds something: that check could only go green in the BAD
// case. No implementation could pass it, and it passed `--check-plan` and it
// passed the human gate.
//
// The rule does not guess intentions: it names a closed list of last stages
// whose exit code is DEMONSTRABLY independent of what the plan claims, and for
// each one it says how the equivalent predicate is written.
describe('the yardstick has to be able to measure what it says it measures (verification-predicate)', () => {
  const planWith = (commands) => [
    '### Task 1 — una tarea',
    '',
    '**Objective:** algo.',
    '',
    '**Files:** `a.js` (modify)',
    '',
    '**TDD:** No TDD — configuración.',
    '',
    '**Tests:** N/A — configuración.',
    '',
    '**Verification:** los comandos.',
    '',
    `${F}bash`,
    ...commands,
    F,
    '',
  ].join('\n')

  const rules = (commands) => extractTasks(planWith(commands)).problems.filter((p) => p.rule === 'verification-predicate')

  it('the inverted check of rust-monitoring, verbatim: `grep -c` closing the pipeline', () => {
    const r = rules(["git diff HEAD -- AGENTS.md | grep -c 'ct-init:slices-contract'   # expected: 0"])
    expect(r).toHaveLength(1)
    expect(r[0].detail).toMatch(/grep -c/)
    expect(r[0].detail).toMatch(/test "\$\(/)
  })

  it('`grep -c` without a pipeline does not hold either: its exit code says "I found something", never how many', () => {
    expect(rules(["grep -c '^      - run: cargo ' .github/workflows/ci.yml   # expected: 4"])).toHaveLength(1)
  })

  it('the fix DOES validate: the predicate that wraps the count, with its pipeline inside `$(...)`', () => {
    expect(rules(['test "$(git diff HEAD -- AGENTS.md | grep -c \'ct-init:slices-contract\')" -eq 0'])).toEqual([])
  })

  it('the case of slice 35 of repo-pulse, verbatim: `grep -c` with TWO files inside the predicate', () => {
    const r = rules(['test "$(grep -c \'Cargando…\' web/src/App.tsx web/src/App.test.tsx)" -eq 0'])
    expect(r).toHaveLength(1)
    expect(r[0].detail).toMatch(/dos o más ficheros/)
    expect(r[0].detail).toMatch(/grep -l/)
  })

  it('one file inside the predicate is the good form and still validates', () => {
    expect(rules(['test "$(grep -c \'^test(\' web/src/screen.test.ts)" -eq 7'])).toEqual([])
  })

  it('the boundary is two: with one it holds, with two it does not, and it makes no difference whether the count is zero or seven', () => {
    expect(rules(['test "$(grep -c \'x\' a.ts)" -eq 7'])).toEqual([])
    expect(rules(['test "$(grep -c \'x\' a.ts b.ts)" -eq 7'])).toHaveLength(1)
    expect(rules(['test "$(grep -c \'x\' a.ts b.ts c.ts)" -eq 0'])).toHaveLength(1)
  })

  it('a `grep -c` after a pipeline, over what arrives on stdin, has no files to count', () => {
    expect(rules(['test "$(git diff --name-only | grep -c \'web/src/App.tsx\')" -eq 1'])).toEqual([])
  })

  it('the substitution IS split by pipeline before counting: unsplit, the stage in front would confuse the count', () => {
    expect(rules(['test "$(cat a.ts | grep -c \'x\' b.ts c.ts)" -eq 0'])).toHaveLength(1)
  })

  it('the patterns of `-e` are not counted as files, or two patterns and one file would look like two files', () => {
    expect(rules(['test "$(grep -c -e p1 -e p2 a.ts)" -eq 0'])).toEqual([])
    expect(rules(['test "$(grep -c -e p1 a.ts b.ts)" -eq 0'])).toHaveLength(1)
  })

  it('the flags of grep are not mistaken for files', () => {
    expect(rules(['test "$(grep -cE \'a|b\' --color=never web/src/screen.ts)" -eq 0'])).toEqual([])
  })

  it('a redirection after the file does not count as a second file', () => {
    expect(rules(['test "$(grep -c \'x\' a.ts 2>/dev/null)" -eq 0'])).toEqual([])
    expect(rules(['test "$(grep -c \'x\' a.ts 2>&1)" -eq 0'])).toEqual([])
  })

  it('the argument of a flag that takes a value (`-m N`) is not counted as a file', () => {
    expect(rules(['test "$(grep -c -m 1 \'x\' a.ts)" -eq 0'])).toEqual([])
  })

  it('a quoted pattern with a space inside is still ONE operand, not two', () => {
    expect(rules(['test "$(grep -c \'dos palabras\' a.ts)" -eq 0'])).toEqual([])
  })

  it('a pattern with a parenthesis inside and two real files is still accused', () => {
    expect(rules(['test "$(grep -c \'a)b\' a.ts b.ts)" -eq 0'])).toHaveLength(1)
  })

  it('a `$(...)` that is literal text inside single quotes is not read as a real substitution', () => {
    expect(rules(["grep -Fq '$(grep -c mark a.ts b.ts)' incidencias.md"])).toEqual([])
  })

  it('a `$(...)` inside double quotes IS expanded, because in that quote the shell expands it too', () => {
    expect(rules(['test -n "$(grep -c \'x\' a.ts b.ts)"'])).toHaveLength(1)
  })

  it('`rg -c` and `grep --count` with two files are caught by the SAME decision that catches `grep -c`, not by a copy that can drift away', () => {
    expect(rules(['test "$(rg -c \'x\' a.ts b.ts)" -eq 0'])).toHaveLength(1)
    expect(rules(['test "$(grep --count \'x\' a.ts b.ts)" -eq 0'])).toHaveLength(1)
  })

  it('double quotes that close stop suppressing, and a single one that opens right after DOES suppress what it carries inside', () => {
    expect(rules(['grep -Fq "prefix" \'$(grep -c mark a.ts b.ts)\' incidencias.md'])).toEqual([])
  })

  it('single quotes that close stop suppressing, and a real substitution that comes afterwards IS inspected', () => {
    expect(rules(['grep -Fq \'note\' "$(grep -c \'x\' a.ts b.ts)" file.md'])).toHaveLength(1)
  })

  it('`grep -q` and the bare `grep` are not touched: there the exit code IS the assertion', () => {
    expect(rules(["grep -q 'cargo clippy' AGENTS.md"])).toEqual([])
    expect(rules(["grep 'cargo clippy' AGENTS.md"])).toEqual([])
  })

  it('`wc` is never a check: it exits with 0 with twelve lines and with twelve thousand — and the real plan carries one', () => {
    expect(rules(['wc -l AGENTS.md'])).toHaveLength(1)
  })

  it('`| tail` closes the pipeline with the exit code of tail, not with that of the command that matters', () => {
    expect(rules(['make check 2>&1 | tail -80'])).toHaveLength(1)
    // On its own, over a file, it does assert something (that the file can be read).
    expect(rules(['tail -5 CHANGELOG.md'])).toEqual([])
  })

  it('`git status` exits with 0 with the tree dirty and with the tree clean', () => {
    expect(rules(['git status --short   # expected: vacío'])).toHaveLength(1)
  })

  it('a `#` or a `|` between quotes are neither a comment nor a pipeline', () => {
    expect(rules(["grep -c '#ct-init' AGENTS.md"])).toHaveLength(1)
    expect(rules(['grep -q "a|b" AGENTS.md'])).toEqual([])
  })

  it('with `&&`, `||` or `;` it does not pronounce: the exit code depends on what got to run', () => {
    expect(rules(['npm test && npm run lint && npm run build   # exit 0'])).toEqual([])
    expect(rules(['cargo test || wc -l x'])).toEqual([])
  })

  it('the real executable plan is still without problems, with its `wc -l` turned into a predicate', () => {
    expect(extractTasks(EXECUTABLE).problems).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// §3.7-A OF THE HANDOFF — "## 8. Global verification" HAS TO BE EXECUTABLE
// TOO. `ct-step` did not execute a single line of this section; this is what
// turns it into a list of commands, with the same yardstick that already
// measures the per-task block.
// ---------------------------------------------------------------------------
describe('the Global verification belongs to the program (§3.7-A)', () => {
  const withTaskAnd = (globalBlock) => [
    '### Task 1 — una tarea',
    '**Objective:** algo.',
    '**Files:** `a.js` (modify)',
    '**TDD:** No TDD — fixture.',
    '**Tests:** N/A — fixture.',
    '**Verification:** ok.',
    F + 'bash',
    'npm test',
    F,
    '',
    ...globalBlock,
    '',
  ].join('\n')

  it('it extracts the commands of the first fence of §8, with prose before and after', () => {
    const plan = withTaskAnd([
      '## 8. Global verification',
      '',
      'Con todo comiteado, desde la raíz:',
      '',
      F + 'bash',
      'npm run build && npm test',
      F,
      '',
      'Para el gate humano: revisa que la UI siga igual.',
    ])
    const { global, problems } = extractTasks(plan)
    expect(global.commands).toEqual(['npm run build && npm test'])
    expect(problems.filter((p) => p.rule.startsWith('global-verification'))).toEqual([])
  })

  it('"N/A — <reason>" leaves the global with no commands and no problem', () => {
    const plan = withTaskAnd(['## 8. Global verification', '', 'N/A — no hay punta a punta que correr.'])
    const { global, problems } = extractTasks(plan)
    expect(global.commands).toEqual([])
    expect(problems.filter((p) => p.rule.startsWith('global-verification'))).toEqual([])
  })

  it('a §8 in prose, with no block of commands, is a problem', () => {
    const plan = withTaskAnd(['## 8. Global verification', '', 'Que todo siga en verde.'])
    const { global, problems } = extractTasks(plan)
    expect(global.commands).toEqual([])
    expect(problems.map((p) => p.rule)).toContain('global-verification-block')
  })

  it('a plan with no "## 8." brings the same problem', () => {
    const plan = withTaskAnd([])
    const { global, problems } = extractTasks(plan)
    expect(global.commands).toEqual([])
    expect(problems.map((p) => p.rule)).toContain('global-verification-block')
  })

  it('a §8 whose last stage is `wc -l` is a predicate problem, just as in a task', () => {
    const plan = withTaskAnd(['## 8. Global verification', '', F + 'bash', 'wc -l AGENTS.md', F])
    const { problems } = extractTasks(plan)
    expect(problems.map((p) => p.rule)).toContain('global-verification-predicate')
  })

  it('a §8 with a `grep -c` over two files is a predicate problem too: the rule of slice 35 is not only for the tasks', () => {
    const plan = withTaskAnd([
      '## 8. Global verification', '', F + 'bash', 'test "$(grep -c \'x\' a.ts b.ts)" -eq 0', F,
    ])
    const { problems } = extractTasks(plan)
    expect(problems.map((p) => p.rule)).toContain('global-verification-predicate')
  })

  it('§8 also splits its words respecting quotes: a `-c` inside a literal does not confuse the head rule', () => {
    const plan = withTaskAnd([
      '## 8. Global verification', '', F + 'bash',
      "grep -Fq '$(grep -c mark a.ts b.ts)' incidencias.md", F,
    ])
    const { problems } = extractTasks(plan)
    expect(problems.map((p) => p.rule)).not.toContain('global-verification-predicate')
  })

  it('the real fixture extracts the single command of its Global verification', () => {
    const { global } = extractTasks(EXECUTABLE)
    expect(global.commands).toEqual(['npm run build && npm test && npm run lint   # exit 0'])
  })
})
