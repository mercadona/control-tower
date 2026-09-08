# La enmienda del plan — el hueco que rompe la autonomía, y la resta que lo cierra

**Fecha:** 2026-09-08
**Repo:** `josemerca/control-tower-plugin`, directorio `plugin/`
**Estado:** diseño aprobado — ningún fichero de producción tocado todavía
**Alcance:** tres cambios y una resta en `plugin/scripts/`, más el texto del juez de tarea

---

## 1. El hueco, y por qué rompe el principio

La implementación de un slice no debe requerir intervención humana. Hoy la
requiere en un caso concreto y reproducible: cuando el plan de una tarea está
mal en un detalle que sólo se descubre implementando.

Se midió en la prueba de punta a punta del 2026-09-08: la lista `**Files:**` de
la tarea 3 de 8 no declaraba un fichero que la tarea necesitaba. La sesión
arregló el plan, lo comiteó, y el verbo siguiente de `ct-step` murió:

> el estado y git no cuentan lo mismo: el fichero espera 1 commit(s) (tarea 2,
> paso implement) y en `d7dff37..HEAD ^origin/main` (sin fusiones) hay 2. No se
> sigue a ciegas.

El programa tiene razón en negarse (`ct-step.mjs:332-336`): comitea cada tarea
él mismo, y un commit que no hizo le deja sin saber qué diff tiene delante.
Lo que no existe es la salida.

Hay **dos** cortes de autonomía, no uno:

1. **El bloqueo.** El control de alcance falla, `controlRetries` devuelve el run
   a `implement` (`run-machine.js:195`), el implementador no puede arreglarlo
   desde el código, y a la segunda el run cierra en `BLOCKED_CONTROLS` — un
   estado del que, dice el propio fichero, «sale una persona, no un reintento».
   O el agente improvisa: comitear el plan mata el run, y operar `baseSha`
   también.
2. **El commit final es manual.** Incluso por la salida buena —dejar el plan
   modificado en el árbol y comitearlo tras «run delivered»— ese último commit
   lo hace una persona, fuera del programa. Si se olvida, la pull request
   presenta a su revisor un plan que contradice al código que la acompaña, y
   nada lo señala.

## 2. Los dos casos, y cuál de ellos se cierra

`**Files:**` no es una lista descriptiva: es una **valla puesta antes de andar**,
con tres consumidores.

- **Decide qué vara alcanza a la tarea.** `creaModulo` (`ct-step.mjs:695`) mira
  si alguna ruta lleva `(create)`; de eso depende que el brief reciba
  `architecture.md`.
- **Es el alcance que se le entrega al implementador.** El `task-brief` lo dice
  literalmente: el fin del slice «no amplía el `**Files:**` de la tarea».
- **Es el control mecánico a posteriori.** `alcanceDeclarado`
  (`ct-step.mjs:1345`), en los dos sentidos.

Por eso una lista `**Files:**` «mal» son dos cosas distintas:

**(a) El implementador se salió de la valla.** La respuesta correcta es traer el
código dentro, y el loop ya la ejecuta: el control bloquea y `controlRetries`
devuelve el run a `implement`. Aquí no hay hueco de mecánica — hay un hueco de
mensaje, porque el texto del control ofrece dos remedios y uno no tiene puerta.

**(b) La valla hace la tarea imposible.** El plan dibujó una tarea irrealizable.
Ahí sí hace falta enmendar.

Este diseño cierra los dos cortes para la clase `**Files:**`, en los casos (a) y
(b). **No** cierra la otra clase de plan imposible —un predicado de
`**Verification:**` que sale rojo diga lo que diga el código—: redactar un
predicado correcto es autoría, no cálculo. Ver §8.

## 3. La decisión que se revisita, y por qué el riesgo ya está vivo

El 2026-09-03 se decidió: «de momento no quiero que la máquina pueda corregir el
plan». El motivo era sólido: dar permiso de escritura sobre el plan aprobado
toca la puerta humana del gate `plan`, la única revisión real del ciclo.

Lo que la medición del 2026-09-08 añade es que **esa decisión protege menos de
lo que parecía**. `ct-step.mjs:190`:

```js
planText = readFileSync(planPath, 'utf8')
```

El programa lee el plan **del árbol**, una vez, al arrancar. De ahí salen todos:
`alcanceDeclarado`, `creaModulo`, el brief del implementador (`:708`) y el
paquete del juez de tarea (`:801`). El juez del slice recibe la ruta del mismo
fichero del árbol. Nadie lee nunca `git show HEAD:<plan>`.

Consecuencia medida: hoy un implementador que edite el plan en el árbol **ya se
amplía el alcance a sí mismo**, y los dos jueces **ya lo miden contra el plan
ampliado**. El run entrega en verde, con los dos jueces en PASS, y la pull
request lleva el plan viejo. Nadie lo caza.

