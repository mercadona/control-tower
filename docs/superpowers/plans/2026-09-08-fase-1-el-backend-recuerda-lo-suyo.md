# Fase 1: el backend recuerda solo lo que es suyo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el backend sobreviva a su propio reinicio sin leer títulos de ventanas de cmux: la lista de checkouts se persiste, y la identidad de cada plan en vuelo se deriva de git y del issue.

**Architecture:** Tres piezas nuevas en `backend/src/infrastructure/` y una que se retira. `DiskCheckoutRegistry` sustituye al `Map` en memoria que hoy alimenta el barrido de cosecha. `WorktreePlans` deriva los `PlanWatch` en vuelo de `git worktree list` (identidad), de las workspaces de cmux cruzadas **por directorio** (el `agent`) y del título del issue (la clave de Jira). `CmuxActivePlan` y sus tres expresiones regulares sobre títulos se borran. `ActivePlanRecovery` se queda —es donde los dos `ReviewWatch` arrancan con su línea base— y solo cambia de fuente.

**Tech Stack:** Node ≥ 24 (ESM), vitest, `git worktree list --porcelain`, `gh issue view --json`.

**Spec:** `docs/superpowers/specs/2026-09-08-el-backend-conduce-design.md` (fase 1, §5 y §6.1)

## Global Constraints

- La vara que liga en todo diff: `plugin/conventions/` (`style.md`, `architecture.md`, `testing.md`, `simplicity.md`, `defects.md`, `boundaries.md`, `domain.md`) y `backend/conventions/this-repository.md`. Ante contradicción, gana `this-repository.md`.
- **Sin comentarios y sin docstrings.** Ni en producción ni en tests.
- **Código en inglés**: ficheros, tipos, métodos, variables, constantes, nombres de test y mensajes de diagnóstico.
- **Ninguna función libre a nivel de módulo**: todo cuelga de un tipo.
- **`backend/` no importa nada nuevo del plugin.** Lo que haga falta se escribe propio y se contrasta con el lector real del plugin en un test de contrato (`backend/__tests__/infrastructure/plugin-contract.test.js` es el precedente). Los imports que ya existen no se tocan en esta fase.
- **Nada "por si acaso"** (`simplicity.md`): cada campo, rama y símbolo público responde a un llamador que existe hoy.
- La suite se corre **desde `backend/`**, nunca desde la raíz. Subconjunto rápido: `npx vitest run --exclude '**/*-real-process.test.js'`. La suite entera antes de dar por terminado.
- Un test que lanza un subproceso real se marca como tal (sufijo `-real-process.test.js`).
- Cada tarea termina con **barrido de mutación declarado**: mutar a mano la línea que la tarea protege, comprobar que la suite se pone roja, restaurar el fichero y verificarlo idéntico, y declarar en el informe qué línea se mutó y si murió.
- **Esta fase no cambia lo que el front ve.** `/active-plans` devuelve los mismos campos con los mismos valores, story incluida, y sigue pudiendo responder 503 cuando la consulta a cmux no es concluyente.

---

### Task 1: El registro de checkouts sobrevive al reinicio

Hoy `MemoryCheckoutRegistry` es un `Map`, y es lo que `HarvestClock` consulta para saber qué clones barrer. Al reiniciar el backend se vacía, así que **la cosecha deja de barrer los clones que atendía**. Este es el defecto que la tarea arregla, y entrega valor sola.

**Files:**
- Create: `backend/src/infrastructure/disk-checkout-registry.js`
- Test: `backend/__tests__/infrastructure/disk-checkout-registry.test.js`
- Modify: `backend/src/infrastructure/ct-api.mjs` (la clase `Disk`, y la línea `const checkouts = new MemoryCheckoutRegistry()`)
- Delete: `backend/src/infrastructure/memory-checkout-registry.js` y `backend/__tests__/infrastructure/memory-checkout-registry.test.js`, **solo si no queda ningún consumidor** (se comprueba en el paso 8)

**Interfaces:**
- Consumes: `CheckoutRegistry` (`backend/src/domain/ports/checkout-registry.js`, métodos `remember(root)` y `known()`), `CheckoutRoot` (`backend/src/domain/value-objects/checkout-root.js`, con `text` y `static isWellFormed(text)`).
- Produces: `DiskCheckoutRegistry({ read, stat, write, root })` con `remember(root: CheckoutRoot): void`, `known(): CheckoutRoot[]`, `static FILE = 'checkouts.json'`, `static pathFor(root: string): string`, `static contentFor(roots: CheckoutRoot[]): string`. **Síncrono a propósito**: `DiskGoRegistry.matches` y `DiskImplementationStartRegistry.matches` ya reciben `read` y `stat` síncronos, y `StartPlan`, `ActivePlanRecovery` y `HarvestClock` llaman a `remember`/`known` sin `await`. Hacerlo asíncrono obligaría a tocar los tres consumidores sin comprar nada.

- [ ] **Step 1: Write the failing tests**

