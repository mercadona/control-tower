// ============================================================================
// CMUX — la ÚNICA copia del recorrido de workspaces, y la única que sabe que el
// esquema de cmux no está garantizado.
//
// POR QUÉ EXISTE ESTE FICHERO. Hasta esta ronda el mismo recorrido
// (`list-windows --json` + un `workspace list --window <id> --json` por ventana)
// vivía en TRES sitios, y sólo uno estaba bien:
//
//   - `ct-next.mjs#queryAllCmuxWorkspaces` — endurecido por dos revisiones
//     externas, con la guarda de esquema completa que está más abajo.
//   - `ct-watch-go.mjs#consultarSesion` — crudo, casando por `custom_title`.
//   - `ct-watch-merge.mjs#consultarCoordinadora` — crudo, casando por
//     `current_directory`.
//
// Lo cazó una revisión adversarial sobre la #37, y su observación más afilada no
// era la duplicación: era que el vigilante del merge había MEJORADO su mensaje
// de error justo antes. El mensaje viejo («no existe ninguna sesión en <cwd>»)
// era vago e inútil; el nuevo nombra la regla y le dice a la persona qué hizo
// mal. Con la lectura cruda, un renombrado de campo en cmux convierte eso en una
// acusación específica, segura y FALSA — y este repo tiene un fichero de tests
// entero (`ct-next-honest-messages.test.js`) contra esa clase exacta de mensaje.
// O sea que la mejora de honestidad, sin la guarda, empeoró el modo de fallo.
//
// Es el desacople que este repo ya pagó con JUDGE_TOOLS, VERDICT_RULES y
// PACKAGE_SECTIONS, y aquí con un agravante: las tres copias no eran iguales, y
// la que estaba bien era la que menos se leía.
//
// ESTE MÓDULO NO ES PURO, y por eso no vive en `dispatch.js`. Aquél se declara
// «lógica pura del dispatcher» y guarda los constructores de argv de cmux
// (`buildCmuxSendArgv`, `cmuxSessionName`); esto lanza subprocesos. Son dos
// sujetos distintos y se mantienen separados: la misma razón por la que
// `harvest.js` es puro y `ct-harvest.mjs` hace la IO.
// ============================================================================

import { execFileSync } from 'node:child_process'

// 5 segundos, el valor con el que nació esta consulta en ct-next.mjs. Se exporta
// porque los dos vigilantes tenían su propia constante (10 s) para la MISMA
// consulta: dos números para lo mismo es una divergencia esperando a que alguien
// ajuste uno y crea que ha ajustado los dos. Quien necesite otro plazo lo pasa.
export const CMUX_QUERY_TIMEOUT_MS = 5000

