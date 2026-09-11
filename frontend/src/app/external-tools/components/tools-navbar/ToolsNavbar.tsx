import { useState } from 'react'
import { MetricsDelivery, ToolSession } from 'app/external-tools/ExternalTools.types'
import { detailFor, SESSION_ICON } from 'app/external-tools/toolSessionPresentation'
import { ExternalTools, useExternalTools } from 'app/external-tools/useExternalTools'
import { RetryIcon } from 'system-ui/icons/NavIcons'
import { StatusInfoIcon } from 'system-ui/icons/StatusIcons'
import { MenuItem } from 'system-ui/menu-item'
import { MenuSection } from 'system-ui/menu-section'
import { NavHeader } from 'system-ui/nav-header'
import { Navbar } from 'system-ui/navbar'
import { Tag } from 'system-ui/tag'
import './ToolsNavbar.css'

const COLLAPSED_STORAGE_KEY = 'control-tower.navbar-collapsed'
const ROW_ICON_SIZE = 20
const RETRY_ICON_SIZE = 20
const RETRY_LABEL = 'Reintentar comprobación'
const TOOLS_TITLE = 'Herramientas'
const METRICS_TITLE = 'Métricas'

const loadCollapsed = (): boolean => {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

const saveCollapsed = (collapsed: boolean): void => {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed))
  } catch {
    return undefined
  }
}

const notifierFor = (tool: ToolSession) => {
  if (tool.session === 'missing') return <Tag variant="danger">falta</Tag>
  if (tool.session === 'unknown') return <Tag variant="neutral">sin confirmar</Tag>
  return undefined
}

const ToolRow = ({ tool, collapsed }: { tool: ToolSession; collapsed: boolean }) => {
  const { Icon, modifier } = SESSION_ICON[tool.session]

  return (
    <MenuItem
      label={tool.tool}
      detail={detailFor(tool)}
      icon={<Icon size={ROW_ICON_SIZE} className={`tools-navbar__icon tools-navbar__icon--${modifier}`} aria-hidden="true" />}
      notifier={notifierFor(tool)}
      collapsed={collapsed}
    />
  )
}

const metricsDetail = (metricsDelivery: MetricsDelivery): string =>
  metricsDelivery.enabled ? `activada · ${metricsDelivery.destination}` : `desactivada · ${metricsDelivery.variable}`

const MetricsRow = ({ metricsDelivery, collapsed }: { metricsDelivery: MetricsDelivery; collapsed: boolean }) => (
  <MenuItem
    label="Entrega a BigQuery"
    detail={metricsDetail(metricsDelivery)}
    icon={<StatusInfoIcon size={ROW_ICON_SIZE} className="tools-navbar__icon tools-navbar__icon--informative" aria-hidden="true" />}
    notifier={<Tag variant="neutral">{metricsDelivery.enabled ? 'on' : 'off'}</Tag>}
    collapsed={collapsed}
  />
)

const ToolSections = ({ tools, collapsed }: { tools: ExternalTools; collapsed: boolean }) => {
  if (tools.phase === 'checking') {
    return (
      <>
        <MenuSection title={TOOLS_TITLE} collapsed={collapsed}>
          <MenuItem label="Comprobando herramientas" detail="Consultando disponibilidad y sesión de cada herramienta." collapsed={collapsed} />
        </MenuSection>
        <MenuSection title={METRICS_TITLE} collapsed={collapsed}>
          <MenuItem label="Entrega a BigQuery" detail="Consultando la configuración de entrega de métricas." collapsed={collapsed} />
        </MenuSection>
      </>
    )
  }

  if (tools.phase === 'unknown') {
    return (
      <>
        <MenuSection title={TOOLS_TITLE} collapsed={collapsed}>
          <MenuItem label="Herramientas" detail="No se pudo contactar con el backend." collapsed={collapsed} />
        </MenuSection>
        <MenuSection title={METRICS_TITLE} collapsed={collapsed}>
          <MenuItem label="Entrega a BigQuery" detail="No se ha podido leer si la entrega de métricas está configurada." collapsed={collapsed} />
        </MenuSection>
      </>
    )
  }

  return (
    <>
      <MenuSection title={TOOLS_TITLE} collapsed={collapsed}>
        {tools.tools.map((tool) => (
          <ToolRow tool={tool} collapsed={collapsed} key={tool.tool} />
        ))}
      </MenuSection>
      <MenuSection title={METRICS_TITLE} collapsed={collapsed}>
        <MetricsRow metricsDelivery={tools.metricsDelivery} collapsed={collapsed} />
      </MenuSection>
    </>
  )
}

const ToolsNavbar = () => {
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const { tools, check } = useExternalTools()

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current
      saveCollapsed(next)
      return next
    })
  }

  return (
    <Navbar
      aria-label="Navegación principal"
      collapsed={collapsed}
      header={
        <NavHeader
          productName="Control Tower"
          logo={<span className="tools-navbar__logo">CT</span>}
          collapsed={collapsed}
          onToggle={toggleCollapsed}
        />
      }
      footer={
        <>
          <RetryIcon size={RETRY_ICON_SIZE} aria-hidden="true" />
          {!collapsed && <span className="lg-footnote-medium">{RETRY_LABEL}</span>}
        </>
      }
      footerLabel={RETRY_LABEL}
      footerDisabled={tools.phase === 'checking'}
      onFooterClick={() => void check()}
    >
      <ToolSections tools={tools} collapsed={collapsed} />
    </Navbar>
  )
}

export { ToolsNavbar }