```javascript
import { describe, expect, it, vi } from 'vitest'
import { DiskCheckoutRegistry } from '../../src/infrastructure/disk-checkout-registry.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'

const A_FILE = { isFile: () => true }
const NOT_A_FILE = { isFile: () => false }

describe('DiskCheckoutRegistry', () => {
  it('the_first_checkout_it_is_asked_to_remember_is_written_as_the_whole_list', () => {
    const write = vi.fn()
    const registry = new DiskCheckoutRegistry({
      read: vi.fn(), stat: () => NOT_A_FILE, write, root: '/state',
    })

    registry.remember(new CheckoutRoot('/repos/one'))

    expect(write).toHaveBeenCalledWith(
      '/state/checkouts.json',
      `${JSON.stringify({ roots: ['/repos/one'] }, null, 2)}\n`
    )
  })

  it('a_second_checkout_joins_the_ones_already_written', () => {
    const write = vi.fn()
    const registry = new DiskCheckoutRegistry({
      read: () => `${JSON.stringify({ roots: ['/repos/one'] })}\n`,
      stat: () => A_FILE,
      write,
      root: '/state',
    })

    registry.remember(new CheckoutRoot('/repos/two'))

    expect(write).toHaveBeenCalledWith(
      '/state/checkouts.json',
      `${JSON.stringify({ roots: ['/repos/one', '/repos/two'] }, null, 2)}\n`
    )
  })

  it('a_checkout_it_already_knows_is_not_written_again', () => {
    const write = vi.fn()
    const registry = new DiskCheckoutRegistry({
      read: () => `${JSON.stringify({ roots: ['/repos/one'] })}\n`,
      stat: () => A_FILE,
      write,
      root: '/state',
    })

    registry.remember(new CheckoutRoot('/repos/one'))

    expect(write).not.toHaveBeenCalled()
  })

  it('what_was_written_before_a_restart_is_what_it_knows_after_one', () => {
    const registry = new DiskCheckoutRegistry({
      read: () => `${JSON.stringify({ roots: ['/repos/one', '/repos/two'] })}\n`,
      stat: () => A_FILE,
      write: vi.fn(),
      root: '/state',
    })

    expect(registry.known().map((root) => root.text)).toEqual(['/repos/one', '/repos/two'])
  })

  it('nothing_written_yet_is_no_checkouts_instead_of_a_failure', () => {
    const registry = new DiskCheckoutRegistry({
      read: vi.fn(), stat: () => NOT_A_FILE, write: vi.fn(), root: '/state',
    })

    expect(registry.known()).toEqual([])
  })

  it('a_file_that_is_not_the_shape_it_writes_is_no_checkouts_instead_of_a_crash', () => {
    const registry = new DiskCheckoutRegistry({
      read: () => 'not json at all',
      stat: () => A_FILE,
      write: vi.fn(),
      root: '/state',
    })

    expect(registry.known()).toEqual([])
  })

  it('one_unusable_entry_does_not_take_the_usable_ones_with_it', () => {
    const registry = new DiskCheckoutRegistry({
      read: () => `${JSON.stringify({ roots: ['relative/path', '/repos/two'] })}\n`,
      stat: () => A_FILE,
      write: vi.fn(),
      root: '/state',
    })

    expect(registry.known().map((root) => root.text)).toEqual(['/repos/two'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run __tests__/infrastructure/disk-checkout-registry.test.js`
Expected: FAIL — `Failed to resolve import ".../disk-checkout-registry.js"`

- [ ] **Step 3: Write the implementation**

```javascript
import { join } from 'node:path'
import { CheckoutRegistry } from '../domain/ports/checkout-registry.js'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.js'

export class DiskCheckoutRegistry extends CheckoutRegistry {
  static FILE = 'checkouts.json'

  constructor({ read, stat, write, root }) {
    super()
    this.read = read
    this.stat = stat
    this.write = write
    this.root = root
  }

  static pathFor(root) {
    return join(root, DiskCheckoutRegistry.FILE)
  }

  static contentFor(roots) {
    return `${JSON.stringify({ roots: roots.map((root) => root.text) }, null, 2)}\n`
  }

  remember(root) {
    const known = this.known()
    if (known.some((seen) => seen.text === root.text)) return

    this.write(DiskCheckoutRegistry.pathFor(this.root), DiskCheckoutRegistry.contentFor([...known, root]))
  }

  known() {
    const printed = this.#printed()
    if (printed === null) return []

    return printed
      .filter((text) => CheckoutRoot.isWellFormed(text))
      .map((text) => new CheckoutRoot(text))
  }

  #printed() {
    const path = DiskCheckoutRegistry.pathFor(this.root)
    try {
      if (!this.stat(path).isFile()) return null
      const record = JSON.parse(this.read(path))
      if (record === null || typeof record !== 'object' || !Array.isArray(record.roots)) return null

      return record.roots
    } catch {
      return null
    }
  }
}
```

Dos decisiones, para que quien juzgue no tenga que deducirlas:

- **Un fichero con la lista, no un fichero por checkout.** La entidad es el conjunto («los clones que este backend atiende»), `known()` lo necesita entero, y así no hay que enumerar un directorio.
- **Un fichero ilegible es «no sé de ninguno», no una excepción.** Es el precedente de los dos registros hermanos (`DiskGoRegistry.matches` y `DiskImplementationStartRegistry.matches` degradan con `try/catch`). Y el filtro por `isWellFormed` está ahí para que **una entrada inservible no se lleve a las buenas por delante**: sin él, `new CheckoutRoot('relative/path')` lanzaría y el `catch` devolvería la lista vacía. Es la puerta por la que un valor entra de fuera, que es donde `boundaries.md` pone la guarda.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run __tests__/infrastructure/disk-checkout-registry.test.js`
Expected: PASS, 7 tests

- [ ] **Step 5: Add the synchronous write to `Disk` in the entrypoint**

En `backend/src/infrastructure/ct-api.mjs`, junto a los métodos que ya tiene la clase `Disk` (`write`, `atomicWrite`, `read`, `remove`, `exists`), añadir:

```javascript
  static writeSync(path, text) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
