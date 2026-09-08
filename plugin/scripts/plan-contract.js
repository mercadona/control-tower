// ============================================================================
// PLAN-CONTRACT — the contract of a slice's prescriptive plan.
//
// The plan the dispatched agent writes (writing-plans-prescriptive) is the
// artefact that crosses the boundary towards the per-task subagents: if it lies
// —missing sections, code quoted from memory that does not exist in the repo,
// unfilled placeholders— the subagents execute it all the same, because they
// have no context with which to doubt. This module turns that prose contract
// into a check, with the same doctrine as the rest of the plugin: a check that
// only prints is not a check.
//
// The piece that has no equivalent anywhere else in the plugin is LITERALITY:
// every `Current state (path):` block of the plan must exist verbatim in the
// file it quotes. It is the detector of code quoted from memory — failure mode
// number one of a plan written by an agent.
//
// A PURE module on purpose (same reason as gates.js/slices.js): all the logic is
// testable with no harness; the I/O comes in by injection (`readFile`) and
// whoever wires it up (dispatch-check.mjs) supplies the real filesystem.
// ============================================================================

import { extractTasks } from './plan-tasks.js'

const BLOCKQUOTE_MARKER = 'This plan is written to be executed by task-scoped subagents'

export const PLAN_SECTIONS = [
  '## 1. Context and goal',
  '## 2. Closed decisions',
  '## 3. Reference patterns',
  '## 4. Inventory',
  '## 5. Interfaces',
  '## 6. Test strategy',
  '## 7. Tasks',
  '## 8. Global verification',
  '## 9. Assumptions',
]

const SUBSECTIONS = ['### Desired end state', '### Out of scope']

const TASK_MARKERS = ['**Objective:**', '**Files:**', '**TDD:**', '**Tests:**', '**Verification:**']

// Tokens that give away an open decision or a placeholder. They are looked for
// only OUTSIDE the code blocks: a plan can legitimately quote a file whose
// content says any of these things.
const FORBIDDEN = [
  [/\bTBD\b/, 'TBD'],
  [/TODO:/, 'TODO:'],
  [/\bFIXME\b/, 'FIXME'],
  [/similar to Task/i, '"similar to Task N" (repite el contenido)'],
  [/to be decided/i, '"to be decided"'],
  [/<!--/, 'comentario HTML sin resolver'],
  [/(^|[^$])\{\{/, 'placeholder {{...}} sin rellenar'],
]

const TASK_HEADING = /^### Task (\d+) — /
const CURRENT_STATE = /^Current state \(([^),]+)(?:,[^)]*)?\):\s*$/

// ============================================================================
// F-jjponz-4 — THE TAXONOMY OF BLOCKS.
//
// The first version of the skill ordered pasting "the complete final content" of
// every file. Measured in the field (slice #2 of repo-pulse): 73,868 characters
// of plan, 1,271 lines of code (65%), published split across TWO comments
// because it did not fit in one; and of its 14 commits, FIVE fixed defects that
// came pasted in the plan — a directory leak, a bare `catch` that swallowed real
// git failures, an exported type that leaked emails, a documentation text that
// asserted something false and four test vectors that did not poke the threshold
// they claimed to poke. A body written blind, with no compiler and without
// running anything, arrives with defects and nobody sees them: the human `plan`
// gate that was supposed to catch them had 74k characters to review.
//
// Why the role and not a line limit: a raw cap would reject a legitimate types
// file (the largest measured, 71 lines) and accept a 25-line body. What gets
// checked is WHAT each block is. That way the mechanical rejection coincides
// with the semantic criterion —the plan closes DECISIONS and leaves the BODIES
// to TDD— and along the way the human reads the plan as an index of roles.
// ============================================================================