Así que la decisión no impide que el plan cambie: impide que el cambio **se
vea**. Lo que este diseño hace no es conceder una capacidad nueva, es hacer
visible y juzgable una que ya está en uso.

## 4. El cambio

Cuatro piezas. Dos son restas.

### 4.1 `report` stagea el plan cuando está modificado

Hoy `esDelRun` (`ct-step.mjs:1081`) saca del stage tres cosas: el fichero de
estado, el directorio `.agent/run-<n>/` y el fichero del plan. Las dos primeras
se quedan como están. El plan pasa a stagearse cuando el árbol lo trae
modificado.

El precedente es literal y está en `scope.js:80-88`, para los veredictos:

> `ct-step verdict` escribe aquí el veredicto del juez cuando el ruling es PASS,
> lo stagea y **lo deja DENTRO del commit de la tarea**, porque el veredicto
> tiene que viajar en la pull request.

Ya existe un artefacto de la maquinaria que el programa stagea a propósito para
que entre en el commit de la tarea y llegue a la pull request. El plan enmendado
es el mismo caso, y por el mismo motivo.

El plan **sigue** en `LOOP_ARTIFACT_PATTERNS` (`scope.js:69`,
`docs/superpowers/plans/**`), así que el gate de alcance del epic no se pone
rojo por él.

**Consecuencia deliberada: no hay commit nuevo.** La enmienda viaja dentro del
commit de su tarea, así que el invariante «un commit por tarea» sigue siendo
cierto y el cruce del ledger (`:332`) no se toca. Ni contador nuevo, ni verbo
nuevo, ni campo nuevo en el estado.

### 4.2 `alcanceDeclarado` no se cuenta a sí mismo

`stagedPaths()` (`ct-step.mjs:1305`) es el índice crudo —`git diff --cached
--name-only`— sin el filtro de `entradasDelArbol()`. En cuanto el plan se
stagee, el control señalaría el propio plan como ruta tocada y no declarada.

Hoy no pasa porque el veredicto y la telemetría se stagean **después** del paso
`controls`; el plan sería la primera ruta de maquinaria que aparece antes. La
comprobación de alcance deja fuera de su cuenta las rutas de maquinaria
(`esRutaDeLaMaquinaria`).

**El control no se relaja en nada más.** Sigue exacto y sigue siendo fatal. Lo
que cambia es que el implementador tiene dos resoluciones legítimas en vez de
una: encoger el código, o enmendar la línea `**Files:**` de su tarea. Las dos
satisfacen el control, y las dos quedan en el diff.

### 4.2 bis — La enmienda sólo puede añadir

Con el plan mutable, la dirección contraria del control —`declarado y no
tocado`— se puede satisfacer por el lado malo: quitando la ruta del plan en vez
de escribiendo el código que prometía. Eso convertiría un control exacto en uno
que se desactiva solo, y el diff lo enseñaría pero el control ya no diría nada.

Así que se comprueba, y es sintáctico: al detectar el plan modificado, se
compara el `**Files:**` de la tarea actual contra el de `git show HEAD:<plan>`
—la ruta relativa al repo ya la tiene `esDelRun`— y la enmienda se rechaza si
**quita** alguna ruta declarada. Añadir sí; quitar no.

Es la única comprobación nueva de todo el diseño, y existe para que la
resolución legítima siga siendo hacer más trabajo, nunca prometer menos. La
dirección aditiva no necesita guardián: el implementador que declara una ruta
más está declarando más alcance, no menos, y de si estaba justificada dictamina
el juez (§4.3).

### 4.3 El juez de tarea dictamina sobre la enmienda

Quién arbitra entre «sobra en el código» y «falta en el plan» no lo decide el
programa: lo decide el juez, y sin actor ni esquema nuevos.

`diffDeTarea()` (`ct-step.mjs:754`) es `git diff --cached -U10`, y su comentario
lo dice: «la superficie exacta que el juez ve y que `commit` se lleva». Con el
plan stageado, la enmienda está **dentro** del diff que el juez juzga. Y como el
kickoff del gate `plan` ordena tenerlo escrito, validado y **comiteado** antes
de implementar (`gates.js`, entrada `plan`), lo que aparece en el diff son las
líneas enmendadas, no el plan entero.

Lo único que hace falta es **decírselo**: el brief del juez de tarea declara que
un diff del fichero del plan dentro de una tarea es una enmienda, y que
dictaminar si está justificada es parte de su trabajo. Sin esa línea, vetaría el
plan por reflejo como ruta fuera de alcance, o lo ignoraría.

Si veta, `judgeRetries` devuelve el run a `implement` y la enmienda muere con el
intento rechazado. Es la semántica correcta.