```

Y añadir `mkdirSync` y `writeFileSync` al import de `node:fs` que ya trae `readFileSync` y `statSync`.

- [ ] **Step 6: Wire it in**

En `ct-api.mjs`, sustituir la línea `const checkouts = new MemoryCheckoutRegistry()` por:

```javascript
    const checkouts = new DiskCheckoutRegistry({
      read: (path) => readFileSync(path, 'utf8'),
      stat: statSync,
      write: Disk.writeSync,
      root: asked.stateRoot,
    })
```

Cambiar el import de `MemoryCheckoutRegistry` por el de `DiskCheckoutRegistry`.

- [ ] **Step 7: Run the whole suite**

Run: `cd backend && npx vitest run --exclude '**/*-real-process.test.js'`
Expected: PASS. Si `ct-api-real-process.test.js` u otro construye `MemoryCheckoutRegistry`, se ajusta en el paso siguiente.

- [ ] **Step 8: Retire the memory registry if nobody is left**

Run: `grep -rn "MemoryCheckoutRegistry" backend frontend plugin`
- Si solo aparece en su propio módulo y en su propio test: borrar los dos ficheros (`simplicity.md`: un símbolo público sin llamador se va).
- Si algún test lo usa como doble: dejarlo y **declarar en el informe quién lo retiene**.

- [ ] **Step 9: Mutation sweep**

Con el árbol limpio y commiteado, mutar a mano **una sola línea** y correr la suite:
1. En `remember`, quitar la línea `if (known.some(...)) return` → debe morir `a_checkout_it_already_knows_is_not_written_again`.
2. En `known`, quitar el `.filter((text) => CheckoutRoot.isWellFormed(text))` → debe morir `one_unusable_entry_does_not_take_the_usable_ones_with_it`.

Restaurar el fichero después de cada mutación y verificar con `git diff --exit-code` que el árbol queda idéntico. Declarar en el informe las dos mutaciones y si murieron.

- [ ] **Step 10: Commit**

```bash
git add backend/src/infrastructure/disk-checkout-registry.js \
        backend/__tests__/infrastructure/disk-checkout-registry.test.js \
        backend/src/infrastructure/ct-api.mjs
git commit -m "fix: los clones que el backend atiende sobreviven a su reinicio, y con ellos la cosecha"
```

Si el paso 8 borró el registro en memoria, sus dos ficheros entran en este mismo commit con `git rm`.

---

### Task 2: La clave de Jira se lee del issue

`WorktreePlans` (tarea 3) va a derivar la identidad de git, y ahí no está la historia de usuario: hoy sale del título de la ventana. El issue la tiene en su título (`KEY summary`) y declara en su cuerpo cuándo **no** la hay, así que no hay heurística. Esta tarea solo añade la lectura; nadie la usa todavía.

**Files:**
- Modify: `backend/src/domain/ports/plan-issues.js` (nuevo método del puerto)
- Modify: `backend/src/domain/exceptions.js` (las dos causas de la nueva lectura)
- Modify: `backend/src/infrastructure/gh-plan-issues.js` (`GhPlanIssues.storyOf`, `GhPlanIssues.storyArgvFor`, `PlanIssueBody.storyIn`)
- Test: `backend/__tests__/infrastructure/gh-plan-issues.test.js` (el adaptador)
- Test: `backend/__tests__/infrastructure/plan-issue-body.test.js` (el contrato render → parse)

**Interfaces:**
- Consumes: `UserStoryKey` (`backend/src/domain/value-objects/user-story-key.js`, con `static isWellFormed(text)` y `text`), `PlanIssueBody.NO_STORY_LINE` y `PlanIssueBody.titleFor({ story, comment })`, que ya existen en `gh-plan-issues.js`.
- Produces: `PlanIssues.storyOf({ issueNumber, repository })` → `Promise<UserStoryKey | null>`; `GhPlanIssues.storyArgvFor({ issueNumber, repository })` → `string[]`; `PlanIssueBody.storyIn({ title, body })` → `UserStoryKey | null`; y las excepciones `PlanIssueNotRead` y `PlanIssueNotUnderstood`.

- [ ] **Step 1: Capture the real shape `gh` returns**

Run: `gh issue view 7 --repo josemerca/ct-loop-sandbox --json title,body`

Copiar la salida literal. Es la forma que el test declara, y `conventions/testing.md` exige que venga de una captura real y que el test **diga de dónde salió**. Si ese issue ya no existe, usar cualquier issue de plan real y anotar cuál.

- [ ] **Step 2: Write the failing test of the adapter**

En `backend/__tests__/infrastructure/gh-plan-issues.test.js`. El fichero ya tiene el doble de conversación `GhDouble`, con `printing(printed)` para una respuesta buena, `refusing(said)` para un comando que falla, `REPOSITORY` fijado a `josemerca/ct-loop-sandbox`, y un método de instancia por lectura que asserta contra `gh.calls` — el patrón exacto está en `asking_where_an_issue_stands_reads_its_labels_and_nothing_else` (línea 612). Añadir a `GhDouble`:

```javascript
  static titled(title, body = '## Descripción\n\nlo que sea\n') {
    return GhDouble.printing(`${JSON.stringify({ title, body })}\n`)
  }

  async storyFor() {
    return this.issues().storyOf({ issueNumber: 7, repository: GhDouble.REPOSITORY })
  }

  async storyRefusalFor() {
    return this.storyFor().catch((cause) => cause)
  }
