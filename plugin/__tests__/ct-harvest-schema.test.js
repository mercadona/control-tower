// `/ct-harvest --schema` — the one-time `bq mk --table --schema=...` needs the
// table's schema as a file, and the schema lives in code (HarvestTable.SCHEMA)
// so that it cannot drift from what rowFor projects. This flag prints it and
// exits, WITHOUT requiring --repo/--milestone and WITHOUT touching GitHub or
// BigQuery: the schema is compile-time data, not something to harvest.
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { HarvestTable } from '../scripts/harvest-table.js'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'ct-harvest.mjs')

// PATH carries only node's own directory: no `gh`, no `bq`. If --schema tried
// to spawn either, the child process would fail to find the executable and
// this suite would catch it.
const noToolsEnv = { ...process.env, PATH: dirname(process.execPath) }

const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: noToolsEnv })

describe('/ct-harvest --schema prints the table schema and touches nothing else', () => {
  it('it_prints_HarvestTable_schemaJson_verbatim_to_stdout_and_exits_0', () => {
    const r = run(['--schema'])
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe(HarvestTable.schemaJson())
  })

  it('it_does_not_require_repo_or_milestone', () => {
    const r = run(['--schema'])
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('the_printed_schema_parses_as_json_and_declares_report_date', () => {
    const r = run(['--schema'])
    const schema = JSON.parse(r.stdout)
    expect(schema.find((column) => column.name === 'report_date')).toBeTruthy()
  })

  it('a_repo_or_milestone_given_alongside_schema_is_ignored_and_never_reached_for', () => {
    const r = run(['--schema', '--repo', 'not/a-real-repo', '--milestone', 'not-a-real-milestone'])
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe(HarvestTable.schemaJson())
  })
})