// ---------------------------------------------------------------------------
// listCmuxWorkspaces: consulta de SOLO LECTURA de todas las workspaces de todas
// las ventanas. Devuelve un array de `{title, cwd, cwdKnown, ref}`, o `null` si
// el resultado es NO CONCLUYENTE.
//
// By default, one failed window does not invalidate the other windows. This
// preserves the contract for existing consumers. With `requireComplete: true`,
// any failed window query returns `null`. Zero windows remains conclusive and
// returns `[]`.
//
// LA DISTINCIÓN QUE SOSTIENE TODO: `null` (no se pudo saber) no es `[]` (cmux
// contestó y de verdad no hay ninguna). De las dos se sigue algo distinto en
// cada uno de los tres consumidores, y confundirlas es el defecto que este
// módulo centraliza.
//
// IMPORTANTE (revisión externa): `custom_title`/`current_directory` son los
// nombres de campo observados contra la versión de cmux instalada en la máquina
// de desarrollo — no hay ninguna garantía de versión ni de esquema. Si el nombre
// real cambiara, CADA `ws.custom_title` sería `undefined`, fallaría el
// `typeof === 'string'` de más abajo, y el resultado se filtraría en silencio a
// un array vacío — indistinguible, antes de esta guarda, de "cmux respondió y de
// verdad no hay ninguna sesión". Eso degradaba CADA staleness-check a un falso
// "abandonado" y CADA verificación de lanzamiento a un falso "not-found", ambos
// ruidosos. `sawAnyWorkspaceEntry`/`sawAnyKnownTitleField` distinguen las dos
// causas de "cero resultados": si hubo entradas de verdad (`parsed.workspaces`
// no vacío) pero en NINGUNA se reconocía el campo, es mucho más probable un
// cambio de esquema que "cero sesiones de verdad" — se trata como NO
// CONCLUYENTE. Si nunca hubo ninguna entrada en ninguna ventana (el caso normal
// y esperado de "no hay nada abierto"), sigue siendo un `[]` con toda confianza.
//
// LO QUE "RECONOCER EL CAMPO" NO PUEDE SIGNIFICAR. La primera versión de esta
// guarda exigía una CADENA, y con eso se comió el caso más común que existe:
// una terminal de cmux sin título puesto trae `custom_title: null` (con su
// `has_custom_title: false` al lado). O sea que cualquiera con una terminal
// abierta y ningún plan en marcha —el arranque normal, incluido el de quien
// lanza el backend DESDE cmux— caía en "hubo entradas y ninguna con título" y
// se llevaba un NO CONCLUYENTE: `GET /active-plans` respondía 503
// `active-plans-recovery-inconclusive` y el front plantaba "No se puede saber
// qué hay en marcha" antes de poder hacer nada. La guarda contra la falsa
// certeza se había convertido en una falsa incertidumbre PERMANENTE, que es el
// mismo pecado por el otro lado. La línea correcta no es cadena-vs-resto, es
// campo PRESENTE (cadena o `null`: cmux ha contestado) vs campo AUSENTE
// (`undefined`: no sabemos si nos entendemos con este esquema).
//
// D5, hallazgo B — la guarda de arriba cubría `custom_title` y NADA MÁS:
// `current_directory` se leía a pelo (`ws.current_directory ?? null`) y luego se
// comparaba con igualdad ESTRICTA contra el worktree esperado. Si cmux
// renombrara SOLO ese campo (el título seguiría reconociéndose, así que
// `sawAnyKnownTitleField` no salvaría nada), cada `cwd` sería `null`,
// `null !== <worktree>` y CADA lanzamiento correcto se clasificaría como
// 'wrong-cwd' — es decir, exactamente la falsa alarma que la guarda de
// `custom_title` existe para evitar, y además con consecuencia de exit code:
// desde que 'wrong-cwd' dejó de contar como lanzado, un repo entero pasaría de
// exit 0 a exit 3 sin que nada estuviera mal.
//
// Arreglo, aplicado a los DOS campos y no a uno: un campo cuyo esquema no
// reconocemos degrada a NO CONCLUYENTE, nunca a "verificado que está mal". Para
// el cwd la degradación es POR ENTRADA (`cwdKnown`), no global como la del
// título: así también se comporta bien ante una flota mixta (unas entradas con
// el campo, otras sin él), y ante una sesión que legítimamente no expone
// directorio. Quien consuma esto traduce `cwdKnown: false` a un estado propio
// ('cwd-unknown' en `verifyCmuxLaunch`), jamás a 'wrong-cwd'.
// ---------------------------------------------------------------------------
export class CmuxWorkspaceQuery {
  static ask({ timeoutMs = CMUX_QUERY_TIMEOUT_MS, run = ejecutar, requireComplete = false } = {}) {
    let windows
    try {
      windows = JSON.parse(run(['list-windows', '--json'], timeoutMs))
    } catch (cause) {
      return CmuxWorkspaceQuery.#refused(`cmux could not be asked for its windows: ${CmuxWorkspaceQuery.#saidBy(cause)}`)
    }
    const out = []
    let sawAnyWorkspaceEntry = false
    let sawAnyKnownTitleField = false
    for (const w of (Array.isArray(windows) ? windows : [])) {
      if (!w || !w.id) continue
      try {
        const parsed = JSON.parse(run(['workspace', 'list', '--window', w.id, '--json'], timeoutMs))
        const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : []
        for (const ws of workspaces) {
          sawAnyWorkspaceEntry = true
          // El campo se da por CONOCIDO tanto si trae una cadena como si trae
          // `null`: `null` es cmux diciendo "esta workspace no tiene título
          // puesto" (lo corrobora su `has_custom_title: false`), y eso es una
          // respuesta, no una laguna. El rename que esta guarda vigila deja el
          // campo AUSENTE (`undefined`), y sólo eso sigue siendo no concluyente.
          if (ws && (typeof ws.custom_title === 'string' || ws.custom_title === null)) {
            sawAnyKnownTitleField = true
          }
          if (ws && typeof ws.custom_title === 'string') {
            const cwdKnown = typeof ws.current_directory === 'string'
            // F20/H1: `ref` (p.ej. "workspace:97") es el handle que acepta
            // `cmux send --workspace`. Se degrada a `null` con el MISMO
            // criterio que el cwd —por entrada, nunca global— porque su
            // ausencia no invalida nada de lo que ya se sabía: solo significa
            // que a ESA sesión no se le puede reenviar la línea, y quien lo
            // necesite tiene que poder decirlo en vez de mandar un `send` a
            // `undefined`.
            const ref = typeof ws.ref === 'string' && ws.ref.length > 0 ? ws.ref : null
            out.push({ title: ws.custom_title, cwd: cwdKnown ? ws.current_directory : null, cwdKnown, ref })
          }
        }
      } catch (cause) {
        // The default mode keeps results from the other windows. Complete mode
        // cannot reach a conclusion if one window is missing.
        if (requireComplete) {
          return CmuxWorkspaceQuery.#refused(
            `cmux could not be asked for the workspaces of window ${w.id}: ${CmuxWorkspaceQuery.#saidBy(cause)}`
          )
        }
      }
    }
    if (sawAnyWorkspaceEntry && !sawAnyKnownTitleField) {
      return CmuxWorkspaceQuery.#refused(
        'cmux listed workspaces and none of them exposes custom_title: this is not the schema this reads'
      )
    }

    return { entries: out, reason: null }
  }

  static #refused(reason) {
    return { entries: null, reason }
  }

  static #saidBy(cause) {
    const written = typeof cause.stderr === 'string' ? cause.stderr.trim() : ''

    return written === '' ? cause.message : written
  }
}

