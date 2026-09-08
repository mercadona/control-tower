# El backend conduce — la portación del transporte y del conductor

**Fecha:** 2026-09-08
**Repos:** `josemerca/control-tower-plugin` (`backend/`) · issue de trabajo `mercadona/control-tower#139`
**Estado:** diseño validado en sesión; nada ejecutado
**Decisión que abre:** **D-4** de `docs/convergencia-tres-loops.md` — *«¿El orquestador de CT deja de ser una sesión de chat?»*, hoy aplazada con dueño José y con un cuándo («se revisa al cerrar F38»)

---

## 1. Qué se porta, y la tesis

El backend no cambia de forma: ya es hexagonal y Claude ya está detrás de un
puerto (`domain/ports/plan-agents.js`, con `CmuxPlanAgents` como único
adaptador, cableado en un solo sitio). Lo que cambia es **quién conduce**.

Hoy el backend redacta una instrucción y le pide al agente que se conduzca solo
consultando un oráculo del plugin: *«Pregunta el paso con `node ct-step next
--plan <tu plan> --issue N` y obedece literalmente lo que imprima»*
(`plan-agent-brief.js:64`; lo mismo con `--check-plan` en las líneas 34 y 49).
Si el modelo no obedece, nada lo detecta. Y como el backend no ve los pasos, no
tiene nada que medir: el progreso lo **raspa** de ficheros
(`run-file-progress.js`, `plan-contract-progress.js`) y el estado de los planes
en vuelo lo **reconstruye parseando títulos de ventanas de cmux**
(`CmuxActivePlan.parse`, tres expresiones regulares).

**La tesis: determinismo, métricas e independencia del plugin no son tres
objetivos, son tres consecuencias de un solo cambio** — que el conductor sea el
programa y que cada paso sea una invocación sin estado cuyo resultado él mismo
recoge.

Y de ahí sale el orden del trabajo, que no es una preferencia:

- **cmux no es la causa, es el síntoma.** Mientras conduzca el agente hace falta
  una sesión viva a la que teclear (`send` + `send-key Enter`), y de ahí salen
  el launcher, el centinela, la política de arranque y el reenvío de la línea.
  Si el backend conduce paso a paso, cada paso es una invocación y cmux se cae
  solo. Al revés no funciona: cambiar a `claude -p` sin cambiar quién conduce
  deja un proceso headless que sigue teniendo que preguntarle a `ct-step`.
- **Las métricas de llamada no se pueden tener antes de que la llamada sea
  nuestra.** Con cmux no hay proceso hijo que medir: el gasto ocurre dentro de
  la sesión de Claude Code de quien mira la ventana.

### 1.1 Lo que NO cambia

Las tres puertas humanas, el `-OK <nonce>` como forma del go, el issue de
GitHub como sitio donde se publica el plan y se responde, el claim por labels,
y la frontera con `agentic-skills` (§9). Esto es una portación del transporte y
del conductor, no un rediseño del ciclo.

---

## 2. Lo medido, no deducido

Todo lo que sigue está contado sobre el código de este repo el 2026-09-08.

### 2.1 Las tres dependencias al plugin, y cuál es la que duele

| Tipo | Qué es | Cuánto | ¿Es el problema? |
|---|---|---|---|
| **Autoridad del formato** | El backend **importa** lectores y renderizadores puros: `groom.js`, `gates.js`, `cells.js`, `conventions.js`, `state.js`, `state-paths.js`, `baseline.js`, `plugin-yardstick.js`, `harvest.js`, `gh-issue-map.js`, `shquote.js`, `launch-sentinel.js` | 17 sentencias de import en 8 ficheros | **No.** Está declarada a propósito en `backend/conventions/this-repository.md` |
| **Ejecutable que el backend invoca** | `dispatch-check.mjs --collect` y `--reopen`, desde `DispatchCheckHarvest` y `DispatchCheckWorkbench` | 2 adaptadores | **Poco.** Es un proceso con código de salida autoritativo: ya es determinista |
| **Ejecutable que el backend le pide al *agente* que llame** | `ct-step next`, `--check-plan`, `--release`, escritos en el brief | 3 líneas de prosa | **Sí. Es toda la raíz** |

