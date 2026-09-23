import * as fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentCallMother } from '../agent-call-mother.ts'
import { DiskAgentMeasurements } from '../../src/infrastructure/disk-agent-measurements.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { RunNotAdvanced, RunNotUnderstood } from '../../src/domain/exceptions.ts'
import { AgentCallMeasurements } from '../../src/domain/value-objects/agent-call-measurements.ts'

class MeasurementDiskMother {
  static readonly roots: string[] = []

  static async empty(): Promise<MeasurementDisk> {
    const root = await fs.mkdtemp(join(tmpdir(), 'ct-agent-measurements-'))
    MeasurementDiskMother.roots.push(root)
    return new MeasurementDisk(new HeadlessFiles({ root, fs, newId: randomUUID }))
  }

  static async clean(): Promise<void> {
    await Promise.all(MeasurementDiskMother.roots.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })))
  }
}

class MeasurementDisk {
  readonly files: HeadlessFiles
  readonly store: DiskAgentMeasurements
  readonly directory: string
  readonly path: string

  constructor(files: HeadlessFiles) {
    this.files = files
    this.store = new DiskAgentMeasurements({ files })
    this.directory = files.callDirectory(AgentCallMother.call())
    this.path = join(this.directory, 'agent-measurements-v1.json')
  }
}

afterEach(async () => MeasurementDiskMother.clean())

describe('disk agent measurements', () => {
  it.each((['input', 'output', 'cacheRead', 'cacheCreation'] as const).flatMap((field) =>
    [-1, 0.5, NaN, Infinity, -Infinity].map((value) => ({ field, value })),
  ))('refuses $field=$value before invalid consumption can be serialized as unknown', ({ field, value }) => {
    const valid = AgentCallMother.measurements(AgentCallMother.completed())

    expect(() => new AgentCallMeasurements({ ...valid, tokens: { ...valid.tokens, [field]: value } }))
      .toThrow(`tokens.${field} must be a nonnegative integer or null`)
  })

  it.each([
    { field: 'provider', value: '' },
    { field: 'provider', value: ' ' },
    { field: 'requestId', value: '' },
    { field: 'role', value: ' ' },
    { field: 'startedAt', value: 'yesterday' },
    { field: 'startedAt', value: '2026-02-30T10:00:00.000Z' },
  ])('refuses invalid $field=$value at the measurement boundary', ({ field, value }) => {
    const valid = AgentCallMother.measurements(AgentCallMother.completed())

    expect(() => new AgentCallMeasurements({ ...valid, [field]: value })).toThrow(field)
  })

  it('refuses empty model identifiers instead of publishing an unnamed model', () => {
    const valid = AgentCallMother.measurements(AgentCallMother.completed())

    expect(() => new AgentCallMeasurements({ ...valid, models: [''] })).toThrow('model')
  })

  it('the common file preserves invocation identity, execution, unknown values and reported consumption', async () => {
    const disk = await MeasurementDiskMother.empty()

    await disk.store.record(AgentCallMother.measurements(AgentCallMother.completed()))

    expect(JSON.parse(await fs.readFile(disk.path, 'utf8'))).toEqual({
      version: 1, conversation: 'conversation', callId: 'call', provider: 'scripted-agent',
      purpose: 'implementation', requestId: 'work-1', role: 'implementer',
      startedAt: '2026-09-23T10:00:00.000Z', finishedAt: '2026-09-23T10:00:02.000Z',
      wallDurationMs: 2000, code: 0, signal: null, execution: { kind: 'success' },
      cost: { kind: 'unavailable', reason: 'this executor does not report cost' },
      turns: 2, reportedDurationMs: null,
      tokens: { input: 12, output: 5, cacheRead: 0, cacheCreation: null },
      models: ['scripted-model'], diagnostics: [],
    })
  })

  it('concurrent observations and a fresh store leave one immutable record', async () => {
    const disk = await MeasurementDiskMother.empty()
    const measurements = AgentCallMother.measurements(AgentCallMother.completed())

    await Promise.all([disk.store.record(measurements), disk.store.record(measurements)])
    const before = await fs.readFile(disk.path, 'utf8')
    await new DiskAgentMeasurements({ files: disk.files }).record(measurements)

    expect(await fs.readFile(disk.path, 'utf8')).toBe(before)
    expect(await fs.readdir(disk.directory)).toEqual(['agent-measurements-v1.json'])
  })

  it('conflicting evidence cannot replace the first recorded invocation', async () => {
    const disk = await MeasurementDiskMother.empty()
    await disk.store.record(AgentCallMother.measurements(AgentCallMother.completed()))
    const before = await fs.readFile(disk.path, 'utf8')

    const refusal = await disk.store.record(AgentCallMother.measurements(AgentCallMother.completed(true)))
      .catch((cause: unknown) => cause)

    expect(refusal).toBeInstanceOf(RunNotUnderstood)
    expect(refusal).toMatchObject({ message: expect.stringContaining('contains different bytes') })

    expect(await fs.readFile(disk.path, 'utf8')).toBe(before)
  })

  it('publication failures remain visible and do not leave a partial measurement', async () => {
    const disk = await MeasurementDiskMother.empty()
    await fs.mkdir(disk.directory, { recursive: true })
    await fs.mkdir(disk.path)

    await expect(disk.store.record(AgentCallMother.measurements(AgentCallMother.completed())))
      .rejects.toBeInstanceOf(RunNotAdvanced)

    expect(await fs.readdir(disk.directory)).toEqual(['agent-measurements-v1.json'])
    expect(await fs.readdir(disk.path)).toEqual([])
  })
})
