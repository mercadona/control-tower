import { useEffect, useRef, useState } from 'react'
import { ProjectReadinessClient } from 'app/project-readiness/client'
import { CHECK_LABELS, NEXT_ACTIONS, STATUS_LABELS, InspectionUnavailable, ProjectReadinessOutcome, ReadinessStatus } from 'app/project-readiness/ProjectReadiness.types'
import { LocalPath } from 'app/start-plan/LocalPath'
import { RepositoryName } from 'app/start-plan/RepositoryName'
import { Button } from 'system-ui/button'
import { Loading } from 'system-ui/loading'
import './ProjectReadiness.css'

type Props = { repository: string, path: string, disabled?: boolean }
type ViewState = 'idle' | 'pending' | ProjectReadinessOutcome

const SUMMARY: Record<ReadinessStatus, string> = {
  ready: 'Diagnóstico sin incidencias detectadas',
  'changes-required': 'Diagnóstico: requiere cambios',
  unverified: 'Diagnóstico con comprobaciones sin verificar',
}

class ProjectReadiness {
  static View = (props: Props) => <ProjectReadiness.Panel key={JSON.stringify([props.repository, props.path])} {...props} />

  private static Panel = ({ repository, path, disabled = false }: Props) => {
    const [state, setState] = useState<ViewState>('idle')
    const controller = useRef<AbortController | null>(null)
    const deadline = useRef<ReturnType<typeof setTimeout> | null>(null)
    const valid = RepositoryName.isWellFormed(repository) && LocalPath.isWellFormed(path)
    const pending = state === 'pending'
    const outcome = typeof state === 'string' ? null : state
    const report = outcome?.kind === 'inspected' ? outcome : null

    useEffect(() => () => {
      controller.current?.abort()
      controller.current = null
      if (deadline.current !== null) clearTimeout(deadline.current)
    }, [])

    const inspect = async () => {
      if (!valid || disabled || controller.current !== null) return
      const current = new AbortController()
      controller.current = current
      setState('pending')
      deadline.current = setTimeout(() => {
        current.abort()
        controller.current = null
        setState(new InspectionUnavailable())
      }, 35_000)
      const result = await ProjectReadinessClient.inspect(repository, LocalPath.normalize(path), current.signal)
      if (controller.current !== current || current.signal.aborted) return
      if (deadline.current !== null) clearTimeout(deadline.current)
      controller.current = null
      setState(result)
    }

    return (
      <section className="project-readiness" aria-label="Preparación del proyecto">
        <h3 className="lg-body-medium">Preparación del proyecto</h3>
        <p>Comprueba la configuración antes de arrancar el plan. La inspección no ejecuta tests ni modifica el repositorio.</p>
        <Button type="button" variant="secondary" disabled={!valid || disabled || pending} onClick={() => void inspect()}>
          {pending ? <><Loading aria-label="Comprobando preparación" /> Comprobando preparación</> : 'Comprobar preparación'}
        </Button>
        {pending && <p role="status">Consultando Git y Docker. Puede tardar hasta treinta segundos.</p>}
        {outcome?.kind === 'unavailable' && <p role="alert">No se pudo completar el diagnóstico. Comprueba la conexión con el backend y vuelve a intentarlo.</p>}
        {report !== null && (
          <div className="project-readiness__report">
            <p role="status"><strong>{SUMMARY[report.status]}</strong></p>
            <dl>
              <div><dt>Ruta inspeccionada</dt><dd><code>{report.path}</code></dd></div>
              <div><dt>Versión de partida conocida localmente</dt><dd><code>{report.baseRevision ?? 'No disponible'}</code></dd></div>
              <div><dt>Fecha de la inspección</dt><dd><time dateTime={report.observedAt}>{report.observedAt}</time></dd></div>
            </dl>
            <p>Las declaraciones se leen de la versión de partida; Compose y los contenedores se comprueban en el checkout local. Los permisos de escritura en GitHub y la disponibilidad futura del agente no quedan certificados. Consulta también el estado de las herramientas.</p>
            <ul className="project-readiness__findings">
              {report.findings.map((finding) => (
                <li key={finding.id} data-status={finding.status}>
                  <strong>{CHECK_LABELS[finding.id]}</strong><span className="project-readiness__status">{STATUS_LABELS[finding.status]}</span>
                  {finding.evidence.length > 0 && <ul aria-label={`Evidencia: ${CHECK_LABELS[finding.id]}`}>
                    {finding.evidence.map((line, index) => <li key={index}><code>{line}</code></li>)}
                  </ul>}
                  {finding.action !== null && <p>{NEXT_ACTIONS[finding.action]}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    )
  }
}

export { ProjectReadiness }
