import { useEffect, useId, useRef, useState } from 'react'
import { ToolSession } from 'app/external-tools/ExternalTools.types'
import { ExternalTools, useExternalTools } from 'app/external-tools/useExternalTools'
import { Button } from 'system-ui/button'
import './ToolsStatus.css'

const labelFor = (tools: ExternalTools) => {
  if (tools.phase === 'checking') return 'Comprobando herramientas'
  if (tools.phase === 'ready') return 'Herramientas listas'
  if (tools.phase === 'attention') return 'Herramientas necesitan atención'
  return 'No se pudo comprobar las herramientas'
}

const detailFor = (tool: ToolSession) => {
  if (!tool.installed) return 'no está instalada'
  if (tool.session === 'ready') return 'sesión lista'
  if (tool.session === 'missing') return 'necesita iniciar sesión'
  return 'no se puede confirmar la sesión'
}

const ToolsStatus = () => {
  const { tools, check } = useExternalTools()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const detailsId = useId()

  useEffect(() => {
    if (!open) return
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [open])

  return (
    <section
      ref={rootRef}
      className="tools-status"
      aria-label="Estado de herramientas"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.stopPropagation()
        setOpen(false)
        rootRef.current?.querySelector('button')?.focus()
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <div className="tools-status__summary">
        <span className={`tools-status__dot tools-status__dot--${tools.phase}`} aria-hidden="true" />
        <strong aria-live="polite">{labelFor(tools)}</strong>
        <Button type="button" variant="secondary" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={detailsId}>
          {open ? 'Ocultar detalles' : 'Ver detalles'}
        </Button>
      </div>
      {open && (
        <div id={detailsId} className="tools-status__details">
          {tools.phase === 'checking' && <p role="status">Consultando disponibilidad y sesión de cada herramienta.</p>}
          {tools.phase === 'unknown' && <p>No se pudo contactar con el backend para comprobar las herramientas.</p>}
          {'tools' in tools && (
            <ul>
              {tools.tools.map((tool) => (
                <li key={tool.tool}>
                  <strong>{tool.tool}</strong>: {detailFor(tool)}
                  {tool.fix !== null && ` · ${tool.fix}`}
                </li>
              ))}
            </ul>
          )}
          {tools.phase !== 'checking' && (
            <Button type="button" onClick={() => void check()}>
              Reintentar comprobación
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
export { ToolsStatus }