```

Y los cuatro tests:

```javascript
  it('asking_which_story_a_plan_came_from_reads_the_title_and_the_body_of_its_issue', async () => {
    const gh = GhDouble.titled('MO_SHOP-42 El buscador acepta acentos')

    await gh.storyFor()

    expect(gh.calls).toEqual([[
      'issue', 'view', '7', '--repo', 'josemerca/ct-loop-sandbox', '--json', 'title,body',
    ]])
  })

  it('the_story_of_a_plan_that_came_from_jira_is_the_key_its_title_opens_with', async () => {
    const story = await GhDouble.titled('MO_SHOP-42 El buscador acepta acentos').storyFor()

    expect(story.text).toBe('MO_SHOP-42')
  })

  it('a_title_that_does_not_open_with_a_key_is_no_story_instead_of_a_made_up_one', async () => {
    expect(await GhDouble.titled('arreglar el login que va lento').storyFor()).toBeNull()
  })

  it('a_command_that_failed_is_told_apart_from_an_answer_that_cannot_be_read', async () => {
    const failed = await GhDouble.refusing('gh: issue not found\n').storyRefusalFor()
    const unreadable = await GhDouble.printing('this is not json\n').storyRefusalFor()

    expect(failed).toBeInstanceOf(PlanIssueNotRead)
    expect(unreadable).toBeInstanceOf(PlanIssueNotUnderstood)
  })
```

Añadir `PlanIssueNotRead` y `PlanIssueNotUnderstood` al import de excepciones que ese fichero ya tiene. La forma que `titled` declara —un objeto con `title` y `body`— es la que `gh issue view --json title,body` devuelve, capturada en el paso 1: **el test lo declara en un comentario de la pull request, no en el código** (`conventions/style.md` prohíbe la prosa en el código, y `conventions/testing.md` pide la procedencia; se declara en el informe de la tarea).

Y el test que fija la simetría con el render, en `plan-issue-body.test.js`. Ese fichero ya tiene `Opened.asGithubSees({ story, comment })`, que compone `{ number, title, body, labels, milestone }` **con el render real** (`PlanIssueBody.titleFor` y `PlanIssueBody.of`), y `Opened.commentOnly(text)` para el caso sin historia:

```javascript
  it('a_plan_that_came_from_a_story_is_read_back_as_that_story', () => {
    expect(PlanIssueBody.storyIn(Opened.asGithubSees({ story: Opened.story() })).text).toBe('MO_SHOP-42')
  })

  it('a_plan_asked_for_by_hand_is_read_back_as_having_no_story_because_its_body_says_so', () => {
    expect(PlanIssueBody.storyIn(Opened.asGithubSees(Opened.commentOnly('arreglar el login')))).toBeNull()
  })
```

Estos dos son el contrato que importa: **alimentan el render real al parseo real**, así que ninguna de las dos direcciones se aprueba por construcción.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && npx vitest run __tests__/infrastructure/gh-plan-issues.test.js __tests__/infrastructure/plan-issue-body.test.js`
Expected: FAIL — `issues.storyOf is not a function` y `PlanIssueBody.storyIn is not a function`

- [ ] **Step 4: Add the two exceptions**

En `backend/src/domain/exceptions.js`, junto a la familia `PlanIssueFailure` que ya está:

```javascript
export class PlanIssueNotRead extends PlanIssueFailure {}

export class PlanIssueNotUnderstood extends PlanIssueFailure {}
```

`backend/conventions/this-repository.md` lo pide así: cada familia nombra sus dos causas — el comando falló, y contestó algo que no se puede leer.

- [ ] **Step 5: Declare the method on the port**

En `backend/src/domain/ports/plan-issues.js`, con la misma forma que los seis que ya hay:

```javascript
  async storyOf({ issueNumber, repository }) {
    throw new Error(
      `${this.constructor.name} must implement storyOf({ issueNumber, repository }), asked for ${issueNumber} in ${repository}`
    )
  }
```

- [ ] **Step 6: Write the implementation**

En `gh-plan-issues.js`, dentro de `GhPlanIssues`:

```javascript
  static storyArgvFor({ issueNumber, repository }) {
    return ['issue', 'view', String(issueNumber), '--repo', repository.text, '--json', 'title,body']
  }

  async storyOf({ issueNumber, repository }) {
    const outcome = await this.gh.run(
      GhPlanIssues.storyArgvFor({ issueNumber, repository }), { safeToRepeat: true }
    )
    if (outcome.failed) {
      throw new PlanIssueNotRead(`${Gh.BIN} issue view --json title,body failed: ${outcome.stderr.trim()}`)
    }

    return PlanIssueBody.storyIn(GhPlanIssues.#viewIn(outcome.stdout, issueNumber))
  }

  static #viewIn(printed, issueNumber) {
    let view
    try {
      view = JSON.parse(printed)
    } catch {
      throw new PlanIssueNotUnderstood(
        `${Gh.BIN} issue view --json title,body printed something that is not json for #${issueNumber}: ${JSON.stringify(printed)}`
      )
    }
    if (view === null || typeof view !== 'object' || Array.isArray(view) || typeof view.title !== 'string') {
      throw new PlanIssueNotUnderstood(
        `${Gh.BIN} issue view --json title,body printed no title for #${issueNumber}: ${JSON.stringify(printed)}`
      )
    }

    return view
  }
```

Y en `PlanIssueBody`, junto a `titleFor` y `NO_STORY_LINE`:

```javascript
  static storyIn({ title, body }) {
    if (typeof body === 'string' && body.includes(PlanIssueBody.NO_STORY_LINE)) return null
    const opening = title.trim().split(/\s+/)[0]

    return UserStoryKey.isWellFormed(opening) ? new UserStoryKey(opening) : null
  }