### 4.4 `architecture.md` aplica siempre

`creaModulo` se evalúa **dos veces** contra un fichero que este diseño vuelve
mutable a media tarea:

- `ct-step.mjs:708`, al escribir el brief, **al empezar** la tarea.
- `ct-step.mjs:801`, al escribir el paquete del juez, en el paso `judge`.

Con una enmienda que añada una ruta `(create)`, el brief salió con
`creates: false` —sin `architecture.md`— y el paquete del juez se compone con
`creates: true` —con él—. El juez queda armado con una vara que el implementador
no tuvo, y puede vetar citando reglas que era imposible que conociera: el muro
insatisfacible que `scope.js` cita como cosa a no repetir.

La salida no es un caso especial, es una resta. `PluginYardstick.forTask` tiene
exactamente **dos** consumidores, y son esos dos. Quitándolos se queda sin
llamar toda la cadena del filtro:

| Se borra | Dónde |
|---|---|
| `creaModulo` | `ct-step.mjs:695` |
| `forTask` | `plugin-yardstick.js:58` |
| `appliesToTask` | `plugin-yardstick.js:52` |
| `#NEW_MODULES` | `plugin-yardstick.js:43` |
| `scopeOf` | `plugin-yardstick.js:45` — sólo lo usaba `appliesToTask` |

`composeSection` y `composePathSection` se quedan, recibiendo la lista de
documentos directamente — exactamente como ya las llaman el paquete de slice
(`ct-step.mjs:1603`) y `judge-bench.mjs:114`.

**Y ese es el argumento que lo cierra: el juez del slice ya recibe las ocho
convenciones siempre**, `architecture.md` incluida, porque compone la vara con
`deCt` a pelo, sin `forTask`. Hacer que aplique siempre no es una política
nueva: pone el nivel de tarea de acuerdo con el nivel de slice.

De las ocho convenciones de `plugin/conventions/`, sólo `architecture.md`
declara `Applies to: **new modules**`; las otras siete dicen «every diff». El
coste medido de quitar el filtro son **8.776 bytes** en la sección de vara del
brief de una tarea que no crea nada y del paquete de su juez —un 27% sobre los
32.888 de las otras siete—. En el paquete del slice no cambia nada. El coste es
observable en la telemetría que ya existe (`briefVaraCtMeasures`) y revertirlo
sería un `if`.

Con esta resta desaparece el residuo entero de §4.1-4.3: no hay asimetría entre
brief y juez, no hay que prohibir enmiendas con `(create)`, y un módulo nuevo
nace siempre con sus reglas.

Además, el texto de `kickoff.js:270` deja de ser cierto —hoy le dice al
planificador que «de qué lado cae cada cosa lo decides tú al repartir
`**Files:**` entre `(create)` y `(modify)`»— y se retira.

## 5. Lo que no cambia

- El cruce del ledger (`:332`) y el invariante «un commit por tarea».
- El fichero de estado: ningún campo nuevo, ningún contador nuevo.
- Los verbos de `ct-step`: ninguno nuevo.
- La máquina de estados (`run-machine.js`): ninguna transición nueva.
- El esquema del veredicto del juez de tarea.
- La exclusión del fichero de estado y de `.agent/run-<n>/` en `esDelRun`.
- El control de alcance en su dirección contraria —`declarado y no tocado`— y la
  comprobación de la marca `(create)` contra git: siguen fatales. Y siguen
  siéndolo de verdad, porque §4.2 bis impide desactivarlos quitando la ruta del
  plan.

Y el código no redacta plan: la línea la escribe el implementador, que es quien
la escribe hoy. La diferencia es que ahora la ve un juez y viaja en la pull
request.

## 6. Por qué es seguro

- **`tokenVigente`** (`ct-step.mjs:1939`) ata la aprobación del juez al árbol
  exacto del índice: la enmienda que el juez aprobó es byte a byte la que se
  comitea. La maquinaria que hace fiable «el juez decide sobre exactamente lo
  que se va a comitear» ya estaba construida.
- **`--release` revalida el plan enmendado.** El plan está en el diff
  `measurementRef...HEAD`, así que vuelve a entrar en `checkPlans`
  (`dispatch-check.mjs:883`) y una reescritura mal formada se cae con la salida
  6 antes de liberar nada. Borde conocido: la regla `size` topa los caracteres
  de una tarea, así que una enmienda podría tirar una tarea justa por encima del
  folio — sale rojo y visible, no callado.
- **La literalidad no se rompe.** `cut`, el corte contra el que `checkPlans` lee
  los ficheros citados, es la **base de la rama**
  (`dispatch-check.mjs:725-756`), no el último commit que tocó el plan. Comitear
  el plan a media ejecución no lo mueve.
