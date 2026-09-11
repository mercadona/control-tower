import { useState } from 'react'
import { ToolsStatus } from 'app/external-tools/components/tools-status'
import { ExternalTools, useExternalTools } from 'app/external-tools/useExternalTools'
import { ImplementHistory } from 'app/implement-history/components/implement-history'
import { Button } from 'system-ui/button'
import { Drawer } from 'system-ui/drawer'
import { Panel } from 'system-ui/panel'
import './StatusPanel.css'

const TITLE = 'Estado'
const PROGRESS_HEADING = 'Progreso'
const TOOLS_HEADING = 'Herramientas'
const NO_IMPLEMENTATION_MESSAGE = 'No hay ninguna implementación en curso'

const summaryFor = (tools: ExternalTools) => {
  if (tools.phase === 'checking') return 'Comprobando'
  if (tools.phase === 'ready') return 'Listas'
  if (tools.phase === 'attention') return 'Necesitan atención'
  return 'No se pudo comprobar'
}

const toggleLabelFor = (tools: ExternalTools, isCollapsed: boolean) =>
  `${isCollapsed ? 'Desplegar' : 'Contraer'} el panel de herramientas: ${summaryFor(tools).toLowerCase()}`

type Implementation = { issue: number; root: string; repo: string }

type StatusPanelProps = {
  implementation: Implementation | null
}

const StatusPanel = ({ implementation }: StatusPanelProps) => {
  const { tools, check } = useExternalTools()
  const [isCollapsed, setIsCollapsed] = useState(true)

  return (
    <Drawer
      className="status-panel"
      title={
        <>
          <span className={`status-panel__dot status-panel__dot--${tools.phase}`} aria-hidden="true" />
          {TITLE}
        </>
      }
      subtitle={<span aria-live="polite">{summaryFor(tools)}</span>}
      collapsed={isCollapsed}
      onToggle={setIsCollapsed}
      toggleLabel={toggleLabelFor(tools, isCollapsed)}
    >
      <Panel heading={PROGRESS_HEADING} className="status-panel__section">
        {implementation !== null ? (
          <ImplementHistory issue={implementation.issue} root={implementation.root} repo={implementation.repo} />
        ) : (
          <p role="status">{NO_IMPLEMENTATION_MESSAGE}</p>
        )}
      </Panel>
      <Panel
        heading={TOOLS_HEADING}
        className="status-panel__section"
        actions={
          tools.phase === 'checking' ? undefined : (
            <Button type="button" onClick={() => void check()}>
              Reintentar comprobación
            </Button>
          )
        }
      >
        <ToolsStatus tools={tools} />
      </Panel>
    </Drawer>
  )
}

export { StatusPanel }
export type { StatusPanelProps }
