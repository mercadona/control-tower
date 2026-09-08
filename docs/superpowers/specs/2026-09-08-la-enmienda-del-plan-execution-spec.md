# La enmienda del plan — Execution spec

**Handoff origen:** `docs/superpowers/specs/2026-09-08-la-enmienda-del-plan-design.md`
**Fecha de congelación:** 2026-09-08
**Estado:** DRAFT

## Hipótesis del experimento

**Apuesta:** un slice cuyo plan declara mal las `**Files:**` de una tarea
intermedia llega hoy a `BLOCKED_CONTROLS` o muere en `PRECONDITION`, y con este
epic llega a `delivered` **sin que ninguna persona toque nada** — con el plan
enmendado dentro del commit de su tarea, juzgado por el juez de esa tarea, y
visible en el diff de la pull request.

**Cómo sabremos que falló:** si tras el epic un slice con ese defecto sigue
necesitando una persona; o si el juez de tarea deja pasar una enmienda que
amplía el alcance sin justificación; o si aparece una enmienda que **quita**
rutas declaradas.

**Anti-scope — qué NO hace este epic:**

- No arregla la otra clase de plan imposible: un predicado de
  `**Verification:**` que sale rojo diga lo que diga el código. Redactar un
  predicado correcto es autoría, no cálculo.
- No compara el plan `.md` comiteado con el plan publicado como comentario del
  issue. Ese agujero es mayor y vecino, y se queda fuera a propósito.
- No añade verbo, contador, campo de estado ni transición de `run-machine.js`.
- No permite que el código redacte texto del plan: la línea la escribe el
  implementador, igual que hoy.
- No toca el gate humano `plan` ni su nonce.

## Decisiones congeladas

- **D-1 · El principio que gobierna el epic** — la implementación de un slice
  no debe requerir intervención humana; un bloqueo como el que se midió el
  2026-09-08 rompe ese principio y es lo que hay que cerrar.
  *(Procedencia: hablada — «al final la implementación no debe requerir de intervención humana, y un bloqueo presentado como el de mi compañero rompe ese principio».)*
- **D-2 · El árbitro es el juez de tarea, y el implementador comitea** — el
  implementador enmienda la línea y la enmienda entra en el commit de su tarea;
  quien dictamina si estaba justificada es el juez de esa tarea, con la
  enmienda dentro del diff que ya juzga.
  *(Procedencia: hablada — «por qué no dejamos que el implementador comitee lo que considere y que sea el juez el que decida si es correcto o no».)*
- **D-3 · `architecture.md` aplica siempre** — se borra el filtro por
  `(create)` entero, con lo que desaparece la asimetría entre la vara del brief
  y la del paquete del juez.
  *(Procedencia: hablada — «si hacemos que architecture aplique siempre, se simplifica todo, no».)*
- **D-4 · La solución más simple posible, y por resta** — se descartaron por
  este criterio un fichero de enmiendas aparte (dos fuentes de verdad), un
  verbo `amend-plan` con guardián de rutas, un contador `planAmendments` en el
  estado, y un disparador por segundo reintento del control.
  *(Procedencia: hablada — «quiero buscar soluciones lo más simples posibles».)*
- **D-5 · La enmienda sólo añade** — se comprueba, porque quitar una ruta
  declarada desactivaría desde dentro un control que hoy es exacto. Es la única
  comprobación nueva del epic.
  *(Procedencia: deducida de D-2 y D-4 — salió de la autorevisión del diseño, no de la conversación.)*
- **D-6 · El orden de construcción** — la resta va primero: sin ella, la
  enmienda que añade una ruta `(create)` deja al juez con una vara que el
  implementador no tuvo.
  *(Procedencia: deducida de D-3.)*

## Enfoque técnico

El corazón es `plugin/scripts/ct-step.mjs`, y el epic entero cabe en cuatro
sitios suyos más uno de `plugin-yardstick.js`. No hay módulo nuevo.

El orden no es negociable: **primero la resta** (slice 1), porque hace
desaparecer el residuo del slice 2 en lugar de obligarle a tratarlo con un caso
especial. El slice 1 es una eliminación pura y su coste está en actualizar las
expectativas de siete ficheros de test; el slice 2 es el cambio de
comportamiento y trae la única comprobación nueva.

Los dos tocan el mismo área (`plugin`) y el mismo fichero, así que **se
serializan**: el 2 depende del 1 y no se despachan en paralelo.

