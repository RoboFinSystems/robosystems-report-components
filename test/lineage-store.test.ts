import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseJsonld } from '../src/adapters/jsonld'
import { checkFactLineage, contributionsOf, describedLines } from '../src/lineage'

// A consolidated Driftline report downloaded with lineage (four monthly
// columns, books closed through August, four ledger entities). The file is the
// fact-lineage spike's: every frozen figure's hash reproduced when it was built.
const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, 'fixtures', 'driftline-consolidated.lineage.holon.jsonld.gz')
const GA = 'fact_01M5FJ3GW95PX7QX1X051AXMMR' // General and administrative expense, June

describe('holon with lineage', () => {
  const text = gunzipSync(readFileSync(FIXTURE)).toString('utf8')

  it('reads the report exactly as the plain holon would', async () => {
    const report = await parseJsonld(text)
    expect(report.facts).toHaveLength(243)
    expect(Object.keys(report.elements)).toHaveLength(149)
    expect(report.informationBlocks).toHaveLength(5)
    expect(report.entity?.name).toBe('Driftline Coffee Roasters')
  })

  it('types the fourth graph and bridges every hashed figure', async () => {
    const report = await parseJsonld(text)
    const lineage = report.lineage!
    expect(lineage).toBeDefined()
    expect(Object.keys(lineage.contributions)).toHaveLength(198)
    expect(Object.keys(lineage.lines)).toHaveLength(325)
    expect(Object.keys(lineage.entities)).toHaveLength(4)
    const hashed = report.facts.filter((f) => f.provenance?.contentHash)
    expect(hashed.length).toBe(96)
    for (const fact of hashed) expect(fact.derivedFrom?.length).toBeGreaterThan(0)
    const live = report.facts.filter((f) => !f.provenance?.contentHash)
    for (const fact of live) expect(fact.derivedFrom).toBeUndefined()
  })

  it('recomputes every figure’s frozen hash from the file alone', async () => {
    const report = await parseJsonld(text)
    const checks = report.facts
      .filter((f) => f.derivedFrom?.length)
      .map((f) => checkFactLineage(report, f)!)
    expect(checks.length).toBe(96)
    expect(checks.every((c) => c.ok === true)).toBe(true)
  })

  it('walks a consolidated figure to four entities and an elimination', async () => {
    const report = await parseJsonld(text)
    const lineage = report.lineage!
    const fact = report.facts.find((f) => f.id.endsWith(`/fact/${GA}`))!
    const contributions = contributionsOf(report, fact)
    expect(contributions).toHaveLength(10)
    expect(new Set(contributions.map((c) => c.entity)).size).toBe(4)
    const elimination = contributions.find((c) => c.amount! < 0)!
    expect(lineage.entities[elimination.entity]?.role).toBe('consolidation')
    const [line] = describedLines(lineage, elimination)
    const entry = lineage.entries[line!.entry]!
    expect(entry.adjustmentKind).toBe('elimination_intercompany')
    expect(lineage.entities[entry.adjustsEntity!]?.name).toBeTruthy()
    expect(line!.event).toBeNull()
    // An operating line reaches its entry, its event and the counterparty.
    const salaries = contributions.find(
      (c) => lineage.accounts[c.account]?.name === 'Salaries & Wages'
    )!
    const [salaryLine] = describedLines(lineage, salaries)
    const salaryEvent = lineage.events[salaryLine!.event!]!
    expect(salaryEvent.type).toBeTruthy()
    expect(lineage.entries[salaryLine!.entry]?.postingDate).toMatch(/^2026-06/)
  })

  it('states the balance before the described span on a balance-sheet figure', async () => {
    const report = await parseJsonld(text)
    const lineage = report.lineage!
    const bounded = Object.values(lineage.contributions).filter((c) => c.priorLineCount > 0)
    expect(bounded.length).toBeGreaterThan(0)
    for (const c of bounded) {
      expect(c.describedFrom).toBe('2026-06-01')
      expect(c.priorBalance).not.toBeNull()
      expect(c.members).toHaveLength(c.lineCount)
      expect(describedLines(lineage, c)).toHaveLength(c.describedLineCount)
    }
  })

  it('does not restate the report’s own entity, and names the members', async () => {
    const report = await parseJsonld(text)
    const lineage = report.lineage!
    const own = lineage.entities[report.entity!.id]!
    expect(own.name).toBe('Driftline Coffee Roasters')
    const members = Object.values(lineage.entities).filter((e) => e.id !== report.entity!.id)
    expect(members.every((e) => e.name && e.role)).toBe(true)
  })
})
