# La puerta del `-REVIEW`: pedir cambios al plan desde la app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una persona pueda pedir cambios al plan desde la página, sin saber que existe un token llamado `-REVIEW` ni tener que escribirlo a mano en GitHub.

**Architecture:** Un endpoint nuevo, `POST /review-plan`, cuyo único efecto es publicar `-REVIEW <texto>` como comentario del issue del plan. El `ReviewWatch` que ya existe lo ve en su barrido de 30 segundos y se lo teclea al agente, exactamente igual que si lo hubieras comentado en GitHub. El endpoint no teclea nada al agente: la única puerta al agente sigue siendo el vigilante, y el issue sigue siendo el registro único de por qué cambió un plan. En el frontend, un componente nuevo en la etapa «Revisar plan» que ya trae `main`.

**Tech Stack:** Node 22 con módulos ES, express, vitest en los dos lados; React 18 con TypeScript; `gh` como único cliente de GitHub.

**Spec:** https://github.com/mercadona/control-tower/issues/169 — esta entrega es la primera de tres (A · la puerta). No cierra la issue: quedan B (la señal `reviewing`) y C (el gate del GO y el agujero del reinicio).

## Global Constraints

- Código nuevo sin comentarios, en inglés y en clases (`plugin/conventions/`, y la vara liga en todo diff).
- Nada de futuribles: solo lo que esta entrega necesita (`backend/conventions/simplicity.md`).
- El backend no importa nada del plugin que no importe ya.
- Cada refusal del API contesta `{"code": "<kebab-case>", "detail": "<una frase>"}`, y se decide por `code`, nunca por status (`backend/API.md`, regla 1).
- Un `POST` con un campo desconocido se rechaza, no se ignora (regla 5).
- El texto que el usuario escribe se publica pasado por `PlanIssueBody.quieted()`: publicar en su nombre no puede avisar a nadie.
- Toda ruta nueva tiene que entrar en `API_PATHS` de `frontend/vite.config.ts`, o el servidor de desarrollo contesta el HTML de la página en vez del API.
- Tests: un `it` por criterio. En el backend el nombre va en snake_case describiendo la conducta (`backend/__tests__/infrastructure/`); en el frontend en prosa inglesa empezando por `should` (`frontend/src/app/implement-plan/client.test.ts`). El frontend corre vitest con `globals: true`: no se importan `describe`, `it`, `expect` ni `vi`.

## File Structure

| Fichero | Responsabilidad |
|---|---|
| `backend/src/domain/exceptions.js` | añade `PlanChangesNotAsked` a la familia `PlanChangesFailure` |
| `backend/src/domain/ports/plan-issues.js` | añade `askChanges({ issue, repository, changes })` al puerto |
| `backend/src/infrastructure/gh-plan-issues.js` | `changesCommentArgvFor` + `askChanges`: el único sitio que sabe cómo se escribe un comentario `-REVIEW` |
| `backend/src/application/actions/ask-plan-changes.js` | la acción: params congelados y una llamada al puerto |
| `backend/src/infrastructure/review-plan-route.js` | parseo del cuerpo, rechazos y respuesta 202 |
| `backend/src/infrastructure/api-server.js` | monta la ruta |
| `backend/src/infrastructure/ct-api.mjs` | cablea la acción real |
| `backend/src/infrastructure/plan-agent-brief.js` | el plan publicado termina diciendo cómo se piden cambios |
| `backend/API.md` | documenta el endpoint |
| `frontend/vite.config.ts` | `/review-plan` en `API_PATHS` |
| `frontend/src/app/review-plan/ReviewPlan.types.ts` | tipos de la petición, el resultado y el outcome |
| `frontend/src/app/review-plan/client.ts` | el `fetch` y la traducción de `code` a `kind` |
| `frontend/src/app/review-plan/components/ask-plan-changes/AskPlanChanges.tsx` | el campo, el botón y lo que se dice después |
| `frontend/src/__scenarios__/ReviewPlanMother.ts` | las respuestas del backend que usan los tests |
| `frontend/src/pages/home/Home.tsx` | lo pinta en la etapa «Revisar plan» |

---

### Task 1: El puerto y el adaptador saben publicar un `-REVIEW`

**Files:**
- Modify: `backend/src/domain/exceptions.js`
- Modify: `backend/src/domain/ports/plan-issues.js`
- Modify: `backend/src/infrastructure/gh-plan-issues.js`
- Test: `backend/__tests__/infrastructure/gh-plan-issues.test.js`

**Interfaces:**
- Consumes: `GhPlanIssues.CHANGES_TOKEN` (`'-REVIEW'`), `PlanIssueBody.quieted(text)`, `Gh.BIN`, `this.gh.run(argv, { safeToRepeat })`.
- Produces: `GhPlanIssues.changesCommentArgvFor({ issueNumber, repository, changes }) -> string[]`; `await ghPlanIssues.askChanges({ issue, repository, changes })` que no devuelve nada y lanza `PlanChangesNotAsked`; `PlanChangesNotAsked` exportada desde `domain/exceptions.js`.

- [ ] **Step 1: Escribe los tests que fallan**

En `backend/__tests__/infrastructure/gh-plan-issues.test.js`, junto al `describe` que ya cubre el GO:

```javascript
describe('asking for changes to the plan publishes them as a comment', () => {
  it('the_comment_starts_with_the_changes_token_and_carries_what_was_asked_for', () => {
    expect(GhPlanIssues.changesCommentArgvFor({
      issueNumber: 33,
      repository: new RepositoryName('jjponz/repo-pulse'),
      changes: 'parte la tarea 2 en dos',
    })).toEqual([
      'issue', 'comment', '33',
      '--repo', 'jjponz/repo-pulse',
      '--body', '-REVIEW parte la tarea 2 en dos',
    ])
  })

  it('what_is_published_is_quieted_so_publishing_on_your_behalf_pings_nobody', () => {
    const argv = GhPlanIssues.changesCommentArgvFor({
      issueNumber: 33,
      repository: new RepositoryName('jjponz/repo-pulse'),
      changes: 'lo que pidió @alcaptar en #162',
    })

    expect(argv[argv.length - 1]).toBe('-REVIEW lo que pidió `@alcaptar` en `#162`')
  })

  it('a_gh_that_refuses_is_told_apart_from_one_that_answered', async () => {
    const gh = { run: async () => ({ failed: true, stdout: '', stderr: 'gh: not found\n' }) }
    const issues = new GhPlanIssues({ gh, stderr: () => {} })

    await expect(issues.askChanges({
      issue: new PlanIssue({ number: 33, url: 'https://github.com/jjponz/repo-pulse/issues/33' }),
      repository: new RepositoryName('jjponz/repo-pulse'),
      changes: 'parte la tarea 2',
    })).rejects.toThrow(PlanChangesNotAsked)
  })

  it('a_comment_is_never_repeated_because_a_repeated_comment_is_a_second_change_asked_for', async () => {
    const asked = []
    const gh = { run: async (argv, options) => { asked.push({ argv, options }); return { failed: false, stdout: '', stderr: '' } } }
    const issues = new GhPlanIssues({ gh, stderr: () => {} })

    await issues.askChanges({
      issue: new PlanIssue({ number: 33, url: 'https://github.com/jjponz/repo-pulse/issues/33' }),
      repository: new RepositoryName('jjponz/repo-pulse'),
      changes: 'parte la tarea 2',
    })

    expect(asked).toHaveLength(1)
    expect(asked[0].options).toEqual({ safeToRepeat: false })
  })
})
```

Añade `PlanChangesNotAsked` al `import` de excepciones del fichero de test.

- [ ] **Step 2: Corre los tests y comprueba que fallan**

Run: `cd backend && npx vitest run __tests__/infrastructure/gh-plan-issues.test.js -t 'asking for changes'`
Expected: FAIL — `changesCommentArgvFor is not a function` y `PlanChangesNotAsked` sin exportar.

- [ ] **Step 3: Añade la excepción**

En `backend/src/domain/exceptions.js`, junto a sus hermanas:

```javascript
export class PlanChangesNotAsked extends PlanChangesFailure {}
```

- [ ] **Step 4: Añade el método al puerto**

En `backend/src/domain/ports/plan-issues.js`, junto a `changesAsked`:

```javascript
  async askChanges({ issue, repository, changes }) {
    throw new Error(
      `${this.constructor.name} must implement askChanges({ issue, repository, changes }), asked for ${issue?.number} in ${repository}`
    )
  }