### 2.2 Los tamaños

- `backend/src`: **4.883** líneas.
- Los ficheros del plugin que el backend consume, sumados: **~10.400** líneas.
  Reimplementarlos literalmente triplicaría el backend antes de entregar
  ningún beneficio.
- Pero la **máquina de estados no son las 2.412 líneas de `ct-step.mjs`: son
  las 474 de `run-machine.js`** — `STEPS`, `OUTCOMES`, `RUN_STATES`,
  `DEFAULT_BUDGETS` y `after()`, lógica pura sin git, sin ficheros y sin
  proceso. El resto de `ct-step.mjs` es envoltura: CLI, git, el fichero
  `.agent/run-<n>.json`, los sellos de intento, la cuenta de commits.
- Y **buena parte de esa envoltura existe porque el conductor no es de fiar**:
  la precondición `commits == run.task - 1`, los sellos y la comprobación de
  que el agente no se saltó un paso son defensas contra un agente que conduce.
  Si conduce el programa, esa defensa sobra.

### 2.3 El camino headless ya está escrito en este repo

`plugin/scripts/judge-dispatch.js:64` invoca `claude -p --output-format json`, y
`ClaudeAnswer.parse` (línea 99) lee `total_cost_usd` e `is_error`. Lo usa
`judge-bench`. **No hay que inventar el transporte ni la lectura del gasto**:
hay que traerlos al backend y ponerlos detrás de un puerto.

### 2.4 La cosecha mide el proceso, no la llamada

La tabla de cosecha tiene **54 columnas**: tiempos por episodio, reopens,
requeues, bloqueos, datos del PR, hallazgos del juez por severidad y por regla,
bytes de brief, de skill y de paquete. Y **cero** apariciones de `cost`, `usd`,
`token` o `model` en `harvest-table.js`.

No es falta de esfuerzo, es estructural: Control Tower mide **lo que se puede
reconstruir desde fuera** (el timeline de GitHub más un fichero de telemetría
del juez), porque no tiene la llamada.

### 2.5 Lo que se pierde al reiniciar no es lo que parece

- `MemoryCheckoutRegistry` es literalmente un `Map` en memoria, y es lo que
  alimenta el barrido de cosecha cada minuto (`HarvestClock` recibe
  `checkouts()`). **Hoy, si se reinicia el backend, la cosecha deja de barrer
  los clones que atendía.** Es un defecto vivo.
- En cambio, **la identidad del run ya es derivable**: `WorktreeListing.surveyOf`
  usa `git worktree list --porcelain`, y el nombre del worktree es determinista
  (`.worktrees/<n>` y `feat/<n>` salen del número de issue).
- Y **el claim ya vive en el issue**: `GhPlanIssues.claim()` pone
  `status:in-progress`, y los tokens `area:` / `touches:` son labels — el
  mecanismo atómico que GitHub sí da.
- Lo que hoy se guarda de más: `ActivePlans` mantiene **tres mapas**
  (`sessions`, `implementing`, `uncertain`) más `ActivePlanRecovery`, y
  `/active-plans` responde **503 `active-plans-recovery-inconclusive`** cuando
  la reconstrucción no es concluyente.
- Y para actuar el backend no necesita recordar nada: `/implement-plan` recibe
  `agent`, `issue` y `repo` del front (`ImplementRequest`).

---

## 3. La arquitectura destino

Cuatro piezas nuevas, todas en sitios que el backend ya tiene:

| Pieza | Qué es |
|---|---|
| `domain/policies/run-machine.js` | La máquina corta: pasos, resultados y estados de run que **este** flujo usa. Lógica pura. Traducción de las 474 líneas, no de las 2.412 |
| `domain/ports/harness.js` | El puerto de Claude **por invocación**, no por sesión: `ask(brief, tools, model)` devuelve texto, coste, duración y si falló. El **modelo es un argumento**, que es lo que pide la issue 139 |
| `infrastructure/headless-harness.js` | El adaptador: `claude -p --output-format json`, con el tope por llamada que `ToolRunner` ya impone. Es el patrón de `judge-dispatch.js` traído al backend |
| `infrastructure/disk-checkout-registry.js` | El único estado que hay que persistir: qué checkouts atiende este backend. Hermano de `disk-go-registry.js` y `disk-implementation-start-registry.js` |

