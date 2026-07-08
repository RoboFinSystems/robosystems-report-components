import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ReportLabels, SecQuery, SecReportShell, SecSection } from '../src/adapters/sec'
import {
  fetchSecReportShell,
  fetchSecSection,
  mergeSecSections,
  parseStructureDefinition,
} from '../src/adapters/sec'
import { isExternalFactUrl } from '../src/constants'
import type { NormalizedReport, PivotTable } from '../src/model'
import { buildPivots } from '../src/pivot'
import { footCheck } from '../src/project'

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

function latestCol(statement: PivotTable): number {
  return statement.columns.length - 1
}
function valueOf(statement: PivotTable, qname: string, col = latestCol(statement)): number | null {
  const row = statement.rows.find((r) => r.element.qname === qname && r.members.length === 0)
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
    const statements = buildPivots(report)
    expect(statements).toHaveLength(1)
    const bs = statements[0]
    expect(bs.blockType).toBe('balance_sheet')
    expect(bs.title).toBe('Consolidated Balance Sheets')
    // noise columns (single-fact prior-year equity opening balances) are dropped
    expect(bs.columns).toHaveLength(2)
  })

  it('foots Liabilities & Equity live (49,510 + 157,293 = 206,803M, latest period)', async () => {
    const report = await fetchSecSection(stubQuery, shell, section)
    const bs = buildPivots(report)[0]
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
    const statement = buildPivots(report)[0]
    const nameRow = statement.rows.find((r) => r.element.qname === 'dei:EntityRegistrantName')
    expect(nameRow).toBeDefined()
    const cell = nameRow!.cells.find((c) => c.textValue)
    expect(cell?.value).toBeNull()
    expect(cell?.textValue).toBe('NVIDIA CORP')
  })
})