```

- [ ] **Step 5: Implementa el adaptador**

En `backend/src/infrastructure/gh-plan-issues.js`, añade `PlanChangesNotAsked` al `import` de excepciones. Junto a `goArgvFor`:

```javascript
  static changesCommentArgvFor({ issueNumber, repository, changes }) {
    return [
      'issue', 'comment', String(issueNumber),
      '--repo', repository.text,
      '--body', `${GhPlanIssues.CHANGES_TOKEN} ${PlanIssueBody.quieted(changes)}`,
    ]
  }
```

Y junto a `answerGo`:

```javascript
  async askChanges({ issue, repository, changes }) {
    const outcome = await this.gh.run(
      GhPlanIssues.changesCommentArgvFor({ issueNumber: issue.number, repository, changes }),
      { safeToRepeat: false }
    )
    if (outcome.failed) {
      throw new PlanChangesNotAsked(`${Gh.BIN} issue comment failed: ${outcome.stderr.trim()}`)
    }
  }
```

`PlanIssueBody` se declara más abajo en el mismo fichero que `GhPlanIssues`; se referencia dentro del cuerpo del método, que se evalúa en tiempo de llamada, así que no hay ciclo.

- [ ] **Step 6: Corre los tests y comprueba que pasan**

Run: `cd backend && npx vitest run __tests__/infrastructure/gh-plan-issues.test.js`
Expected: PASS, todo el fichero.

- [ ] **Step 7: Commit**

```bash
git add backend/src/domain/exceptions.js backend/src/domain/ports/plan-issues.js backend/src/infrastructure/gh-plan-issues.js backend/__tests__/infrastructure/gh-plan-issues.test.js
git commit -m "feat(backend): publicar un -REVIEW en el issue del plan es cosa del puerto de issues

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: La acción `AskPlanChanges`

**Files:**
- Create: `backend/src/application/actions/ask-plan-changes.js`
- Test: `backend/__tests__/application/ask-plan-changes.test.js`

**Interfaces:**
- Consumes: `PlanIssues.askChanges` de la Task 1.
- Produces: `new AskPlanChanges({ planIssues })` con `await action.execute(new AskPlanChangesParams({ issue, repository, changes }))`. `AskPlanChangesParams` congela sus campos.

- [ ] **Step 1: Escribe el test que falla**

Crea `backend/__tests__/application/ask-plan-changes.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { AskPlanChanges, AskPlanChangesParams } from '../../src/application/actions/ask-plan-changes.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'

class PlanIssuesSpy {
  constructor() {
    this.asked = []
  }

  async askChanges({ issue, repository, changes }) {
    this.asked.push({ issue: issue.number, repository: repository.text, changes })
  }
}

const ISSUE = new PlanIssue({ number: 33, url: 'https://github.com/jjponz/repo-pulse/issues/33' })
const REPOSITORY = new RepositoryName('jjponz/repo-pulse')

describe('AskPlanChanges', () => {
  it('asks_the_issue_to_carry_the_changes_and_nothing_else', async () => {
    const planIssues = new PlanIssuesSpy()

    await new AskPlanChanges({ planIssues }).execute(
      new AskPlanChangesParams({ issue: ISSUE, repository: REPOSITORY, changes: 'parte la tarea 2' })
    )

    expect(planIssues.asked).toEqual([
      { issue: 33, repository: 'jjponz/repo-pulse', changes: 'parte la tarea 2' },
    ])
  })

  it('its_params_are_frozen_so_nobody_rewrites_what_was_asked_for_on_the_way', () => {
    const params = new AskPlanChangesParams({ issue: ISSUE, repository: REPOSITORY, changes: 'parte la tarea 2' })

    expect(Object.isFrozen(params)).toBe(true)
  })
})
```

- [ ] **Step 2: Corre el test y comprueba que falla**

Run: `cd backend && npx vitest run __tests__/application/ask-plan-changes.test.js`
Expected: FAIL — no existe `src/application/actions/ask-plan-changes.js`.

- [ ] **Step 3: Escribe la acción**

Crea `backend/src/application/actions/ask-plan-changes.js`:

```javascript
export class AskPlanChangesParams {
  constructor({ issue, repository, changes }) {
    this.issue = issue
    this.repository = repository
    this.changes = changes
    Object.freeze(this)
  }
}

export class AskPlanChanges {
  constructor({ planIssues }) {
    this.planIssues = planIssues
  }

  async execute(params) {
    await this.planIssues.askChanges({
      issue: params.issue,
      repository: params.repository,
      changes: params.changes,
    })
  }
}
```

- [ ] **Step 4: Corre el test y comprueba que pasa**