// ONE A4 PAGE PER TASK: single-spaced and with normal margins, a page gives
// about 50 lines and ~3,500 characters. The unit is the TASK, not the plan, and
// the reason is a field measurement (F-jjponz-5).
//
// The first version put the page on the whole plan. Result, measured over the
// transcripts of the dispatched sessions: the agent invoked `--check-plan` 24
// times in one slice and 14 in another, and of those, 14 and 9 failed on `size`.
// Which is to say that most of those round trips were not thinking about the
// slice: they were filing characters down. And the way out the design assumed
// —«if it does not fit, the slice is two»— the agent CANNOT act on: it comes
// dispatched for a frozen issue, so it did the only thing it could, collapse
// tasks (one slice ended up being a commit with four endpoints and four modules,
// exactly what «one task = one commit» is meant to avoid).
//
// A TASK the agent CAN split. That is why the ceiling goes where the remedy is
// actionable, and there is no aggregate cap per plan: a twelve-task plan is a
// badly cut slice, and that gets fixed at the spec's freeze, which is where
// there is a human.
export const ROLE_BUDGETS = { 'Current state': 12, Contract: 25, 'Call site': 10, 'Final text': 12 }
export const COMMAND_BUDGET = 8
export const CODE_BUDGETS = { task: 30, chars: 3500 }

const ROLE_LABELS = [
  ['Current state', CURRENT_STATE],
  ['Contract', /^Contract \(([^),]+)(?:,[^)]*)?\):\s*$/],
  ['Call site', /^Call site \(([^),]+)(?:,[^)]*)?\):\s*$/],
  ['Final text', /^Final text \(([^),]+)(?:,[^)]*)?\):\s*$/],
]

const ROLE_MENU =
  'Todo bloque va precedido por una de estas cuatro etiquetas: "Current state (path):" (el ' +
  'tramo de hoy, que se comprueba verbatim), "Contract (path):" (tipos, firmas, errores ' +
  'tipados y constantes que el implementador no puede deducir), "Call site (path):" (cómo ' +
  'queda la llamada en el consumidor) o "Final text (path.md):" (texto cuyo valor literal ES ' +
  'el entregable). Los comandos van con su lenguaje (```bash) o detrás de **Verification:**. ' +
  'Un cuerpo de módulo no tiene etiqueta porque no va en el plan: lo escribe el implementador, ' +
  'en rojo primero.'

const TEXT_EXTENSIONS = ['.md', '.txt', '.rst', '.adoc']
const CONFIG_EXTENSIONS = ['.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.lock', '.properties', '.env']
const CONFIG_BASENAMES = ['.gitignore', '.dockerignore', '.npmrc', '.editorconfig', 'Dockerfile', 'Makefile']
const TEST_PATH = /(\.|_)(test|spec)\.|(^|\/)(__tests__|tests?)\//
const COMMAND_LANGS = new Set(['bash', 'sh', 'shell', 'console', 'zsh'])
const NO_CODE = /^No code — .+/

const ends = (path, list) => list.some((ext) => path.toLowerCase().endsWith(ext))
const isText = (path) => ends(path, TEXT_EXTENSIONS)

// Whether a backticked token of §3 is a repo path that has to be checked. See
// the long why next to the `reference-paths` rule, at the end of validatePlan.
const esRutaCitada = (t) => !t.endsWith('/') && !/\s/.test(t) && (t.includes('/') || isText(t))
const isTest = (path) => TEST_PATH.test(path)
const isConfig = (path) =>
  ends(path, CONFIG_EXTENSIONS) || CONFIG_BASENAMES.includes(path.split('/').pop())

function roleOf(line) {
  for (const [rol, re] of ROLE_LABELS) {
    const m = re.exec(line)
    if (m) return { rol, path: m[1].trim() }
  }
  return null
}

const BUDGET_REMEDY = {
  'Current state': 'cita solo el tramo que cambia y acótalo en la etiqueta: "Current state (path, lines 40-58):".',
  Contract: 'un contrato son declaraciones: tipos, firmas, errores tipados y constantes no deducibles. Si no cabe, lo que estás pegando es un cuerpo: quítalo y deja la firma — el cuerpo lo escribe el implementador con el test delante.',
  'Call site': 'el call site es la llamada, no el consumidor entero: deja las líneas que cambian, antes → después.',
  'Final text': 'parte el reemplazo en tramos, cada uno con su "Current state (path, lines A-B):".',
}

function bodyAtFence(lines, openIdx) {
  const body = []
  for (let j = openIdx + 1; j < lines.length; j++) {
    if (lines[j].fence) return body
    body.push(lines[j].line)
  }
  return null
}

const langAt = (line) => line.slice(3).trim().toLowerCase()

