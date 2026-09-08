# Acuses de las señales de colisión de protocolo

claim: 2026-09-08 — este repo ES la casa del plugin, así que `plugin/scripts/dispatch-check.mjs` no es un protocolo de claim rival: es el del propio loop, y `backend/src/infrastructure/dispatch-check-*.js` son el producto que lo consume. No hay dos protocolos sobre el mismo espacio de labels, hay uno visto desde dentro. Manda el del plugin, que es el único que existe.

El barrido de `/ct-init` no puede distinguir «el repo trae su propio script de claim»
de «el repo trae el script de claim», y en un repo cualquiera esa señal estaría bien
disparada. Aquí es autodetección.

Sobre la vara del repo (`.agent/conventions.md`, que se queda sin declarar):

- `plugin/conventions/*.md` **no se declaran**. Son ya la vara de ct: `cargarVaraDeCt()`
  las lee de `PLUGIN_ROOT`, que en este repo es este mismo `plugin/`. Declararlas las
  pegaría **dos veces** en cada brief — unos 33 KB duplicados por tarea.
- `AGENTS.md` **no se declara**. `/ct-init` lo marcó como esqueleto (solo encabezados) y
  advierte, con razón, que declarar un documento vacío es peor que no declarar: le da al
  juez una vara del repo que no dice nada.
- `backend/conventions/this-repository.md` **no se declara todavía**. La vara del repo es
  una propiedad del repo entero, así que declararla la pegaría también en los briefs de
  tareas que solo tocan `plugin/`. Se revisa cuando entre un epic con slices de backend.