Run: `cd backend && npx vitest run __tests__/application/ask-plan-changes.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/application/actions/ask-plan-changes.js backend/__tests__/application/ask-plan-changes.test.js
git commit -m "feat(backend): la accion de pedir cambios al plan

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: `POST /review-plan`

**Files:**
- Create: `backend/src/infrastructure/review-plan-route.js`
- Modify: `backend/src/infrastructure/api-server.js`
- Test: `backend/__tests__/infrastructure/review-plan-route.test.js`

**Interfaces:**
- Consumes: `AskPlanChanges`/`AskPlanChangesParams` de la Task 2; `Answer`, `Refusal`, `JsonBody`, `Browsers` de `./http.js`; `Projection` de `./projection.js`; `ActivePlans.find({ issue, repository })` de `./active-plans-route.js`; `RepositoryName.isWellFormed`, `RepositoryName.EXAMPLE`; `PlanChangesFailure` de `domain/exceptions.js`.
- Produces: `ReviewPlanRoute.PATH === '/review-plan'`; `ReviewPlanRoute.METHOD === 'POST'`; `ReviewPlanRoute.handledBy(askPlanChanges, activePlans)`; `ReviewPlanRoute.refuseOtherMethods`; `ReviewRequestOutcome` con `ACCEPTED`, `BODY_NOT_A_JSON_OBJECT`, `UNKNOWN_FIELD`, `MALFORMED_ISSUE`, `MALFORMED_REPO`, `MALFORMED_CHANGES`, `NO_LIVE_SESSION`; `ReviewRefusal.of(asked)`; `ReviewCollapse.of(cause)`. `ApiServer` acepta `askPlanChanges` en su objeto de opciones.

- [ ] **Step 1: Escribe los tests que fallan**

Crea `backend/__tests__/infrastructure/review-plan-route.test.js`. Copia el armazón `RunningApi` de `implement-plan-route.test.js` (mismo `ApiServer`, mismo `afterEach`), añadiendo `askPlanChanges` al objeto de opciones y `PATH = '/review-plan'`, con `ACCEPTED_BODY = '{"issue":33,"repo":"jjponz/repo-pulse","changes":"parte la tarea 2"}'`. El espía:

```javascript
class AskPlanChangesSpy {
  constructor() {
    this.asked = []
  }

  static failingWith(cause) {
    const spy = new AskPlanChangesSpy()
    spy.execute = async () => { throw cause }

    return spy
  }

  async execute(params) {
    this.asked.push({ issue: params.issue.number, repository: params.repository.text, changes: params.changes })
  }
}
```

`params.issue` es el `PlanIssue` que la ruta saca de `active.watch.issue`, no un número: el espía apunta su `number` para que la expectativa se lea sola.

Y los casos:

```javascript
describe('ReviewPlanRoute', () => {
  it('a_well_formed_body_for_a_watched_plan_publishes_the_changes_and_answers_accepted', async () => {
    const spy = new AskPlanChangesSpy()
    const response = await RunningApi.post(await RunningApi.listening(spy), RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
    expect(await response.text()).toBe('{"status":"changes-asked","issue":33}')
    expect(spy.asked).toEqual([{ issue: 33, repository: 'jjponz/repo-pulse', changes: 'parte la tarea 2' }])
  })

  it('a_plan_this_process_does_not_watch_is_refused_without_publishing_anything', async () => {
    const spy = new AskPlanChangesSpy()
    const response = await RunningApi.post(
      await RunningApi.listening(spy, { watched: false }), RunningApi.ACCEPTED_BODY
    )

    expect(response.status).toBe(409)
    expect(JSON.parse(await response.text()).code).toBe('no-live-planning-session')
    expect(spy.asked).toEqual([])
  })

  it('blank_changes_are_refused_because_an_empty_review_asks_the_agent_for_nothing', async () => {
    const response = await RunningApi.asking('{"issue":33,"repo":"jjponz/repo-pulse","changes":"   "}')

    expect(response.status).toBe(400)
    expect(JSON.parse(await response.text()).code).toBe('malformed-changes')
  })

  it('changes_that_are_not_text_are_refused', async () => {
    const response = await RunningApi.asking('{"issue":33,"repo":"jjponz/repo-pulse","changes":7}')

    expect(JSON.parse(await response.text()).code).toBe('malformed-changes')
  })

  it('a_body_that_is_not_a_json_object_is_refused', async () => {
    const response = await RunningApi.asking('[]')

    expect(JSON.parse(await response.text()).code).toBe('body-not-a-json-object')
  })

  it('an_unknown_field_is_refused_and_named_sorted', async () => {
    const response = await RunningApi.asking('{"issue":33,"repo":"jjponz/repo-pulse","changes":"x","zip":1,"agent":"a"}')
    const refusal = JSON.parse(await response.text())

    expect(refusal.code).toBe('unknown-field')
    expect(refusal.detail).toBe('unknown field: agent, zip')
  })

  it('a_malformed_issue_is_refused', async () => {
    const response = await RunningApi.asking('{"issue":0,"repo":"jjponz/repo-pulse","changes":"x"}')

    expect(JSON.parse(await response.text()).code).toBe('malformed-issue')
  })

  it('a_malformed_repo_is_refused', async () => {
    const response = await RunningApi.asking('{"issue":33,"repo":"repo-pulse","changes":"x"}')

    expect(JSON.parse(await response.text()).code).toBe('malformed-repo')
  })

  it('a_gh_that_refuses_reaches_the_page_as_plan_changes_not_asked_with_its_own_words', async () => {
    const spy = AskPlanChangesSpy.failingWith(new PlanChangesNotAsked('gh issue comment failed: gh: not found'))
    const response = await RunningApi.post(await RunningApi.listening(spy), RunningApi.ACCEPTED_BODY)
    const refusal = JSON.parse(await response.text())

    expect(response.status).toBe(400)
    expect(refusal.code).toBe('plan-changes-not-asked')
    expect(refusal.detail).toBe('gh issue comment failed: gh: not found')
  })

  it('a_wrong_method_answers_405_naming_the_right_one', async () => {
    const port = await RunningApi.listening()
    const response = await fetch(`http://127.0.0.1:${port}/review-plan`)

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
  })

  it('a_post_that_does_not_declare_json_is_refused', async () => {
    const port = await RunningApi.listening()
    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY, {})

    expect(response.status).toBe(415)
  })
})

describe('ReviewRefusal', () => {
  it('every_declared_outcome_but_the_accepted_one_has_a_refusal', () => {
    const declared = ReviewRefusal.declaredOutcomes()
    const outcomes = Object.values(ReviewRequestOutcome).filter(
      (outcome) => outcome !== ReviewRequestOutcome.ACCEPTED
    )

    expect(declared.sort()).toEqual(outcomes.sort())
  })
})
```

- [ ] **Step 2: Corre los tests y comprueba que fallan**

Run: `cd backend && npx vitest run __tests__/infrastructure/review-plan-route.test.js`
Expected: FAIL — no existe `review-plan-route.js`.

- [ ] **Step 3: Escribe la ruta**

Crea `backend/src/infrastructure/review-plan-route.js`, con la forma de `implement-plan-route.js`: un `ReviewRequest` que parsea y decide el `outcome`, un `ReviewRefusal` con la `Projection` por outcome, un `ReviewCollapse` que traduce un `PlanChangesFailure` a `plan-changes-not-asked`, y `handledBy` que consulta `activePlans.find` antes de ejecutar la acción.

```javascript
import { Answer, JsonBody, Refusal } from './http.js'
import { Projection } from './projection.js'
import { AskPlanChangesParams } from '../application/actions/ask-plan-changes.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import { PlanChangesFailure } from '../domain/exceptions.js'

