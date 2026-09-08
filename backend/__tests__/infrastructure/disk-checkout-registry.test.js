import { describe, expect, it, vi } from 'vitest'
import { DiskCheckoutRegistry } from '../../src/infrastructure/disk-checkout-registry.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'

class StoredCheckouts {
  static A_FILE = { isFile: () => true }
  static NOT_A_FILE = { isFile: () => false }

  static empty(write = vi.fn()) {
    return new DiskCheckoutRegistry({
      read: vi.fn(), stat: () => StoredCheckouts.NOT_A_FILE, write, root: '/state',
    })
  }

  static holding(roots, write = vi.fn()) {
    return new DiskCheckoutRegistry({
      read: () => `${JSON.stringify({ roots })}\n`,
      stat: () => StoredCheckouts.A_FILE,
      write,
      root: '/state',
    })
  }

  static unreadable(printed) {
    return new DiskCheckoutRegistry({
      read: () => printed,
      stat: () => StoredCheckouts.A_FILE,
      write: vi.fn(),
      root: '/state',
    })
  }

  static contentOf(roots) {
    return `${JSON.stringify({ roots }, null, 2)}\n`
  }
}

describe('DiskCheckoutRegistry', () => {
  it('the_first_checkout_it_is_asked_to_remember_is_written_as_the_whole_list', () => {
    const write = vi.fn()

    StoredCheckouts.empty(write).remember(new CheckoutRoot('/repos/one'))

    expect(write).toHaveBeenCalledWith('/state/checkouts.json', StoredCheckouts.contentOf(['/repos/one']))
  })

  it('a_second_checkout_joins_the_ones_already_written', () => {
    const write = vi.fn()

    StoredCheckouts.holding(['/repos/one'], write).remember(new CheckoutRoot('/repos/two'))

    expect(write).toHaveBeenCalledWith(
      '/state/checkouts.json',
      StoredCheckouts.contentOf(['/repos/one', '/repos/two'])
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

  it('a_file_that_is_not_the_shape_it_writes_is_no_checkouts_instead_of_a_crash', () => {
    expect(StoredCheckouts.unreadable('not json at all').known()).toEqual([])
    expect(StoredCheckouts.unreadable(`${JSON.stringify({ roots: 'not a list' })}\n`).known()).toEqual([])
  })

  it('one_unusable_entry_does_not_take_the_usable_ones_with_it', () => {
    const known = StoredCheckouts.holding(['relative/path', '/repos/two']).known()

    expect(known.map((root) => root.text)).toEqual(['/repos/two'])
  })
})