// Annotates every line with whether it is structural (outside a fence) — the
// only markdown parsing this contract needs. A fence opens and closes with a
// line that STARTS with three backticks, as in the rest of the repo's parsers.
function annotate(markdown) {
  const out = []
  let inFence = false
  for (const line of String(markdown).split('\n')) {
    if (line.startsWith('```')) {
      out.push({ line, structural: false, fence: true, opens: !inFence })
      inFence = !inFence
      continue
    }
    out.push({ line, structural: !inFence, fence: false, opens: false })
  }
  return out
}

function fenceBodyAfter(lines, from) {
  let i = from
  while (i < lines.length && lines[i].line.trim() === '') i++
  if (i >= lines.length || !lines[i].fence || !lines[i].opens) return null
  const body = []
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].fence) return body.join('\n')
    body.push(lines[j].line)
  }
  return null
}

export function validatePlan(markdown, { readFile } = {}) {
  const violations = []
  const push = (rule, detail) => violations.push({ rule, detail })
  const lines = annotate(markdown)

  if (!lines.length || !lines[0].line.startsWith('# ')) {
    push('title', 'la primera línea debe ser el título: "# <issue> — <qué>"')
  }
  if (!lines.some((l) => l.structural && l.line.includes(BLOCKQUOTE_MARKER))) {
    push('header', `falta el blockquote de cabecera (debe contener: "${BLOCKQUOTE_MARKER}")`)
  }

  let prev = -1
  for (const section of PLAN_SECTIONS) {
    const at = lines.findIndex((l) => l.structural && l.line.startsWith(section))
    if (at === -1) { push('sections', `falta la sección "${section}" (si no aplica: "N/A — <reason>")`); continue }
    if (at < prev) push('sections', `sección fuera de orden: "${section}"`)
    prev = at
  }
  for (const sub of SUBSECTIONS) {
    if (!lines.some((l) => l.structural && l.line.startsWith(sub))) {
      push('sections', `falta la subsección "${sub}" dentro de "## 1. Context and goal"`)
    }
  }

  const decisionsAt = lines.findIndex((l) => l.structural && l.line.startsWith('## 2. Closed decisions'))
  if (decisionsAt !== -1) {
    let rows = 0
    for (let i = decisionsAt + 1; i < lines.length; i++) {
      if (lines[i].structural && lines[i].line.startsWith('## ')) break
      if (lines[i].structural && lines[i].line.startsWith('|')) rows++
    }
    if (rows < 3) push('decisions', 'la tabla de "Closed decisions" está vacía (cabecera + separador + al menos 1 fila)')
  }

  const tasks = []
  lines.forEach((l, i) => {
    if (!l.structural) return
    const m = TASK_HEADING.exec(l.line)
    if (m) tasks.push({ n: parseInt(m[1], 10), name: l.line, at: i })
  })
  if (!tasks.length) push('tasks', 'no hay ninguna "### Task N — <name>"')
  tasks.forEach((t, idx) => {
    if (t.n !== idx + 1) push('tasks', `numeración no consecutiva: esperaba Task ${idx + 1} y encontré "${t.name}"`)
    const end = idx + 1 < tasks.length ? tasks[idx + 1].at : lines.length
    let boundary = end
    for (let i = t.at + 1; i < end; i++) {
      if (lines[i].structural && lines[i].line.startsWith('## ')) { boundary = i; break }
    }
    t.boundary = boundary
    const block = lines.slice(t.at + 1, boundary)
    for (const marker of TASK_MARKERS) {
      if (!block.some((l) => l.structural && l.line.includes(marker))) {
        push('tasks', `${t.name}: falta ${marker}`)
      }
    }
  })

  // D-4 — THE TASK'S YARDSTICK HAS TO BE EXECUTABLE.
  //
  // Up to here the contract checked that **Verification:** IS THERE (it is one
  // of the five TASK_MARKERS), not that it says something that can be run. The
  // difference was not theoretical: measured against the real plan of slice #5
  // of repo-pulse, SEVEN of its eight tasks verified with inline prose —
  // "`npm test -w web` → exit 0. `npm run build && npm run lint` → exit 0." —
  // and the plan validated without a single complaint. It is faithful to
  // plan-template.md, which asked for "{{exact command and expected output}}"
  // without saying where; the hole was the template's.
  //
  // A human reads that prose and knows what to run. A program does not: among
  // the commands there are arrows, full stops, "and then:" and explanatory
  // parentheses with a `wc -l AGENTS.md` inside. Separating command from comment
  // by heuristics is guessing, and guessing here means calling green a task
  // nobody measured.
  //
  // That is why the commands go in the fenced block that follows the
  // **Verification:** paragraph — the same block the role rules already exempted
  // by its label and on which COMMAND_BUDGET already puts a cap. The rule
  // invents no format: it makes mandatory the one that was already exempt.
  //
  // The detail lives in plan-tasks.js, which is what later executes them: a
  // contract that accepted plans its own executor cannot read would not be a
  // contract.
  // Two rules, one violation: `verification-block` (the verification is prose
  // nobody can execute) and `verification-predicate` (the verification IS a
  // command and its exit code says the opposite of what its comment says it
  // measures — the inverted check of jjponz/rust-monitoring#10, which went
  // through precisely this door). Both come out under `verification` because for
  // whoever fixes the plan they are the same work: making the yardstick measure.
  //
  // §3.7-A of the handoff adds the same pair for "## 8. Global verification":
  // `global-verification-block` (prose where nobody executes) and
  // `global-verification-predicate` (it measures backwards). A contract that
  // accepted a §8 its own executor (`ct-step global`, in plan-tasks.js) cannot
  // read would not be a contract — the same sentence that already justifies
  // reading this list from `extractTasks().problems` instead of reinventing the
  // parsing here.
  const VERIFICATION_RULES = [
    'verification-block', 'verification-predicate',
    'global-verification-block', 'global-verification-predicate',
  ]
  for (const problema of extractTasks(markdown).problems) {
    if (!VERIFICATION_RULES.includes(problema.rule)) continue
    push('verification', problema.detail)
  }

  // F-jjponz-4, pass A — the blocks WITH a role. It checks where each one
  // lives, over which file, and how much space it takes.
  const taskOf = (i) => tasks.find((t) => i > t.at && i < t.boundary)
  const roleBlocks = []
  lines.forEach((l, i) => {
    if (!l.structural) return
    const found = roleOf(l.line)
    if (!found) return
    const { rol, path } = found
    const body = fenceBodyAfter(lines, i + 1)
    if (body === null) {
      // For "Current state" that warning is already emitted by the literality
      // pass, which has owned it since F-jjponz-1: it is not duplicated.
      if (rol !== 'Current state') {
        push('roles', `línea ${i + 1}: "${l.line.trim()}" no lleva bloque de código a continuación.`)
      }
      return
    }
    const len = body === '' ? 0 : body.split('\n').length
    const task = taskOf(i)
    if (!task) {
      push('roles', `línea ${i + 1}: "${l.line.trim()}" está fuera de una "### Task N". Los bloques viven DENTRO de la tarea que los usa: subagent-driven-development entrega al implementador su task brief (scripts/task-brief extrae la tarea, no el plan entero), así que un bloque escrito fuera no le llega nunca. Nombra las firmas en prosa aquí y pon el bloque en la tarea.`)
    }
    if (isConfig(path)) {
      push('config', `línea ${i + 1}: "${l.line.trim()}" apunta a configuración (${path}). Las configuraciones NO llevan bloque: describe el cambio en prosa con el valor inline — p.ej. «el script \`build\` pasa a \`tsc -p tsconfig.build.json\`». Solo el código lleva bloque.`)
    } else if (rol !== 'Current state' && isTest(path)) {
      push('tests', `línea ${i + 1}: "${l.line.trim()}" apunta a un fichero de test (${path}). El cuerpo del test lo escribe el implementador en rojo primero: en el plan van el NOMBRE literal del test y su aserción clave, en **TDD:** y **Tests:**. Si lo que citas es una aserción que YA existe y hay que cambiar, cítala con "Current state (${path}, lines A-B):".`)
    }
    if (rol === 'Final text' && !isText(path)) {
      push('roles', `línea ${i + 1}: "Final text (${path})" solo vale para texto cuyo valor literal es el entregable (${TEXT_EXTENSIONS.join(', ')}). Para código, el plan lleva su contrato y el cuerpo lo escribe el implementador con TDD.`)
    }
    if (len > ROLE_BUDGETS[rol]) {
      push('budget', `línea ${i + 1}: el bloque "${l.line.trim()}" tiene ${len} líneas y su presupuesto son ${ROLE_BUDGETS[rol]}. ${BUDGET_REMEDY[rol]}`)
    }
    roleBlocks.push({ rol, path, at: i, len, task })
  })

  for (const rol of ['Contract', 'Call site']) {
    const vistos = new Map()
    for (const b of roleBlocks) {
      if (b.rol !== rol || !b.task) continue
      const clave = `${b.task.name}::${b.path}`
      if (vistos.has(clave)) {
        push('roles', `${b.task.name}: dos bloques "${rol} (${b.path})" (líneas ${vistos.get(clave) + 1} y ${b.at + 1}). El contrato de un fichero se escribe UNA vez por tarea: junta las declaraciones en un solo bloque — trocearlo no compra presupuesto.`)
        continue
      }
      vistos.set(clave, b.at)
    }
  }

  // F-jjponz-4, pass B — the blocks WITHOUT a role. This is the one that kills
  // the "Final content:"/"Current state: does not exist." idiom that produced
  // the dumps. A command block is exempt: it gives itself away by its language
  // or by coming after **Verification:**.
  let menuPendiente = true
  lines.forEach((l, i) => {
    if (!l.fence || !l.opens) return
    let prev = i - 1
    while (prev >= 0 && lines[prev].line.trim() === '') prev--
    const etiqueta = prev >= 0 ? lines[prev].line.trim() : ''
    if (prev >= 0 && lines[prev].structural && roleOf(lines[prev].line)) return
    const lang = langAt(l.line)
    const esComando = COMMAND_LANGS.has(lang) || etiqueta.includes('**Verification:**')
    const body = bodyAtFence(lines, i)
    if (!esComando) {
      // The menu of roles goes out ONCE: a plan with twenty dumps produced
      // twenty copies of the same paragraph, and a message that cannot be read
      // is not a remedy.
      push('roles', `línea ${i + 1}: bloque de código sin etiqueta de rol${etiqueta ? ` (lo precede "${etiqueta}")` : ''}.${menuPendiente ? ` ${ROLE_MENU}` : ''}`)
      menuPendiente = false
      return
    }
    if (body === null) return
    if (body.some((linea) => linea.includes('<<'))) {
      push('commands', `línea ${i + 1}: el bloque de comandos lleva un heredoc (<<). Un heredoc es un fichero entero colado por la puerta de atrás: si su contenido importa, va como "Contract (path):"; si no, no va.`)
    }
    if (body.length > COMMAND_BUDGET) {
      push('commands', `línea ${i + 1}: el bloque de comandos tiene ${body.length} líneas y su presupuesto son ${COMMAND_BUDGET}. Un bloque de comandos son los comandos y su salida esperada, no un script: si hace falta un script, va al repo y el plan lo invoca.`)
    }
    // THE SUITE TOTAL NAILED DOWN. Measured in slice #7 of rust-monitoring: the
    // plan nailed `52 passed` into four checks, the judge rightly demanded one
    // more test, and the expired number had to be corrected in seven places of
    // the plan —two briefs were generated already carrying the old value—. The
    // greater damage is not that one: with the total nailed down there is no gap
    // left for the assertion `conventions/testing.md` mandates driving in red,
    // so two branches were delivered without a single test so that a check would
    // stay green. It is ct's yardstick fighting against a ct check, and the only
    // place it can be prevented is here, before the plan exists: the judge can
    // by then only declare the clash, and the implementer cannot satisfy both.
    //
    // It is measured over the command's LITERAL and not over its intention: a
    // suite total is written with the number stuck to `passed`/`passing`, which
    // is the shape cargo, pytest, jest and mocha print. A count bounded to the
    // task's module —`grep -c '^test log_timestamp::'`— does not have it, and
    // that is exactly the alternative the message offers.
    for (const [j, linea] of body.entries()) {
      const total = /\b\d+\s+pass(?:ed|ing)\b/i.exec(linea)
      if (!total) continue
      push('commands', `línea ${i + 2 + j}: el control clava el número de tests de la suite ("${total[0]}"). Es un proxy: el juez puede exigir con razón una aserción más, y entonces el número caduca en todos los controles que lo repiten; y mientras esté clavado no queda hueco para conducir en rojo la aserción que conventions/testing.md exige, así que una rama se entrega sin test para que el control siga verde. Cuenta los tests DE ESTA TAREA por su prefijo de módulo (por ejemplo: grep -c '^test <modulo>::'), no el total.`)
    }
  })

  // F-jjponz-4 — replaces the old rule ("every task contains at least one code
  // block"): with **Verification:** mandatory and its command block, that one
  // was always satisfied and checked nothing.
  for (const t of tasks) {
    if (roleBlocks.some((b) => b.task === t)) continue
    const declara = lines
      .slice(t.at + 1, t.boundary)
      .some((l) => l.structural && NO_CODE.test(l.line.trim()))
    if (!declara) {
      push('tasks', `${t.name}: no lleva ningún bloque con etiqueta de rol (Current state / Contract / Call site / Final text), y un bloque de comandos no cuenta. Si la tarea de verdad no lleva código —configuración descrita en prosa, o documentación—, dilo con la línea exacta: "No code — <razón>".`)
    }
  }

  for (const t of tasks) {
    const total = roleBlocks.filter((b) => b.task === t).reduce((n, b) => n + b.len, 0)
    if (total > CODE_BUDGETS.task) {
      push('budget', `${t.name}: acumula ${total} líneas de código en sus bloques y el presupuesto de una tarea son ${CODE_BUDGETS.task}. Una tarea es UN commit: si de verdad necesita más contrato que esto, o el commit son dos, o estás volcando cuerpos que escribe el implementador.`)
    }
  }
  for (const t of tasks) {
    const largo = lines.slice(t.at, t.boundary).map((l) => l.line).join('\n').length
    if (largo > CODE_BUDGETS.chars) {
      const folios = (largo / CODE_BUDGETS.chars).toFixed(1)
      push('size', `${t.name}: la tarea mide ${largo} caracteres — ${folios} folios — y el máximo es UN folio A4 (${CODE_BUDGETS.chars} caracteres, unas 50 líneas). Es lo que un humano lee de una sentada en el gate \`plan\`, y es también lo que el implementador recibe como task brief. Recorta a las decisiones (contrato, call site y el tramo que cambia) y, si aun así no cabe, la tarea son dos: una tarea es un commit, y partir un commit sí está en tu mano.`)
    }
  }

  lines.forEach((l, i) => {
    if (!l.structural) return
    for (const [re, label] of FORBIDDEN) {
      if (re.test(l.line)) push('placeholders', `línea ${i + 1}: token prohibido (${label})`)
    }
  })

  lines.forEach((l, i) => {
    if (!l.structural) return
    const m = CURRENT_STATE.exec(l.line)
    if (!m) return
    const path = m[1].trim()
    const body = fenceBodyAfter(lines, i + 1)
    if (body === null) { push('literality', `"Current state (${path})" sin bloque de código a continuación`); return }
    if (!readFile) return
    let real
    try {
      real = readFile(path)
    } catch (e) {
      push('literality', `no se pudo leer "${path}" para comprobar la cita: ${e.message}`)
      return
    }
    if (!String(real).includes(body)) {
      push('literality', `el bloque "Current state (${path})" NO existe verbatim en ese fichero — cita de memoria`)
    }
  })

  // ---------------------------------------------------------------------------
  // §3 IS THE REPO'S YARDSTICK, AND A YARDSTICK THAT DOES NOT EXIST DOES NOT
  // MEASURE.
  //
  // `## 3. Reference patterns` stopped being only "files to look like": it is
  // the only thing in the plan that tells the implementer how one writes in this
  // repo and tells the judge what to block against. And it is written by an
  // AGENT, so it can quote `docs/conventions/domain.md` because it sounds to it
  // like a repo of this kind would have one. Then the implementer does not open
  // it (it is not there), the judge does not open it (it is not there), and both
  // carry on as if they had measured.
  //
  // It is the SAME rule as `Current state`'s literality, applied to the plan's
  // other class of citation: there it is checked that the quoted text exists
  // verbatim in the file, here that the quoted file exists. Third of the series —
  // `5b97fdd` closed "the yardstick is prose", `verification-predicate` closed
  // "the yardstick measures backwards", and this one closes "the yardstick does
  // not exist".
  //
  // BOUNDED TO §3 on purpose: in the rest of the plan there are paths the slice
  // is going to CREATE, and demanding that they exist there would veto every
  // plan.
  //
  // WHAT GETS TREATED AS A PATH. A backticked token, only if it carries no
  // spaces and (carries a slash or ends in a text extension). That way
  // `docs/conventions/infra.md` and `AGENTS.md` get checked, while
  // `test(...)`, `describe` and the skill `backend-engineering:backend-best-practices`
  // are not looked at — a skill is not a file of the repo and its existence is
  // not checked on disk.
  //
  // And a token that ends in `/` is skipped: it is a directory, and the only
  // read port this module receives is one of files. Checking directories asked
  // for a new IO seam all the way along `checkPlans`, and the hole it leaves (an
  // invented directory gets through) is smaller than the seam.
  // ---------------------------------------------------------------------------
  if (readFile) {
    const desde = lines.findIndex((l) => l.structural && l.line.startsWith('## 3. Reference patterns'))
    if (desde !== -1) {
      let hasta = lines.findIndex((l, i) => i > desde && l.structural && /^## /.test(l.line))
      if (hasta === -1) hasta = lines.length
      for (let i = desde + 1; i < hasta; i++) {
        if (!lines[i].structural) continue
        for (const cita of lines[i].line.match(/`[^`]+`/g) || []) {
          const ruta = cita.slice(1, -1).trim()
          if (!esRutaCitada(ruta)) continue
          try {
            readFile(ruta)
          } catch {
            push('reference-paths', `línea ${i + 1}: §3 nombra "${ruta}" y no se puede leer en el repo. §3 es la vara con la que el implementador escribe y el juez bloquea: una ruta citada de memoria deja a los dos midiendo contra un fichero que no está. Cita una ruta real, o quítala.`)
          }
        }
      }
    }
  }

  return { ok: violations.length === 0, violations }
}

export function planFilesForIssue(issue, paths) {
  const needle = `issue-${issue}-`
  return (paths || []).filter(
    (p) => p.startsWith('docs/superpowers/plans/') && p.endsWith('.md') && p.includes(needle),
  )
}

// checkPlans: the gate's whole decision, pure. `candidates` is the list of
// paths in which to look for the plan (in --release, the files the branch
// INTRODUCES; in --check-plan, the contents of the plans directory). The
// message returned is finished prose, with a remedy — whoever receives it just
// prints it on stderr and exits with `code`.
//
// F-jjponz-3 — TWO different reads, and confusing them made the gate
// unsatisfiable. The PLAN is always read where it is now (`readFile`): this
// branch introduces it, so it does not exist in the base. The files the plan
// QUOTES are read with `readCitedFile`, which in --release points at the
// branch's base: by then the tasks have already rewritten those files, and
// comparing them against the tree would only prove that the slice did its job.
// By default it is the same reader, which is the right thing in --check-plan
// (the plan is written before implementing and quotes the tree as it stands).
export function checkPlans({ issue, candidates, readFile, readCitedFile }) {
  const files = planFilesForIssue(issue, candidates)
  if (!files.length) {
    return {
      ok: false,
      code: 6,
      files,
      message:
        `no hay ningún plan prescriptivo para #${issue} entre los candidatos: falta un ` +
        `docs/superpowers/plans/YYYY-MM-DD-issue-${issue}-<slug>.md. Escríbelo con ` +
        `control-tower-loop:writing-plans-prescriptive, valídalo con --check-plan y commitéalo ` +
        `(viaja en el PR). Si ya existe en tu árbol de trabajo pero no está commiteado, commitéalo.`,
    }
  }
  for (const file of files) {
    let content
    try {
      content = readFile(file)
    } catch (e) {
      return {
        ok: false,
        code: 6,
        files,
        message: `no se ha podido leer ${file} (${e.message}) — no se afirma que el plan sea inválido, pero tampoco se puede comprobar. Arregla la lectura y reintenta.`,
      }
    }
    const result = validatePlan(content, { readFile: readCitedFile ?? readFile })
    if (!result.ok) {
      const detail = result.violations.map((v) => `  - [${v.rule}] ${v.detail}`).join('\n')
      return {
        ok: false,
        code: 6,
        files,
        message: `${file} no cumple el contrato del plan (plan-contract.js):\n${detail}\nCorrige el plan, re-valida con --check-plan y vuelve a intentarlo.`,
      }
    }
  }
  return { ok: true, code: 0, files, message: `plan ok: ${files.join(', ')} cumple el contrato` }
}
