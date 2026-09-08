// §3.3 of the handoff (docs/prompt-juez-lo-que-queda.md): the seed of
// `.agent/conventions.md` that `scripts/ct-init.sh` writes. A NEW file on
// purpose — separate from __tests__/ct-init.test.js — so as not to brush
// against that file's deliberately red test (`SLICES_PRISTINE_HASHES`, a human
// decision, neither touched nor counted).
//
// Same idiom as ct-init.test.js: `mkdtempSync` + `execFileSync('bash', [script, dir])`.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CONVENTIONS_FILE } from '../scripts/repo-yardstick.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'ct-init.sh')

describe('ct-init.sh seeds .agent/conventions.md', () => {
  it('in an empty dir, it creates the file and announces it with "creado"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
    const out = execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const path = join(dir, CONVENTIONS_FILE)
    expect(existsSync(path)).toBe(true)
    expect(out).toMatch(/creado.*conventions\.md/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('is idempotent: an already existing file is not overwritten', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, CONVENTIONS_FILE), 'MÍO')
    const out = execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(readFileSync(join(dir, CONVENTIONS_FILE), 'utf8')).toBe('MÍO')
    expect(out).toMatch(/conventions\.md ya existe, no se pisa/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the seed sets itself apart from conventions-ack.md (a comment of its own)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const content = readFileSync(join(dir, CONVENTIONS_FILE), 'utf8')
    expect(content).toMatch(/conventions-ack\.md/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the seed declares no yardstick — it keeps measuring sin-vara until a human confirms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const content = readFileSync(join(dir, CONVENTIONS_FILE), 'utf8')
    expect(content).toMatch(/ninguna declarada todavía/)
    rmSync(dir, { recursive: true, force: true })
  })
})
