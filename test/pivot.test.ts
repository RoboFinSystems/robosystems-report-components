import { describe, expect, it } from 'vitest'
import type {
  DimensionQualifier,
  ElementInfo,
  Fact,
  NormalizedReport,
  PivotTable,
} from '../src/model'
import { buildPivot, defaultPivotConfig } from '../src/pivot'

// A compact Statement-of-Equity-shaped section built from real NVDA FY2026
// numbers: `us-gaap:StockholdersEquity` reported once per equity component
// (a dimensional breakdown on StatementEquityComponentsAxis) *and* as a
// consolidated total, at two period-ends — exactly the case the legacy
// `(element, period.end)` keying collapsed into one cell.

const AXIS = 'us-gaap:StatementEquityComponentsAxis'
const members: Record<string, string> = {
  common: 'us-gaap:CommonStockMember',
  apic: 'us-gaap:AdditionalPaidInCapitalMember',
  re: 'us-gaap:RetainedEarningsMember',
  aoci: 'us-gaap:AccumulatedOtherComprehensiveIncomeMember',
}
const memberLabel: Record<string, string> = {
  [members.common]: 'Common Stock',
  [members.apic]: 'Additional Paid-in Capital',
  [members.re]: 'Retained Earnings',
  [members.aoci]: 'AOCI',
}

function dim(member: string): DimensionQualifier {
  return {
    axis: AXIS,
    member,
    axisLabel: 'Equity Components',
    memberLabel: memberLabel[member],
    explicit: true,
  }
}

function el(id: string, opts: Partial<ElementInfo> & { abstract?: boolean } = {}): ElementInfo {
  return {
    id,
    qname: id,
    label: id.split(':').pop() ?? id,
    balance: null,
    periodType: opts.periodType ?? null,
    abstract: opts.abstract ?? false,
    monetary: opts.monetary ?? false,
    numericKind: opts.numericKind,
  }
}

let fid = 0
function fact(
  element: string,
  period: string,
  value: number | null,
  extra: Partial<Fact> = {}
): Fact {
  return {
    id: `f${fid++}`,
    element,
    period,
    unit: extra.unit ?? 'u:usd',
    entity: 'e:nvda',
    factSet: 'fs',
    value,
    decimals: extra.decimals ?? '-6',
    dimensions: extra.dimensions,
    textValue: extra.textValue,
  }
}

const SE = 'us-gaap:StockholdersEquity'
const NI = 'us-gaap:NetIncomeLoss'
const EPS = 'us-gaap:EarningsPerShareBasic'
const ABS = 'us-gaap:StatementOfStockholdersEquityAbstract'

