# La señal del `-REVIEW`: la página sabe que el plan se está rehaciendo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la página sepa, sin preguntar a nadie, que un plan está siendo rehecho tras una petición de cambios, y que deje de ofrecer el GO mientras lo esté.

**Architecture:** `GET /plan-events` gana un tercer estado, `reviewing`, compuesto en la capa de aplicación: si el `-REVIEW` más nuevo del issue es posterior al último commit del fichero del plan, hay revisión en vuelo. La fecha del `-REVIEW` no la pregunta la consulta —leer GitHub cada 2 segundos se come el límite de la API—: la apunta el vigilante que ya lee esos comentarios cada 30 segundos, en un registro en memoria detrás de un puerto. El cierre lo pone el commit: cuando el agente recommitea el plan rehecho, el estado vuelve a `ready` solo.

**Tech Stack:** Node 22 con módulos ES, express, vitest en los dos lados; React 19 con TypeScript; `gh` y `git` como únicos clientes externos.

**Spec:** https://github.com/mercadona/control-tower/issues/169 — entrega B de tres. Cierra 9 de los 25 criterios. No cierra la issue: queda la C (el gate del GO, el drenaje antes de pararlo y el agujero del reinicio).

## Global Constraints

- Código nuevo sin comentarios, en inglés y en clases (`plugin/conventions/`, y la vara liga en todo diff). La copia visible es en castellano, porque la página lo es.
- Nada de futuribles: solo lo que esta entrega necesita (`plugin/conventions/simplicity.md`). Un campo, una rama y un símbolo público responden a una llamada que existe.
- `plugin/conventions/defects.md:22-24`: una respuesta lleva el vocabulario que su consumidor necesita para volver a separar los estados. Y `:28-31`: se despacha exhaustivamente, sin rama por defecto.
- `plugin/conventions/testing.md:53` y `:158-160`: un test que solo comprueba que un contenedor guarda lo que le pasaste, o una aserción que solo puede fallar si el lenguaje se rompe, NO se escribe. `:60`: una aserción no está terminada hasta que se la ha visto fallar por la razón que dice su nombre.
- El backend no importa nada nuevo del plugin.
- **Este repositorio NO tiene linter en ningún paquete.** Las únicas comprobaciones son `npm test` por paquete y, en el frontend, `npm run build` (que corre `tsc --noEmit`). NO ejecutes `npx eslint`: npx te lo instala, te modifica `package.json` y `package-lock.json` y te escribe un `eslint.config.js`. Ya pasó en la entrega A y hubo que revertirlo.
- Tests: en el backend, nombres en snake_case describiendo la conducta, e importando `describe`, `it`, `expect` de 'vitest' explícitamente. En el frontend, prosa inglesa empezando por `should`, y vitest corre con `globals: true`: no se importan `describe`, `it`, `expect` ni `vi`.

## Las dos trampas que ya están medidas, para que nadie las descubra a golpes

1. **Las fechas no se comparan como cadenas.** `git log --format=%cI` da `2026-09-09T08:55:39+02:00` y GitHub da `2026-09-09T09:54:05Z` — verificado a mano en las dos fuentes. Comparar esos dos textos con `>` da resultados falsos en cuanto los husos difieren. Se comparan **milisegundos de época**, con `Date.parse`, y se rechaza lo que no parsee.
2. **`ChangeAsked` lo construyen dos adaptadores**: `gh-plan-issues.js:156` (los `-REVIEW` de un issue de plan) y `gh-pull-requests.js:86` (los cambios pedidos en una pull request). Solo el primero tiene fecha. El criterio habla de `changesAsked`, no de `fixesAsked`, así que el campo se añade al value object y **solo el camino de planes lo exige**; el de pull requests declara que no la tiene.

Y una tercera que condiciona la forma: **`ReviewWatch` se instancia dos veces** (`ct-api.mjs#planReviews` y `#pullRequestReviews`) y las dos llavean por `repo#issue`. Cada vigilante recibe **su propio registro**, así que un comentario de arreglo en una pull request no puede hacer que un plan parezca en revisión.

## File Structure

| Fichero | Responsabilidad |
|---|---|
| `backend/src/domain/value-objects/change-asked.js` | gana `askedAt`, que puede ser `null` |
| `backend/src/infrastructure/gh-plan-issues.js` | exige `createdAt` en cada comentario y lo lleva al value object |
| `backend/src/infrastructure/gh-pull-requests.js` | declara que su camino no trae fecha |
| `backend/src/domain/ports/review-log.js` | el puerto: apuntar y leer la fecha del `-REVIEW` más nuevo |
| `backend/src/infrastructure/memory-review-log.js` | el registro en memoria, uno por vigilante |
| `backend/src/infrastructure/review-watch.js` | apunta en cada barrido, entregue o no |
| `backend/src/domain/ports/plan-progress.js` | gana `committedAt({ located })` |
| `backend/src/infrastructure/plan-contract-progress.js` | lo implementa con `git log -1 --format=%cI` |
| `backend/src/domain/value-objects/plan-state.js` | gana `REVIEWING` |
| `backend/src/application/queries/read-plan-progress.js` | compone el estado, comparando épocas |
| `backend/src/infrastructure/ct-api.mjs` | cablea el registro del vigilante de planes con la consulta |
| `backend/API.md` | documenta el tercer estado y que no pregunta a GitHub |
| `frontend/src/app/plan-events/PlanEvents.types.ts` | `reviewing` en el tipo del estado |
| `frontend/src/app/plan-events/usePlanProgress.ts` | `reviewing` en la unión de fases |
| `frontend/src/app/plan-events/components/plan-progress/PlanProgress.tsx` | lo dice, y avisa a su padre |
| `frontend/src/app/review-plan/components/ask-plan-changes/AskPlanChanges.tsx` | deja de afirmar que el plan ya está publicado |
| `frontend/src/pages/home/Home.tsx` | sigue escuchando toda la etapa, vuelve a `planning`, y descartar reconcilia |

---

### Task 1: `ChangeAsked` lleva la fecha, y solo el camino de planes la exige

