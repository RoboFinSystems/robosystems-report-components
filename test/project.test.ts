import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseJsonld } from '../src/adapters/jsonld'
import type { Statement } from '../src/model'
import { buildStatements, calcSubtotals, footCheck } from '../src/project'

const here = dirname(fileURLToPath(import.meta.url))
const holon = readFileSync(join(here, 'fixtures', 'seattle-method-case-1.holon.jsonld'), 'utf8')

const report = await parseJsonld(holon)
const statements = buildStatements(report)

function statementOf(blockType: string): Statement {
  const s = statements.find((x) => x.blockType === blockType)
  if (!s) throw new Error(`no statement for ${blockType}`)
  return s
}

// Columns are sorted ascending by date; the latest column is the primary
// reporting period (e.g. 2024-03-31 for the balance sheet, alongside a sparse
// 2023-12-31 opening-balance column).
function latestCol(statement: Statement): number {
  return statement.columns.length - 1
}

function valueOf(statement: Statement, qname: string, col = latestCol(statement)): number | null {
  const row = statement.rows.find((r) => r.element.qname === qname)
  return row ? (row.cells[col]?.value ?? null) : null
}

describe('jsonld adapter — parse', () => {
  it('parses the entity', () => {
    expect(report.entity?.name).toBe('Lemonade Stand (Charlie Hoffman Test Case 1)')
  })

  it('parses all facts, blocks, structures and networks', () => {
    expect(report.facts.length).toBe(48)
    expect(report.informationBlocks.length).toBe(4)
    expect(report.structures.length).toBe(4)
    expect(report.presAssociations.length).toBe(94)
    expect(report.calcAssociations.length).toBe(68)
  })

  it('derives the report IRI / id from the named graphs', () => {
    expect(report.reportId).toMatch(/^rpt_/)
  })
})

describe('projection — statements in canonical order', () => {
  it('produces the four statements in block order', () => {
    expect(statements.map((s) => s.blockType)).toEqual([
      'balance_sheet',
      'income_statement',
      'cash_flow_statement',
      'equity_statement',
    ])
  })
})

describe('projection — balance sheet values', () => {
  const bs = statementOf('balance_sheet')

  it('renders details then subtotals in presentation order', () => {
    expect(valueOf(bs, 'rs-gaap:CashAndCashEquivalentsAtCarryingValue')).toBe(10850)
    expect(valueOf(bs, 'rs-gaap:InventoryNetOfAllowancesCustomerAdvancesAndProgressBillings')).toBe(
      2700
    )
    expect(valueOf(bs, 'rs-gaap:AssetsCurrent')).toBe(13550)
    expect(valueOf(bs, 'rs-gaap:AssetsNoncurrent')).toBe(900)
    expect(valueOf(bs, 'rs-gaap:Assets')).toBe(14450)
    expect(valueOf(bs, 'rs-gaap:LiabilitiesAndStockholdersEquity')).toBe(14450)
  })

  it('orders a subtotal after its components', () => {
    const idx = (q: string) => bs.rows.findIndex((r) => r.element.qname === q)
    expect(idx('rs-gaap:AssetsCurrent')).toBeGreaterThan(
      idx('rs-gaap:CashAndCashEquivalentsAtCarryingValue')
    )
    expect(idx('rs-gaap:Assets')).toBeGreaterThan(idx('rs-gaap:AssetsCurrent'))
  })

  it('marks calculation parents (and only those) as subtotals', () => {
    const isSub = (q: string) => bs.rows.find((r) => r.element.qname === q)?.isSubtotal
    expect(isSub('rs-gaap:Assets')).toBe(true)
    expect(isSub('rs-gaap:AssetsCurrent')).toBe(true)
    expect(isSub('rs-gaap:CashAndCashEquivalentsAtCarryingValue')).toBe(false)
  })
})

describe('projection — income statement values', () => {
  const is = statementOf('income_statement')
  it('foots the multi-step income statement', () => {
    expect(valueOf(is, 'rs-gaap:Revenues')).toBe(8000)
    expect(valueOf(is, 'rs-gaap:GrossProfit')).toBe(2700)
    expect(valueOf(is, 'rs-gaap:OperatingIncomeLoss')).toBe(2600)
    expect(valueOf(is, 'rs-gaap:NetIncomeLoss')).toBe(2050)
  })
})

describe('footing — live foots-check', () => {
  const bs = statementOf('balance_sheet')

  it('foots Assets = AssetsCurrent + AssetsNoncurrent (13,550 + 900 = 14,450)', () => {
    const assetsRow = bs.rows.find((r) => r.element.qname === 'rs-gaap:Assets')!
    const foot = footCheck(report, bs, assetsRow.element.id, latestCol(bs))
    expect(foot).not.toBeNull()
    expect(foot!.ok).toBe(true)
    expect(foot!.expected).toBe(14450)
    expect(foot!.actual).toBe(14450)
    expect(foot!.terms.length).toBe(2)
  })

  it('returns null for a non-subtotal (nothing to foot)', () => {
    const cashRow = bs.rows.find(
      (r) => r.element.qname === 'rs-gaap:CashAndCashEquivalentsAtCarryingValue'
    )!
    expect(footCheck(report, bs, cashRow.element.id, 0)).toBeNull()
  })

  it('every calc-parent subtotal in the report foots', () => {
    const subtotals = calcSubtotals(report)
    const mismatches: string[] = []
    for (const statement of statements) {
      for (const row of statement.rows) {
        if (!subtotals.has(row.element.id)) continue
        for (let col = 0; col < statement.columns.length; col++) {
          const foot = footCheck(report, statement, row.element.id, col)
          // only assert when both sides are present in this column
          if (foot && foot.expected !== null && foot.actual !== null && !foot.ok) {
            mismatches.push(
              `${statement.blockType}:${row.element.qname}[${col}] ${foot.expected} != ${foot.actual}`
            )
          }
        }
      }
    }
    expect(mismatches).toEqual([])
  })
})
