import { useCallback, useState } from 'react'
import { useCoordinatingSession } from 'app/coordinating-session/useCoordinatingSession'
import { ToolsNavbar } from 'app/external-tools/components/tools-navbar'
import { FocusedSession } from 'app/focused-session/components/focused-session'
import { SessionStage } from 'app/focused-session/SessionStage'
import { FocusedMode } from 'pages/home/FocusedMode'
import { useEpicGroom } from 'app/epic-groom/useEpicGroom'
import { useSpecFreeze } from 'app/spec-freeze/useSpecFreeze'
import { StartPlanForm } from 'app/start-plan/components/start-plan-form'
import { Banner } from 'system-ui/banner'
import { Navigation } from 'system-ui/navigation'
import { TopBar } from 'system-ui/top-bar'
import './Home.css'

const BRAINSTORMING_UNREACHABLE_TITLE = 'No se pudo contactar con el backend'
const BRAINSTORMING_UNREACHABLE_DETAIL = 'No se pudo abrir el brainstorming. Inténtalo de nuevo.'

const Home = () => {
  const [brainstormingUnreachable, setBrainstormingUnreachable] = useState(false)
  const coordinatingSession = useCoordinatingSession()
  const isSessionLive = coordinatingSession.read.phase === 'read' && coordinatingSession.read.kind === 'live'
  const specFreezeRead = useSpecFreeze(coordinatingSession.target)
  const epicGroomRead = useEpicGroom(isSessionLive, coordinatingSession.target, isSessionLive)

  const formInteracted = useCallback(() => setBrainstormingUnreachable(false), [])
  const sessionOpened = useCallback(() => setBrainstormingUnreachable(false), [])
  const sessionUnreachable = useCallback(() => setBrainstormingUnreachable(true), [])

  const coordinatingSessionClosing = coordinatingSession.closing || (
    coordinatingSession.read.phase === 'read' &&
    coordinatingSession.read.kind !== 'unavailable' &&
    coordinatingSession.read.operation === 'closing'
  )
  const focusedMode = FocusedMode.of({ read: coordinatingSession.read, opened: coordinatingSession.opened })

  if (focusedMode.kind === 'focused') {
    return (
      <div className="home">
        <Navigation navbar={<ToolsNavbar />} topBar={<TopBar productName="Control Tower" />}>
          <FocusedSession
            held={focusedMode.held}
            terminal={focusedMode.terminal}
            stage={SessionStage.of(specFreezeRead, epicGroomRead)}
            lifecycle={coordinatingSession}
            closing={coordinatingSessionClosing}
          />
        </Navigation>
      </div>
    )
  }

  return (
    <div className="home">
      <Navigation navbar={<ToolsNavbar />} topBar={<TopBar productName="Control Tower" />}>
        <main className="home__start">
          {brainstormingUnreachable && (
            <Banner type="warning" role="alert" title={BRAINSTORMING_UNREACHABLE_TITLE} description={BRAINSTORMING_UNREACHABLE_DETAIL} />
          )}
          <StartPlanForm
            onOpened={sessionOpened}
            onUnreachable={sessionUnreachable}
            onInteraction={formInteracted}
            isLocked={false}
            isCoordinatingSessionLive={coordinatingSession.occupied}
            openSession={coordinatingSession.open}
          />
        </main>
      </Navigation>
    </div>
  )
}

export { Home }