**Files:**
- Modify: `backend/src/domain/value-objects/change-asked.js`
- Modify: `backend/src/infrastructure/gh-plan-issues.js` (`#demandRead`, `#changesIn`)
- Modify: `backend/src/infrastructure/gh-pull-requests.js:86`
- Test: `backend/__tests__/infrastructure/gh-plan-issues.test.js`

**Interfaces:**
- Produces: `new ChangeAsked({ id, text, askedAt })` con `askedAt` un string ISO o `null`. `changesAsked` devuelve cada cambio con su `askedAt` relleno, y lanza `PlanChangesNotUnderstood` si un comentario llega sin `createdAt`.

- [ ] **Step 1: Escribe los tests que fallan**

En `backend/__tests__/infrastructure/gh-plan-issues.test.js`, dentro del `describe` que ya cubre `changesAsked`. Los comentarios de mentira de ese fichero tendrán que ganar `createdAt`; mira cómo están declarados (`BARE_GO`, `THE_GO` y compañía) y añádeselo a los que representen comentarios legítimos.

```javascript
  it('a_change_asked_for_carries_the_date_the_comment_was_created', async () => {
    const printed = JSON.stringify({ comments: [
      { id: 'IC_1', body: '-REVIEW parte la tarea 2', createdAt: '2026-09-09T09:54:05Z' },
    ] })
    const gh = { run: async () => ({ failed: false, stdout: printed, stderr: '' }) }
    const issues = new GhPlanIssues({ gh, stderr: () => {} })

    const [change] = await issues.changesAsked({ issue: THE_ISSUE, repository: THE_REPOSITORY })

    expect(change.askedAt).toBe('2026-09-09T09:54:05Z')
  })

  it('a_comment_that_arrives_without_its_date_is_refused_because_the_review_state_is_read_from_it', async () => {
    const printed = JSON.stringify({ comments: [{ id: 'IC_1', body: '-REVIEW parte la tarea 2' }] })
    const gh = { run: async () => ({ failed: false, stdout: printed, stderr: '' }) }
    const issues = new GhPlanIssues({ gh, stderr: () => {} })

    await expect(issues.changesAsked({ issue: THE_ISSUE, repository: THE_REPOSITORY }))
      .rejects.toThrow(PlanChangesNotUnderstood)
  })
```

`THE_ISSUE` y `THE_REPOSITORY` son los que ese fichero ya usa; reutilízalos en vez de construir otros.

- [ ] **Step 2: Corre los tests y comprueba que fallan**

Run: `cd backend && npx vitest run __tests__/infrastructure/gh-plan-issues.test.js`
Expected: FAIL — `change.askedAt` es `undefined`, y el segundo test no lanza.

- [ ] **Step 3: Añade el campo al value object**

`backend/src/domain/value-objects/change-asked.js`:

```javascript
export class ChangeAsked {
  constructor({ id, text, askedAt }) {
    this.id = id
    this.text = text
    this.askedAt = askedAt
    Object.freeze(this)
  }
}
```

- [ ] **Step 4: Exígelo y llévalo, en el camino de planes**

En `backend/src/infrastructure/gh-plan-issues.js`, `#demandRead` pasa a exigir también `createdAt`:

```javascript
  static #demandRead(comment, issue) {
    if (typeof comment?.id === 'string' && typeof comment?.body === 'string' &&
      typeof comment?.createdAt === 'string') return

    throw new PlanChangesNotUnderstood(
      `${Gh.BIN} answered a comment of ${issue.number} without the id, the body and the date this reads, it printed ${JSON.stringify(comment)}`
    )
  }
```

Y `#changesIn` lo lleva al value object, junto al `id` y al `text` que ya lleva:

```javascript
        askedAt: comment.createdAt,
```

- [ ] **Step 5: Declara que el otro camino no la tiene**

En `backend/src/infrastructure/gh-pull-requests.js:86`, pasa `askedAt: null` explícitamente. Es una línea, y dice en el sitio que ese camino no lee fechas — mejor que dejar el campo `undefined` por omisión.

- [ ] **Step 6: Corre los dos ficheros y comprueba que pasan**

Run: `cd backend && npx vitest run __tests__/infrastructure/gh-plan-issues.test.js __tests__/infrastructure/gh-pull-requests.test.js`
Expected: PASS los dos. Si `gh-pull-requests.test.js` afirma la forma de un `ChangeAsked`, actualiza la expectativa al campo nuevo; no relajes la aserción.

- [ ] **Step 7: Commit**

```bash
git add backend/src/domain/value-objects/change-asked.js backend/src/infrastructure/gh-plan-issues.js backend/src/infrastructure/gh-pull-requests.js backend/__tests__/infrastructure/
git commit -m "feat(backend): un cambio pedido lleva la fecha en la que se pidio

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: El registro de revisiones, y el vigilante apunta en cada barrido

**Files:**
- Create: `backend/src/domain/ports/review-log.js`
- Create: `backend/src/infrastructure/memory-review-log.js`
- Modify: `backend/src/infrastructure/review-watch.js`
- Test: `backend/__tests__/infrastructure/memory-review-log.test.js`
- Test: `backend/__tests__/infrastructure/review-watch.test.js`

**Interfaces:**
- Consumes: `ChangeAsked.askedAt` de la Task 1.
- Produces: el puerto `ReviewLog` con `noted({ issue, repository, at })` y `lastAskedAt({ issue, repository })`, que devuelve un string ISO o `null`. `MemoryReviewLog` lo implementa. `ReviewWatch` acepta `log` en su constructor y apunta la fecha más nueva que lee en cada barrido, **haya entregado o no**.

- [ ] **Step 1: Escribe los tests del registro**

Crea `backend/__tests__/infrastructure/memory-review-log.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { MemoryReviewLog } from '../../src/infrastructure/memory-review-log.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'

const REPOSITORY = new RepositoryName('jjponz/repo-pulse')
const OTHER = new RepositoryName('jjponz/other')

