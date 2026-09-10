export type ReadinessStatus = 'ready' | 'changes-required' | 'unverified'

export const CHECK_LABELS = {
  checkout: 'Repositorio y ruta local',
  base: 'Versión de partida de los worktrees',
  commands: 'Comandos de construcción, tests y estilo',
  conventions: 'Convenciones del proyecto',
  'test-workers': 'Procesos de tests',
  'checkout-drift': 'Diferencias de configuración con la versión de partida',
  'git-ignore': 'Archivos temporales y planes en Git',
  docker: 'Docker y recursos disponibles',
  compose: 'Configuración de Compose inspeccionada',
  'container-resources': 'Límites de los contenedores',
  'database-readiness': 'Disponibilidad de PostgreSQL al arrancar',
  'worktree-config': 'Puertos, nombres y montajes compartidos',
  'build-context': 'Origen de la construcción de imágenes',
  'container-mounts': 'Montajes de los contenedores existentes',
  'image-provenance': 'Imágenes de los contenedores existentes',
  execution: 'Ejecución en un worktree nuevo',
  inspection: 'Inspección disponible',
}

export const NEXT_ACTIONS = {
  'confirm-checkout': 'Comprueba que la ruta pertenece al repositorio elegido y que origin apunta a él.',
  'update-checkout': 'Revisa y actualiza la referencia origin/HEAD y la configuración de la rama de partida. El diagnóstico no descarga cambios.',
  'declare-commands': 'Declara los comandos reales de build, test y lint en AGENTS.md o .agent/conventions.md.',
  'declare-conventions': 'Declara en .agent/conventions.md las rutas de las convenciones entre comillas invertidas y comprueba que contienen reglas.',
  'limit-workers': 'Limita los procesos de tests y comprueba que el valor llega al contenedor.',
  'inspect-command': 'Revisa el comando efectivo de tests y su número de procesos. Este formato aún no se puede comprobar automáticamente.',
  'fix-ignore': 'Ignora los worktrees y el estado temporal, pero permite guardar los planes de docs/superpowers/plans en Git.',
  'declare-compose': 'Indica qué configuración usa el proyecto. No se ha encontrado un único archivo Compose compatible.',
  'start-docker': 'Comprueba que Docker está instalado, arrancado y accesible desde el backend; después repite el diagnóstico.',
  'review-compose': 'Revisa el archivo Compose indicado y las opciones que usa el proyecto. Los formatos no reconocidos quedan sin verificar.',
  'limit-resources': 'Define límites de procesador y memoria para la aplicación y sus servicios, contando las ejecuciones simultáneas.',
  'wait-for-database': 'Añade una comprobación de disponibilidad de PostgreSQL y espera a que pase antes de lanzar los tests.',
  'isolate-worktrees': 'Comprueba con dos worktrees que código, datos, puertos y limpieza están aislados. Los contenedores comparten recursos del ordenador.',
  'verify-dependencies': 'Comprueba que la imagen y su contexto de construcción corresponden a las dependencias del worktree.',
  'recreate-environment': 'Revisa el entorno del proyecto indicado y sus montajes e imágenes antes de recrearlo. Conserva el trabajo y los datos que necesites.',
  'verify-execution': 'Verifica por separado el arranque, un test acotado, la cancelación y limpieza, y el recorrido de backend y frontend en un worktree nuevo.',
  'retry-inspection': 'Hay otra inspección activa o no se pudo leer la información dentro del plazo. Espera un momento y vuelve a comprobar.',
}

export type ReadinessFinding = {
  id: keyof typeof CHECK_LABELS
  status: ReadinessStatus
  evidence: string[]
  action: keyof typeof NEXT_ACTIONS | null
}

export type ProjectReadinessReport = {
  repo: string
  path: string
  base_revision: string | null
  observed_at: string
  status: ReadinessStatus
  findings: ReadinessFinding[]
}

export type ProjectReadinessOutcome = { kind: 'inspected', report: ProjectReadinessReport } | { kind: 'unavailable' }