describe('sec adapter — report-scoped labels via the per-report taxonomy', () => {
  // The SEC graph resolves labels through the filer's per-report extension
  // taxonomy, tagged with the element each label is for (element_uri). The adapter
  // prefers those and humanizes the qname only as a fallback. See sec-label-scoping.
  const STD = 'http://www.xbrl.org/2003/role/label'
  const labels: ReportLabels = {
    byElement: new Map([
      [
        'http://fasb.org/us-gaap/2025#PropertyPlantAndEquipmentNet',
        new Map([[STD, 'Property, Plant and Equipment, Net']]),
      ],
      // XBRL standard labels carry a bracketed role tag; the adapter strips it.
      [
        'http://fasb.org/srt/2025#ProductOrServiceAxis',
        new Map([[STD, 'Products and Services [Axis]']]),
      ],
      // a filer-extension member whose qname prefix isn't reconstructible — URI keying still resolves it
      ['http://filer.example.com/20240101#RetailMember', new Map([[STD, 'Retail [Member]']])],
    ]),
  }
  const labelShell: SecReportShell = {
    reportId: 'r1',
    entity: { id: 'ent1', name: 'Test Co', legalName: null, country: null },
    sections: [],
    labels,
  }
  const labelSection: SecSection = {
    id: 'struct-1',
    title: 'Balance Sheet',
    kind: 'Statement',
    canonicalType: 'balance_sheet',
    order: 0,
    factsetIds: ['fs-1'],
  }
  const factRows: Array<Record<string, unknown>> = [
    {
      fid: 'f-ppe',
      qname: 'us-gaap:PropertyPlantAndEquipmentNet',
      euri: 'http://fasb.org/us-gaap/2025#PropertyPlantAndEquipmentNet',
      ename: 'PropertyPlantAndEquipmentNet',
      is_numeric: true,
      item_type: 'monetaryItemType',
      numeric_value: 1000,
      raw_value: '1000',
      pid: 'p1',
      period_type: 'instant',
      end_date: '2024-01-28',
    },
    {
      fid: 'f-other',
      qname: 'us-gaap:OtherAssetsNoncurrent',
      euri: 'http://fasb.org/us-gaap/2025#OtherAssetsNoncurrent', // not in the dictionary → humanize
      ename: 'OtherAssetsNoncurrent',
      is_numeric: true,
      item_type: 'monetaryItemType',
      numeric_value: 50,
      raw_value: '50',
      pid: 'p1',
      period_type: 'instant',
      end_date: '2024-01-28',
    },
  ]
  const dimRows: Array<Record<string, unknown>> = [
    {
      fid: 'f-ppe',
      axis: 'ProductOrServiceAxis',
      member: 'RetailMember',
      axis_uri: 'http://fasb.org/srt/2025#ProductOrServiceAxis',
      member_uri: 'http://filer.example.com/20240101#RetailMember',
      is_explicit: true,
      is_typed: false,
    },
    {
      fid: 'f-other',
      axis: 'ConcentrationRiskByTypeAxis',
      member: 'CommercialMember',
      axis_uri: 'http://fasb.org/us-gaap/2025#ConcentrationRiskByTypeAxis',
      member_uri: 'http://fasb.org/us-gaap/2025#CommercialMember', // not in dict → dimLabel fallback
      is_explicit: true,
      is_typed: false,
    },
  ]
  const labelQuery: SecQuery = async (cypher) => {
    if (cypher.includes('FACT_HAS_UNIT')) return []
    if (cypher.includes('STRUCTURE_HAS_ASSOCIATION')) return []
    if (cypher.includes('FACT_HAS_DIMENSION')) return dimRows
    if (cypher.includes('FACT_HAS_ELEMENT')) return factRows
    return []
  }

  it('fetchSecReportShell builds the label dictionary from LABELS_Q', async () => {
    const shellQuery: SecQuery = async (cypher) => {
      if (cypher.includes('TAXONOMY_HAS_LABEL'))
        return [
          { element_uri: 'http://x#A', role: STD, value: 'Alpha' },
          {
            element_uri: 'http://x#A',
            role: 'http://www.xbrl.org/2003/role/terseLabel',
            value: 'A',
          },
        ]
      if (cypher.includes('ENTITY_HAS_REPORT')) return [{ entity_id: 'e', entity_name: 'Co' }]
      return [] // SECTIONS_Q
    }
    const built = await fetchSecReportShell(shellQuery, 'r1')
    expect(built.labels.byElement.get('http://x#A')?.get(STD)).toBe('Alpha')
  })

  it('prefers the report label for a fact concept, humanizing only as fallback', async () => {
    const report = await fetchSecSection(labelQuery, labelShell, labelSection)
    expect(report.elements['us-gaap:PropertyPlantAndEquipmentNet'].label).toBe(
      'Property, Plant and Equipment, Net'
    )
    expect(report.elements['us-gaap:OtherAssetsNoncurrent'].label).toBe('Other Assets Noncurrent')
  })

  it('prefers the report label for a dimension member, humanizing only as fallback', async () => {
    const report = await fetchSecSection(labelQuery, labelShell, labelSection)
    const ppe = report.facts.find((f) => f.id === 'f-ppe')!
    expect(ppe.dimensions?.[0].memberLabel).toBe('Retail')
    const other = report.facts.find((f) => f.id === 'f-other')!
    expect(other.dimensions?.[0].memberLabel).toBe('Commercial')
  })

  it('strips the XBRL [Member]/[Axis] role tag from resolved labels', async () => {
    const report = await fetchSecSection(labelQuery, labelShell, labelSection)
    const ppe = report.facts.find((f) => f.id === 'f-ppe')!
    // dictionary values were 'Retail [Member]' / 'Products and Services [Axis]'
    expect(ppe.dimensions?.[0].memberLabel).toBe('Retail')
    expect(ppe.dimensions?.[0].axisLabel).toBe('Products and Services')
  })
})