describe('MemoryReviewLog', () => {
  it('a_plan_nobody_asked_changes_for_has_no_date', () => {
    expect(new MemoryReviewLog().lastAskedAt({ issue: 54, repository: REPOSITORY })).toBeNull()
  })

  it('what_it_answers_is_the_newest_date_it_was_told_about_not_the_last_one', () => {
    const log = new MemoryReviewLog()

    log.noted({ issue: 54, repository: REPOSITORY, at: '2026-09-09T10:00:00Z' })
    log.noted({ issue: 54, repository: REPOSITORY, at: '2026-09-09T09:00:00Z' })

    expect(log.lastAskedAt({ issue: 54, repository: REPOSITORY })).toBe('2026-09-09T10:00:00Z')
  })

  it('two_issues_of_the_same_repository_are_told_apart', () => {
    const log = new MemoryReviewLog()

    log.noted({ issue: 54, repository: REPOSITORY, at: '2026-09-09T10:00:00Z' })

    expect(log.lastAskedAt({ issue: 55, repository: REPOSITORY })).toBeNull()
  })

  it('two_repositories_with_the_same_issue_number_are_told_apart', () => {
    const log = new MemoryReviewLog()

    log.noted({ issue: 54, repository: REPOSITORY, at: '2026-09-09T10:00:00Z' })

    expect(log.lastAskedAt({ issue: 54, repository: OTHER })).toBeNull()
  })

  it('a_date_that_cannot_be_read_as_a_moment_is_not_noted', () => {
    const log = new MemoryReviewLog()

    log.noted({ issue: 54, repository: REPOSITORY, at: 'un rato' })

    expect(log.lastAskedAt({ issue: 54, repository: REPOSITORY })).toBeNull()
  })
})
```

- [ ] **Step 2: Corre y comprueba que fallan**

Run: `cd backend && npx vitest run __tests__/infrastructure/memory-review-log.test.js`
Expected: FAIL — no existe `memory-review-log.js`.

- [ ] **Step 3: Escribe el puerto y el registro**

Crea `backend/src/domain/ports/review-log.js`:

```javascript
export class ReviewLog {
  noted({ issue, repository, at }) {
    throw new Error(
      `${this.constructor.name} must implement noted({ issue, repository, at }), told about ${issue} in ${repository} at ${at}`
    )
  }