export const ReviewRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_ISSUE: 'malformed-issue',
  MALFORMED_REPO: 'malformed-repo',
  MALFORMED_CHANGES: 'malformed-changes',
  NO_LIVE_SESSION: 'no-live-planning-session',
})

class ReviewRequest {
  static ISSUE_FIELD = 'issue'
  static REPO_FIELD = 'repo'
  static CHANGES_FIELD = 'changes'
  static KNOWN_FIELDS = Object.freeze([
    ReviewRequest.ISSUE_FIELD, ReviewRequest.REPO_FIELD, ReviewRequest.CHANGES_FIELD,
  ])

  constructor({ outcome, issue, repository, changes, fields }) {
    this.outcome = outcome
    this.issue = issue
    this.repository = repository
    this.changes = changes
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted({ issue, repository, changes }) {
    return new ReviewRequest({
      outcome: ReviewRequestOutcome.ACCEPTED, issue, repository, changes, fields: [],
    })
  }

  static refused(outcome) {
    return new ReviewRequest({
      outcome, issue: null, repository: null, changes: null, fields: [],
    })
  }

  static withUnknownFields(fields) {
    return new ReviewRequest({
      outcome: ReviewRequestOutcome.UNKNOWN_FIELD,
      issue: null, repository: null, changes: null, fields,
    })
  }

  static #isWellFormedIssue(given) {
    return Number.isInteger(given) && given >= 1
  }