function makeReport(): NormalizedReport {
  fid = 0
  const facts: Fact[] = [
    // Consolidated totals (no dimension).
    fact(SE, 'p2025', 79327000000),
    fact(SE, 'p2026', 157293000000),
    fact(NI, 'pfy2026', 120067000000),
    fact(EPS, 'pfy2026', 4.93, { decimals: '2', unit: 'u:usdps' }),
    // StockholdersEquity by equity component @ 2025-01-26 (sums to 79,327M).
    fact(SE, 'p2025', 24000000, { dimensions: [dim(members.common)] }),
    fact(SE, 'p2025', 11237000000, { dimensions: [dim(members.apic)] }),
    fact(SE, 'p2025', 68038000000, { dimensions: [dim(members.re)] }),
    fact(SE, 'p2025', 28000000, { dimensions: [dim(members.aoci)] }),
    // @ 2026-01-25 (sums to 157,293M).
    fact(SE, 'p2026', 24000000, { dimensions: [dim(members.common)] }),
    fact(SE, 'p2026', 12000000000, { dimensions: [dim(members.apic)] }),
    fact(SE, 'p2026', 145241000000, { dimensions: [dim(members.re)] }),
    fact(SE, 'p2026', 28000000, { dimensions: [dim(members.aoci)] }),
    // Net income flows entirely to retained earnings.
    fact(NI, 'pfy2026', 120067000000, { dimensions: [dim(members.re)] }),
  ]

  const elements: Record<string, ElementInfo> = {
    [ABS]: el(ABS, { abstract: true }),
    [SE]: el(SE, { monetary: true, periodType: 'instant', numericKind: 'monetary' }),
    [NI]: el(NI, { monetary: true, periodType: 'duration', numericKind: 'monetary' }),
    [EPS]: el(EPS, { periodType: 'duration', numericKind: 'perShare' }),
    [AXIS]: el(AXIS, { abstract: true }),
  }
  for (const m of Object.values(members)) elements[m] = el(m, { abstract: true })

  return {
    reportId: 'r',
    reportIri: null,
    entity: { id: 'e:nvda', name: 'NVIDIA CORP', legalName: null, country: null },
    informationBlocks: [
      { id: 's', blockType: 'equity_statement', factSet: 'fs', label: 'Equity', structureId: 's' },
    ],
    structures: [
      {
        id: 's',
        blockType: 'equity_statement',
        roleUri: null,
        structureName: "Shareholders' Equity",
        order: 0,
      },
    ],
    facts,
    elements,
    periods: {
      p2025: {
        id: 'p2025',
        type: 'instant',
        instant: '2025-01-26',
        startDate: null,
        endDate: null,
        end: '2025-01-26',
      },
      p2026: {
        id: 'p2026',
        type: 'instant',
        instant: '2026-01-25',
        startDate: null,
        endDate: null,
        end: '2026-01-25',
      },
      pfy2026: {
        id: 'pfy2026',
        type: 'duration',
        instant: null,
        startDate: '2025-01-27',
        endDate: '2026-01-25',
        end: '2026-01-25',
      },
    },
    units: {
      'u:usd': { id: 'u:usd', measure: 'iso4217:USD', label: 'USD', symbol: '$' },
      'u:usdps': { id: 'u:usdps', measure: 'iso4217:USD', label: 'USD', symbol: '$' },
    },
    calcAssociations: [
      { parent: SE, child: members.common, weight: 1, order: 1, role: null, structure: 's' },
    ],
    presAssociations: [
      { parent: ABS, child: AXIS, order: 0, role: null, structure: 's' },
      { parent: ABS, child: NI, order: 1, role: null, structure: 's' },
      { parent: ABS, child: SE, order: 2, role: null, structure: 's' },
      { parent: ABS, child: EPS, order: 3, role: null, structure: 's' },
      { parent: AXIS, child: members.common, order: 1, role: null, structure: 's' },
      { parent: AXIS, child: members.apic, order: 2, role: null, structure: 's' },
      { parent: AXIS, child: members.re, order: 3, role: null, structure: 's' },
      { parent: AXIS, child: members.aoci, order: 4, role: null, structure: 's' },
    ],
  }
}

const report = makeReport()

function colIndex(p: PivotTable, end: string, leafLabel: string): number {
  return p.columns.findIndex((c) => (c.period?.end ?? '') === end && c.label === leafLabel)
}
function rowByKey(p: PivotTable, key: string) {
  return p.rows.find((r) => r.key === key)
}
function cell(p: PivotTable, rowKey: string, end: string, leafLabel: string): number | null {
  const row = rowByKey(p, rowKey)
  const idx = colIndex(p, end, leafLabel)
  return row && idx >= 0 ? (row.cells[idx]?.value ?? null) : null
}

describe('defaultPivotConfig — derives roles from the section aspects', () => {
  const config = defaultPivotConfig(report, report.informationBlocks[0])
  it('puts concept on rows, period + the multi-member axis on columns', () => {
    expect(config.rows).toEqual(['concept'])
    expect(config.columns).toEqual(['period', `dim:${AXIS}`])
  })
  it('makes the reporting entity a slicer', () => {
    expect(config.slicers).toContain('entity')
  })
})