  lastAskedAt({ issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement lastAskedAt({ issue, repository }), asked for ${issue} in ${repository}`
    )
  }
}
```

Crea `backend/src/infrastructure/memory-review-log.js`:

```javascript
import { ReviewLog } from '../domain/ports/review-log.js'

export class MemoryReviewLog extends ReviewLog {
  constructor() {
    super()
    this.newest = new Map()
  }

  static #keyFor(repository, issue) {
    return `${repository.text}#${issue}`
  }

  noted({ issue, repository, at }) {
    const moment = Date.parse(at)
    if (Number.isNaN(moment)) return
    const key = MemoryReviewLog.#keyFor(repository, issue)
    const known = this.newest.get(key)
    if (known !== undefined && Date.parse(known) >= moment) return

    this.newest.set(key, at)
  }

  lastAskedAt({ issue, repository }) {
    return this.newest.get(MemoryReviewLog.#keyFor(repository, issue)) ?? null
  }
}
```

Es memoria y no disco, a diferencia de los tres registros de `disk-*-registry.js`, porque esto no es estado que el backend tenga que recordar: es una caché de un hecho que vive en GitHub y que el vigilante vuelve a derivar en cada barrido. Al reiniciar, su primer barrido lo repuebla.

- [ ] **Step 4: Corre y comprueba que pasan**

Run: `cd backend && npx vitest run __tests__/infrastructure/memory-review-log.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Escribe los tests del vigilante que fallan**

`backend/__tests__/infrastructure/review-watch.test.js` ya trae un `WatchDouble` que construye el `ReviewWatch` con sus dobles. Tócalo en tres sitios y añade tres casos.

Primero, sus dos cambios de mentira ganan fecha, y la segunda es la más nueva:

```javascript
  static A_CHANGE = new ChangeAsked({
    id: 'IC_kwDOT9lB5c8AAAABRCF0GG',
    text: 'añade el caso de la issue sin descripción',
    askedAt: '2026-09-09T09:00:00Z',
  })

  static ANOTHER_CHANGE = new ChangeAsked({
    id: 'IC_kwDOT9lB5c8AAAABRCF0HH',
    text: WatchDouble.A_CHANGE.text,
    askedAt: '2026-09-09T10:00:00Z',
  })
```

Segundo, el doble tiene su propio registro, y se lo pasa al vigilante. En el constructor:

```javascript
    this.log = new MemoryReviewLog()
```

y en `#reviews()`, junto a `stderr` y `label`:

```javascript
      log: this.log,
```

Importa `MemoryReviewLog` arriba. Y tercero, los tres casos, en un `describe` propio:

```javascript
describe('the watch notes when changes were asked for, so the plan state can be read without asking GitHub', () => {
  it('the_newest_date_it_reads_is_noted_even_on_the_baseline_sweep_that_delivers_nothing', async () => {
    const watched = WatchDouble.recovering([WatchDouble.A_CHANGE, WatchDouble.ANOTHER_CHANGE])

    await watched.runRecovered()

    expect(watched.reviewed).toEqual([])
    expect(watched.log.lastAskedAt(WatchDouble.STOPPING)).toBe(WatchDouble.ANOTHER_CHANGE.askedAt)
  })

  it('a_sweep_that_delivers_a_change_notes_its_date_too', async () => {
    const watched = WatchDouble.answering([WatchDouble.A_CHANGE])

    await watched.run()

    expect(watched.reviewed).toHaveLength(1)
    expect(watched.log.lastAskedAt(WatchDouble.STOPPING)).toBe(WatchDouble.A_CHANGE.askedAt)
  })

  it('a_sweep_that_could_not_be_read_notes_nothing_instead_of_noting_a_gap', async () => {
    const watched = WatchDouble.answering(new PlanChangesNotRead('HTTP 502'))

    await watched.run()

    expect(watched.log.lastAskedAt(WatchDouble.STOPPING)).toBeNull()
    expect(watched.warnings).toHaveLength(1)
  })
})
```

`WatchDouble.STOPPING` es ya `{ issue, repository }`, que es exactamente lo que `lastAskedAt` pide: reutilízalo en vez de escribir otro objeto. El primer caso es el que importa: un vigilante **recuperado** no entrega lo viejo, y aun así tiene que dejar la fecha, porque si no un reinicio a mitad de revisión dejaría el estado en `ready` mintiendo.

- [ ] **Step 6: Corre y comprueba que fallan**

Run: `cd backend && npx vitest run __tests__/infrastructure/review-watch.test.js`
Expected: FAIL — `ReviewWatch` no acepta `log`.

- [ ] **Step 7: Que el vigilante apunte**

En `backend/src/infrastructure/review-watch.js`: acepta `log` en el constructor y apunta dentro de `#sound`, que es el único sitio por el que pasan **los dos** caminos, el del baseline y el de la entrega:

```javascript
  async #sound(watch) {
    try {
      const read = await this.asked(watch)
      this.#note(watch, read.changes)

      return read
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      this.#warn(watch, `could not be asked what changes were asked for: ${cause.message}`)

      return null
    }
  }

  #note(watch, changes) {
    for (const change of changes) {
      if (change.askedAt === null) continue
      this.log.noted({ issue: watch.issue.number, repository: watch.repository, at: change.askedAt })
    }
  }
```

Apuntar dentro de `#sound` y no en `#attend` es lo que hace que el barrido de baseline —el que un vigilante recuperado usa para NO reentregar lo viejo— también deje la fecha, que es justo el caso que la Task 4 necesita para no perder una revisión al reiniciar.

- [ ] **Step 8: Corre y comprueba que pasan**

Run: `cd backend && npx vitest run __tests__/infrastructure/review-watch.test.js`
Expected: PASS, todo el fichero. Los tests que ya había no deben cambiar: el vigilante entrega lo mismo que antes.

- [ ] **Step 9: Commit**

```bash
git add backend/src/domain/ports/review-log.js backend/src/infrastructure/memory-review-log.js backend/src/infrastructure/review-watch.js backend/__tests__/infrastructure/memory-review-log.test.js backend/__tests__/infrastructure/review-watch.test.js
git commit -m "feat(backend): el vigilante apunta cuando se pidieron los cambios

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: El puerto sabe cuándo se commiteó el plan

**Files:**
- Modify: `backend/src/domain/ports/plan-progress.js`
- Modify: `backend/src/infrastructure/plan-contract-progress.js`
- Test: `backend/__tests__/infrastructure/plan-contract-progress.test.js`

**Interfaces:**
- Produces: `await planProgress.committedAt({ located })`, que devuelve un string ISO 8601 o `null` si el fichero del plan no está commiteado todavía. Lanza `PlanProgressNotRead` si git se niega.

- [ ] **Step 1: Escribe los tests que fallan**

En `backend/__tests__/infrastructure/plan-contract-progress.test.js`, con los dobles de `node` y `git` que ese fichero ya usa:

```javascript
describe('when the plan was last committed', () => {
  it('the_date_git_prints_is_the_date_it_answers', async () => {
    const git = async () => ({ failed: false, stdout: '2026-09-09T08:55:39+02:00\n', stderr: '' })
    const progress = new PlanContractProgress({ node: NEVER_ASKED, git, dispatchCheck: DISPATCH_CHECK })

    expect(await progress.committedAt({ located: LOCATED })).toBe('2026-09-09T08:55:39+02:00')
  })

  it('a_plan_that_was_never_committed_has_no_date_instead_of_an_empty_one', async () => {
    const git = async () => ({ failed: false, stdout: '\n', stderr: '' })
    const progress = new PlanContractProgress({ node: NEVER_ASKED, git, dispatchCheck: DISPATCH_CHECK })

    expect(await progress.committedAt({ located: LOCATED })).toBeNull()
  })

  it('it_asks_git_only_for_the_plans_path_so_another_commit_cannot_answer_for_the_plan', async () => {
    const asked = []
    const git = async (argv) => { asked.push(argv); return { failed: false, stdout: '\n', stderr: '' } }

    await new PlanContractProgress({ node: NEVER_ASKED, git, dispatchCheck: DISPATCH_CHECK })
      .committedAt({ located: LOCATED })

    expect(asked).toEqual([[
      '-C', LOCATED.path, 'log', '-1', '--format=%cI', '--', 'docs/superpowers/plans',
    ]])
  })

  it('a_git_that_refuses_is_a_failure_and_not_a_missing_date', async () => {
    const git = async () => ({ failed: true, stdout: '', stderr: 'not a git repository\n' })
    const progress = new PlanContractProgress({ node: NEVER_ASKED, git, dispatchCheck: DISPATCH_CHECK })

    await expect(progress.committedAt({ located: LOCATED })).rejects.toThrow(PlanProgressNotRead)
  })
})
```

`NEVER_ASKED`, `DISPATCH_CHECK` y `LOCATED` son los que ese fichero ya declara, o sus equivalentes; ábrelo primero y usa los suyos. El tercer test es el que importa: sin el `-- docs/superpowers/plans`, git contestaría la fecha de **cualquier** último commit, y el estado `reviewing` se cerraría con un commit que no es el plan.

- [ ] **Step 2: Corre y comprueba que fallan**

Run: `cd backend && npx vitest run __tests__/infrastructure/plan-contract-progress.test.js`
Expected: FAIL — `committedAt is not a function`.

- [ ] **Step 3: Añádelo al puerto**

En `backend/src/domain/ports/plan-progress.js`, junto a `of`:

```javascript
  async committedAt({ located }) {
    throw new Error(
      `${this.constructor.name} must implement committedAt({ located }), asked for ${located?.path}`
    )
  }
```

- [ ] **Step 4: Impleméntalo**

En `backend/src/infrastructure/plan-contract-progress.js`, junto a `pendingArgvFor`:

```javascript
  static committedAtArgvFor(located) {
    return ['-C', located.path, 'log', '-1', '--format=%cI', '--', PlanContractProgress.PLANS]
  }

  async committedAt({ located }) {
    const dated = await this.git(PlanContractProgress.committedAtArgvFor(located))
    if (dated.failed) {
      throw new PlanProgressNotRead(
        `git log could not say when the plan of ${located.path} was committed: ${dated.stderr.trim()}`
      )
    }
    const printed = dated.stdout.trim()

    return printed.length === 0 ? null : printed
  }
```

- [ ] **Step 5: Corre y comprueba que pasan**

Run: `cd backend && npx vitest run __tests__/infrastructure/plan-contract-progress.test.js`
Expected: PASS, todo el fichero.

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain/ports/plan-progress.js backend/src/infrastructure/plan-contract-progress.js backend/__tests__/infrastructure/plan-contract-progress.test.js
git commit -m "feat(backend): el progreso del plan sabe cuando se commiteo

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: El estado `reviewing`, compuesto comparando momentos y no textos

**Files:**
- Modify: `backend/src/domain/value-objects/plan-state.js`
- Modify: `backend/src/application/queries/read-plan-progress.js`
- Test: `backend/__tests__/application/read-plan-progress.test.js`

**Interfaces:**
- Consumes: `ReviewLog.lastAskedAt` de la Task 2, `PlanProgress.committedAt` de la Task 3.
- Produces: `new ReadPlanProgress({ planProgress, reviewLog })`. `execute` devuelve `state: PlanState.REVIEWING` cuando hay revisión en vuelo, y si no lo que `planProgress.of` diga.

- [ ] **Step 1: Escribe los tests que fallan**

Crea `backend/__tests__/application/read-plan-progress.test.js` (si ya existe, añade el `describe` nuevo y deja los casos que haya). El `Flow` cuenta a quién se preguntó, porque dos de los criterios son justamente que no se pregunte de más:

```javascript
import { describe, it, expect } from 'vitest'
import { ReadPlanProgress, ReadPlanProgressParams } from '../../src/application/queries/read-plan-progress.js'
import { PlanState } from '../../src/domain/value-objects/plan-state.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'

const ISSUE = new PlanIssue({ number: 54, url: 'https://github.com/jjponz/repo-pulse/issues/54' })
const REPOSITORY = new RepositoryName('jjponz/repo-pulse')
const LOCATED = new WorkspaceLocation({ path: '/repo/.worktrees/54', branch: 'feat/54' })

class Flow {
  constructor({ askedAt = null, committedAt = null, onDisk = PlanState.READY } = {}) {
    this.askedFor = []
    this.committedAsked = 0
    this.diskAsked = 0
    this.reviewLog = {
      lastAskedAt: (asked) => {
        this.askedFor.push(asked)

        return askedAt
      },
    }
    this.planProgress = {
      committedAt: async () => {
        this.committedAsked += 1

        return committedAt
      },
      of: async () => {
        this.diskAsked += 1

        return onDisk
      },
    }
  }

  async run() {
    const read = await new ReadPlanProgress({
      planProgress: this.planProgress,
      reviewLog: this.reviewLog,
    }).execute(new ReadPlanProgressParams({ located: LOCATED, issue: ISSUE, repository: REPOSITORY }))

    return read.state
  }
}

describe('a plan being reworked is told apart from one waiting for a person', () => {
  it('a_plan_nobody_asked_changes_for_is_read_from_disk_and_git_is_not_asked_for_a_date', async () => {
    const flow = new Flow({ askedAt: null, onDisk: PlanState.WRITING })

    expect(await flow.run()).toBe(PlanState.WRITING)
    expect(flow.committedAsked).toBe(0)
    expect(flow.askedFor).toEqual([{ issue: 54, repository: REPOSITORY }])
  })

  it('a_change_asked_for_after_the_plan_was_committed_is_a_review_in_flight_and_disk_is_not_asked', async () => {
    const flow = new Flow({ askedAt: '2026-09-09T10:00:00Z', committedAt: '2026-09-09T09:00:00Z' })

    expect(await flow.run()).toBe(PlanState.REVIEWING)
    expect(flow.diskAsked).toBe(0)
  })

  it('a_change_asked_for_on_a_plan_that_was_never_committed_is_a_review_in_flight', async () => {
    const flow = new Flow({ askedAt: '2026-09-09T10:00:00Z', committedAt: null })

    expect(await flow.run()).toBe(PlanState.REVIEWING)
  })

  it('a_change_asked_for_before_the_plan_was_recommitted_is_no_longer_in_flight', async () => {
    const flow = new Flow({ askedAt: '2026-09-09T09:00:00Z', committedAt: '2026-09-09T10:00:00Z' })

    expect(await flow.run()).toBe(PlanState.READY)
  })

  it('the_two_dates_are_compared_as_moments_and_not_as_text_because_git_and_github_do_not_write_them_alike', async () => {
    const asText = new Flow({ askedAt: '2026-09-09T10:00:00Z', committedAt: '2026-09-09T11:00:00+02:00' })

    expect(await asText.run()).toBe(PlanState.REVIEWING)

    const other = new Flow({ askedAt: '2026-09-09T09:54:05Z', committedAt: '2026-09-09T11:55:39+02:00' })

    expect(await other.run()).toBe(PlanState.READY)
  })

  it('a_date_that_cannot_be_read_as_a_moment_does_not_claim_a_review', async () => {
    const flow = new Flow({ askedAt: 'un rato', onDisk: PlanState.READY })

    expect(await flow.run()).toBe(PlanState.READY)
    expect(flow.committedAsked).toBe(0)
  })
})
```

El quinto caso es el que justifica todo este párrafo del plan, y merece leerse dos veces. En el primer par, `10:00:00Z` es `12:00` local y el commit es `11:00` local: hay revisión en vuelo, pero comparados **como texto** `'2026-09-09T10...' < '2026-09-09T11...'` habría dicho que no. En el segundo par, `09:54:05Z` es `11:54:05` local y el commit `11:55:39` local: no hay revisión, y ahí el texto acierta por casualidad. Un test con solo el segundo par pasaría con la implementación equivocada.

Si `WorkspaceLocation` no acepta `{ path, branch }` a secas, usa la forma que usen los tests vecinos (`review-watch.test.js` usa esa) y dilo en tu informe.

- [ ] **Step 2: Corre y comprueba que fallan**

Run: `cd backend && npx vitest run __tests__/application/read-plan-progress.test.js`
Expected: FAIL — `ReadPlanProgress` no acepta `reviewLog`.

- [ ] **Step 3: Añade el estado**

`backend/src/domain/value-objects/plan-state.js`:

```javascript
export class PlanState {
  static WRITING = 'writing'
  static READY = 'ready'
  static REVIEWING = 'reviewing'
}
```

- [ ] **Step 4: Compón el estado en la consulta**

`backend/src/application/queries/read-plan-progress.js`: el constructor gana `reviewLog`, y `execute` compone. Las fechas se comparan como milisegundos de época, nunca como cadenas:

```javascript
export class ReadPlanProgress {
  constructor({ planProgress, reviewLog }) {
    this.planProgress = planProgress
    this.reviewLog = reviewLog
  }

  async execute(params) {
    return new ReadPlanProgressResult({
      state: await this.#stateOf(params),
    })
  }

  async #stateOf(params) {
    if (await this.#underReview(params)) return PlanState.REVIEWING

    return await this.planProgress.of({
      located: params.located,
      issue: params.issue,
      repository: params.repository,
    })
  }

  async #underReview(params) {
    const asked = ReadPlanProgress.#momentOf(
      this.reviewLog.lastAskedAt({ issue: params.issue.number, repository: params.repository })
    )
    if (asked === null) return false
    const committed = ReadPlanProgress.#momentOf(
      await this.planProgress.committedAt({ located: params.located })
    )

