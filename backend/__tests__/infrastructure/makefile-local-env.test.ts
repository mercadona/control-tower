import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

class SandboxCheckout {
  static readonly #SOURCE_MAKEFILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'Makefile')

  readonly root: string

  private constructor(root: string) {
    this.root = root
  }

  static async created(): Promise<SandboxCheckout> {
    const root = await mkdtemp(join(tmpdir(), 'ct-makefile-local-env-'))
    await copyFile(SandboxCheckout.#SOURCE_MAKEFILE, join(root, 'Makefile'))

    return new SandboxCheckout(root)
  }

  async writeEnv(contents: string): Promise<void> {
    await writeFile(join(this.root, '.env'), contents)
  }

  printedStartRecipe(): string {
    return execFileSync('make', ['-n', 'start'], { cwd: this.root, encoding: 'utf8' })
  }

  async removed(): Promise<void> {
    await rm(this.root, { recursive: true, force: true })
  }
}

describe('the Makefile reads a local, git-ignored .env file', () => {
  let sandbox: SandboxCheckout

  beforeEach(async () => {
    sandbox = await SandboxCheckout.created()
  })

  afterEach(async () => {
    await sandbox.removed()
  })

  it('passes the harvest table from the local env file to the backend', async () => {
    await sandbox.writeEnv('CT_HARVEST_BQ_TABLE=my-project:my_dataset.my_table\n')

    const printed = sandbox.printedStartRecipe()

    expect(printed).toContain('CT_HARVEST_BQ_TABLE=my-project:my_dataset.my_table')
  })

  it('starts with no local env file present', () => {
    const printed = sandbox.printedStartRecipe()

    expect(printed).toContain('CT_HARVEST_BQ_TABLE=')
    expect(printed).not.toContain('CT_HARVEST_BQ_TABLE=my-project')
  })

  it('lets the local env file override the default port', async () => {
    await sandbox.writeEnv('CT_API_PORT=0\n')

    const printed = sandbox.printedStartRecipe()

    expect(printed).toContain('CT_API_PORT=0')
  })
})
