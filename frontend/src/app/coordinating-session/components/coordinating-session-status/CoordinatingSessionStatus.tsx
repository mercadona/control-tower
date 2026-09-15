import { CoordinatingSessionRead } from 'app/coordinating-session/useCoordinatingSession'
import { TimelineEvent, TimelineEventKind } from 'app/coordinating-session/CoordinatingSession.types'
import { Banner } from 'system-ui/banner'
import { Timeline } from 'system-ui/timeline'
import type { TimelineItem } from 'system-ui/timeline'
import './CoordinatingSessionStatus.css'

const LABEL_BY_KIND: Record<TimelineEventKind, string> = {
  opened: 'Sesión coordinadora iniciada',
  resumed: 'Sesión recuperada tras un reinicio del backend',
  unresumable: 'No se ha podido recuperar la conversación',
  working: 'Trabajando',
  'waiting-for-permission': 'Esperando permiso',
  completed: 'Ha terminado de trabajar',
  ended: 'La terminal se ha cerrado',
}

const UNRESUMABLE_TITLE = 'No se ha podido recuperar la conversación coordinadora'
const UNRESUMABLE_DESCRIPTION = 'Claude Code ya no guarda esta conversación. No se ha abierto otra en su lugar.'
const ENDED_TITLE = 'La conversación coordinadora ha terminado'
const ENDED_DESCRIPTION = 'Su terminal se ha cerrado. No se ha abierto otra en su lugar.'

const TIME_FORMAT = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' })

const timeOf = (at: string): string | undefined => {
  const parsed = new Date(at)
  return Number.isNaN(parsed.getTime()) ? undefined : TIME_FORMAT.format(parsed)
}

const itemsFor = (timeline: readonly TimelineEvent[]): TimelineItem[] =>
  timeline.map((event, index) => ({
    id: event.id,
    label: LABEL_BY_KIND[event.kind],
    detail: event.detail ?? undefined,
    timestamp: timeOf(event.at),
    status: index === timeline.length - 1 ? 'current' : 'past',
  }))

const announcementFor = (event: TimelineEvent): string => {
  const label = LABEL_BY_KIND[event.kind]
  return event.detail === null ? label : `${label}: ${event.detail}`
}

type CoordinatingSessionStatusProps = {
  read: CoordinatingSessionRead
}

const CoordinatingSessionStatus = ({ read }: CoordinatingSessionStatusProps) => {
  if (read.phase === 'connecting') return null
  if (read.kind === 'none') return null
  if (read.kind === 'unavailable') return null
  if (read.kind === 'unresumable') {
    return (
      <div className="coordinating-session-status">
        <Banner type="error" role="alert" title={UNRESUMABLE_TITLE} description={UNRESUMABLE_DESCRIPTION} />
        {read.timeline.length > 0 && <Timeline items={itemsFor(read.timeline)} />}
      </div>
    )
  }
  if (read.kind === 'ended') {
    return (
      <div className="coordinating-session-status">
        <Banner type="warning" role="alert" title={ENDED_TITLE} description={ENDED_DESCRIPTION} />
        {read.timeline.length > 0 && <Timeline items={itemsFor(read.timeline)} />}
      </div>
    )
  }

  const current = read.timeline.at(-1)

  return (
    <div className="coordinating-session-status">
      {current !== undefined && (
        <p className="coordinating-session-status__visually-hidden" role="status">
          {announcementFor(current)}
        </p>
      )}
      <Timeline items={itemsFor(read.timeline)} />
    </div>
  )
}

export { CoordinatingSessionStatus }
export type { CoordinatingSessionStatusProps }