    return committed === null || asked > committed
  }

  static #momentOf(dated) {
    if (typeof dated !== 'string') return null
    const moment = Date.parse(dated)

    return Number.isNaN(moment) ? null : moment
  }
}
```

Importa `PlanState` en ese fichero. Ojo con las dos direcciones, porque **no son la misma** y una versión anterior de este plan lo decía mal. La regla se lee en una frase: **hay revisión en vuelo salvo que el plan se haya recommiteado demostrablemente después de pedirla.** De ahí sale que una fecha PEDIDA ilegible no afirme nada —cae al estado de disco, porque no se puede demostrar que empezara una revisión— y que una fecha de COMMIT ilegible sí afirme `reviewing`, porque no se puede demostrar que la revisión se cerrara. Esa segunda dirección es deliberada: esta función existe para impedir un GO sobre un plan viejo, así que cuando no se puede probar que el plan se rehízo, no se concede el GO. Escríbelo con un predicado que lo diga —`#recommittedSince`— en vez de dejarlo colgando de que `#momentOf` devuelva `null` para los dos casos por coincidencia, y fíjalo con un test.

- [ ] **Step 5: Corre y comprueba que pasan**

Run: `cd backend && npx vitest run __tests__/application/read-plan-progress.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 6: Comprueba que el estado viaja por el stream sin tocar la ruta**

Run: `cd backend && npx vitest run __tests__/infrastructure/plan-events-route.test.js`
Expected: PASS sin cambios. `PlanEvents.stream` emite el `state` que le devuelvan y solo cuando cambia (`plan-events-route.js:134-137`), así que el tercer estado viaja sin que la ruta aprenda nada. Si algún test de ese fichero enumera los estados posibles, añádele `reviewing`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/domain/value-objects/plan-state.js backend/src/application/queries/read-plan-progress.js backend/__tests__/application/read-plan-progress.test.js backend/__tests__/infrastructure/plan-events-route.test.js
git commit -m "feat(backend): plan-events dice reviewing mientras el plan se rehace

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Cablearlo, con un registro por vigilante, y documentarlo

**Files:**
- Modify: `backend/src/infrastructure/ct-api.mjs`
- Modify: `backend/API.md`
- Test: `backend/__tests__/infrastructure/ct-api-real-process.test.js`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: el proceso real compone `#planReviews` y `#planEvents` alrededor del **mismo** `MemoryReviewLog`, y `#pullRequestReviews` alrededor de **otro**.