Y una pieza que **se retira en vez de portarse**: `active-plan-recovery.js`. Su
trabajo —reconstruir el estado parseando títulos de ventana— desaparece cuando
el estado se deriva (§5).

---

## 4. La medición

### 4.1 Cómo mide agentic-skills, y qué se adopta

Siete decisiones, y ninguna es la obvia:

1. **Un solo punto de captura.** Todo pasa por `HarnessInvocationRunner.call()`
   (34 líneas), y ahí mismo se registran traza, gasto y usos de herramienta. Si
   no pasas por el runner, no hay llamada: por eso no hay agujeros.
2. **La unidad medida es la invocación**, no la sesión ni el slice.
   `HarnessOutput` parsea el sobre: `total_cost_usd`, `num_turns`,
   `duration_ms`, `duration_api_ms`, `ttft_ms`, `session_id`, `is_error`,
   `permission_denials`, `stop_reason`, y `modelUsage` desglosado por modelo en
   tokens de entrada, salida, creación de caché y lectura de caché.
3. **El gasto es sumable.** `HarnessSpend` tiene `nothing()`, `plus()` y
   `summing()`, así que cualquier agregado es una suma y ningún consumidor sabe
   sumar campos a mano.
4. **La correlación paso ↔ gasto no se mete dentro del gasto: se cruza por
   `session_id`.** `CallTrace` guarda (coordenadas, paso, sesión);
   `CallSpendLog` guarda (coordenadas, sesión, gasto).
5. **«No medido» no es cero.** `HarnessSpend.measured` es `calls > 0`, y
   `CostExhaustion` distingue `TOTAL_EXCEEDED` de `CALL_UNMEASURED`.
6. **El presupuesto es dominio y corta** (`Budgets.slice_cost_usd = 50.0`).
7. **Persistencia uniforme y con schema:** JSONL append-only bajo
   `~/.claude/slice-runner/runs/`, una sola clase `DurableLedger(name, row)`, y
   cada fila un modelo con test de schema.

**Se adoptan 1, 2, 4, 5 y 7.** El 3 se adopta a medias (la forma de la fila, sin
la aritmética: ver §4.2) y el 6 **no se adopta**.

### 4.2 Lo que no se adopta, y por qué

- **Los agregados no son de la app: son SQL.** agentic-skills implementa
  `SpendByRole`, `SpendAverages`, `GroupedMetrics`, `Measurement` y `by_model`
  **porque su ledger es un JSONL en un portátil y no tiene dónde consultarlo**.
  Control Tower ya tiene una tabla de BigQuery compartida entre equipos
  (`CT_HARVEST_BQ_TABLE`), donde «gasto por papel», «media por modelo» y «tasa
  de primer intento» son un `GROUP BY`. Meterlos en el backend es duplicar un
  motor de consultas peor **y limitar el trabajo analítico posterior**: a
  BigQuery van los datos en crudo.
  Consecuencia: `HarnessSpend` se queda como **forma del dato que se emite**, y
  pierde `plus()` y `summing()`.
- **`by_variant` no entra: hoy es un literal.** `record.variant` se rellena con
  `VARIANT = "program"`, una constante. No compara nada — es infraestructura
  para un banco de pruebas que aún no existe.
- **`unrecorded-tool-uses` no entra: aquí no tiene causa.** Existe en
  agentic-skills porque los usos de herramienta **no vienen en el sobre**: los
  saca leyendo el transcript de la conversación del disco por `session_id`, y esa
  lectura falla de dos maneras (`NOT_FOUND`, `UNREADABLE`). Lo que compra ahí es
  distinguir *no lo hizo* de *no lo pude ver*. Aquí la fila se rellena solo con
  el sobre que devuelve el proceso: si no hay sobre, hay una **llamada fallida**,
  y eso se cuenta en su propia fila.
