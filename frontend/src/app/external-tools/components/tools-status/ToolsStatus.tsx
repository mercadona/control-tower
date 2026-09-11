import { ComponentType } from 'react'
import {
  METRICS_DELIVERY_TOOL,
  MetricsDelivery,
  SessionState,
  ToolSession,
} from 'app/external-tools/ExternalTools.types'
import { ExternalTools } from 'app/external-tools/useExternalTools'
import { StatusIconProps, StatusInfoIcon, StatusKoIcon, StatusSuccessIcon, StatusWarningIcon } from 'system-ui/icons/StatusIcons'
import './ToolsStatus.css'

const ROW_ICON_SIZE = 20

type SessionIcon = { Icon: ComponentType<StatusIconProps>; modifier: string; label: string }

const SESSION_ICON: Record<SessionState, SessionIcon> = {
  [SessionState.READY]: { Icon: StatusSuccessIcon, modifier: 'ready', label: 'Lista' },
  [SessionState.MISSING]: { Icon: StatusKoIcon, modifier: 'missing', label: 'Falta' },
  [SessionState.UNKNOWN]: { Icon: StatusWarningIcon, modifier: 'unknown', label: 'Desconocida' },
}

const detailFor = (tool: ToolSession) => {
  if (!tool.installed) return 'no está instalada'
  if (tool.session === SessionState.READY) return 'sesión lista'
  if (tool.session === SessionState.MISSING) return 'necesita iniciar sesión'
  return 'no se puede confirmar la sesión'
}

const isOptional = (tool: ToolSession, metricsDelivery: MetricsDelivery) =>
  tool.tool === METRICS_DELIVERY_TOOL && !metricsDelivery.enabled

const deliveredBy = (tools: ToolSession[]) =>
  tools.find((tool) => tool.tool === METRICS_DELIVERY_TOOL) ?? null

const isDelivering = (tool: ToolSession | null) =>
  tool !== null && tool.installed && tool.session === SessionState.READY

const blockedBecause = (tool: ToolSession | null) =>
  tool === null ? 'no se ha podido comprobar' : detailFor(tool)

const ToolRow = ({ tool, metricsDelivery }: { tool: ToolSession; metricsDelivery: MetricsDelivery }) => {
  const { Icon, modifier, label } = SESSION_ICON[tool.session]

  return (
    <li className="tools-status__row">
      <Icon size={ROW_ICON_SIZE} className={`tools-status__icon tools-status__icon--${modifier}`} aria-hidden="true" />
      <span className="tools-status__visually-hidden">{label}</span>
      <strong className="tools-status__name">{tool.tool}</strong>
      <span className="tools-status__detail">
        {detailFor(tool)}
        {isOptional(tool, metricsDelivery)
          ? ' · opcional: solo hace falta si activas la entrega de métricas'
          : tool.fix !== null && ` · ${tool.fix}`}
      </span>
    </li>
  )
}

const MetricsDeliveryDetails = ({
  metricsDelivery,
  tools,
}: {
  metricsDelivery: MetricsDelivery
  tools: ToolSession[]
}) => {
  const bq = deliveredBy(tools)
  if (!metricsDelivery.enabled) {
    return (
      <>
        <p>
          <strong>{metricsDelivery.variable}</strong> no está configurada, así que la entrega de métricas
          está desactivada.
        </p>
        <p>
          Los planes siguen funcionando igual, pero las métricas de las PR fusionadas no se enviarán a
          BigQuery y no aparecerán en las comparativas de herramientas.
        </p>
        <p>
          Para activarla, arranca el backend con la tabla de destino:{' '}
          <code>{metricsDelivery.variable}=proyecto:dataset.tabla make run-backend</code>. Es una opción de
          arranque: hay que reiniciar el backend para que el cambio surta efecto.
        </p>
      </>
    )
  }
  if (isDelivering(bq)) {
    return (
      <>
        <p>Entrega activa: las métricas de cada slice fusionado se suben automáticamente.</p>
        <p>
          Tabla de destino: <code>{metricsDelivery.destination}</code>
        </p>
      </>
    )
  }

  return (
    <>
      <p>
        No se pueden entregar las métricas: <strong>{METRICS_DELIVERY_TOOL}</strong> {blockedBecause(bq)}.
      </p>
      <p>
        Tabla de destino configurada: <code>{metricsDelivery.destination}</code>
      </p>
      {bq !== null && bq.fix !== null && (
        <p>
          Para arreglarlo: <code>{bq.fix}</code>
        </p>
      )}
      <p>
        Mientras falle, la recogida se reintenta en cada barrido y el worktree del slice se conserva hasta
        que la carga funcione: no se pierde ninguna métrica.
      </p>
    </>
  )
}

const MetricsDeliveryRow = ({ tools }: { tools: ExternalTools }) => (
  <li className="tools-status__row tools-status__row--metrics">
    <StatusInfoIcon size={ROW_ICON_SIZE} className="tools-status__icon tools-status__icon--informative" aria-hidden="true" />
    <span className="tools-status__visually-hidden">Información</span>
    <strong className="tools-status__name">Entrega de métricas</strong>
    <div className="tools-status__detail">
      {tools.phase === 'checking' && <p role="status">Consultando la configuración de entrega de métricas.</p>}
      {tools.phase === 'unknown' && (
        <p>
          No se pudo contactar con el backend, así que no se ha podido leer si la entrega de métricas
          está configurada.
        </p>
      )}
      {'tools' in tools && <MetricsDeliveryDetails metricsDelivery={tools.metricsDelivery} tools={tools.tools} />}
    </div>
  </li>
)

type ToolsStatusProps = {
  tools: ExternalTools
}

const ToolsStatus = ({ tools }: ToolsStatusProps) => (
  <div className="tools-status">
    {tools.phase === 'checking' && <p role="status">Consultando disponibilidad y sesión de cada herramienta.</p>}
    {tools.phase === 'unknown' && <p>No se pudo contactar con el backend para comprobar las herramientas.</p>}
    <ul className="tools-status__list">
      {'tools' in tools &&
        tools.tools.map((tool) => <ToolRow key={tool.tool} tool={tool} metricsDelivery={tools.metricsDelivery} />)}
      <MetricsDeliveryRow tools={tools} />
    </ul>
  </div>
)

export { ToolsStatus }
export type { ToolsStatusProps }