- [ ] **Step 1: Cablea, con la separación que importa**

En `backend/src/infrastructure/ct-api.mjs`, construye un `MemoryReviewLog` para los planes y pásalo a los dos sitios que lo comparten:

```javascript
    const planReviewLog = new MemoryReviewLog()
```

`#planReviews(planIssues, planAgents, log)` se lo pasa a su `ReviewWatch`, y `#planEvents(git, log)` se lo pasa a `ReadPlanProgress` como `reviewLog`. `#pullRequestReviews` construye **el suyo propio** — nunca el mismo.

Esa separación no es de estilo: los dos vigilantes llavean por `repo#issue`, así que compartir el registro dejaría que un cambio pedido en una pull request hiciera parecer que el plan de ese mismo issue está en revisión.

- [ ] **Step 2: Escribe el test del proceso real que falla**

En `backend/__tests__/infrastructure/ct-api-real-process.test.js`, con el armazón `Entrypoint` que ese fichero ya usa (mira `review_plan_is_mounted_in_the_real_process_and_not_only_in_the_test_server`):

```javascript
  it('plan_events_refuses_an_issue_this_process_never_watched_instead_of_crashing_for_want_of_a_review_log', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    const response = await fetch(`http://127.0.0.1:${port}/plan-events/54?repo=jjponz%2Frepo-pulse`)

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('not-watched')
  })
```

Contesta `not-watched` y no `request-failed`: eso es lo que prueba que la ruta y su consulta están compuestas en el proceso real. Un `reviewLog` sin cablear daría `request-failed` en cuanto la consulta corriera.

- [ ] **Step 3: Corre los dos y comprueba**

Run: `cd backend && npx vitest run __tests__/infrastructure/ct-api-real-process.test.js`
Expected: PASS.

- [ ] **Step 4: Documenta el tercer estado**

En `backend/API.md`, sección `GET /plan-events/:issue`: `state` pasa a ser `writing`, `ready` o `reviewing`. Di las tres cosas que un desarrollador del frontend necesita y no puede deducir:

1. `reviewing` significa que se pidieron cambios y el agente aún no ha recommiteado el plan rehecho.
2. Sale de comparar la fecha del `-REVIEW` más nuevo con la del último commit del fichero del plan, **y el endpoint no pregunta nada a GitHub por su cuenta**: la fecha la apunta el vigilante de revisiones en su barrido de 30 segundos, así que un `-REVIEW` recién comentado puede tardar hasta ese barrido en aparecer como `reviewing`.
3. Vuelve a `ready` solo, cuando el agente recommitea.

- [ ] **Step 5: Commit**

```bash
git add backend/src/infrastructure/ct-api.mjs backend/API.md backend/__tests__/infrastructure/ct-api-real-process.test.js
git commit -m "feat(backend): reviewing cableado en el proceso real y documentado

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: La página dice que el plan se está rehaciendo