  static #isWellFormedChanges(given) {
    return typeof given === 'string' && given.trim().length > 0
  }

  static from(raw) {
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return ReviewRequest.refused(ReviewRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return ReviewRequest.refused(ReviewRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter(
      (field) => !ReviewRequest.KNOWN_FIELDS.includes(field)
    )
    if (unknown.length > 0) {
      return ReviewRequest.withUnknownFields(unknown.sort())
    }
    if (!ReviewRequest.#isWellFormedIssue(parsed[ReviewRequest.ISSUE_FIELD])) {
      return ReviewRequest.refused(ReviewRequestOutcome.MALFORMED_ISSUE)
    }
    if (!RepositoryName.isWellFormed(parsed[ReviewRequest.REPO_FIELD])) {
      return ReviewRequest.refused(ReviewRequestOutcome.MALFORMED_REPO)
    }
    if (!ReviewRequest.#isWellFormedChanges(parsed[ReviewRequest.CHANGES_FIELD])) {
      return ReviewRequest.refused(ReviewRequestOutcome.MALFORMED_CHANGES)
    }

    return ReviewRequest.accepted({
      issue: parsed[ReviewRequest.ISSUE_FIELD],
      repository: new RepositoryName(parsed[ReviewRequest.REPO_FIELD]),
      changes: parsed[ReviewRequest.CHANGES_FIELD].trim(),
    })
  }
}

export class ReviewRefusal {
  static #BY_OUTCOME = new Projection('refusal', [
    [ReviewRequestOutcome.BODY_NOT_A_JSON_OBJECT, () => new Refusal({
      status: 400,
      code: ReviewRequestOutcome.BODY_NOT_A_JSON_OBJECT,
      detail: 'body must be a JSON object',
    })],
    [ReviewRequestOutcome.UNKNOWN_FIELD, (asked) => new Refusal({
      status: 400,
      code: ReviewRequestOutcome.UNKNOWN_FIELD,
      detail: `unknown field: ${asked.fields.join(', ')}`,
    })],
    [ReviewRequestOutcome.MALFORMED_ISSUE, () => new Refusal({
      status: 400,
      code: ReviewRequestOutcome.MALFORMED_ISSUE,
      detail: `${ReviewRequest.ISSUE_FIELD} must be a whole number from one`,
    })],
    [ReviewRequestOutcome.MALFORMED_REPO, () => new Refusal({
      status: 400,
      code: ReviewRequestOutcome.MALFORMED_REPO,
      detail: `${ReviewRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    })],
    [ReviewRequestOutcome.MALFORMED_CHANGES, () => new Refusal({
      status: 400,
      code: ReviewRequestOutcome.MALFORMED_CHANGES,
      detail: `${ReviewRequest.CHANGES_FIELD} must say what to change`,
    })],
    [ReviewRequestOutcome.NO_LIVE_SESSION, () => new Refusal({
      status: 409,
      code: ReviewRequestOutcome.NO_LIVE_SESSION,
      detail: 'no matching live planning session exists, so nobody would read the changes',
    })],
  ])

  static of(asked) {
    return ReviewRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }

  static declaredOutcomes() {
    return ReviewRefusal.#BY_OUTCOME.members()
  }
}

export class ReviewCollapse {
  static CODE = 'plan-changes-not-asked'

  static of(cause) {
    return new Refusal({ status: 400, code: ReviewCollapse.CODE, detail: cause.message })
  }
}

export class ReviewPlanRoute {
  static PATH = '/review-plan'
  static METHOD = 'POST'

  static handledBy(askPlanChanges, activePlans) {
    return async (request, response) => {
      const asked = ReviewRequest.from(JsonBody.textOf(request))
      if (asked.outcome !== ReviewRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, ReviewRefusal.of(asked))
        return
      }
      const active = activePlans.find({ issue: asked.issue, repository: asked.repository })
      if (active === null) {
        Answer.refuseAs(response, ReviewRefusal.of(
          ReviewRequest.refused(ReviewRequestOutcome.NO_LIVE_SESSION)
        ))
        return
      }
      try {
        await askPlanChanges.execute(new AskPlanChangesParams({
          issue: active.watch.issue, repository: asked.repository, changes: asked.changes,
        }))
      } catch (cause) {
        if (!(cause instanceof PlanChangesFailure)) throw cause
        Answer.refuseAs(response, ReviewCollapse.of(cause))
        return
      }
      Answer.send(response, 202, { status: 'changes-asked', [ReviewRequest.ISSUE_FIELD]: asked.issue })
    }
  }

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', ReviewPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
```

- [ ] **Step 4: Monta la ruta**

En `backend/src/infrastructure/api-server.js`: importa `ReviewPlanRoute`, añade `askPlanChanges` al objeto de opciones del constructor y a `this`, y en `#route()`, junto a la de `ImplementPlanRoute`:

```javascript
    app.post(
      ReviewPlanRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      ReviewPlanRoute.handledBy(this.askPlanChanges, this.activePlans)
    )
    app.all(ReviewPlanRoute.PATH, ReviewPlanRoute.refuseOtherMethods)
```

- [ ] **Step 5: Corre los tests y comprueba que pasan**

Run: `cd backend && npx vitest run __tests__/infrastructure/review-plan-route.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 6: Corre el fichero que declara los endpoints del servidor**

Run: `cd backend && npx vitest run __tests__/infrastructure/api-server.test.js`
Expected: PASS. Si un test cuenta los endpoints o los enumera, actualízalo a 7.

- [ ] **Step 7: Commit**

```bash
git add backend/src/infrastructure/review-plan-route.js backend/src/infrastructure/api-server.js backend/__tests__/infrastructure/review-plan-route.test.js backend/__tests__/infrastructure/api-server.test.js
git commit -m "feat(backend): POST /review-plan publica los cambios pedidos en el issue del plan

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Cablearlo de verdad y documentarlo

**Files:**
- Modify: `backend/src/infrastructure/ct-api.mjs`
- Modify: `backend/API.md`
- Modify: `frontend/vite.config.ts:8`
- Test: `backend/__tests__/infrastructure/ct-api-real-process.test.js`

**Interfaces:**
- Consumes: `AskPlanChanges` de la Task 2, `planIssues` ya construido en `ct-api.mjs`.
- Produces: un backend arrancado de verdad que contesta 409 `no-live-planning-session` en `POST /review-plan` cuando no hay ningún plan en vuelo.

- [ ] **Step 1: Escribe el test que falla**

En `backend/__tests__/infrastructure/ct-api-real-process.test.js`, con el armazón `Entrypoint` que ese fichero ya usa (mismo patrón que `a_whole_request_to_external_tools_...`, líneas 156-168):

```javascript
  it('a_whole_request_to_review_plan_reaches_the_route_the_entrypoint_wired_up', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    const response = await fetch(`http://127.0.0.1:${port}/review-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue: 33, repo: 'jjponz/repo-pulse', changes: 'parte la tarea 2' }),
    })

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('no-live-planning-session')
  })
```

Contesta 409 y no 404 porque el proceso real arranca sin ningún plan en vuelo: eso es exactamente lo que prueba que la ruta está montada y cableada.

- [ ] **Step 2: Corre el test y comprueba que falla**

Run: `cd backend && npx vitest run __tests__/infrastructure/ct-api-real-process.test.js -t a_whole_request_to_review_plan`
Expected: FAIL con 404 `not-found` — la ruta existe en `ApiServer` pero `ct-api.mjs` no le pasa `askPlanChanges`, o con 400 `request-failed` si llega sin acción.

- [ ] **Step 3: Cablea la acción**

En `backend/src/infrastructure/ct-api.mjs`: importa `AskPlanChanges` y añádelo al `new ApiServer({...})`, junto a `implementPlan`:

```javascript
      askPlanChanges: new AskPlanChanges({ planIssues }),
```

- [ ] **Step 4: Corre el test y comprueba que pasa**

Run: `cd backend && npx vitest run __tests__/infrastructure/ct-api-real-process.test.js`
Expected: PASS.

- [ ] **Step 5: Abre la ruta en el servidor de desarrollo**

En `frontend/vite.config.ts:8`, añade `'/review-plan'` a `API_PATHS`.

- [ ] **Step 6: Documenta el endpoint**

En `backend/API.md`: sube el contador de endpoints de la tabla «Reaching it» a 7 (`POST` 3, `GET` 4) y añade una sección `## POST /review-plan` con el mismo formato que `## POST /implement-plan` — tabla de campos (`issue`, `repo`, `changes`), la respuesta 202 `{"status":"changes-asked","issue":33}`, la tabla de rechazos con `body-not-a-json-object`, `unknown-field`, `malformed-issue`, `malformed-repo`, `malformed-changes`, `no-live-planning-session` (409) y `plan-changes-not-asked`, y el `curl` que lo reproduce. Di explícitamente que el efecto es un comentario en el issue y que el agente lo recibe en el siguiente barrido del vigilante, hasta 30 segundos después, no al contestar.

- [ ] **Step 7: Commit**

```bash
git add backend/src/infrastructure/ct-api.mjs backend/API.md frontend/vite.config.ts backend/__tests__/infrastructure/ct-api-real-process.test.js
git commit -m "feat(backend): /review-plan cableado en el proceso real y documentado

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: El cliente del frontend

**Files:**
- Create: `frontend/src/app/review-plan/ReviewPlan.types.ts`
- Create: `frontend/src/app/review-plan/client.ts`
- Create: `frontend/src/__scenarios__/ReviewPlanMother.ts`
- Test: `frontend/src/app/review-plan/client.test.ts`

**Interfaces:**
- Produces: `ReviewPlanClient.askChanges({ issue, repo, changes }) -> Promise<ReviewPlanOutcome>`, con `ReviewPlanOutcome = { kind: 'changes-asked'; issue: number } | { kind: 'stale-plan'; detail: string } | { kind: 'refused'; detail: string } | { kind: 'backend-unreachable' }`. `ReviewPlanMother` expone `ISSUE`, `REPO`, `CHANGES`, `REQUEST_BODY`, `changesAsked()`, `malformedChanges()`, `noLiveSession()`, `notAsked()`.

- [ ] **Step 1: Escribe los tests que fallan**

Crea `frontend/src/app/review-plan/client.test.ts`, con el estilo exacto de `frontend/src/app/implement-plan/client.test.ts` — sin importar `describe`/`it`/`expect`/`vi`, y con `Response` de verdad:

```typescript
import { ReviewPlanMother } from '__scenarios__/ReviewPlanMother'
import { ReviewPlanClient } from 'app/review-plan/client'

const request = () => ({
  issue: ReviewPlanMother.ISSUE,
  repo: ReviewPlanMother.REPO,
  changes: ReviewPlanMother.CHANGES,
})

const answerWith = (answer: { status: number; body: string }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))
}

describe('ReviewPlanClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should report accepted changes by status, carrying the issue they were asked on', async () => {
    answerWith(ReviewPlanMother.changesAsked())

    const outcome = await ReviewPlanClient.askChanges(request())

    expect(outcome).toEqual({ kind: 'changes-asked', issue: ReviewPlanMother.ISSUE })
  })

  it('should post the three fields the backend demands and declare JSON', async () => {
    answerWith(ReviewPlanMother.changesAsked())

    await ReviewPlanClient.askChanges(request())

    expect(fetch).toHaveBeenCalledWith('/review-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ReviewPlanMother.REQUEST_BODY,
    })
  })

  it('should report a plan the backend no longer watches by code, not by status', async () => {
    answerWith(ReviewPlanMother.noLiveSession())

    const outcome = await ReviewPlanClient.askChanges(request())

    expect(outcome).toEqual({
      kind: 'stale-plan',
      detail: 'no matching live planning session exists, so nobody would read the changes',
    })
  })

  it('should keep other refusals generic, carrying only their detail', async () => {
    answerWith(ReviewPlanMother.notAsked())

    const outcome = await ReviewPlanClient.askChanges(request())

    expect(outcome).toEqual({ kind: 'refused', detail: 'gh issue comment failed: gh: not found' })
  })

  it('should tell a backend it cannot reach apart from one that refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    const outcome = await ReviewPlanClient.askChanges(request())

    expect(outcome).toEqual({ kind: 'backend-unreachable' })
  })
})
```

- [ ] **Step 2: Corre los tests y comprueba que fallan**

Run: `cd frontend && npx vitest run src/app/review-plan/client.test.ts`
Expected: FAIL — no existe `app/review-plan/client`.

- [ ] **Step 3: Escribe los tipos**

Crea `frontend/src/app/review-plan/ReviewPlan.types.ts`:

```typescript
export type ReviewPlanRequest = {
  issue: number
  repo: string
  changes: string
}