- **Presupuestos de dinero y cortes por coste no entran.** Se mide, se guarda, se
  agrega fuera. **Dos precisiones para que «sin presupuestos» no se lea de más:**
  el **tope por llamada al proceso** sí se queda, porque no es presupuesto de
  gasto sino higiene —una invocación colgada sin tope cuelga el run sin
  diagnóstico— y no hay que añadirlo, `ToolRunner` ya lanza cada binario con el
  suyo; y los **topes de reintento** de la máquina de estados (los
  `DEFAULT_BUDGETS` de `run-machine.js`: cuántas vueltas de control, de juez y de
  corrección) también se quedan, porque son su condición de parada. Lo que no
  entra es el dinero como criterio de nada.
- **Del principio de «un hueco no es un cero» se conserva lo que aquí tiene
  causa, y como columna:** `cost_usd` nulable con su causa, para no escribir un
  `0` cuando lo que pasó es que no se pudo medir.

### 4.3 El reparto

agentic-skills reparte en **nueve ledgers** con la **misma cabecera**
(`StampedRow`: `ts`, `repo`, `issue`, `slice_id`): `calls`, `spend`, `metrics`,
`verdicts`, `diffs`, `events`, `debt`, `tool-uses` y `unrecorded-tool-uses`. El
principio del reparto es **una tabla por cosa de la que eres testigo, no por
pregunta que quieres responder**, y la cabecera común es lo que permite
cruzarlas todas.

Aquí, dos tablas:

| Tabla | Grano | Quién la carga | Contenido |
|---|---|---|---|
| **`harness_calls`** *(nueva)* | una invocación | El backend | El sobre entero en crudo, sin recortar campos: `step`, `session`, `model`, `cost_usd` (nulable, con causa), turnos, las cuatro clases de token, `duration_ms`, `duration_api_ms`, `ttft_ms`, `is_error`, `stop_reason`, `permission_denials` |
| **La cosecha actual** | un slice | El plugin, como hoy | **Sin tocar**: sus 54 columnas ya son crudas por slice |

Dos decisiones dentro de esto:

- **`calls` y `spend` se fusionan.** En agentic-skills están separados porque son
  dos puertos de dominio con dos preguntas distintas y las cruza `SpendByRole`.
  Sin agregados en la app esa separación no compra nada: tienen el mismo grano.
- **El `step` hay que emitirlo en el origen.** Es el único dato que no se puede
  recuperar en SQL: el sobre trae `session_id` y coste, y quién sabe que esa
  sesión era el juez y no el implementador es **el programa, en el momento de
  llamar**. Si no se emite ahí, no existe.

Y una ventaja de calendario: **la tabla nueva la carga el backend, así que las
métricas no obligan a tocar el plugin.**

El ledger local se queda, pero su papel **no es analizar**: es no perder el dato
entre la llamada y la carga, que ocurre al cosechar.

Lo que se deja fuera y se dice para que no parezca olvido: `tool-uses` (qué
herramientas usó cada llamada) es dato crudo y valioso para explicar por qué un
run costó lo que costó, y se añade con el mismo patrón cuando haya una pregunta
que lo pida. `verdicts`, `diffs`, `events` y `debt` no entran: la cosecha ya lee
el fichero de telemetría del juez.

---

## 5. El estado del run: derivarlo, no guardarlo

El estado ya está en tres fuentes autoritativas. El trabajo no es escribir un
registro nuevo: es **dejar de reconstruirlo mal**.

| Qué se necesita | De dónde sale | Coste |
|---|---|---|
| Qué runs hay, en qué rama y en qué worktree | `git worktree list --porcelain` por checkout, que ya se usa | Local, sin red |
| De qué issue es cada uno | El número está en el nombre: `.worktrees/<n>` | Gratis, determinista |
| Qué repo es | Lo devuelve la propia encuesta (`WorkspaceSurvey.repository`) | Gratis |
| Planificando o implementando | El go, **que ya está en disco** (`disk-go-registry`, `disk-implementation-start-registry`): hay go → implementando | Lectura local |
| La lista de checkouts | El único fichero nuevo — hoy es un `Map` que se pierde al reiniciar | Un adaptador |

**Desaparece** `CmuxActivePlan` con sus tres expresiones regulares, y con él que
la **identidad** del run venga de un título de ventana.

