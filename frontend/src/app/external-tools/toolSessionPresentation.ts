import { ComponentType } from 'react'
import { SessionState, ToolSession } from 'app/external-tools/ExternalTools.types'
import { StatusIconProps, StatusKoIcon, StatusSuccessIcon, StatusWarningIcon } from 'system-ui/icons/StatusIcons'

type SessionIcon = { Icon: ComponentType<StatusIconProps>; modifier: string; label: string }

const SESSION_ICON: Record<SessionState, SessionIcon> = {
  [SessionState.READY]: { Icon: StatusSuccessIcon, modifier: 'ready', label: 'Lista' },
  [SessionState.MISSING]: { Icon: StatusKoIcon, modifier: 'missing', label: 'Falta' },
  [SessionState.UNKNOWN]: { Icon: StatusWarningIcon, modifier: 'unknown', label: 'Desconocida' },
}

const detailFor = (tool: ToolSession): string => {
  if (!tool.installed) return 'no está instalada'
  if (tool.session === SessionState.READY) return 'sesión lista'
  if (tool.session === SessionState.MISSING) return 'necesita iniciar sesión'
  return 'no se puede confirmar la sesión'
}

export { SESSION_ICON, detailFor }
