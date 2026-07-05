import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseJsonld } from '../src/adapters/jsonld'
import { parseTrig } from '../src/adapters/trig'
import type { NormalizedReport } from '../src/model'
import { buildStatements } from '../src/project'

// The two fixtures are the SAME report (rpt_01KVF99...), emitted as a TriG holon
// and as a dataset-form JSON-LD holon. Parsing both must yield the same
// NormalizedReport — that equivalence IS the reconciliation between the two
// serializations.
const here = dirname(fileURLToPath(import.meta.url))
const trig = readFileSync(join(here, 'fixtures', 'seattle-method-case-1.holon.trig'), 'utf8')
const jsonldDoc = readFileSync(join(here, 'fixtures', 'seattle-method-case-1.holon.jsonld'), 'utf8')

const fromTrig = parseTrig(trig)
let fromJsonld: NormalizedReport

beforeAll(async () => {
  fromJsonld = await parseJsonld(jsonldDoc)
})

function balanceSheet(r: NormalizedReport): Record<string, number | null> {
  const s = buildStatements(r).find((x) => x.blockType === 'balance_sheet')
  if (!s) throw new Error('no balance sheet')
  const col = s.columns.length - 1
  const v = (q: string) => s.rows.find((row) => row.element.qname === q)?.cells[col]?.value ?? null
  return {
    cash: v('rs-gaap:CashAndCashEquivalentsAtCarryingValue'),
    assetsCurrent: v('rs-gaap:AssetsCurrent'),
    assets: v('rs-gaap:Assets'),
    liabilitiesAndEquity: v('rs-gaap:LiabilitiesAndStockholdersEquity'),
  }
}

describe('jsonld adapter — reconciles with the trig holon', () => {
  it('derives the same report identity and entity', () => {
    expect(fromJsonld.reportId).toMatch(/^rpt_/)
    expect(fromJsonld.reportId).toBe(fromTrig.reportId)
    expect(fromJsonld.reportIri).toBe(fromTrig.reportIri)
    expect(fromJsonld.entity?.name).toBe(fromTrig.entity?.name)
  })

  it('yields the same fact / block / structure / network counts', () => {
    expect(fromJsonld.facts.length).toBe(fromTrig.facts.length)
    expect(fromJsonld.informationBlocks.length).toBe(fromTrig.informationBlocks.length)
    expect(fromJsonld.structures.length).toBe(fromTrig.structures.length)
    expect(fromJsonld.presAssociations.length).toBe(fromTrig.presAssociations.length)
    expect(fromJsonld.calcAssociations.length).toBe(fromTrig.calcAssociations.length)
    expect(Object.keys(fromJsonld.elements).length).toBe(Object.keys(fromTrig.elements).length)
  })

  it('renders identical balance-sheet values through the projection', () => {
    expect(balanceSheet(fromJsonld)).toEqual(balanceSheet(fromTrig))
    expect(balanceSheet(fromJsonld).assets).toBe(14450)
  })
})