**Lo que NO desaparece, corregido tras leer el código el 2026-09-08:** la
recuperación se queda **como concepto**. `ActivePlanRecovery.recover()` no solo
rellena mapas — también **arranca los dos `ReviewWatch`** (`startRecovered`), los
bucles que sondean el issue buscando cambios pedidos en el plan y en la pull
request, y arrancan en modo recuperado para establecer una **línea base** y no
volver a atender lo ya atendido. Ese `attended` es memoria genuina: no se deriva
de nada. Así que lo que la fase 1 cambia es **la fuente** de la recuperación, no
su existencia.

**Y el 503 sobrevive a la fase 1, no se va con ella.** Mientras el `agent` venga
de cmux, la consulta puede ser **no concluyente** (`listCmuxWorkspaces` devuelve
`null`, que no es `[]`), y ese es el caso que el 503 reporta con razón. Se cae en
la fase 4, cuando no haya ventana que consultar.

Dos matices:

- **El `agent` es lo único no derivable mientras exista cmux.** Se le pregunta a
  cmux **en el momento de listar**, en vez de recordarlo en un mapa. Es la misma
  llamada que hoy sin el estado alrededor, y **es más fiable**: hoy la
  reconstrucción se hace una vez al arrancar y si falla el endpoint responde 503;
  derivando, cada listado ve el estado actual y el siguiente reintenta. En la
  fase 4 se cae, porque no hay ventana que nombrar.
- **La fase `uncertain` no se borra: se borra su causa.** Existe porque la
  reconstrucción podía no ser concluyente. Si lo que se quiere seguir sabiendo es
  *«el agente se murió»*, esa es otra pregunta y en la fase 4 la contesta el
  registro de la llamada.

**El refresco del front sigue funcionando** porque `/active-plans` devuelve lo
mismo que hoy —`agent`, `issue`, `repo`, `branch`, `worktree`—; lo único que
cambia es de dónde saca el backend cada campo.

---

## 6. Las cinco fases

Cada fase entrega algo por sí sola. **Las tres primeras no tocan una línea del
plugin.**

### 6.1 Fase 1 — el backend recuerda solo lo que es suyo

**Qué entra:** `disk-checkout-registry.js`, un lector que deriva los planes en
vuelo de `git worktree list` (§5), la clave de Jira leída del **título del
issue**, y la recuperación cableada a eso en vez de a los títulos de ventana. Se
retira `CmuxActivePlan`.

**Precisión:** cmux deja de ser la fuente de la **identidad** del run, pero sigue
siendo la del `agent` y la de la **prueba de vida** hasta la fase 4. Por eso el
503 sigue vivo en esta fase.

**El dato que no está en git: la historia de usuario.** Hoy se saca del título de
la ventana, y no siempre existe (un plan pedido a mano no la tiene). Decidido el
2026-09-08: **se lee del título del issue**, que es `KEY summary` cuando viene de
una historia, y el cuerpo declara explícitamente cuándo no la hay
(`PlanIssueBody.NO_STORY_LINE`), así que no hay heurística. Es el dato
autoritativo, no añade estado, y **sobrevive a las fases 2 y 4** — las otras
salidas (persistirla en el worktree, seguir sacándola del título de cmux,
perderla) vuelven a estar sobre la mesa en la fase 2, cuando no haya ventana.
Si `gh` falla al recuperar, el run **se recupera sin story** en vez de no
recuperarse: la identidad viene de git, que es local.

**Criterio de cierre:** con un plan en vuelo, matar el backend, arrancarlo, y que
`/active-plans` devuelva **lo mismo que antes, campo por campo, story incluida**,
y que el barrido de cosecha siga barriendo su checkout. Más un test que vigile
que no queda ninguna expresión regular sobre títulos de cmux.

**Lo que esta fase NO cambia, a propósito:** un plan cuya ventana murió sigue
**sin aparecer** en el listado, igual que hoy. Derivando de git aparecería, con
`agent: null` — más honesto, porque el worktree y el trabajo están ahí — pero
sería un cambio visible en el front, y esta fase no cambia lo que el front ve.
Es la fase 4 la que lo resuelve, cuando «vivo» deje de significar «tiene
ventana».

### 6.2 Fase 2 — el plan se escribe headless, y se mide