```

Añadir el import de `UserStoryKey` si el módulo aún no lo tiene, y los de las dos excepciones nuevas.

El parseo vive en `PlanIssueBody` **porque es donde vive el render**: `titleFor` escribe el título y `NO_STORY_LINE` se escribe en el cuerpo, así que las dos direcciones quedan en el mismo módulo y se comprueban una contra otra sin red.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend && npx vitest run __tests__/infrastructure/gh-plan-issues.test.js __tests__/infrastructure/plan-issue-body.test.js`
Expected: PASS

- [ ] **Step 8: Mutation sweep**

1. Quitar `if (typeof body === 'string' && body.includes(...)) return null` de `storyIn` → debe morir `a_plan_asked_for_by_hand_is_read_back_as_having_no_story_from_the_line_that_says_so`.
2. Cambiar `'title,body'` por `'title'` en `storyArgvFor` → debe morir el test del argv.

Restaurar y verificar con `git diff --exit-code`. Declarar las dos.

- [ ] **Step 9: Commit**

```bash
git add backend/src/domain/exceptions.js backend/src/domain/ports/plan-issues.js \
        backend/src/infrastructure/gh-plan-issues.js \
        backend/__tests__/infrastructure/gh-plan-issues.test.js \
        backend/__tests__/infrastructure/plan-issue-body.test.js
git commit -m "feat: el backend sabe preguntarle al issue de qué historia de usuario viene un plan"
```

---

### Task 3: Los planes en vuelo se derivan de git, no de un título de ventana

**Files:**
- Create: `backend/src/infrastructure/worktree-plans.js`
- Test: `backend/__tests__/infrastructure/worktree-plans.test.js`

**Interfaces:**
- Consumes: `DiskCheckoutRegistry.known()` de la tarea 1; `PlanIssues.storyOf(...)` de la tarea 2; `WorkspaceSurvey` (`{ repository, prepared }`) y `PreparedWorkspace` (`{ issueNumber, located }`) tal como los devuelve hoy `SurveyWorkspaces`; `PlanWatch({ story, issue, located, repository, agent })`; `PlanIssue({ number, url })`; `CmuxPlanAgents.isHandle(value)`.
- Produces: `WorktreePlans({ checkouts, survey, sessions, planIssues, stderr })` con `async inFlight(): Promise<PlanWatch[] | null>`. **Devuelve `null` cuando no se pudo saber**, que no es lo mismo que `[]`: es el idioma que ya usan `listCmuxWorkspaces` y `ActivePlanRecovery`, y es lo que sostiene el 503.

- [ ] **Step 1: Write the failing tests**

```javascript
import { describe, expect, it, vi } from 'vitest'
import { WorktreePlans } from '../../src/infrastructure/worktree-plans.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'
import { WorkspaceSurvey } from '../../src/domain/value-objects/workspace-survey.js'
import { PreparedWorkspace } from '../../src/domain/value-objects/prepared-workspace.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { PlanIssueNotRead } from '../../src/domain/exceptions.js'

class SurveyedCheckout {
  static of(root, issueNumbers) {
    return new WorkspaceSurvey({
      repository: new RepositoryName('owner/repo'),
      prepared: issueNumbers.map((issueNumber) => new PreparedWorkspace({
        issueNumber,
        located: new WorkspaceLocation({
          root,
          path: `${root}/.worktrees/${issueNumber}`,
          branch: `feat/${issueNumber}`,
        }),
      })),
    })
  }
}

describe('WorktreePlans', () => {
  it('the_identity_of_a_plan_in_flight_comes_from_git_and_the_window_only_names_its_agent', async () => {
    const plans = new WorktreePlans({
      checkouts: { known: () => [new CheckoutRoot('/repos/one')] },
      survey: () => SurveyedCheckout.of('/repos/one', [33]),
      sessions: () => [{ cwd: '/repos/one/.worktrees/33', cwdKnown: true, ref: 'workspace:20', title: 'anything at all' }],
      planIssues: { storyOf: () => new UserStoryKey('ABC-123') },
      stderr: vi.fn(),
    })

    const [watch] = await plans.inFlight()

    expect({
      story: watch.storyText(),
      issue: watch.issue.number,
      url: watch.issue.url,
      repo: watch.repository.text,
      root: watch.located.root,
      worktree: watch.located.path,
      branch: watch.located.branch,
      agent: watch.agent,
    }).toEqual({
      story: 'ABC-123',
      issue: 33,
      url: 'https://github.com/owner/repo/issues/33',
      repo: 'owner/repo',
      root: '/repos/one',
      worktree: '/repos/one/.worktrees/33',
      branch: 'feat/33',
      agent: 'workspace:20',
    })
  })

  it('a_worktree_with_no_live_session_is_left_out_the_same_way_it_is_left_out_today', async () => {
    const plans = new WorktreePlans({
      checkouts: { known: () => [new CheckoutRoot('/repos/one')] },
      survey: () => SurveyedCheckout.of('/repos/one', [33]),
      sessions: () => [],
      planIssues: { storyOf: vi.fn() },
      stderr: vi.fn(),
    })

    expect(await plans.inFlight()).toEqual([])
  })

  it('a_session_whose_directory_is_unknown_names_no_agent', async () => {
    const plans = new WorktreePlans({
      checkouts: { known: () => [new CheckoutRoot('/repos/one')] },
      survey: () => SurveyedCheckout.of('/repos/one', [33]),
      sessions: () => [{ cwd: '/repos/one/.worktrees/33', cwdKnown: false, ref: 'workspace:20', title: '' }],
      planIssues: { storyOf: vi.fn() },
      stderr: vi.fn(),
    })

    expect(await plans.inFlight()).toEqual([])
  })

  it('sessions_that_could_not_be_listed_is_not_the_same_as_no_plans_in_flight', async () => {
    const plans = new WorktreePlans({
      checkouts: { known: () => [new CheckoutRoot('/repos/one')] },
      survey: () => SurveyedCheckout.of('/repos/one', [33]),
      sessions: () => null,
      planIssues: { storyOf: vi.fn() },
      stderr: vi.fn(),
    })

    expect(await plans.inFlight()).toBeNull()
  })

  it('the_story_it_could_not_read_leaves_the_plan_recovered_without_one', async () => {
    const stderr = vi.fn()
    const plans = new WorktreePlans({
      checkouts: { known: () => [new CheckoutRoot('/repos/one')] },
      survey: () => SurveyedCheckout.of('/repos/one', [33]),
      sessions: () => [{ cwd: '/repos/one/.worktrees/33', cwdKnown: true, ref: 'workspace:20', title: '' }],
      planIssues: { storyOf: () => { throw new PlanIssueNotRead('gh said no') } },
      stderr,
    })

    const [watch] = await plans.inFlight()

    expect(watch.storyText()).toBeNull()
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('#33'))
  })

  it('a_checkout_that_cannot_be_surveyed_does_not_take_the_other_checkouts_with_it', async () => {
    const plans = new WorktreePlans({
      checkouts: { known: () => [new CheckoutRoot('/repos/broken'), new CheckoutRoot('/repos/one')] },
      survey: (root) => {
        if (root.text === '/repos/broken') throw new WorkspaceNotRead('git said no')

        return SurveyedCheckout.of('/repos/one', [33])
      },
      sessions: () => [{ cwd: '/repos/one/.worktrees/33', cwdKnown: true, ref: 'workspace:20', title: '' }],
      planIssues: { storyOf: () => null },
      stderr: vi.fn(),
    })

    const recovered = await plans.inFlight()

    expect(recovered.map((watch) => watch.issue.number)).toEqual([33])
  })
})
```