export type ReviewPlanResult = {
  status: 'changes-asked'
  issue: number
}

export type ReviewPlanRefusal = {
  code: string
  detail: string
}

export type ReviewPlanOutcome =
  | { kind: 'changes-asked'; issue: number }
  | { kind: 'stale-plan'; detail: string }
  | { kind: 'refused'; detail: string }
  | { kind: 'backend-unreachable' }
```

- [ ] **Step 4: Escribe el cliente**

Crea `frontend/src/app/review-plan/client.ts`:

```typescript
import {
  ReviewPlanOutcome,
  ReviewPlanRefusal,
  ReviewPlanRequest,
  ReviewPlanResult,
} from 'app/review-plan/ReviewPlan.types'

const PATH = '/review-plan'
const ACCEPTED = 202
const NO_LIVE_PLANNING_SESSION = 'no-live-planning-session'

const askChanges = async ({ issue, repo, changes }: ReviewPlanRequest): Promise<ReviewPlanOutcome> => {
  let response: Response
  try {
    response = await fetch(PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue, repo, changes }),
    })
  } catch {
    return { kind: 'backend-unreachable' }
  }
  if (response.status === ACCEPTED) {
    const asked = (await response.json()) as ReviewPlanResult
    return { kind: 'changes-asked', issue: asked.issue }
  }
  const refused = (await response.json()) as ReviewPlanRefusal
  if (refused.code === NO_LIVE_PLANNING_SESSION) return { kind: 'stale-plan', detail: refused.detail }
  return { kind: 'refused', detail: refused.detail }
}

export const ReviewPlanClient = {
  askChanges,
}
```

- [ ] **Step 5: Escribe la mother**

Crea `frontend/src/__scenarios__/ReviewPlanMother.ts`:

```typescript
const ISSUE = 7
const REPO = 'owner/name'
const CHANGES = 'parte la tarea 2 en dos'
const REQUEST_BODY = '{"issue":7,"repo":"owner/name","changes":"parte la tarea 2 en dos"}'

const changesAsked = () => ({
  status: 202,
  body: '{"status":"changes-asked","issue":7}',
})

const malformedChanges = () => ({
  status: 400,
  body: '{"code":"malformed-changes","detail":"changes must say what to change"}',
})

const noLiveSession = () => ({
  status: 409,
  body: '{"code":"no-live-planning-session","detail":"no matching live planning session exists, so nobody would read the changes"}',
})

const notAsked = () => ({
  status: 400,
  body: '{"code":"plan-changes-not-asked","detail":"gh issue comment failed: gh: not found"}',
})

export const ReviewPlanMother = {
  ISSUE,
  REPO,
  CHANGES,
  REQUEST_BODY,
  changesAsked,
  malformedChanges,
  noLiveSession,
  notAsked,
}
```

`ISSUE` y `REPO` valen 7 y `owner/name` a propósito: son los mismos que `ImplementPlanMother.plan()`, así que el plan que usan los tests del componente encaja con estas respuestas sin tener que construir otro.

- [ ] **Step 6: Corre los tests y comprueba que pasan**

Run: `cd frontend && npx vitest run src/app/review-plan/client.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/review-plan frontend/src/__scenarios__/ReviewPlanMother.ts
git commit -m "feat(frontend): cliente de /review-plan

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: El componente `AskPlanChanges`

**Files:**
- Create: `frontend/src/app/review-plan/components/ask-plan-changes/AskPlanChanges.tsx`
- Create: `frontend/src/app/review-plan/components/ask-plan-changes/AskPlanChanges.css`
- Create: `frontend/src/app/review-plan/components/ask-plan-changes/index.ts`
- Test: `frontend/src/app/review-plan/components/ask-plan-changes/AskPlanChanges.test.tsx`

**Interfaces:**
- Consumes: `ReviewPlanClient.askChanges` y `ReviewPlanMother` de la Task 5; `StartedPlan` de `app/start-plan/StartPlan.types`; `ImplementPlanMother.plan()` de `__scenarios__/ImplementPlanMother`; `TextArea` de `system-ui/text-area`; `Button` de `system-ui/button`; `Banner` de `system-ui/banner`; `FormField` de `system-ui/form-field`.
- Produces: `<AskPlanChanges plan={plan} onChangesAsked={() => {}} />`. `onChangesAsked` es opcional y se llama solo cuando el backend acepta.

La pareja `FormField` envolviendo un `TextArea` sin `id` propio ya está en producción en `StartPlanForm.tsx:126-136`: `FormField` genera el `id` con `useId` y cablea el `htmlFor` de la etiqueta, así que `getByLabelText` encuentra el control. Imítala tal cual; no le pongas `id` ni `htmlFor` a mano.

- [ ] **Step 1: Escribe los tests que fallan**

Crea `frontend/src/app/review-plan/components/ask-plan-changes/AskPlanChanges.test.tsx`, con el estilo de `ImplementPlanAction.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ImplementPlanMother } from '__scenarios__/ImplementPlanMother'
import { ReviewPlanMother } from '__scenarios__/ReviewPlanMother'
import { AskPlanChanges } from './AskPlanChanges'

const ASK_BUTTON = { name: 'Pedir cambios' }
const FIELD_LABEL = 'Qué quieres cambiar del plan'

const answerWith = (answer: { status: number; body: string }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))
}

const ask = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByLabelText(FIELD_LABEL), text)
  await user.click(screen.getByRole('button', ASK_BUTTON))
}

describe('AskPlanChanges', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should say where the plan is read, so you know what you are reviewing', () => {
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    expect(screen.getByText(/último comentario del issue/)).toBeInTheDocument()
  })

  it('should ask for nothing until you write what to change', () => {
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    expect(screen.getByRole('button', ASK_BUTTON)).toBeDisabled()
  })

  it('should send what you wrote with the issue and the repo of the plan', async () => {
    answerWith(ReviewPlanMother.changesAsked())
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)

    expect(fetch).toHaveBeenCalledWith('/review-plan', expect.objectContaining({
      body: ReviewPlanMother.REQUEST_BODY,
    }))
  })

  it('should say the changes were asked for without waiting for the agent, and say it takes a while', async () => {
    answerWith(ReviewPlanMother.changesAsked())
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)

    const said = await screen.findByRole('status')
    expect(said).toHaveTextContent(/Cambios pedidos/)
    expect(said).toHaveTextContent(/medio minuto/)
  })

  it('should empty the field once accepted, so the same change is not asked for twice', async () => {
    answerWith(ReviewPlanMother.changesAsked())
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)

    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(screen.getByLabelText(FIELD_LABEL)).toHaveValue('')
  })

  it('should notify its parent once only after the changes are accepted', async () => {
    answerWith(ReviewPlanMother.changesAsked())
    const onChangesAsked = vi.fn()
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} onChangesAsked={onChangesAsked} />)

    await ask(user, ReviewPlanMother.CHANGES)

    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(onChangesAsked).toHaveBeenCalledTimes(1)
  })

  it('should keep what you wrote when the backend no longer watches the plan', async () => {
    answerWith(ReviewPlanMother.noLiveSession())
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya no tiene este plan activo/)
    expect(screen.getByLabelText(FIELD_LABEL)).toHaveValue(ReviewPlanMother.CHANGES)
  })

  it('should show the backend own words on any other refusal, and keep what you wrote', async () => {
    answerWith(ReviewPlanMother.notAsked())
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)

    expect(await screen.findByRole('alert')).toHaveTextContent('gh issue comment failed: gh: not found')
    expect(screen.getByLabelText(FIELD_LABEL)).toHaveValue(ReviewPlanMother.CHANGES)
  })

  it('should say when the backend could not be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
  })
})
```

