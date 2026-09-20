import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ControlTowerState, StateRoot } from '../scripts/control-tower-state.js'
import { configuredDir, controlTowerDir, controlTowerLogDir, metricsPath } from '../scripts/run-metrics.js'
import { CheckoutRegistry } from '../scripts/checkout-registry.js'

class Machine {
  static ACCOUNT = '/account'
  static HOME = '/home/person'
  static ISOLATED = '/isolated/state'

  static account() { return { configDir: Machine.ACCOUNT, home: Machine.HOME } }
  static isolated() { return { ...Machine.account(), stateDir: Machine.ISOLATED } }
}

class Asked {
  static REFUSED = ['relative/state', '~/state', ' ', '/state\u0000hidden']

  static nothing() { return ControlTowerState.resolveIn({}, Machine.account()) }
  static for(requested) {
    return ControlTowerState.resolveIn({ [ControlTowerState.VARIABLE]: requested }, Machine.account())
  }
  static withNoAccountConfigured(requested) {
    return ControlTowerState.resolveIn({ [ControlTowerState.VARIABLE]: requested }, { home: Machine.HOME })
  }
}

beforeEach(() => vi.stubEnv(ControlTowerState.VARIABLE, ''))
afterEach(() => vi.unstubAllEnvs())

describe('the one door where Control Tower resolves where it keeps its state', () => {
  it('an_unset_variable_resolves_the_account_relative_default_rather_than_a_refusal', () => {
    expect(Asked.nothing().path).toBe('/account/control-tower')
    expect(Asked.nothing().reason).toBe(null)
    expect(Asked.for('').path).toBe('/account/control-tower')
    expect(Asked.withNoAccountConfigured(undefined).path).toBe('/home/person/.claude/control-tower')
  })

  it('a_requested_root_is_used_exactly_as_given_without_appending_another_control_tower_directory', () => {
    expect(Asked.for(Machine.ISOLATED).path).toBe('/isolated/state')
    expect(Asked.for('/state with spaces').path).toBe('/state with spaces')
    expect(Asked.for(Machine.ISOLATED).reason).toBe(null)
  })

  it('a_value_that_is_not_an_absolute_path_comes_back_as_a_sentence_and_no_path_instead_of_throwing', () => {
    for (const requested of Asked.REFUSED) {
      expect(() => Asked.for(requested)).not.toThrow()
      expect(Asked.for(requested).path).toBe(null)
      expect(Asked.for(requested).reason)
        .toBe(`${ControlTowerState.VARIABLE} must be an absolute path without null bytes, got ${JSON.stringify(requested)}`)
    }
  })

  it('a_refused_value_never_resolves_to_the_account_state_somebody_asked_to_stop_using', () => {
    for (const requested of Asked.REFUSED) {
      expect(Asked.for(requested).path).not.toBe('/account/control-tower')
    }
  })
})

describe('the paths that hang off the root, once the door has checked it', () => {
  it('logs_metrics_and_the_checkout_registry_all_follow_the_checked_value', () => {
    const checked = { stateDir: Asked.for(Machine.ISOLATED).path }

    expect(controlTowerDir(checked)).toBe('/isolated/state')
    expect(controlTowerLogDir(checked)).toBe('/isolated/state/log')
    expect(metricsPath('ct-step', checked)).toBe('/isolated/state/log/ct-step.jsonl')
    expect(CheckoutRegistry.path(checked)).toBe('/isolated/state/checkouts.json')
  })

  it('no_checked_value_keeps_the_account_relative_default_every_reader_resolves_today', () => {
    expect(controlTowerDir(Machine.account())).toBe('/account/control-tower')
    expect(metricsPath('ct-step', Machine.account())).toBe('/account/control-tower/log/ct-step.jsonl')
    expect(CheckoutRegistry.path(Machine.account())).toBe('/account/control-tower/checkouts.json')
    expect(controlTowerDir({ home: Machine.HOME })).toBe('/home/person/.claude/control-tower')
  })

  it('they_do_not_read_the_environment_themselves_so_an_unchecked_value_cannot_reach_them', () => {
    vi.stubEnv(ControlTowerState.VARIABLE, '/never/read/here')

    expect(controlTowerDir(Machine.account())).toBe('/account/control-tower')
    expect(metricsPath('ct-step', Machine.account())).toBe('/account/control-tower/log/ct-step.jsonl')
    expect(CheckoutRegistry.path(Machine.account())).toBe('/account/control-tower/checkouts.json')
    expect(configuredDir(Machine.account())).toBe('/account')
  })

  it('a_malformed_value_in_the_environment_can_no_longer_make_them_throw', () => {
    for (const requested of Asked.REFUSED) {
      vi.stubEnv(ControlTowerState.VARIABLE, requested)

      expect(() => controlTowerDir(Machine.account())).not.toThrow()
      expect(() => metricsPath('ct-step', Machine.account())).not.toThrow()
      expect(() => CheckoutRegistry.read(Machine.account())).not.toThrow()
    }
  })
})

describe('StateRoot, the answer the door gives', () => {
  it('carries_either_a_path_or_a_reason_and_never_both', () => {
    const resolved = Asked.for(Machine.ISOLATED)
    const refused = Asked.for('relative/state')

    expect([resolved.path, resolved.reason]).toEqual(['/isolated/state', null])
    expect([refused.path, refused.reason]).toEqual([null, expect.any(String)])
  })

  it('cannot_be_edited_after_it_answers', () => {
    const resolved = Asked.for(Machine.ISOLATED)

    expect(Object.isFrozen(resolved)).toBe(true)
    expect(resolved).toBeInstanceOf(StateRoot)
  })
})