Añadir `WorkspaceNotRead` al import de excepciones del test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run __tests__/infrastructure/worktree-plans.test.js`
Expected: FAIL — `Failed to resolve import ".../worktree-plans.js"`

- [ ] **Step 3: Write the implementation**

```javascript
import { CmuxPlanAgents } from './cmux-plan-agents.js'
import { PlanIssue } from '../domain/value-objects/plan-issue.js'
import { PlanWatch } from '../domain/value-objects/plan-watch.js'
import { PlanFailure } from '../domain/exceptions.js'

export class WorktreePlans {
  constructor({ checkouts, survey, sessions, planIssues, stderr }) {
    this.checkouts = checkouts
    this.survey = survey
    this.sessions = sessions
    this.planIssues = planIssues
    this.stderr = stderr
  }

  static urlOf({ repository, issueNumber }) {
    return `https://github.com/${repository.text}/issues/${issueNumber}`
  }

  static agentOf(listed, worktree) {
    const found = listed.find((entry) =>
      entry !== null && typeof entry === 'object' && entry.cwdKnown === true &&
      entry.cwd === worktree && CmuxPlanAgents.isHandle(entry.ref))

    return found === undefined ? null : found.ref
  }

  async inFlight() {
    const listed = this.sessions()
    if (listed === null) return null
    const watches = []
    for (const root of this.checkouts.known()) {
      for (const watch of await this.#of(root, listed)) watches.push(watch)
    }

    return watches
  }

  async #of(root, listed) {
    const surveyed = await this.#surveyed(root)
    if (surveyed === null) return []
    const watches = []
    for (const prepared of surveyed.prepared) {
      const agent = WorktreePlans.agentOf(listed, prepared.located.path)
      if (agent === null) continue
      watches.push(new PlanWatch({
        story: await this.#storyOf(prepared.issueNumber, surveyed.repository),
        issue: new PlanIssue({
          number: prepared.issueNumber,
          url: WorktreePlans.urlOf({ repository: surveyed.repository, issueNumber: prepared.issueNumber }),
        }),
        located: prepared.located,
        repository: surveyed.repository,
        agent,
      }))
    }

    return watches
  }

  async #surveyed(root) {
    try {
      return await this.survey(root)
    } catch (failure) {
      if (!(failure instanceof PlanFailure)) throw failure
      this.stderr(`plans in flight: ${root.text} could not be surveyed, so its plans are not recovered: ${failure.message}\n`)

      return null
    }
  }

  async #storyOf(issueNumber, repository) {
    try {
      return await this.planIssues.storyOf({ issueNumber, repository })
    } catch (failure) {
      if (!(failure instanceof PlanFailure)) throw failure
      this.stderr(`plans in flight: #${issueNumber} is recovered without its user story: ${failure.message}\n`)

      return null
    }
  }
}
```

Tres decisiones para quien juzgue:

- **El cruce con la sesión es por directorio, no por título.** El `cwd` es un hecho de la sesión; el título es una convención de nombre que hay que parsear y validar. `cwdKnown === true` es la guarda que `plugin/scripts/cmux.js` ya documenta: un `cwd` desconocido no es un `cwd` distinto.
- **Un worktree sin sesión viva se deja fuera.** Es el comportamiento de hoy —`CmuxActivePlan.parse` devuelve `null` si el `ref` no es un handle— y esta fase no cambia lo que el front ve. Que aparezca con `agent: null` es la fase 4.
- **La story y la encuesta degradan por separado.** Un checkout que no se puede encuestar no se lleva por delante a los demás, y un issue que no se puede leer no se lleva por delante a su plan: se recupera sin story y se dice por `stderr`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run __tests__/infrastructure/worktree-plans.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Mutation sweep**

1. En `inFlight`, cambiar `if (listed === null) return null` por `if (listed === null) return []` → debe morir `sessions_that_could_not_be_listed_is_not_the_same_as_no_plans_in_flight`.
2. En `agentOf`, quitar `entry.cwdKnown === true` → debe morir `a_session_whose_directory_is_unknown_names_no_agent`.
3. En `#storyOf`, quitar el `catch` (dejar que propague) → debe morir `the_story_it_could_not_read_leaves_the_plan_recovered_without_one`.