export function listCmuxWorkspaces(opts = {}) {
  return CmuxWorkspaceQuery.ask(opts).entries
}

function ejecutar(argv, timeoutMs) {
  return execFileSync('cmux', argv, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL',
  })
}

// ---------------------------------------------------------------------------
// LOS DOS BUSCADORES DE LOS VIGILANTES. Devuelven `{ consultado, ref }`, que es
// la forma que los dos ya sostenían por separado:
//
//   { consultado: true,  ref: '<handle>' } → está, y se le puede teclear.
//   { consultado: true,  ref: null }       → cmux contestó y NO está.
//   { consultado: false, ref: null }       → no se pudo saber.
//
// La tercera es la que se pierde con una lectura cruda, y perderla tiene
// consecuencias opuestas en los dos vigilantes: el del `-OK` se apaga con exit 4
// diciendo que la sesión del slice ya no existe, y el del merge acusa a una
// persona de no tener la coordinadora donde toca. Los dos con toda confianza y
// los dos en falso. Por eso el `null` de `listCmuxWorkspaces` se traduce aquí a
// `consultado: false` y no a "no está": es el único sitio donde esa traducción
// se hace, y así no puede volver a divergir.
//
// `undefined` para `ref` NO se usa nunca: "no se miró" viaja en `consultado`,
// jamás camuflado en el handle.
// ---------------------------------------------------------------------------
export function findWorkspaceByTitle(title, opts = {}) {
  return primeraQueCase((w) => w.title === title, opts)
}

// Casa por DIRECTORIO, y sólo contra entradas cuyo `cwdKnown` sea cierto: una
// entrada cuyo esquema de cwd no reconocemos no puede decir ni que coincide ni
// que no. Si NINGUNA entrada expone directorio, el resultado no es "no está":
// es `consultado: false`, porque la pregunta no se ha podido hacer. Sin esto, un
// renombrado de ese campo devolvería "cmux contestó y no está" con toda
// confianza — el falso negativo que D5 eliminó en ct-next y que aquí se colaba
// por la puerta de atrás.
export function findWorkspaceByCwd(cwd, opts = {}) {
  const all = listCmuxWorkspaces(opts)
  if (all === null) return { consultado: false, ref: null }
  const conocibles = all.filter((w) => w.cwdKnown)
  if (all.length > 0 && conocibles.length === 0) return { consultado: false, ref: null }
  const match = conocibles.find((w) => w.cwd === cwd && typeof w.ref === 'string')
  return { consultado: true, ref: match ? match.ref : null }
}

function primeraQueCase(predicado, opts) {
  const all = listCmuxWorkspaces(opts)
  if (all === null) return { consultado: false, ref: null }
  const match = all.find((w) => predicado(w) && typeof w.ref === 'string')
  return { consultado: true, ref: match ? match.ref : null }
}