describe('buildPivot — the equity hypercube (default view)', () => {
  const p = buildPivot(report, report.informationBlocks[0])

  it('renders the entity as a slicer bar', () => {
    const entity = p.slicers.find((s) => s.aspect === 'entity')
    expect(entity?.valueLabel).toBe('NVIDIA CORP')
  })

  it('lays members out as columns, nested under each period (+ a Total)', () => {
    // 2 periods × (4 members + Total) = 10 leaf columns.
    expect(p.columns).toHaveLength(10)
    // Top header level = the two period-ends, each spanning 5 member sub-columns.
    expect(p.columnHeaders[0].map((h) => h.span)).toEqual([5, 5])
    // Second level = member labels in domain (presentation) order, Total last.
    expect(p.columnHeaders[1].slice(0, 5).map((h) => h.label)).toEqual([
      'Common Stock',
      'Additional Paid-in Capital',
      'Retained Earnings',
      'AOCI',
      'Total',
    ])
  })

  it('keeps each dimensional fact in its own cell — no collision', () => {
    // The four component values AND the consolidated total coexist at 2025-01-26.
    expect(cell(p, SE, '2025-01-26', 'Common Stock')).toBe(24000000)
    expect(cell(p, SE, '2025-01-26', 'Additional Paid-in Capital')).toBe(11237000000)
    expect(cell(p, SE, '2025-01-26', 'Retained Earnings')).toBe(68038000000)
    expect(cell(p, SE, '2025-01-26', 'AOCI')).toBe(28000000)
    expect(cell(p, SE, '2025-01-26', 'Total')).toBe(79327000000)
    // The components foot to the total.
    const sum = 24000000 + 11237000000 + 68038000000 + 28000000
    expect(sum).toBe(79327000000)
  })

  it('routes net income into the retained-earnings column only', () => {
    expect(cell(p, NI, '2026-01-25', 'Retained Earnings')).toBe(120067000000)
    expect(cell(p, NI, '2026-01-25', 'Total')).toBe(120067000000)
    expect(cell(p, NI, '2026-01-25', 'Common Stock')).toBeNull()
    expect(cell(p, NI, '2025-01-26', 'Total')).toBeNull()
  })

  it('emits the abstract concept as a header row', () => {
    const header = rowByKey(p, ABS)
    expect(header?.header).toBe(true)
    expect(header?.cells).toHaveLength(0)
  })

  it('marks calculation parents as subtotals', () => {
    expect(rowByKey(p, SE)?.isSubtotal).toBe(true)
    expect(rowByKey(p, NI)?.isSubtotal).toBe(false)
  })

  it('resolves the section scale to millions, excepting per-share amounts', () => {
    expect(p.scale.factor).toBe(1e6)
    expect(p.scale.label).toBe('millions')
    expect(p.scale.caption).toBe('In millions, except per-share amounts')
  })

  it('does not rescale the EPS row itself (its fact stays 4.93)', () => {
    const eps = rowByKey(p, EPS)
    const idx = colIndex(p, '2026-01-25', 'Total')
    expect(eps?.cells[idx]?.value).toBe(4.93)
  })
})

describe('buildPivot — configurable: move the axis to rows', () => {
  const p = buildPivot(report, report.informationBlocks[0], {
    rows: ['concept', `dim:${AXIS}`],
    columns: ['period'],
    slicers: ['entity'],
    scale: 'auto',
    showAbstracts: true,
  })

  it('columns collapse back to periods only', () => {
    expect(p.columns.map((c) => c.period?.end)).toEqual(['2025-01-26', '2026-01-25'])
  })

  it('StockholdersEquity expands into per-member sub-rows', () => {
    const reRow = rowByKey(p, `${SE}␟${AXIS}=${members.re}`)
    expect(reRow).toBeDefined()
    expect(reRow?.depth).toBeGreaterThan(rowByKey(p, SE)?.depth ?? 0)
    const idx = p.columns.findIndex((c) => c.period?.end === '2025-01-26')
    expect(reRow?.cells[idx]?.value).toBe(68038000000)
  })
})