Restaurar tras cada una y verificar con `git diff --exit-code`. Declarar las tres.

- [ ] **Step 6: Commit**

```bash
git add backend/src/infrastructure/worktree-plans.js \
        backend/__tests__/infrastructure/worktree-plans.test.js
git commit -m "feat: los planes en vuelo se derivan de git y del issue, y la ventana solo nombra su agente"
```

---

### Task 4: La recuperación cambia de fuente, y las expresiones regulares sobre títulos se van

**Files:**
- Modify: `backend/src/infrastructure/active-plan-recovery.js` (borrar `CmuxActivePlan`, cambiar la fuente de `recover()`)
- Modify: `backend/src/infrastructure/ct-api.mjs` (construir `WorktreePlans` y pasárselo a la recuperación)
- Test: `backend/__tests__/infrastructure/active-plan-recovery.test.js` (ajustar a la fuente nueva)
- Create: `backend/__tests__/infrastructure/no-window-titles-parsed.test.js` (el guardián del criterio de cierre)

**Interfaces:**
- Consumes: `WorktreePlans.inFlight()` de la tarea 3.
- Produces: `ActivePlanRecovery({ plans, implementationStarts, goRegistry, implementationProgress, sessions, reviews, pullRequestReviews, activePlans })` — desaparecen `list` y `checkouts` de su constructor: la lista de planes la da `plans`, y los checkouts ya no se rellenan desde cmux porque son la fuente, no el resultado.

- [ ] **Step 1: Read the current recovery test and the recovery itself**

Run: `cd backend && sed -n 1,80p __tests__/infrastructure/active-plan-recovery.test.js`

Hace falta saber cómo dobla hoy `list` para reescribirlo doblando `plans.inFlight()`. **Lo que los tests existentes garantizan no cambia** —qué plan acaba en `implementing`, cuál en `uncertain`, cuál en `sessions`, y que los dos vigilantes arrancan— y esos casos se conservan tal cual: lo único que cambia es de dónde salen los `PlanWatch`.

- [ ] **Step 2: Rewrite the recovery's source in the test**

Sustituir en ese fichero la construcción de entradas de cmux por un doble de `WorktreePlans`:

```javascript
const plansInFlight = (watches) => ({ inFlight: () => Promise.resolve(watches) })
const plansThatCouldNotBeListed = () => ({ inFlight: () => Promise.resolve(null) })
```

y pasar `plans: plansInFlight([...])` donde hoy se pasa `list: () => [...]`. Los `PlanWatch` que antes se construían desde una entrada de cmux ahora se construyen directamente, que es lo que la tarea 3 ya devuelve.

Conservar el caso de la lista no concluyente:

```javascript
  it('a_recovery_that_could_not_list_the_plans_in_flight_is_not_conclusive', async () => {
    const recovery = new ActivePlanRecovery({ plans: plansThatCouldNotBeListed(), ...rest })

    expect(await recovery.recover()).toBe(false)
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && npx vitest run __tests__/infrastructure/active-plan-recovery.test.js`
Expected: FAIL — la recuperación sigue esperando `list` y llamando a `CmuxActivePlan.parse`

- [ ] **Step 4: Change the recovery**

En `active-plan-recovery.js`: borrar la clase `CmuxActivePlan` entera y los imports que solo ella usaba (`LOOP_BRANCH_PREFIX`, `CmuxPlanAgents`, `PlanIssue`, `PlanWatch`, `RepositoryName`, `WorkspaceLocation`, `UserStoryKey`, `CheckoutRoot` — dejar los que el resto del módulo siga usando). Y en `ActivePlanRecovery`:

```javascript
  constructor({
    plans, implementationStarts, goRegistry, implementationProgress,
    sessions, reviews, pullRequestReviews, activePlans,
  }) {
    this.plans = plans
    this.implementationStarts = implementationStarts
    this.goRegistry = goRegistry
    this.implementationProgress = implementationProgress
    this.sessions = sessions
    this.reviews = reviews
    this.pullRequestReviews = pullRequestReviews
    this.activePlans = activePlans
    this.conclusive = false
  }

  async recover() {
    if (this.conclusive) return true
    const watches = await this.plans.inFlight()
    if (watches === null) return false
    for (const watch of watches) {
      if (this.activePlans.find({ issue: watch.issue.number, repository: watch.repository }) !== null) continue
      if (this.implementationStarts.matches(watch)) {
        this.#rememberImplementing(watch)
        continue
      }
      if (this.goRegistry.matches(watch)) {
        if (await this.#workIsUnderway(watch)) {
          this.#rememberImplementing(watch)
        } else {
          this.activePlans.rememberUncertain(watch)
        }
        continue
      }
      this.sessions.remember(watch)
      this.reviews.startRecovered(watch)
    }
    this.conclusive = true

    return true
  }
```