**Qué entra:** el puerto `harness.js`, su adaptador headless, y la fila en
`harness_calls`. `HeadlessPlanAgents.launch` sustituye al de cmux **solo para
escribir el plan**; `resume`, `review` y `fix` siguen igual, y el `agent` pasa a
**nacer en `resume`**, que abre entonces la ventana con el errand de
implementación de hoy.

**Por qué la costura es limpia:** la salida de la fase del plan ya es durable
—el brief manda commitear el plan y publicarlo como comentario del issue, y el
errand de implementación empieza con *«implementa AHORA el plan que
commiteaste»*—. Las dos fases nunca necesitaron ser la misma sesión.

**Lo que entrega, y es lo que pide la 139:** el modelo es un argumento de la
invocación, y la fila lleva el modelo y el coste. Elegir modelo y poder
compararlo después son la misma pieza.

**La pérdida que se acepta:** cmux da gratis que **el trabajo sobreviva al
reinicio del backend**, porque la ventana no es hija del backend. Un `claude -p`
lanzado por el backend muere con él. Se acepta en vez de resolverse: escribir el
plan es idempotente —el worktree sigue ahí—, así que un run interrumpido **se
relanza**. Que sobreviva exigiría un proceso desprendido con su fichero de
estado, y es bastante más máquina.

**Criterio de cierre:** un plan escrito de punta a punta sin abrir ninguna
ventana, con su fila en `harness_calls` (modelo, coste, turnos, tokens,
duración), y el go y la implementación siguiendo por cmux como hoy.

### 6.3 Fase 3 — el control del plan lo corre el programa

**Qué entra:** el backend ejecuta la validación del plan y decide qué hacer con
el resultado; si falla, vuelve a llamar al harness con el fallo. El brief deja de
nombrar ningún comando. Es el primer bucle que cierra el programa en vez de
pedírselo al modelo.

**No toca el plugin:** invocar `dispatch-check --check-plan` como proceso es
usarlo, no modificarlo — igual que ya se hace con `--collect` y `--reopen`.

**Criterio de cierre:** un plan que falla la validación se corrige en una segunda
invocación **que el backend decidió**, con dos filas en `harness_calls`, y con el
brief sin una sola mención a un comando que el agente deba ejecutar.

### 6.4 Fase 4 — la implementación conducida, y cmux fuera

**Qué entra:** `run-machine.js` propia, y el backend llamando al harness paso a
paso. El juez es su propia llamada, con herramientas restringidas y **sin
`Bash`**, que es lo que impide que se convenza a sí mismo de que está verde.

**Qué desaparece:** `CmuxPlanAgents`, el launcher, el centinela, la política de
arranque, el reenvío de la línea y la prueba de vida por ventanas. Y con la
envoltura defensiva se va su daño colateral: las precondiciones que cuentan
commits existen para vigilar a un agente que conduce.

**La pérdida que hay que construir, no dar por hecha:** hoy se puede mirar la
ventana. Headless no se mira. agentic-skills lo resuelve con un vigilante que lee
las líneas del proceso mientras corre (`HarnessTurnWatch` con `on_line`, volcado
a un log de turnos). **Sin eso, esta fase cambia observabilidad por
determinismo, y sería un mal trato.**

**Criterio de cierre:** un slice completo —plan, go, implementación por tareas,
controles, juez, pull request— sin cmux en ningún punto, con una fila por llamada
y su paso, y con los turnos visibles mientras corre.

### 6.5 Fase 5 — los lectores propios

**Qué entra:** reimplementación en el backend de lo que hoy importa del plugin,
cada pieza con su **test de contrato** que alimenta la salida propia al lector
real del plugin — la receta que ya existe en `plugin-contract.test.js`. Y el
backend absorbe la carga de la cosecha.

**Y algo que no es código:** reescribir `backend/conventions/this-repository.md`,
que hoy declara lo contrario de este objetivo (*«The backend leans on the plugin,
never the reverse»*, con su párrafo justificándolo). Mientras esa regla esté
escrita, cualquier juez o revisor tiene razón al bloquear un diff que la
incumpla.

**Criterio de cierre:** cero rutas `../../../plugin` en `backend/src`, vigilado
por un test —igual que el que vigila el `source` del marketplace—, y la
convención reescrita.

