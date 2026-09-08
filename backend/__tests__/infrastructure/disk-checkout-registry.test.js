import { describe, expect, it, vi } from 'vitest'
import { DiskCheckoutRegistry } from '../../src/infrastructure/disk-checkout-registry.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.js'

class StoredCheckouts {
  static A_FILE = { isFile: () => true }
  static NOT_A_FILE = { isFile: () => false }

  static empty(write = vi.fn()) {
    return new DiskCheckoutRegistry({
      read: vi.fn(), stat: () => StoredCheckouts.NOT_A_FILE, write, stderr: vi.fn(), root: '/state',
    })
  }

  static holding(roots, write = vi.fn()) {
    const stored = `${JSON.stringify({ roots }, null, 2)}\n`

    return new DiskCheckoutRegistry({
      read: () => stored,
      stat: () => StoredCheckouts.A_FILE,
      write,
      stderr: vi.fn(),
      root: '/state',
    })
  }

  static unreadable(printed, { write = vi.fn(), stderr = vi.fn() } = {}) {
    return new DiskCheckoutRegistry({
      read: () => printed,
      stat: () => StoredCheckouts.A_FILE,
      write,
      stderr,
      root: '/state',
    })
  }
}

describe('DiskCheckoutRegistry', () => {
  it('it_is_the_registry_the_use_case_asks_for_and_not_a_lookalike', () => {
    expect(StoredCheckouts.empty()).toBeInstanceOf(CheckoutRegistry)
  })

  it('the_first_checkout_it_is_asked_to_remember_is_written_as_the_whole_list', () => {
    const write = vi.fn()

    StoredCheckouts.empty(write).remember(new CheckoutRoot('/repos/one'))

    expect(write).toHaveBeenCalledWith(
      '/state/checkouts.json',
      '{\n  "roots": [\n    "/repos/one"\n  ]\n}\n'
    )
  })

  it('a_second_checkout_joins_the_ones_already_written', () => {
    const write = vi.fn()

    StoredCheckouts.holding(['/repos/one'], write).remember(new CheckoutRoot('/repos/two'))

    expect(write).toHaveBeenCalledWith(
      '/state/checkouts.json',
      '{\n  "roots": [\n    "/repos/one",\n    "/repos/two"\n  ]\n}\n'
    )
  })

  it('a_checkout_it_already_knows_is_not_written_again', () => {
    const write = vi.fn()

    StoredCheckouts.holding(['/repos/one'], write).remember(new CheckoutRoot('/repos/one'))

    expect(write).not.toHaveBeenCalled()
  })

  it('what_was_written_before_a_restart_is_what_it_knows_after_one', () => {
    const known = StoredCheckouts.holding(['/repos/one', '/repos/two']).known()

    expect(known.map((root) => root.text)).toEqual(['/repos/one', '/repos/two'])
  })

  it('every_checkout_it_knows_travels_out_as_the_value_object_a_sweep_can_use', () => {
    const [first] = StoredCheckouts.holding(['/repos/one']).known()

    expect(first).toBeInstanceOf(CheckoutRoot)
  })

  it('nothing_written_yet_is_no_checkouts_instead_of_a_failure', () => {
    expect(StoredCheckouts.empty().known()).toEqual([])
  })

  it('a_file_it_cannot_read_is_not_the_same_as_no_checkouts_at_all', () => {
    expect(StoredCheckouts.unreadable('not json at all').known()).toBeNull()
    expect(StoredCheckouts.unreadable(`${JSON.stringify({ roots: 'not a list' })}\n`).known()).toBeNull()
    expect(StoredCheckouts.unreadable('null\n').known()).toBeNull()
  })

  it('a_registry_it_cannot_read_is_left_alone_instead_of_being_overwritten_with_the_one_checkout_it_knows', () => {
    const write = vi.fn()
    const stderr = vi.fn()

    StoredCheckouts.unreadable('not json at all', { write, stderr }).remember(new CheckoutRoot('/repos/one'))

    expect(write).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('/state/checkouts.json'))
  })

  it('what_it_writes_is_what_it_reads_back_so_the_two_halves_cannot_drift_apart', () => {
    let stored = null
    const registry = new DiskCheckoutRegistry({
      read: () => stored,
      stat: () => (stored === null ? StoredCheckouts.NOT_A_FILE : StoredCheckouts.A_FILE),
      write: (path, text) => { stored = text },
      stderr: vi.fn(),
      root: '/state',
    })

    registry.remember(new CheckoutRoot('/repos/one'))
    registry.remember(new CheckoutRoot('/repos/two'))

    expect(registry.known().map((root) => root.text)).toEqual(['/repos/one', '/repos/two'])
  })

  it('one_unusable_entry_does_not_take_the_usable_ones_with_it', () => {
    const known = StoredCheckouts.holding(['relative/path', '/repos/two']).known()

    expect(known.map((root) => root.text)).toEqual(['/repos/two'])
  })
})