Se va también el juego de `recovered`/`key` que deduplicaba dos ventanas del mismo issue: `git worktree list` da un worktree por issue, así que el duplicado que aquello atajaba **no puede ocurrir** y una guarda inalcanzable no es una guarda (`simplicity.md`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run __tests__/infrastructure/active-plan-recovery.test.js`
Expected: PASS

- [ ] **Step 6: Wire it in the entrypoint**

En `ct-api.mjs`, sustituir la construcción de `recovery` por:

```javascript
    const recovery = new ActivePlanRecovery({
      plans: new WorktreePlans({
        checkouts,
        survey: async (root) => (await new SurveyWorkspaces({ workspace })
          .execute(new SurveyWorkspacesParams({ root }))).survey,
        sessions: () => listCmuxWorkspaces({ requireComplete: true }),
        planIssues,
        stderr: (line) => process.stderr.write(line),
      }),
      implementationStarts,
      goRegistry,
      implementationProgress: runFileProgress,
      sessions,
      reviews,
      pullRequestReviews,
      activePlans,
    })
```

`SurveyWorkspaces` y `SurveyWorkspacesParams` ya están importados en el entrypoint (los usa `#harvestClock`). Añadir el import de `WorktreePlans`.

- [ ] **Step 7: Write the guardian of the closing criterion**

```javascript
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

class SourceTree {
  static ROOT = join(import.meta.dirname, '..', '..', 'src')

  static modules(directory = SourceTree.ROOT) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return SourceTree.modules(path)

      return [{ path: relative(SourceTree.ROOT, path), text: readFileSync(path, 'utf8') }]
    })
  }

  static containing(fragment) {
    return SourceTree.modules()
      .filter((module) => module.text.includes(fragment))
      .map((module) => module.path)
  }
}

describe('the identity of a plan does not come from the title of a window', () => {
  it('the_only_module_that_names_a_cmux_window_is_the_one_that_opens_it', () => {
    expect(SourceTree.containing('ct-plan-')).toEqual(['infrastructure/cmux-plan-agents.js'])
  })
})
```

`ct-plan-` es la cadena que `CmuxPlanAgents.nameFor` compone y que `CmuxActivePlan` parseaba. Cuando solo la contenga el módulo que la **escribe**, el criterio de cierre está cumplido — y el día que la fase 4 retire ese módulo, este test lo cazará con la lista vacía, que es lo que se quiere.

- [ ] **Step 8: Run the whole suite**

Run: `cd backend && npx vitest run`
Expected: PASS, incluidos los `-real-process`. Si `ct-api-real-process.test.js` arranca el entrypoint de verdad, es el que va a cazar un cableado mal hecho.

- [ ] **Step 9: Verify the closing criterion by hand**

Con un plan en vuelo real (un worktree `.worktrees/<n>` y su ventana de cmux abierta):

1. `curl -s localhost:8787/active-plans` y guardar la respuesta.
2. Matar el backend y arrancarlo otra vez.
3. `curl -s localhost:8787/active-plans` y **comparar campo por campo**: `phase`, `request.id`, `request.repo`, `request.path`, `plan.id`, `plan.issue`, `plan.agent`, `plan.branch`, `plan.worktree`. La story (`id`) tiene que seguir ahí.
4. Comprobar en `stderr` del backend que el barrido de cosecha sigue nombrando el checkout tras el reinicio.

Declarar el resultado en el informe. **Es el criterio de cierre de la fase**, y ningún test lo sustituye: los tests doblan cmux y git.

- [ ] **Step 10: Mutation sweep**

1. En `recover`, cambiar `if (watches === null) return false` por `return true` → debe morir `a_recovery_that_could_not_list_the_plans_in_flight_is_not_conclusive`.
2. En el guardián, añadir la cadena `ct-plan-` a un módulo cualquiera de `src/` → debe morir `no_module_under_src_matches_the_name_of_a_cmux_window_except_the_one_that_writes_it`.

Restaurar y verificar con `git diff --exit-code`. Declarar las dos.

- [ ] **Step 11: Commit**

```bash
git add backend/src/infrastructure/active-plan-recovery.js \
        backend/src/infrastructure/ct-api.mjs \
        backend/__tests__/infrastructure/active-plan-recovery.test.js \
        backend/__tests__/infrastructure/no-window-titles-parsed.test.js
git commit -m "refactor: la recuperación pregunta a git quién está en vuelo, no al título de una ventana"
```

- [ ] **Step 12: Retire the design document from the branch**

El diseño no viaja en la pull request: su contenido ya vive en `mercadona/control-tower#139`.

```bash
git rm docs/superpowers/specs/2026-09-08-el-backend-conduce-design.md \
       docs/superpowers/plans/2026-09-08-fase-1-el-backend-recuerda-lo-suyo.md
git commit -m "docs: el diseño y el plan de la fase 1 salen de la rama, su sitio es el issue 139"
```

---

## Lo que esta fase deja escrito para la siguiente

- **El `agent` sigue viniendo de cmux**, ahora cruzado por directorio. La fase 2 lo hace nacer en `resume`, y la 4 lo elimina.
- **El 503 sigue vivo**, porque `sessions()` puede devolver `null`. Se cae en la fase 4.
- **Un plan cuya ventana murió sigue sin aparecer** en el listado. La fase 4 decide qué significa «vivo» sin ventanas.
- **`ActivePlans` conserva sus tres mapas y la recuperación su papel de arrancar los dos vigilantes con su línea base.** Ese `attended` es memoria genuina y no se deriva de nada; lo que esta fase cambió es la fuente, no la existencia.