---

## 7. Los contratos que cambian

- **`/implement-plan` deja de recibir `agent`** (fase 2). Hoy lo exige y refuta
  con `malformed-agent`; a partir de la fase 2 el `agent` lo **produce** el
  backend, porque es `resume` quien abre la ventana. Es contrato con el front, no
  detalle de implementación.
- **`/active-plans` deja de poder responder 503** por recuperación no
  concluyente — **en la fase 4, no en la 1**: mientras el `agent` venga de cmux,
  «no se pudo saber» sigue siendo un resultado posible y el 503 lo reporta con
  razón. La forma de la respuesta no cambia en ninguna fase.
- **`backend/conventions/this-repository.md`** cambia de regla (fase 5).

---

## 8. Riesgos

| Riesgo | Qué lo mitiga |
|---|---|
| **Congelar el plugin durante la portación no lo decide solo este repo.** Es lo público e instalable, y tiene otros usuarios | Es un acuerdo que hay que cerrar con ellos, no una decisión técnica. Ver §10 |
| **D-4 tiene dueño y no es quien escribe esto** | Este documento es el argumento para reabrirla, no su resolución. Ver §10 |
| **Se pierde la ventana** | El vigilante de turnos de la fase 4. Si no entra, la fase 4 no cierra |
| **Reimplementar el formato y desincronizarse** (fase 5) | Test de contrato por pieza contra el lector real del plugin |
| **Cinco fases es un plan largo** | Las tres primeras entregan sin tocar el plugin y son reversibles: si la 2 sale mal, se vuelve al adaptador de cmux borrando un cable |
| **Un run interrumpido se pierde** (fase 2) | Aceptado a conciencia: escribir el plan es idempotente y se relanza |

---

## 9. Lo que este diseño NO hace

- **No reescribe nada en Python** ni fusiona ningún repo dentro del otro. La
  portación es a JavaScript, en el backend, tomando de `agentic-skills` los
  **mecanismos** y no el código. Es lo que `convergencia-tres-loops.md` §6 declara
  fuera de alcance, y sigue fuera.
- **No mueve la frontera de §4 de ese documento:** `deploy-watch` y el análisis
  de causa raíz se quedan en `agentic-skills`, y Control Tower para en el merge.
- **No toca el brainstorming ni la congelación.**
- **No mete presupuestos, cortes por coste ni agregados en el backend.**
- **No paraleliza más de lo que hoy se paraleliza.**

---

## 10. Decisiones que necesitan dueño

| # | Decisión | Dueño | Cuándo |
|---|---|---|---|
| **A** | **Reabrir D-4** con este diseño encima, en vez de esperar a que cierre F38 | José | Antes de la fase 2. La fase 1 no la necesita: arregla un defecto de hoy y no cambia quién conduce, así que puede hacerse mientras D-4 se decide |
| **B** | **Congelar el plugin durante la portación** — no añadirle nada hasta que esté portado | José y Juanjo | Antes de empezar |
| **C** | Si la fase 4 no puede llevar el vigilante de turnos, ¿se hace igual? | Quien la ejecute | En la fase 4 |

---

## 11. Relación con los diseños que preceden

- **`2026-08-18-el-conductor-como-programa-design.md`** describe el conductor como
  programa y se dejó escrito «tal cual porque es lo que hay que leer el día que
  D-4 se decida». Este documento es ese día, para el backend. Y confirma con
  datos lo que aquella nota ya anticipó en su tabla: *«Presupuesto en dinero y
  gasto por papel — **No**: `total_cost_usd` sólo lo devuelve una llamada
  headless»*.
- **`2026-08-31-fusion-con-app-companion-design.md`** llegó a la conclusión
  simétrica desde el otro lado: *«todo lo que hay en CT de proceso desprendido,
  centinela y vigilante que sondea GitHub existe por una única causa — hoy nadie
  sostiene el terminal del agente»*. Aquella respuesta fue que otro sostenga el
  terminal; esta es que no haga falta terminal.
- **`convergencia-tres-loops.md`** fija el reparto por tercios y la frontera. Este
  diseño no lo cambia: cambia **cómo** el tercio de detrás se ejecuta en el
  backend.
