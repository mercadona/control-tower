import { describe, expect, it, vi } from 'vitest'
import { DiskCheckoutRegistry } from '../../src/infrastructure/disk-checkout-registry.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RegisteredCheckout } from '../../src/domain/value-objects/registered-checkout.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.ts'
import { CheckoutRegistry as PluginCheckoutRegistry } from '../../../plugin/scripts/checkout-registry.js'

class Checkouts {
  static of(repo: string, path: string): RegisteredCheckout {
    return new RegisteredCheckout({ repository: new RepositoryName(repo), root: new CheckoutRoot(path) })
  }

  static withoutRepository(path: string): RegisteredCheckout {
    return new RegisteredCheckout({ repository: null, root: new CheckoutRoot(path) })
  }
}

class StoredCheckouts {
  static A_FILE = { isFile: () => true }

  static #missing(): never {
    throw Object.assign(new Error('no such file or directory'), { code: 'ENOENT' })
  }

  static empty(
    write: (path: string, text: string) => void = vi.fn(),
    stderr: (line: string) => void = vi.fn()
  ) {
    return new DiskCheckoutRegistry({
      read: vi.fn(), stat: StoredCheckouts.#missing, write, stderr, root: '/state',
    })
  }

  static holding(stored: unknown, write = vi.fn()) {
    const printed = `${JSON.stringify(stored, null, 2)}\n`

    return new DiskCheckoutRegistry({
      read: () => printed,
      stat: () => StoredCheckouts.A_FILE,
      write,
      stderr: vi.fn(),
      root: '/state',
    })
  }

  static unreadable(printed: string, { write = vi.fn(), stderr = vi.fn() } = {}) {
    return new DiskCheckoutRegistry({
      read: () => printed,
      stat: () => StoredCheckouts.A_FILE,
      write,
      stderr,
      root: '/state',
    })
  }

  static live() {
    let stored: string | null = null

    return {
      registry: new DiskCheckoutRegistry({
        read: () => stored ?? '',
        stat: () => {
          if (stored === null) throw Object.assign(new Error('no such file or directory'), { code: 'ENOENT' })

          return StoredCheckouts.A_FILE
        },
        write: (path, text) => { stored = text },
        stderr: vi.fn(),
        root: '/state',
      }),
      written: () => stored,
    }
  }
}