**Files:**
- Modify: `frontend/src/app/plan-events/PlanEvents.types.ts`
- Modify: `frontend/src/app/plan-events/usePlanProgress.ts`
- Modify: `frontend/src/app/plan-events/components/plan-progress/PlanProgress.tsx`
- Modify: `frontend/src/app/review-plan/components/ask-plan-changes/AskPlanChanges.tsx`
- Modify: `frontend/src/__scenarios__/PlanEventsMother.ts`
- Test: `frontend/src/app/plan-events/components/plan-progress/PlanProgress.test.tsx`

**Interfaces:**
- Produces: `PlanState` gana `'reviewing'`; `PlanProgress` acepta `onReviewing?: () => void` y lo llama cuando el estado entra en `reviewing`; `PlanEventsMother.reviewing()` devuelve `'{"state":"reviewing"}'`.

- [ ] **Step 1: Escribe los tests que fallan**

En `frontend/src/app/plan-events/components/plan-progress/PlanProgress.test.tsx`. Su ayudante `renderProgress` ya espía `onReady`; que espíe también el nuevo y lo devuelva:

```typescript
const renderProgress = async (writeToClipboard?: (text: string) => Promise<void>) => {
  const onReady = vi.fn()
  const onReviewing = vi.fn()
  render(<PlanProgress plan={plan} onReady={onReady} onReviewing={onReviewing} writeToClipboard={writeToClipboard} />)
  await screen.findByRole('status')

  return { onReady, onReviewing }
}
```

Y los tres casos, empujando frames como ya lo hace el fichero:

```typescript
  it('should say the plan is being reworked while a review is in flight', async () => {
    await renderProgress()

    act(() => FakeEventSource.last().receive(PlanEventsMother.reviewing()))

    expect(await screen.findByRole('status')).toHaveTextContent(/Rehaciendo el plan/)
  })

  it('should tell its parent when a review starts, so the page can stop offering the go', async () => {
    const { onReviewing } = await renderProgress()

    act(() => FakeEventSource.last().receive(PlanEventsMother.reviewing()))

    expect(onReviewing).toHaveBeenCalledTimes(1)
  })

  it('should not tell its parent a review started when the plan is merely ready', async () => {
    const { onReady, onReviewing } = await renderProgress()

    act(() => FakeEventSource.last().receive(PlanEventsMother.ready()))

    expect(onReady).toHaveBeenCalled()
    expect(onReviewing).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Corre y comprueba que fallan**

Run: `cd frontend && npx vitest run src/app/plan-events/components/plan-progress/PlanProgress.test.tsx`
Expected: FAIL.

- [ ] **Step 3: El estado, por los tres sitios que lo tipan**

`frontend/src/app/plan-events/PlanEvents.types.ts`:

```typescript
export type PlanState = 'writing' | 'ready' | 'reviewing'
```

`frontend/src/app/plan-events/usePlanProgress.ts`, en la unión:

```typescript
  | { phase: 'reviewing' }
```

`frontend/src/__scenarios__/PlanEventsMother.ts`:

```typescript
const reviewing = () => '{"state":"reviewing"}'
```

y añádelo al objeto exportado.

- [ ] **Step 4: Que el componente lo diga y lo avise**

En `PlanProgress.tsx`: un `onReviewing?: () => void` en los props, una constante para la frase, la línea de estado, y el efecto que avisa. El efecto que ya existe avisa de `ready`; añade el de `reviewing` al lado, con la misma forma:

```typescript
const REWORKING_MESSAGE = 'Rehaciendo el plan con los cambios pedidos…'
```

```typescript
      {observe && progress.phase === 'reviewing' && <p className="plan-progress__state" role="status">{REWORKING_MESSAGE}</p>}
```

```typescript
  useEffect(() => {
    if (progress.phase === 'reviewing') onReviewing?.()
  }, [onReviewing, progress.phase])
```

- [ ] **Step 5: Que la página deje de afirmar una publicación que no sabe**

En `AskPlanChanges.tsx`, `WHERE_MESSAGE` afirma «El plan está publicado como el último comentario del issue». El smoke demostró dos veces que eso puede ser falso: `ready` sale del commit y el comentario aterriza después, y en cuanto pides cambios el último comentario es tu propio `-REVIEW`. Cámbialo por una frase que diga **dónde se lee** sin afirmar que ya está:

```typescript
const WHERE_MESSAGE = 'El plan se publica como comentario del issue, y el rehecho también.'
```

Actualiza el test que afirma sobre `/último comentario del issue/` a la frase nueva. Debe seguir afirmando que se dice dónde se lee el plan; no lo borres.

- [ ] **Step 6: Corre los tres ficheros y el tipado**

Run: `cd frontend && npx vitest run src/app/plan-events src/app/review-plan && npx tsc --noEmit -p tsconfig.json`
Expected: PASS los dos.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/plan-events frontend/src/app/review-plan frontend/src/__scenarios__/PlanEventsMother.ts
git commit -m "feat(frontend): la pagina dice que el plan se esta rehaciendo

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: La etapa de revisión escucha hasta el final, y descartar reconcilia

**Files:**
- Modify: `frontend/src/pages/home/Home.tsx`
- Test: `frontend/src/pages/home/__tests__/Home.reviewPlan.test.tsx`

**Interfaces:**
- Consumes: `onReviewing` de la Task 6.
- Produces: nada nuevo. `reviewing` devuelve la instantánea a `phase: 'planning'`, con lo que `ImplementPlanAction` y `AskPlanChanges` dejan de pintarse solos, porque los dos viven dentro del bloque `phase === 'ready'`.

- [ ] **Step 1: Escribe los tests que fallan**

En `frontend/src/pages/home/__tests__/Home.reviewPlan.test.tsx`, con los ayudantes que ese fichero ya usa (`backendAnswering`, `openHome`, `startPlan`, `streamFrame`):

```typescript
  it('should stop offering the go while the plan is being reworked', async () => {
    await planStarted()
    await streamFrame(PlanEventsMother.ready())
    expect(screen.getByRole('button', { name: 'Implementar plan' })).toBeInTheDocument()

    await streamFrame(PlanEventsMother.reviewing())

    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pedir cambios' })).toBeNull()
  })

  it('should offer the go again once the reworked plan is committed', async () => {
    await planStarted()
    await streamFrame(PlanEventsMother.ready())
    await streamFrame(PlanEventsMother.reviewing())

    await streamFrame(PlanEventsMother.ready())

    expect(screen.getByRole('button', { name: 'Implementar plan' })).toBeInTheDocument()
  })