- [ ] **Step 2: Corre los tests y comprueba que fallan**

Run: `cd frontend && npx vitest run src/app/review-plan/components/ask-plan-changes/AskPlanChanges.test.tsx`
Expected: FAIL — no existe el componente.

- [ ] **Step 3: Escribe el componente**

Crea `frontend/src/app/review-plan/components/ask-plan-changes/AskPlanChanges.tsx`:

```typescript
import { useState } from 'react'
import { ReviewPlanClient } from 'app/review-plan/client'
import { ReviewPlanOutcome } from 'app/review-plan/ReviewPlan.types'
import { StartedPlan } from 'app/start-plan/StartPlan.types'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { FormField } from 'system-ui/form-field'
import { TextArea } from 'system-ui/text-area'
import './AskPlanChanges.css'

const FIELD_LABEL = 'Qué quieres cambiar del plan'
const FIELD_MESSAGE = 'Lo que escribas es lo que se le pide al agente'
const WHERE_MESSAGE = 'El plan está publicado como el último comentario del issue.'
const ASKED_MESSAGE = 'Cambios pedidos. El agente los recibe en menos de medio minuto y publicará el plan rehecho en el issue.'
const STALE_TITLE = 'El backend ya no tiene este plan activo'
const STALE_DESCRIPTION = 'Nadie leería los cambios. Recupera el plan activo antes de volver a pedirlos.'
const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'

type AskPlanChangesProps = {
  plan: StartedPlan
  onChangesAsked?: () => void
}

const AskPlanChanges = ({ plan, onChangesAsked }: AskPlanChangesProps) => {
  const [changes, setChanges] = useState('')
  const [outcome, setOutcome] = useState<ReviewPlanOutcome | null>(null)
  const [isSending, setIsSending] = useState(false)

  const askChanges = async () => {
    setIsSending(true)
    setOutcome(null)
    const answered = await ReviewPlanClient.askChanges({
      issue: plan.issue.number,
      repo: plan.repo,
      changes,
    })
    setOutcome(answered)
    setIsSending(false)
    if (answered.kind !== 'changes-asked') return
    setChanges('')
    onChangesAsked?.()
  }

  return (
    <section className="ask-plan-changes" aria-label="Pedir cambios en el plan">
      <p className="ask-plan-changes__where">{WHERE_MESSAGE}</p>
      <FormField label={FIELD_LABEL} message={FIELD_MESSAGE} error={false}>
        <TextArea
          placeholder="Qué hay que cambiar"
          value={changes}
          disabled={isSending}
          autoComplete="off"
          onChange={(event) => setChanges(event.target.value)}
        />
      </FormField>
      <Button onClick={() => void askChanges()} disabled={isSending || changes.trim().length === 0}>
        Pedir cambios
      </Button>
      {outcome?.kind === 'changes-asked' && (
        <p className="ask-plan-changes__asked" role="status" aria-live="polite">{ASKED_MESSAGE}</p>
      )}
      {outcome?.kind === 'stale-plan' && (
        <Banner type="warning" role="alert" title={STALE_TITLE} description={STALE_DESCRIPTION} />
      )}
      {outcome?.kind === 'refused' && <Banner type="error" role="alert" title={outcome.detail} />}
      {outcome?.kind === 'backend-unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
    </section>
  )
}

export { AskPlanChanges }
export type { AskPlanChangesProps }
```

- [ ] **Step 4: Escribe el CSS y el índice**

Crea `frontend/src/app/review-plan/components/ask-plan-changes/AskPlanChanges.css` con la forma de `ImplementPlanAction.css`, que usa píxeles y no tokens de tamaño:

```css
.ask-plan-changes {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: flex-start;
}

.ask-plan-changes__where {
  margin: 0;
}

.ask-plan-changes__asked {
  margin: 0;
}
```

Crea `frontend/src/app/review-plan/components/ask-plan-changes/index.ts`:

```typescript
export { AskPlanChanges } from './AskPlanChanges'
export type { AskPlanChangesProps } from './AskPlanChanges'
```

- [ ] **Step 5: Corre los tests y comprueba que pasan**

Run: `cd frontend && npx vitest run src/app/review-plan/components/ask-plan-changes/AskPlanChanges.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/review-plan/components
git commit -m "feat(frontend): pedir cambios del plan desde la etapa de revision

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: La etapa «Revisar plan» lo ofrece

**Files:**
- Modify: `frontend/src/pages/home/Home.tsx:390-402`
- Test: `frontend/src/pages/home/__tests__/Home.reviewPlan.test.tsx`

**Interfaces:**
- Consumes: `AskPlanChanges` de la Task 6; los ayudantes `backendAnswering`, `openHome`, `startPlan`, `streamFrame` de `./helpers`; `StartPlanMother.started()`, `PlanEventsMother.writing()`, `PlanEventsMother.ready()`, `ImplementPlanMother.implementing()`.
- Produces: nada nuevo. El componente se pinta dentro del bloque `workflow.phase === 'ready' && restoredIsConfirmed` de la etapa `review`, junto al enlace a GitHub y al botón de implementar.

- [ ] **Step 1: Escribe los tests que fallan**

Crea `frontend/src/pages/home/__tests__/Home.reviewPlan.test.tsx`. La llegada al plan listo es la misma que usa `Home.implementPlan.test.tsx:26-38`; se repite aquí porque cada fichero de `Home` monta la suya:

```typescript
import { screen } from '@testing-library/react'
import { ImplementPlanMother } from '__scenarios__/ImplementPlanMother'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { backendAnswering, openHome, startPlan, streamFrame } from './helpers'