Lo que sostiene que esto sea seguro ya está construido y no se toca:
`tokenVigente` ata la aprobación del juez al árbol exacto del índice, y
`--release` vuelve a pasar el plan enmendado por `checkPlans` con su salida 6.

**Prerrequisito fuera de los slices:** este repo no está bootstrapeado para el
loop — no hay `.agent/`, no hay `AGENTS.md`, y el `.gitignore` no trae las
líneas que pone `/ct-init`. Hay que correr `/ct-init` antes de despachar nada,
y rellenar en `AGENTS.md` la sección «Cómo se atraviesa este repo (e2e)», o el
gate `e2e` del slice 2 sólo podrá emitir «no-verificado».

## Contexto del epic

- Stack: Node 24, JavaScript sin TypeScript en `plugin/`, suite con `node:test`.
- La vara del repo son los ocho documentos de `plugin/conventions/`, y ligan en
  todo diff.
- Lo nuevo nace sin comentarios en el código, en inglés y en clases.
- Un commit por tarea: el invariante que cruza el estado con git en cada verbo
  de `ct-step` no se toca en este epic.
- El plan del slice se lee del árbol de trabajo, nunca de `HEAD`. Es el hecho
  del que sale todo este epic.
- Ninguna transición del run depende de una medida: la telemetría nunca puede
  tumbar un run.

## Tabla de slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Señal | E2E |
|---|-------|------|---------|-----|--------|-----------|------|------|------|-------|-----|
| 1 | La vara no depende de `(create)` | backend | El brief de una tarea y el paquete de su juez llevan los ocho documentos de la vara, igual que ya los lleva el paquete del slice | – | el brief de una tarea que no crea nada incluye `architecture.md`, el paquete del juez de esa tarea también, `creaModulo` ya no existe en `ct-step.mjs`, `forTask` `appliesToTask` `#NEW_MODULES` y `scopeOf` ya no existen en `plugin-yardstick.js`, el texto de `kickoff.js` ya no reparte la arquitectura entre `(create)` y `(modify)`, la suite de `plugin/` en verde | `composeSection` y `composePathSection`, el paquete del slice y `judge-bench.mjs`: los tres siguen recibiendo la lista de documentos tal cual | plugin | – | – | los bytes de vara del brief que ya mide la telemetría del run suben en una tarea que no crea módulo, y no cambian en el paquete del slice | no |
| 2 | La enmienda del plan viaja en su tarea | backend | Un `**Files:**` mal declarado se enmienda a media tarea sin que ninguna persona intervenga: la enmienda se stagea, entra en el commit de su tarea y la dictamina el juez de esa tarea | #1 | un plan enmendado a media tarea queda dentro del commit de su tarea, `controls` sale 0 y no señala la ruta del plan, el paquete de revisión de la tarea contiene el diff del fichero del plan, ningún verbo posterior sale con `PRECONDITION`, un veto del juez devuelve el árbol y el plan de `HEAD` no declara la ruta nueva, una enmienda que quita una ruta declarada se rechaza y el plan de `HEAD` sigue declarándola, el fichero de estado y `.agent/run-<n>/` siguen fuera del commit de la tarea | el cruce del ledger y el invariante de un commit por tarea, los verbos de `ct-step`, las transiciones de `run-machine.js`, el esquema del veredicto del juez de tarea, y el gate humano `plan` con su nonce | plugin | – | – | la telemetría del run deja constancia de cada enmienda y de en qué dirección la resolvió el juez de la tarea | un slice de prueba conducido con el `ct-step` de esta rama sobre un repo temporal\, con el `**Files:**` de una tarea intermedia mal declarado a propósito: el run llega a `delivered` sin intervención y el plan enmendado está dentro del commit de esa tarea |

## Decisiones aparcadas (BLOCKED)

| ID | Fila | Qué falta decidir | Opciones vistas | Estado |
|----|------|-------------------|-----------------|--------|
| B-1 | – | Si se ata el plan `.md` comiteado al plan publicado como comentario del issue | Comparar el sha256 del texto en `--release`; republicar el comentario al enmendar; no hacer nada | Aparcada: agujero mayor que el de este epic y con decisión propia pendiente |
| B-2 | – | Si el validador del plan gana un ensayo previo al gate humano: correr los predicados de `**Verification:**` contra el árbol esperándolos en rojo, y comprobar que las rutas `(modify)` se pueden leer | Hacerlo en `--check-plan`; dejarlo | Aparcada: encoge el residuo pero no cierra el hueco, y no es este epic |

## Registro de cierre (evidencia)