describe('isExternalFactUrl', () => {
  it('matches externalized fact URLs (html + txt) and rejects everything else', () => {
    expect(
      isExternalFactUrl(
        'https://public.robosystems.ai/2026/0001522767/0001522767-26-000030/fact_ad2ee5cf0f43.html'
      )
    ).toBe(true)
    expect(isExternalFactUrl('https://public.robosystems.ai/x/fact_deadbeef.txt')).toBe(true)
    // rejects: not a fact_* URL, wrong extension, non-hex hash, non-url, nullish
    expect(isExternalFactUrl('https://api.robosystems.ai/v1/graphs')).toBe(false)
    expect(isExternalFactUrl('https://public.robosystems.ai/x/fact_abc.pdf')).toBe(false)
    expect(isExternalFactUrl('https://public.robosystems.ai/x/fact_xyz.html')).toBe(false)
    expect(isExternalFactUrl('10-K')).toBe(false)
    expect(isExternalFactUrl(null)).toBe(false)
    expect(isExternalFactUrl(undefined)).toBe(false)
  })
})

describe('projection — multiple structures sharing a block type', () => {
  // A filing has several structures of one canonical type (e.g. the balance
  // sheet and its parenthetical). Each Information Block must resolve to its own
  // structure via `structureId`, not collapse onto the first blockType match.
  const report: NormalizedReport = {
    reportId: 't',
    reportIri: null,
    entity: null,
    informationBlocks: [
      { id: 'ib1', blockType: 'balance_sheet', factSet: 'fs1', label: 'A', structureId: 's1' },
      { id: 'ib2', blockType: 'balance_sheet', factSet: 'fs2', label: 'B', structureId: 's2' },
    ],
    structures: [
      {
        id: 's1',
        blockType: 'balance_sheet',
        roleUri: null,
        structureName: 'Balance Sheet A',
        order: 0,
      },
      {
        id: 's2',
        blockType: 'balance_sheet',
        roleUri: null,
        structureName: 'Balance Sheet B',
        order: 1,
      },
    ],
    facts: [
      {
        id: 'f1',
        element: 'x:Cash',
        period: 'p1',
        unit: null,
        entity: null,
        factSet: 'fs1',
        value: 100,
        decimals: null,
      },
      {
        id: 'f2',
        element: 'x:Debt',
        period: 'p1',
        unit: null,
        entity: null,
        factSet: 'fs2',
        value: 200,
        decimals: null,
      },
    ],
    elements: {
      'x:Cash': {
        id: 'x:Cash',
        qname: 'x:Cash',
        label: 'Cash',
        balance: 'debit',
        periodType: 'instant',
        abstract: false,
        monetary: true,
      },
      'x:Debt': {
        id: 'x:Debt',
        qname: 'x:Debt',
        label: 'Debt',
        balance: 'credit',
        periodType: 'instant',
        abstract: false,
        monetary: true,
      },
    },
    periods: {
      p1: {
        id: 'p1',
        type: 'instant',
        instant: '2026-01-01',
        startDate: null,
        endDate: null,
        end: '2026-01-01',
      },
    },
    units: {},
    calcAssociations: [],
    presAssociations: [],
  }

  it('resolves each block to its own structure (title + facts), not the first match', () => {
    const statements = buildPivots(report)
    expect(statements).toHaveLength(2)
    expect(statements.map((s) => s.title)).toEqual(['Balance Sheet A', 'Balance Sheet B'])
    expect(statements[0].rows.map((r) => r.element.qname)).toEqual(['x:Cash'])
    expect(statements[1].rows.map((r) => r.element.qname)).toEqual(['x:Debt'])
  })
})

describe('mergeSecSections — whole-report reconstruction', () => {
  it('concatenates single-section reports into one model', async () => {
    const bsSection = shell.sections.find(
      (s) => s.canonicalType === 'balance_sheet' && !/parenthetical/i.test(s.title)
    )!
    const coverSection = shell.sections.find((s) => s.kind === 'Cover')!
    const bs = await fetchSecSection(stubQuery, shell, bsSection)
    const cover = await fetchSecSection(stubQuery, shell, coverSection)

    const merged = mergeSecSections(shell, [bs, cover])
    expect(merged.informationBlocks).toHaveLength(2)
    expect(merged.structures).toHaveLength(2)
    expect(merged.facts.length).toBe(bs.facts.length + cover.facts.length)
    expect(merged.entity?.name).toBe('NVIDIA CORP')
    expect(buildPivots(merged)).toHaveLength(2)
  })
})
