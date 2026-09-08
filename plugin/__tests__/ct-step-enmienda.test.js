// Un trozo de la máquina de estados de scripts/ct-step.mjs. El preámbulo —y
// por qué son nueve ficheros y no uno— está en fixtures/ct-step-harness.js.
//
// Issue 161 — el plan amendado a media tarea. Antes, `esDelRun` excluía la
// ruta del plan de "lo que tocó la tarea", así que una enmienda quedaba
// stageada sin comitear (el bloqueo humano medido el 2026-09-08). Ahora la
// ruta del plan entra en el commit de SU tarea, como cualquier otro fichero
// que el implementador toca, y los tres controles que leen CONTENIDO del
// índice (alcance, tests, bloques) filtran esa ruta para no leer el plan como
// si fuera código de la tarea.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { crearHelpers, montarRepo } from './fixtures/ct-step-harness.js'

let repo
const { ct, informe, veredicto, veredictoDeSlice, commits, estado,
  paqueteDeTarea, juzgar, juzgarSlice, tareaOk } = crearHelpers(() => repo)

beforeEach(() => { repo = montarRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

const HALLAZGO = { severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }

// La enmienda que un implementador de verdad haría a media tarea: la tarea 1
// declaraba sólo `uno.txt`, y ahora también declara `extra.txt`. `informe`
// escribe `extra.txt` por su cuenta (crea lo que declara y no existe), así
// que aquí sólo hace falta tocar el plan.
function enmendar() {
  const ruta = join(repo, 'plan.md')
  const original = readFileSync(ruta, 'utf8')
  const enmendado = original.replace(
    '**Files:** `uno.txt` (create).',
    '**Files:** `uno.txt` (create), `extra.txt` (create).',
  )
  expect(enmendado).not.toBe(original) // el fixture cambió de forma sin que este test se enterase
  writeFileSync(ruta, enmendado)
}

describe('el plan enmendado viaja dentro del commit de su tarea', () => {
  it('el plan enmendado a media tarea entra en el commit de esa tarea, y el estado y el directorio del run no', () => {
    enmendar()
    ct('report', informe(['uno.txt', 'extra.txt']))
    ct('controls')
    juzgar(veredicto('PASS'))
    expect(ct('commit').status).toBe(0)

    const enElCommit = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(enElCommit).toMatch(/plan\.md/)
    expect(enElCommit).not.toMatch(/\.agent\/SLICE\.md/)
    expect(commits()).toBe(2) // base + esta tarea: ninguna tarea nueva por la enmienda
  })

  it('el control de alcance sale 0 y su salida no nombra la ruta del plan', () => {
    enmendar()
    ct('report', informe(['uno.txt', 'extra.txt']))
    const r = ct('controls')

    expect(r.stdout).toMatch(/controles: done/)
    const log = readFileSync(estado().lastControlsLog, 'utf8')
    expect(log).not.toMatch(/plan\.md/)
  })

  it('el paquete de revisión de la tarea trae el diff del plan', () => {
    enmendar()
    ct('report', informe(['uno.txt', 'extra.txt']))
    ct('controls')
    ct('next')

    const paquete = readFileSync(paqueteDeTarea(), 'utf8')
    expect(paquete).toMatch(/diff --git a\/plan\.md b\/plan\.md/)
    expect(paquete).toContain('extra.txt')
  })

  it('tras una tarea con enmienda, reconcile, global y slice-verdict no salen con PRECONDITION', () => {
    enmendar()
    ct('report', informe(['uno.txt', 'extra.txt']))
    ct('controls')
    juzgar(veredicto('PASS'))
    expect(ct('commit').status).toBe(0)
    expect(tareaOk('dos.txt').status).toBe(0)

    expect(ct('reconcile').status).not.toBe(8)
    expect(ct('global').status).not.toBe(8)
    expect(juzgarSlice(veredictoDeSlice('PASS')).status).not.toBe(8)
  })

  it('un veredicto vetado devuelve el árbol y el plan de HEAD no declara la ruta que la enmienda añadió', () => {
    // Primer intento: veto sin enmienda todavía — sólo abre el presupuesto de
    // reintentos, no dispara el consejero (eso pide el SEGUNDO veto).
    ct('report', informe(['uno.txt']))
    ct('controls')
    juzgar(veredicto('FAIL', [HALLAZGO]))
    expect(estado().step).toBe('implement')

    // Segundo intento: el implementador enmienda el plan y declara la ruta
    // nueva. El juez veta otra vez — el segundo veto manda al consejero.
    enmendar()
    ct('report', informe(['uno.txt', 'extra.txt']))
    ct('controls')
    juzgar(veredicto('FAIL', [HALLAZGO]))
    expect(estado().step).toBe('advise')

    ct('next')
    const consejo = join(repo, 'advice.json')
    writeFileSync(consejo, JSON.stringify({
      approach: 'prueba de otra forma',
      files_to_reconsider: ['uno.txt'],
    }))
    expect(ct('advice', consejo).status).toBe(0)
    expect(estado().step).toBe('implement')

    const plan = readFileSync(join(repo, 'plan.md'), 'utf8')
    expect(plan).not.toContain('extra.txt')
    expect(existsSync(join(repo, 'extra.txt'))).toBe(false)
  })
})

function quitarUnoDeLasFiles() {
  const ruta = join(repo, 'plan.md')
  const original = readFileSync(ruta, 'utf8')
  const enmendado = original.replace(
    '**Files:** `uno.txt` (create).',
    '**Files:** `dos.txt` (create).',
  )
  expect(enmendado).not.toBe(original)
  writeFileSync(ruta, enmendado)
}

describe('una enmienda sólo puede AÑADIR rutas', () => {
  it('una enmienda que quita una ruta declarada se rechaza y el paso sale en rojo', () => {
    quitarUnoDeLasFiles()
    ct('report', informe(['uno.txt']))
    const r = ct('controls')

    expect(r.stdout).toMatch(/controles: failed/)
    const log = readFileSync(estado().lastControlsLog, 'utf8')
    expect(log).toMatch(/tarea 1 enmendó el plan quitando 'uno\.txt'.*sólo puede AÑADIR rutas/)
  })

  it('una enmienda que sólo añade rutas pasa el control', () => {
    enmendar()
    ct('report', informe(['uno.txt', 'extra.txt']))
    const r = ct('controls')

    expect(r.stdout).toMatch(/controles: done/)
  })

  it('tras el rechazo, el plan de HEAD sigue declarando la ruta que la enmienda quitó', () => {
    quitarUnoDeLasFiles()
    ct('report', informe(['uno.txt']))
    ct('controls')

    const enHead = execFileSync('git', ['show', 'HEAD:plan.md'], { cwd: repo, encoding: 'utf8' })
    expect(enHead).toContain('**Files:** `uno.txt` (create).')
  })
})

// Issue 161, revisión — los cuatro agujeros que la revisión de la PR encontró.
// El primero es el que abría la puerta que el slice viene a cerrar: la guarda
// se condicionaba al ÍNDICE mientras todo lo demás medía el ÁRBOL.
describe('el plan que gobierna los controles es el que se va a comitear', () => {
  const log = () => readFileSync(estado().lastControlsLog, 'utf8')

  it('editar el plan DESPUÉS de report deja árbol e índice en desacuerdo, y el control lo rechaza', () => {
    ct('report', informe(['uno.txt']))
    enmendar()
    const r = ct('controls')

    expect(r.stdout).toMatch(/controles: failed/)
    expect(log()).toMatch(/el plan del árbol no es el que se va a comitear/)
    expect(log()).toMatch(/no está entre lo stageado/)
  })

  it('una segunda edición tras report, con el plan ya stageado, también se rechaza', () => {
    enmendar()
    ct('report', informe(['uno.txt', 'extra.txt']))
    const ruta = join(repo, 'plan.md')
    const otra = readFileSync(ruta, 'utf8')
      .replace('`extra.txt` (create).', '`extra.txt` (create), `otra.txt` (create).')
    expect(otra).not.toBe(readFileSync(ruta, 'utf8'))
    writeFileSync(ruta, otra)
    const r = ct('controls')

    expect(r.stdout).toMatch(/controles: failed/)
    expect(log()).toMatch(/el del ÍNDICE dice otra cosa/)
  })
})

describe('el control de alcance no exime a la maquinaria que llega al índice', () => {
  it('una ruta de docs/superpowers stageada a mano la señala el control de alcance', () => {
    ct('report', informe(['uno.txt']))
    const colado = join(repo, 'docs', 'superpowers', 'specs', 'colado.md')
    mkdirSync(dirname(colado), { recursive: true })
    writeFileSync(colado, 'colado\n')
    execFileSync('git', ['add', '--', 'docs/superpowers/specs/colado.md'], { cwd: repo })
    const r = ct('controls')

    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8'))
      .toMatch(/tocó 'docs\/superpowers\/specs\/colado\.md'/)
  })
})

describe('los dos mensajes del control de alcance no se contradicen', () => {
  it('la ruta declarada y no tocada ya no ofrece quitarla del PLAN', () => {
    ct('report', informe(['otro.txt']))
    const r = ct('controls')

    expect(r.stdout).toMatch(/controles: failed/)
    const texto = readFileSync(estado().lastControlsLog, 'utf8')
    expect(texto).toMatch(/QUITARLA NO ES TU SALIDA/)
    expect(texto).not.toMatch(/o sobra en el PLAN/)
  })
})

describe('enmendar el plan no se lee como un defecto del informe', () => {
  it('el aviso de discrepancia de report no nombra la ruta del plan', () => {
    enmendar()
    const r = ct('report', informe(['uno.txt', 'extra.txt']))

    expect(String(r.stderr ?? '')).not.toMatch(/Tocado y no declarado:.*plan\.md/)
  })
})