describe('DiskCheckoutRegistry', () => {
  it('it_is_the_registry_the_use_case_asks_for_and_not_a_lookalike', () => {
    expect(StoredCheckouts.empty()).toBeInstanceOf(CheckoutRegistry)
  })

  it('a_remembered_checkout_is_written_with_the_repository_that_holds_it', () => {
    const write = vi.fn()

    StoredCheckouts.empty(write).remember(Checkouts.of('owner/one', '/repos/one'))

    expect(write).toHaveBeenCalledWith(
      '/state/checkouts.json',
      '{\n  "checkouts": [\n    {\n      "repo": "owner/one",\n      "path": "/repos/one"\n    }\n  ]\n}\n'
    )
  })

  it('a_second_checkout_joins_the_ones_already_written', () => {
    const write = vi.fn()

    StoredCheckouts.holding({ checkouts: [{ repo: 'owner/one', path: '/repos/one' }] }, write)
      .remember(Checkouts.of('owner/two', '/repos/two'))

    expect(write).toHaveBeenCalledWith('/state/checkouts.json', expect.stringContaining('"repo": "owner/two"'))
    expect(write).toHaveBeenCalledWith('/state/checkouts.json', expect.stringContaining('"repo": "owner/one"'))
  })

  it('a_checkout_it_already_knows_is_not_written_again', () => {
    const write = vi.fn()

    StoredCheckouts.holding({ checkouts: [{ repo: 'owner/one', path: '/repos/one' }] }, write)
      .remember(Checkouts.of('owner/one', '/repos/one'))

    expect(write).not.toHaveBeenCalled()
  })

  it('what_was_written_before_a_restart_is_what_it_knows_after_one', () => {
    const known = StoredCheckouts.holding({
      checkouts: [{ repo: 'owner/one', path: '/repos/one' }, { repo: 'owner/two', path: '/repos/two' }],
    }).known()

    expect(known?.map((checkout) => [checkout.repository?.text, checkout.root.text]))
      .toEqual([['owner/one', '/repos/one'], ['owner/two', '/repos/two']])
  })

  it('every_checkout_it_knows_travels_out_as_the_value_object_a_sweep_can_use', () => {
    const [first] = StoredCheckouts.holding({ checkouts: [{ repo: 'owner/one', path: '/repos/one' }] }).known() ?? []

    expect(first).toBeInstanceOf(RegisteredCheckout)
    expect(first?.root).toBeInstanceOf(CheckoutRoot)
  })

  it('a_legacy_roots_path_survives_a_write_and_comes_back_with_no_repository', () => {
    const write = vi.fn()

    StoredCheckouts.holding({ roots: ['/repos/before'] }, write).remember(Checkouts.of('owner/one', '/repos/one'))

    expect(write).toHaveBeenCalledWith('/state/checkouts.json', expect.stringContaining('"roots"'))
    expect(write).toHaveBeenCalledWith('/state/checkouts.json', expect.stringContaining('/repos/before'))
    expect(StoredCheckouts.holding({ roots: ['/repos/before'] }).known()?.[0].repository).toBeNull()
  })

  it('a_path_registered_without_a_repository_is_upgraded_when_it_arrives_with_one', () => {
    const write = vi.fn()

    StoredCheckouts.holding({ roots: ['/repos/one'] }, write).remember(Checkouts.of('owner/one', '/repos/one'))

    expect(write).toHaveBeenCalledWith('/state/checkouts.json', expect.stringContaining('"repo": "owner/one"'))
    expect(write).toHaveBeenCalledWith('/state/checkouts.json', expect.not.stringContaining('"roots"'))
  })

  it('a_registered_checkout_says_whether_it_holds_the_repository_it_is_asked_about', () => {
    const registered = Checkouts.of('owner/one', '/repos/one')

    expect(registered.holds(new RepositoryName('Owner/One'))).toBe(true)
    expect(registered.holds(new RepositoryName('owner/two'))).toBe(false)
    expect(Checkouts.withoutRepository('/repos/one').holds(new RepositoryName('owner/one'))).toBe(false)
  })

  it('nothing_written_yet_is_no_checkouts_instead_of_a_failure', () => {
    expect(StoredCheckouts.empty().known()).toEqual([])
  })

  it('a_file_it_cannot_read_is_not_the_same_as_no_checkouts_at_all', () => {
    expect(StoredCheckouts.unreadable('not json at all').known()).toBeNull()
    expect(StoredCheckouts.unreadable(`${JSON.stringify({ checkouts: 'not a list' })}\n`).known()).toBeNull()
    expect(StoredCheckouts.unreadable(`${JSON.stringify({ roots: 'not a list' })}\n`).known()).toBeNull()
    expect(StoredCheckouts.unreadable('null\n').known()).toBeNull()
  })

  it('a_path_it_cannot_even_look_at_is_not_the_same_as_nothing_written_yet', () => {
    const registry = new DiskCheckoutRegistry({
      read: vi.fn(),
      stat: () => { throw Object.assign(new Error('input/output error'), { code: 'EIO' }) },
      write: vi.fn(),
      stderr: vi.fn(),
      root: '/state',
    })

    expect(registry.known()).toBeNull()
  })

  it('a_registry_that_is_a_directory_is_not_the_same_as_nothing_written_yet', () => {
    const registry = new DiskCheckoutRegistry({
      read: vi.fn(),
      stat: () => ({ isFile: () => false }),
      write: vi.fn(),
      stderr: vi.fn(),
      root: '/state',
    })

    expect(registry.known()).toBeNull()
  })

  it('a_registry_it_cannot_read_is_left_alone_instead_of_being_overwritten_with_the_one_checkout_it_knows', () => {
    const write = vi.fn()
    const stderr = vi.fn()

    StoredCheckouts.unreadable('not json at all', { write, stderr })
      .remember(Checkouts.of('owner/one', '/repos/one'))

    expect(write).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('/state/checkouts.json'))
  })

  it('a_registry_it_cannot_write_does_not_bring_down_the_plan_that_was_already_launched', () => {
    const stderr = vi.fn()
    const registry = StoredCheckouts.empty(
      () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }) },
      stderr
    )

    expect(() => registry.remember(Checkouts.of('owner/one', '/repos/one'))).not.toThrow()
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('permission denied'))
  })

  it('what_it_writes_is_what_it_reads_back_so_the_two_halves_cannot_drift_apart', () => {
    const { registry } = StoredCheckouts.live()

    registry.remember(Checkouts.of('owner/one', '/repos/one'))
    registry.remember(Checkouts.of('owner/two', '/repos/two'))

    expect(registry.known()?.map((checkout) => checkout.repository?.text)).toEqual(['owner/one', 'owner/two'])
  })

  it('one_unusable_entry_does_not_take_the_usable_ones_with_it', () => {
    const known = StoredCheckouts.holding({
      checkouts: [{ repo: 'owner/one', path: 'relative/path' }, { path: '/repos/two' }, { repo: 'owner/two', path: '/repos/two' }],
      roots: ['relative/legacy', '/repos/three'],
    }).known()

    expect(known?.map((checkout) => checkout.root.text)).toEqual(['/repos/two', '/repos/three'])
  })

  it('what_the_plugin_reads_back_is_what_this_adapter_wrote_so_the_two_halves_of_the_contract_cannot_drift', () => {
    const { registry, written } = StoredCheckouts.live()

    registry.remember(Checkouts.of('owner/one', '/repos/one'))
    registry.remember(Checkouts.withoutRepository('/repos/legacy'))

    expect(PluginCheckoutRegistry.entriesIn(JSON.parse(written() ?? 'null'))).toEqual([
      { repo: 'owner/one', path: '/repos/one' },
      { repo: null, path: '/repos/legacy' },
    ])
  })

  it('the_plugin_and_this_adapter_name_the_same_file_and_the_same_keys', () => {
    expect(PluginCheckoutRegistry.FILE).toBe(DiskCheckoutRegistry.FILE)
    expect(PluginCheckoutRegistry.CHECKOUTS_KEY).toBe(DiskCheckoutRegistry.CHECKOUTS_KEY)
    expect(PluginCheckoutRegistry.LEGACY_KEY).toBe(DiskCheckoutRegistry.LEGACY_KEY)
  })
})