- **Un veto revierte la enmienda** con el resto del intento rechazado.

## 7. Tests

Todo con el harness que ya existe (`plugin/__tests__/fixtures/ct-step-harness.js`):
repo temporal, git de verdad, plan de dos tareas.

1. **La vía A deja de matar el run.** Tarea 1 por el camino feliz; se enmienda el
   `**Files:**` de la tarea 2 en el árbol; el ciclo completo de la tarea 2 pasa y
   el plan enmendado queda **dentro** del commit de la tarea 2 (`git show
   HEAD --name-only` lo incluye).
2. **El plan no se señala a sí mismo.** Con el plan stageado, `controls` sale 0 y
   su salida no menciona la ruta del plan.
3. **El juez ve la enmienda.** El paquete de revisión de la tarea contiene el
   diff del fichero del plan.
4. **El invariante aguanta.** Después de la tarea 2 con enmienda, `reconcile`,
   `global` y `slice-verdict` no salen con `PRECONDITION`.
5. **El veto la revierte.** Con veredicto FAILED, el árbol vuelve al último
   commit y el plan de `HEAD` no declara la ruta nueva.
6. **Encoger se rechaza.** Una enmienda que **quita** una ruta declarada de
   `**Files:**` no se stagea, el paso sale en rojo con el mensaje de §4.2 bis, y
   el plan de `HEAD` sigue declarándola.
7. **La vara es la misma para los dos.** El brief de la tarea y el paquete de su
   juez llevan los ocho documentos, cree la tarea un módulo o no.

Y las expectativas a actualizar por la resta: los casos de `creates` en
`plugin-yardstick.test.js`, y los tests que hoy afirman que `architecture.md`
**no** está —`ct-step-paquete`, `ct-step-vara-y-telemetria`, `conventions-vara`,
`yardstick-citation`, `precedencia-una-sola-fuente`, `run-metrics`— más el texto
de `kickoff.test.js`.

## 8. Lo que queda fuera, nombrado

- **La otra clase de plan imposible.** Un predicado de `**Verification:**` rojo
  siempre no se arregla con esto. La subclase que se midió en el slice #35 —
  `grep -c` sobre dos ficheros— ya está cerrada en el contrato del plan
  (`plan-tasks.js:457`, commit `2398432`). La familia entera, no.
- **El plan vive en dos sitios y nadie los compara.** El `.md` comiteado en la
  rama es lo que mide la maquinaria; el plan **publicado como comentario del
  issue** es lo que leyó el humano que dio el `-OK <nonce>`. Ese comentario queda
  congelado en el momento de la firma y nadie lo republica, así que la pull
  request es el único sitio donde una persona ve la enmienda. Y nada ata las dos
  copias: `planSha256` (`run-metrics.js:94`) sólo alimenta la telemetría, y el
  sha256 del `go-registry` es del **nonce**, no del texto del plan. Hoy se podría
  publicar el plan A, cobrar el go, y comitear el plan B. Agujero mayor que éste
  y vecino suyo; no se toca aquí.
- **Un comentario falso.** `ct-step.mjs:688` afirma que `dispatch-check
  --check-plan` comprueba las marcas `(create)`/`(modify)` contra el commit
  anterior. No lo hace: nadie mira el contenido de `**Files:**` en tiempo de
  plan. Se corrige de paso, porque el bloque que lo contiene desaparece con §4.4.
- **Anotado y medible, no cerrado:** cuántas veces se enmienda un plan, y en qué
  dirección la resuelve el juez. Sale de la telemetría del run.

## 9. La prueba de punta a punta

El slice se lanza por la puerta principal del propio producto: `make
run-frontend`, `POST /start-plan` sobre su issue, `GET /plan-events/:issue`, el
gate humano `-OK <nonce>`, `POST /implement-plan`,
`GET /implement-progress/:issue`.

Dos avisos que hay que tener antes, no después:

1. **El arreglo no se prueba a sí mismo en su propia corrida.** El backend
   despacha al agente del plan por nombre de skill
   (`backend/src/infrastructure/plan-agent-brief.js:32`), que resuelve al plugin
   **instalado**, no al del worktree. La corrida que construya esto ejecutará el
   `ct-step` viejo. La punta a punta del comportamiento nuevo necesita una
   **segunda** corrida con el plugin reinstalado desde la rama.
2. **Y esa primera corrida puede caer en el hueco que arregla.** Si su propio
   plan se equivoca en un `**Files:**` a media ejecución, se come el bloqueo con
   el código viejo. La salida conocida: dejar el plan modificado en el árbol, no
   comitearlo, seguir con `ct-step next`, y comitearlo a solas después de «run
   delivered». No tocar `baseSha` ni el fichero del run.