```

El segundo es el que prueba que la etapa **sigue escuchando** después del primer `ready`: hoy `observe` se apaga ahí y el `reviewing` no llegaría nunca.

- [ ] **Step 2: Corre y comprueba que fallan**

Run: `cd frontend && npx vitest run src/pages/home/__tests__/Home.reviewPlan.test.tsx`
Expected: FAIL — el botón sigue ahí tras el frame de `reviewing`.

- [ ] **Step 3: Escucha toda la etapa**

En `Home.tsx`, línea 393, `observe` deja de apagarse al primer `ready`:

```typescript
                observe={workflow.phase !== 'implementing' && restoredIsConfirmed}
```

- [ ] **Step 4: Vuelve a `planning` cuando entra una revisión**

Junto a `planReady` (línea 179), un `planReviewing` con la misma forma:

```typescript
  const planReviewing = useCallback(() => {
    const current = workflowRef.current
    if (current === null || current.phase === 'implementing') return
    const reviewing: WorkflowSnapshot = { ...current, phase: 'planning' }
    workflowRef.current = reviewing
    setWorkflow(reviewing)
    WorkflowSnapshotStorage.save(reviewing)
  }, [])
```

Y pásalo al `PlanProgress` de la etapa de revisión como `onReviewing={planReviewing}`. No lo pases al del resumen de abajo, que va con `observe={false}`.

- [ ] **Step 5: Que descartar reconcilie**

`discardWorkflow` limpia la instantánea pero no vuelve a preguntar qué hay en marcha, así que hace falta recargar para que un plan vivo se adopte. Al final de `discardWorkflow`, después de `WorkflowSnapshotStorage.remove()`:

```typescript
    void reconcile()
```

Quita el `recoveryTokenRef.current = null` de esa función si impide que la reconciliación que acabas de lanzar se aplique — lee `reconcile` antes de tocarlo, porque ese token es el que descarta respuestas viejas.

Y añade el test en `frontend/src/pages/home/__tests__/Home.restoreWorkflow.test.tsx`, que es el fichero que ya cubre la restauración y la reconciliación:

```typescript
  it('should adopt a live plan after discarding a saved one the backend no longer knows, without a reload', async () => {
    // arrange: una instantanea guardada que /active-plans no reconoce, y UN plan activo distinto
    // act: pulsar 'Descartar estado'
    // assert: la pagina cae en la etapa de revision de ESE plan activo, sin volver a renderizar
  })
```

Ese es el único cuerpo que este plan no te da escrito, porque su arreglo depende de cómo ese fichero prepara las dos respuestas consecutivas de `/active-plans` — la que no reconoce lo guardado y la que trae el plan vivo. Ábrelo, usa su manera de encadenarlas, y si no la tiene, escríbela ahí para que se comparta.

- [ ] **Step 6: Corre todo el directorio de Home y el tipado**

Run: `cd frontend && npx vitest run src/pages/home/__tests__/ && npx tsc --noEmit -p tsconfig.json`
Expected: PASS. Si un test existente se rompe porque la etapa ahora escucha más tiempo, **no relajes su aserción**: acota su consulta o dale el frame que le falta, y di en tu informe cuál tocaste y por qué.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/home
git commit -m "feat(frontend): la etapa de revision escucha hasta el final, y descartar reconcilia

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Verificación de la entrega

**Files:**
- Test: las suites de los dos paquetes.

- [ ] **Step 1: La suite del backend**

Run: `cd backend && npx vitest run`
Expected: PASS. Tarda unos 11 segundos.

- [ ] **Step 2: La suite y el build del frontend**

Run: `cd frontend && npx vitest run && npm run build`
Expected: PASS los dos. `npm run build` es `tsc --noEmit` más `vite build`, y es lo que gatea la integración continua.

- [ ] **Step 3: No hay linter, y no se instala uno**

Este repositorio no tiene linter en ningún paquete. NO ejecutes `npx eslint`. Si el árbol trae `eslint` en un `package.json`, un `package-lock.json` tocado o un `eslint.config.js`, reviértelos: los ha puesto npx.

- [ ] **Step 4: Retira el plan y commitea**

El diseño no viaja en la pull request: borra este fichero en su propio commit y lleva su contenido al cuerpo de la pull request.

```bash
git rm docs/superpowers/plans/2026-09-09-issue-169-la-senal-del-review.md
git commit -m "chore: retirar el plan de la senal del -REVIEW

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: Lo que este plan NO puede verificar, y hay que decirlo en la pull request**

El bucle real —pedir cambios y ver la página pasar a `reviewing` y volver a `ready`— exige la API arrancada **dentro de cmux** y un plan de verdad en un repositorio de pruebas. Desde un shell normal, `cmux workspace list --json` contesta `Access denied - only processes started inside cmux can connect`, la recuperación sale inconclusa y `/active-plans` da 503. Declara en la pull request que el smoke a mano queda pendiente y cómo se hace, en vez de dejar que parezca verificado.
