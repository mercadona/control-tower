# AGENTS.md
<!-- Guía durable del repo (≤150 líneas). Procedimientos → Skills. -->
## Project overview
## Setup commands
## Build, test & lint
## Code style & conventions
## Project layout
## Workflow: 1 issue = 1 slice = 1 session
## Commit & PR rules
## Security & data handling
## Do NOT touch
## Gotchas
## Skills (load on demand)

<!-- ct-init:loop -->
## Control Tower loop

Este repo lo gobierna el loop Control Tower: **un issue = un slice = una sesión**.

- **Comandos de este repo** (rellénalos una vez): build `…` · test `…` · lint `…`.
- **La vara de este repo** —los documentos de reglas del código que `ct-step`
  pega en el brief de cada tarea— se declara en `.agent/conventions.md`. La vara
  de ct viaja con el plugin y manda donde las dos hablen de lo mismo; donde ct
  calla, la del repo obliga entera.
- **El estado de un slice despachado es `.agent/SLICE.md`**, el de SU worktree
  (ignorado por git, nunca producto). `.agent/STATE.md` es el de la sesión
  coordinadora del checkout principal y un slice no lo toca. Si te quedas
  parado, escribe `blocked: {reason, unblock}` en tu `SLICE.md` y PARA.
- **Cada slice trabaja en `.worktrees/<n>` sobre `feat/<n>`**, y su claim
  (`status:ready` → `status:in-progress`) lo hace `/ct-next` en código: no
  muevas esas labels a mano. Al abrir el PR, `Closes #N` en el cuerpo.
- **Lo que no llega al cuerpo del issue no llega al agente**: no recibe el spec.
- **El formato de la tabla de slices —el contrato con `/ct-groom`— está en
  [`docs/superpowers/CONTRATO-SLICES.md`](docs/superpowers/CONTRATO-SLICES.md)**:
  qué columnas lee, qué genera cada una y qué hace `/ct-next` con ellas. Es lo
  que lee quien escribe un spec para este repo. Lo mantiene `/ct-init`, lleva su
  propia versión y no se edita a mano.
- **Cómo se levanta este repo** para atravesarlo de punta a punta: la sección
  «Cómo se atraviesa este repo (e2e)», más abajo. Rellénala una vez.
<!-- /ct-init:loop -->

<!-- ct-init:e2e-howto -->
## Cómo se atraviesa este repo (e2e)

<!-- Rellena esto UNA vez. Lo lee el agente de un slice cuya fila declara
     recorridos en la columna E2E de la tabla de slices. Si está sin
     rellenar, el agente marca sus recorridos como "no-verificado" y NO se
     inventa cómo levantar el repo. -->

- Levantar: `make run-frontend` desde la raíz — instala y construye el front y
  arranca el backend sirviéndolo en `http://127.0.0.1:8787/`. Un slice que solo
  toca `plugin/` no necesita servidor: ahí «levantar» es conducir `ct-step` de
  esta rama a mano sobre un repo temporal (`node plugin/scripts/ct-step.mjs`).
- Listo cuando: `curl -sf http://127.0.0.1:8787/` responde 200. Para los
  recorridos de `plugin/`, cuando `ct-step next` imprime el primer paso sin
  salir con `PRECONDITION`.
- Plazo: 120
- Tirar: matar el proceso de `make run-frontend` (Ctrl-C libera el 8787), y
  borrar el repo temporal si el recorrido creó uno.
- Herramientas: `curl` para el backend, el navegador para lo visual del front,
  y `git` sobre el repo temporal para comprobar qué quedó comiteado.
- Fuera de límites: GitHub — ningún recorrido crea, mueve ni cierra issues, ni
  abre pull requests; BigQuery — no cargar telemetría (`CT_HARVEST_BQ_TABLE`
  se queda sin definir); y `~/.claude/` — no reinstalar ni repuntar el plugin
  instalado como parte de un recorrido.
<!-- /ct-init:e2e-howto -->
