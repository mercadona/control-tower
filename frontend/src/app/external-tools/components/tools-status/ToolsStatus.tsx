import { useState } from 'react'
import {
  METRICS_DELIVERY_TOOL,
  MetricsDelivery,
  SessionState,
  ToolSession,
} from 'app/external-tools/ExternalTools.types'
import { ExternalTools, useExternalTools } from 'app/external-tools/useExternalTools'
import { Button } from 'system-ui/button'
import { Drawer } from 'system-ui/drawer'
import './ToolsStatus.css'

const TITLE = 'Herramientas'

const summaryFor = (tools: ExternalTools) => {
  if (tools.phase === 'checking') return 'Comprobando'
  if (tools.phase === 'ready') return 'Listas'
  if (tools.phase === 'attention') return 'Necesitan atención'
  return 'No se pudo comprobar'
}

const toggleLabelFor = (tools: ExternalTools, isCollapsed: boolean) =>
  `${isCollapsed ? 'Desplegar' : 'Contraer'} el panel de herramientas: ${summaryFor(tools).toLowerCase()}`

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

const ToolsStatus = () => {
  const { tools, check } = useExternalTools()
  const [isCollapsed, setIsCollapsed] = useState(true)

  return (
    <Drawer
      className="tools-status"
      title={
        <>
          <span className={`tools-status__dot tools-status__dot--${tools.phase}`} aria-hidden="true" />
          {TITLE}
        </>
      }
      subtitle={<span aria-live="polite">{summaryFor(tools)}</span>}
      collapsed={isCollapsed}
      onToggle={setIsCollapsed}
      toggleLabel={toggleLabelFor(tools, isCollapsed)}
    >
      {tools.phase === 'checking' && <p role="status">Consultando disponibilidad y sesión de cada herramienta.</p>}
      {tools.phase === 'unknown' && <p>No se pudo contactar con el backend para comprobar las herramientas.</p>}
      {'tools' in tools && (
        <ul>
          {tools.tools.map((tool) => (
            <li key={tool.tool}>
              <strong>{tool.tool}</strong>: {detailFor(tool)}
              {isOptional(tool, tools.metricsDelivery)
                ? ' · opcional: solo hace falta si activas la entrega de métricas'
                : tool.fix !== null && ` · ${tool.fix}`}
            </li>
          ))}
        </ul>
      )}
      <section className="tools-status__metrics" aria-label="Entrega de métricas">
        <strong>Entrega de métricas</strong>
        {tools.phase === 'checking' && (
          <p role="status">Consultando la configuración de entrega de métricas.</p>
        )}
        {tools.phase === 'unknown' && (
          <p>
            No se pudo contactar con el backend, así que no se ha podido leer si la entrega de métricas
            está configurada.
          </p>
        )}
        {'tools' in tools && (
          <MetricsDeliveryDetails metricsDelivery={tools.metricsDelivery} tools={tools.tools} />
        )}
      </section>
      {tools.phase !== 'checking' && (
        <Button type="button" onClick={() => void check()}>
          Reintentar comprobación
        </Button>
      )}
    </Drawer>
  )
}
export { ToolsStatus }