const ASK_BUTTON = { name: 'Pedir cambios' }
const READ_LINK = { name: 'Abrir el plan en GitHub' }

describe('Home · review plan', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const planStarted = async () => {
    backendAnswering(StartPlanMother.started())
    const opened = openHome()
    await startPlan(opened.user)
    await screen.findByRole('status')

    return opened
  }

  it('should offer to ask for changes only once the plan is ready, beside the link to read it', async () => {
    await planStarted()

    await streamFrame(PlanEventsMother.writing())
    expect(screen.queryByRole('button', ASK_BUTTON)).toBeNull()

    await streamFrame(PlanEventsMother.ready())
    expect(screen.getByRole('button', ASK_BUTTON)).toBeInTheDocument()
    expect(screen.getByRole('link', READ_LINK)).toBeInTheDocument()
  })

  it('should stop offering to ask for changes once the plan is being implemented', async () => {
    const opened = await planStarted()
    await streamFrame(PlanEventsMother.ready())

    backendAnswering(ImplementPlanMother.implementing())
    await opened.user.click(screen.getByRole('button', { name: 'Implementar plan' }))

    expect(screen.queryByRole('button', ASK_BUTTON)).toBeNull()
  })
})
```

- [ ] **Step 2: Corre los tests y comprueba que fallan**

Run: `cd frontend && npx vitest run src/pages/home/__tests__/Home.reviewPlan.test.tsx`
Expected: FAIL — el primero, porque no hay ningún botón «Pedir cambios» con el plan listo.

- [ ] **Step 3: Píntalo en la etapa de revisión**

En `frontend/src/pages/home/Home.tsx`, importa `AskPlanChanges` de `app/review-plan/components/ask-plan-changes` y añádelo dentro del bloque que ya existe:

```typescript
              {workflow.phase === 'ready' && restoredIsConfirmed && (
                <div className="home__review-action">
                  <a href={workflow.plan.issue.url} target="_blank" rel="noreferrer" className="home__issue-link lg-body-medium">
                    Abrir el plan en GitHub
                  </a>
                  <AskPlanChanges plan={workflow.plan} />
                  <ImplementPlanAction
                    plan={workflow.plan}
                    onImplementationStarted={implementationStarted}
                  />
                </div>
              )}
```

- [ ] **Step 4: Corre los tests y comprueba que pasan**

Run: `cd frontend && npx vitest run src/pages/home/__tests__/`
Expected: PASS, todos los ficheros de `Home`. Si `Home.implementPlan.test.tsx` busca un `role="status"` que ahora es ambiguo porque el componente nuevo añade otro, no relajes su expectativa: acota la suya con el `aria-label` de su sección.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/home
git commit -m "feat(frontend): la etapa de revision ofrece pedir cambios en el plan

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: El plan publicado dice cómo se le piden cambios

**Files:**
- Modify: `backend/src/infrastructure/plan-agent-brief.js`
- Test: `backend/__tests__/infrastructure/plan-agent-brief.test.js`

**Interfaces:**
- Consumes: `PlanIssueBody.CHANGES_LINE`, que ya se importa en ese fichero.
- Produces: nada que otra tarea consuma. Los dos encargos que publican plan terminan pidiendo esa línea.

- [ ] **Step 1: Escribe los tests que fallan**

En `backend/__tests__/infrastructure/plan-agent-brief.test.js`:

```javascript
describe('the published plan says how to ask for changes to it', () => {
  it('the_first_errand_asks_the_agent_to_close_the_comment_with_the_line_that_says_it', () => {
    expect(errand()).toContain(PlanIssueBody.CHANGES_LINE)
  })

  it('the_review_errand_asks_for_it_too_because_the_reworked_plan_can_be_reviewed_again', () => {
    expect(reviewErrand()).toContain(PlanIssueBody.CHANGES_LINE)
  })
})
```

Reutiliza los ayudantes `errand()` y `reviewErrandFor(...)` que el fichero ya tiene; importa `PlanIssueBody` de `../../src/infrastructure/gh-plan-issues.js`.

- [ ] **Step 2: Corre los tests y comprueba que fallan**

Run: `cd backend && npx vitest run __tests__/infrastructure/plan-agent-brief.test.js -t 'says how to ask for changes'`
Expected: FAIL — ninguno de los dos encargos contiene la línea.

- [ ] **Step 3: Pídelo en los dos encargos**

En `backend/src/infrastructure/plan-agent-brief.js`, en `errandFor`, cambia la línea que manda publicar el plan para que además pida cerrarlo con la frase. Y añade la misma exigencia a `reviewErrandFor`, antes del «Y entonces PARA otra vez»:

```javascript
      `Y cierra ese comentario con esta línea tal cual, que es donde una persona la lee: ${PlanIssueBody.CHANGES_LINE}`,
```

- [ ] **Step 4: Corre los tests y comprueba que pasan**

Run: `cd backend && npx vitest run __tests__/infrastructure/plan-agent-brief.test.js`
Expected: PASS, todo el fichero. Los tests que ya afirmaban que el encargo no contiene `-OK` siguen pasando, porque `CHANGES_LINE` solo nombra `-REVIEW`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/infrastructure/plan-agent-brief.js backend/__tests__/infrastructure/plan-agent-brief.test.js
git commit -m "feat(backend): el plan publicado termina diciendo como pedirle cambios

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Verificación de la entrega

**Files:**
- Test: toda la suite de los dos lados.

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la evidencia de que la entrega está verde antes de abrir la pull request.

- [ ] **Step 1: La suite del backend**

Run: `cd backend && npx vitest run`
Expected: PASS. Si algo rojo no lo ha tocado esta entrega, no lo arregles aquí: dilo.

- [ ] **Step 2: La suite y el linter del frontend**

Run: `cd frontend && npx vitest run && npx tsc --noEmit && npx eslint src`
Expected: PASS los tres.

- [ ] **Step 3: El linter del backend**

Run: `cd backend && npx eslint src __tests__`
Expected: PASS.

- [ ] **Step 4: Comprueba a mano que la puerta funciona de verdad**

Arranca el backend con `make run-backend` y, sin ningún plan en vuelo:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/review-plan \
  -d '{"issue":1,"repo":"owner/name","changes":"parte la tarea 2"}'
```

Expected: `{"code":"no-live-planning-session","detail":"no matching live planning session exists, so nobody would read the changes"}`. Que conteste eso y no un 404 es lo que prueba que la ruta está montada en el proceso real.

- [ ] **Step 5: Retira el plan y commitea**

El diseño no viaja en la pull request: borra este fichero en su propio commit y lleva su contenido al cuerpo de la pull request.

```bash
git rm docs/superpowers/plans/2026-09-09-issue-169-la-puerta-del-review.md
git commit -m "chore: retirar el plan de la puerta del -REVIEW

Co-Authored-By: Claude <noreply@anthropic.com>"
```
