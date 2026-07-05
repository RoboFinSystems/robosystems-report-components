import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SecQuery } from '../src/adapters/sec'
import { fetchSecReportShell, fetchSecSection, parseStructureDefinition } from '../src/adapters/sec'
import type { Statement } from '../src/model'
import { buildStatements, footCheck } from '../src/project'

const here = dirname(fileURLToPath(import.meta.url))
const fx = (name: string): Array<Record<string, unknown>> =>
  JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8')).data

// Rows captured live from the SEC graph (NVDA FY2026 10-K), so the stub exercises
// the exact row shapes the adapter maps.
const entityRows = fx('nvda-shell-entity.json')
const sectionRows = fx('nvda-shell-sections.json')
const bsFacts = fx('nvda-balance-sheet-facts.json')
const bsUnits = fx('nvda-balance-sheet-units.json')
const bsAssoc = fx('nvda-balance-sheet-assoc.json')
const coverFacts = fx('nvda-cover-facts.json')

const BS_FS = '019cf2c9-f694-77b4-a0a9-8a873ddcf9d8'
const COVER_FS = '019cf2c9-f6c5-7e47-b351-62c1a609cf23'

/** Routes each adapter query to its captured fixture by a distinctive clause. */
const stubQuery: SecQuery = async (cypher, params = {}) => {
  const fsid = params.fsid as string | undefined
  if (cypher.includes('FACT_HAS_UNIT')) return fsid === BS_FS ? bsUnits : []
  if (cypher.includes('STRUCTURE_HAS_ASSOCIATION')) return bsAssoc
  if (cypher.includes('collect(DISTINCT')) return sectionRows
  if (cypher.includes('ENTITY_HAS_REPORT')) return entityRows
  if (cypher.includes('FACT_HAS_ELEMENT')) return fsid === COVER_FS ? coverFacts : bsFacts
  return []
}

const REPORT_ID = 'c26ebe09-3d6e-56a8-b086-d297c73e8831'
const shell = await fetchSecReportShell(stubQuery, REPORT_ID)

function latestCol(statement: Statement): number {
  return statement.columns.length - 1
}
function valueOf(statement: Statement, qname: string, col = latestCol(statement)): number | null {
  const row = statement.rows.find((r) => r.element.qname === qname)
  return row ? (row.cells[col]?.value ?? null) : null
}

describe('parseStructureDefinition', () => {
  it('strips the "NNNN - Type - " prefix and classifies the kind', () => {
    expect(parseStructureDefinition('9952162 - Disclosure - Goodwill', null)).toEqual({
      title: 'Goodwill',
      kind: 'Disclosure',
    })
    expect(parseStructureDefinition('0000001 - Document - Cover Page', null)).toEqual({
      title: 'Cover Page',
      kind: 'Cover',
    })
    // a recognized canonical statement always reads as a Statement
    expect(
      parseStructureDefinition('9952153 - Statement - Consolidated Balance Sheets', 'balance_sheet')
    ).toEqual({ title: 'Consolidated Balance Sheets', kind: 'Statement' })
  })
})

describe('sec adapter — report shell', () => {
  it('reads the reporting entity', () => {
    expect(shell.entity?.name).toBe('NVIDIA CORP')
  })

  it('lists the filing sections in order, the Cover first', () => {
    expect(shell.sections.length).toBeGreaterThan(30)
    expect(shell.sections[0].kind).toBe('Cover')
    expect(shell.sections[0].title).toMatch(/cover/i)
    expect(shell.sections.map((s) => s.order)).toEqual(shell.sections.map((_, i) => i))
  })

  it('surfaces the core statements by canonical type', () => {
    const types = new Set(shell.sections.map((s) => s.canonicalType).filter(Boolean))
    expect(types).toContain('balance_sheet')
    expect(types).toContain('income_statement')
    expect(types).toContain('cash_flow_statement')
  })
})

describe('sec adapter — balance sheet section', () => {
  const section = shell.sections.find(
    (s) => s.canonicalType === 'balance_sheet' && !/parenthetical/i.test(s.title)
  )!
  it('resolves a single balance-sheet section', () => {
    expect(section).toBeDefined()
    expect(section.title).toBe('Consolidated Balance Sheets')
  })

  it('reconstructs one statement, titled from its structure', async () => {
    const report = await fetchSecSection(stubQuery, shell, section)
    const statements = buildStatements(report)
    expect(statements).toHaveLength(1)
    const bs = statements[0]
    expect(bs.blockType).toBe('balance_sheet')
    expect(bs.title).toBe('Consolidated Balance Sheets')
    // noise columns (single-fact prior-year equity opening balances) are dropped
    expect(bs.columns).toHaveLength(2)
  })

  it('foots Liabilities & Equity live (49,510 + 157,293 = 206,803M, latest period)', async () => {
    const report = await fetchSecSection(stubQuery, shell, section)
    const bs = buildStatements(report)[0]
    expect(valueOf(bs, 'us-gaap:Assets')).toBe(206803000000)
    expect(valueOf(bs, 'us-gaap:LiabilitiesAndStockholdersEquity')).toBe(206803000000)
    // Assets is a calculation parent → rendered as a subtotal.
    expect(bs.rows.find((r) => r.element.qname === 'us-gaap:Assets')?.isSubtotal).toBe(true)
    // L&E foots exactly: the null CommitmentsAndContingencies placeholder is
    // excluded, leaving Liabilities + StockholdersEquity.
    const leRow = bs.rows.find(
      (r) => r.element.qname === 'us-gaap:LiabilitiesAndStockholdersEquity'
    )!
    const foot = footCheck(report, bs, leRow.element.id, latestCol(bs))
    expect(foot?.ok).toBe(true)
    expect(foot?.expected).toBe(206803000000)
    expect(foot?.actual).toBe(206803000000)
    expect(foot?.terms.length).toBe(3)
  })
})

describe('sec adapter — cover page (text facts)', () => {
  it('renders non-numeric facts as their string value', async () => {
    const cover = shell.sections.find((s) => s.kind === 'Cover')!
    const report = await fetchSecSection(stubQuery, shell, cover)
    const statement = buildStatements(report)[0]
    const nameRow = statement.rows.find((r) => r.element.qname === 'dei:EntityRegistrantName')
    expect(nameRow).toBeDefined()
    const cell = nameRow!.cells.find((c) => c.textValue)
    expect(cell?.value).toBeNull()
    expect(cell?.textValue).toBe('NVIDIA CORP')
  })
})
