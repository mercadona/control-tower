import { cleanup, screen, waitFor } from '@testing-library/react'
import { RestartedBackendMother } from '__scenarios__/RestartedBackendMother'
import { WorkflowSnapshotStorage } from 'app/workflow-snapshot/storage'
import { FakeEventSource } from './FakeEventSource'
import { FakeFitAddon, FakeTerminal } from './FakeXterm'
import { backendRecovering, openHome } from './helpers'

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

class ThePageBeforeTheCrash {
  static readonly PHASE = 'planning'

  static stored(): void {
    WorkflowSnapshotStorage.save({
      phase: ThePageBeforeTheCrash.PHASE,
      request: RestartedBackendMother.request(),
      plan: RestartedBackendMother.plan(),
    })
  }
}

class WhatTheReloadedPageShows {
  static async inventory(): Promise<Record<string, string>> {
    const alert = await screen.findByRole('alert')

    return {
      storedWorkflow: WhatTheReloadedPageShows.#stored(),
      phase: `${ThePageBeforeTheCrash.PHASE} then ${WhatTheReloadedPageShows.#phaseShown(alert)}`,
      diagnostic: WhatTheReloadedPageShows.#diagnosticShown(alert),
      planNamed: WhatTheReloadedPageShows.#codesIn(alert).join(' · '),
      offer: WhatTheReloadedPageShows.#offer(),
      implementButton: WhatTheReloadedPageShows.#named('Implementar plan'),
      discardButton: WhatTheReloadedPageShows.#named('Descartar estado'),
      planStream: FakeEventSource.opened.length === 0 ? 'not opened' : 'opened',
    }
  }

  static #stored(): string {
    const workflow = WorkflowSnapshotStorage.load()
    if (workflow === null) return 'cleared'

    return workflow.plan.agent === RestartedBackendMother.AGENT ? `still stored as ${workflow.phase}` : 'replaced'
  }

  static #phaseShown(alert: HTMLElement): string {
    return alert.querySelector('.banner__title')?.textContent ?? (alert.textContent ?? '')
  }

  static #diagnosticShown(alert: HTMLElement): string {
    const said = alert.textContent ?? ''

    return said.includes(RestartedBackendMother.DIAGNOSTIC) ? 'the one the backend gave' : said
  }

  static #codesIn(alert: HTMLElement): string[] {
    return [...alert.querySelectorAll('code')].map((code) => code.textContent ?? '')
  }

  static #offer(): string {
    const offered = ['Recuperar trabajo', 'Reintentar recuperación', 'Limpiar arranque fallido']
      .filter((name) => screen.queryByRole('button', { name }) !== null)

    return offered.length === 1 ? offered[0] : `${offered.length} offers`
  }

  static #named(name: string): string {
    return screen.queryByRole('button', { name }) === null ? 'withdrawn' : 'offered'
  }
}

describe(RestartedBackendMother.CAPTURE, () => {
  beforeEach(() => {
    FakeTerminal.install()
    FakeFitAddon.install()
  })

  afterEach(() => {
    cleanup()
    ThePageBeforeTheCrash.stored()
    vi.unstubAllGlobals()
  })

  it('keeps the stored plan, names the call the restarted backend no longer owns, and offers to look again', async () => {
    ThePageBeforeTheCrash.stored()
    backendRecovering(RestartedBackendMother.disownedPlan())

    openHome()

    await waitFor(async () => expect(await WhatTheReloadedPageShows.inventory()).toEqual({
      storedWorkflow: 'still stored as planning',
      phase: 'planning then Aviso: No se puede confirmar el estado de implementación',
      diagnostic: 'the one the backend gave',
      planNamed: `${RestartedBackendMother.REPO}#${RestartedBackendMother.ISSUE} · ${RestartedBackendMother.AGENT}`,
      offer: 'Reintentar recuperación',
      implementButton: 'withdrawn',
      discardButton: 'offered',
      planStream: 'not opened',
    }))
  })
})
