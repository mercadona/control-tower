import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configuredDir, controlTowerDir, controlTowerLogDir, metricsPath } from '../scripts/run-metrics.js'
import { CheckoutRegistry } from '../scripts/checkout-registry.js'

class Machine {
  static account() { return { configDir: '/account', home: '/home/person' } }
  static isolated() { return { ...Machine.account(), stateDir: '/isolated/state' } }
}

beforeEach(() => vi.stubEnv('CT_STATE_DIR', ''))
afterEach(() => vi.unstubAllEnvs())

describe('Control Tower state independent of the Claude account', () => {
  it('keeps_the_existing_default_when_the_override_is_absent_or_empty', () => {
    for (const stateDir of [undefined, null, '']) {
      expect(controlTowerDir({ ...Machine.account(), stateDir })).toBe('/account/control-tower')
    }
    expect(controlTowerDir({ home: '/home/person' })).toBe('/home/person/.claude/control-tower')
  })

  it('uses_the_exact_requested_root_without_appending_another_control_tower_directory', () => {
    expect(controlTowerDir(Machine.isolated())).toBe('/isolated/state')
    expect(controlTowerDir({ ...Machine.account(), stateDir: '/state with spaces' })).toBe('/state with spaces')
  })

  it('moves_logs_metrics_and_checkout_registry_together', () => {
    expect(controlTowerLogDir(Machine.isolated())).toBe('/isolated/state/log')
    expect(metricsPath('ct-step', Machine.isolated())).toBe('/isolated/state/log/ct-step.jsonl')
    expect(CheckoutRegistry.path(Machine.isolated())).toBe('/isolated/state/checkouts.json')
  })

  it('passes_the_inherited_override_through_existing_plugin_call_sites', () => {
    vi.stubEnv('CT_STATE_DIR', '/inherited/state')

    expect(controlTowerDir(Machine.account())).toBe('/inherited/state')
    expect(metricsPath('ct-step', Machine.account())).toBe('/inherited/state/log/ct-step.jsonl')
    expect(CheckoutRegistry.path(Machine.account())).toBe('/inherited/state/checkouts.json')
    expect(configuredDir(Machine.account())).toBe('/account')
  })

  it('an_explicit_option_is_not_overridden_by_the_callers_environment', () => {
    vi.stubEnv('CT_STATE_DIR', '/inherited/state')

    expect(controlTowerDir(Machine.isolated())).toBe('/isolated/state')
    expect(controlTowerDir({ ...Machine.account(), stateDir: null })).toBe('/account/control-tower')
  })

  it('refuses_invalid_overrides_without_returning_a_default_write_destination', () => {
    for (const stateDir of ['relative/state', '~/state', ' ', '/state\u0000hidden']) {
      const options = { ...Machine.account(), stateDir }
      const reason = `CT_STATE_DIR must be an absolute path without null bytes, got ${JSON.stringify(stateDir)}`

      expect(() => controlTowerDir(options)).toThrow(reason)
      expect(() => metricsPath('ct-step', options)).toThrow(reason)
      expect(() => CheckoutRegistry.path(options)).toThrow(reason)
    }
  })
})
