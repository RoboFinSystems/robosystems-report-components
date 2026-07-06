import { describe, expect, it } from 'vitest'
import type {
  DimensionQualifier,
  ElementInfo,
  Fact,
  NormalizedReport,
  PeriodInfo,
  PivotTable,
} from '../src/model'
import { buildPivot, defaultPivotConfig, pivotDimensionsOn } from '../src/pivot'

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

// Value at a period column for a row identified by key (dims-as-rows mode).
function rowCellAt(p: PivotTable, rowKey: string, end: string): number | null {
  const row = rowByKey(p, rowKey)
  const idx = p.columns.findIndex((c) => c.period?.end === end)
  return row && idx >= 0 ? (row.cells[idx]?.value ?? null) : null
}

describe('defaultPivotConfig — derives roles from the section aspects', () => {
  const config = defaultPivotConfig(report, report.informationBlocks[0])
  it('puts concept + the multi-member axis on rows, period on columns', () => {
    expect(config.rows).toEqual(['concept', `dim:${AXIS}`])
    expect(config.columns).toEqual(['period'])
  })
  it('makes the reporting entity a slicer', () => {
    expect(config.slicers).toContain('entity')
  })
})

describe('buildPivot — the equity hypercube (default: dimensions as rows)', () => {
  const p = buildPivot(report, report.informationBlocks[0])

  it('renders the entity as a slicer bar', () => {
    const entity = p.slicers.find((s) => s.aspect === 'entity')
    expect(entity?.valueLabel).toBe('NVIDIA CORP')
  })

  it('keeps columns as the two period-ends only', () => {
    expect(p.columns.map((c) => c.period?.end)).toEqual(['2025-01-26', '2026-01-25'])
  })

  it('expands each concept into indented member sub-rows above its total', () => {
    expect(rowCellAt(p, SE, '2025-01-26')).toBe(79327000000)
    const reRow = rowByKey(p, `${SE}␟${AXIS}=${members.re}`)
    expect(reRow?.depth).toBeGreaterThan(rowByKey(p, SE)?.depth ?? 0)
    // The member sub-row label is just the member (the total row names the concept).
    expect(reRow?.members.map((m) => m.memberLabel)).toEqual(['Retained Earnings'])
    // Accounting order: members list first, the concept total sums below them.
    const totalIdx = p.rows.findIndex((r) => r.key === SE)
    const memberIdx = p.rows.findIndex((r) => r.key === `${SE}␟${AXIS}=${members.re}`)
    expect(totalIdx).toBeGreaterThan(memberIdx)
  })

  it('keeps each dimensional fact in its own row — no collision', () => {
    // The consolidated total and every component coexist at 2025-01-26.
    expect(rowCellAt(p, SE, '2025-01-26')).toBe(79327000000)
    expect(rowCellAt(p, `${SE}␟${AXIS}=${members.common}`, '2025-01-26')).toBe(24000000)
    expect(rowCellAt(p, `${SE}␟${AXIS}=${members.apic}`, '2025-01-26')).toBe(11237000000)
    expect(rowCellAt(p, `${SE}␟${AXIS}=${members.re}`, '2025-01-26')).toBe(68038000000)
    expect(rowCellAt(p, `${SE}␟${AXIS}=${members.aoci}`, '2025-01-26')).toBe(28000000)
  })

  it('routes net income into a retained-earnings sub-row only', () => {
    expect(rowCellAt(p, NI, '2026-01-25')).toBe(120067000000)
    expect(rowCellAt(p, `${NI}␟${AXIS}=${members.re}`, '2026-01-25')).toBe(120067000000)
    // Net income has no common-stock breakdown, so no such row exists.
    expect(rowByKey(p, `${NI}␟${AXIS}=${members.common}`)).toBeUndefined()
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
})

describe('buildPivot — toggle: dimensions as columns (the matrix)', () => {
  const p = buildPivot(
    report,
    report.informationBlocks[0],
    pivotDimensionsOn(defaultPivotConfig(report, report.informationBlocks[0]), 'columns')
  )

  it('lays members out as columns, nested under each period (+ a Total)', () => {
    // 2 periods × (4 members + Total) = 10 leaf columns.
    expect(p.columns).toHaveLength(10)
    expect(p.columnHeaders[0].map((h) => h.span)).toEqual([5, 5])
    expect(p.columnHeaders[1].slice(0, 5).map((h) => h.label)).toEqual([
      'Common Stock',
      'Additional Paid-in Capital',
      'Retained Earnings',
      'AOCI',
      'Total',
    ])
  })

  it('keeps each dimensional fact in its own cell — no collision', () => {
    expect(cell(p, SE, '2025-01-26', 'Common Stock')).toBe(24000000)
    expect(cell(p, SE, '2025-01-26', 'Retained Earnings')).toBe(68038000000)
    expect(cell(p, SE, '2025-01-26', 'Total')).toBe(79327000000)
  })

  it('does not rescale the EPS row itself (its fact stays 4.93)', () => {
    const eps = rowByKey(p, EPS)
    const idx = colIndex(p, '2026-01-25', 'Total')
    expect(eps?.cells[idx]?.value).toBe(4.93)
  })
})

describe('buildPivot — a statement owns only its hypercube axes', () => {
  // The income statement's factset also holds segment-revenue facts (tagged to
  // the same role), but its presentation network declares no axis. Those facts
  // must not turn the statement into a segment × geography grid.
  const SEG = 'us-gaap:StatementBusinessSegmentsAxis'
  const REV = 'us-gaap:Revenues'
  const ISABS = 'us-gaap:IncomeStatementAbstract'
  const seg = (member: string): DimensionQualifier => ({
    axis: SEG,
    member,
    axisLabel: 'Segments',
    memberLabel: member.split(':').pop() ?? member,
    explicit: true,
  })
  const f = (value: number, dimensions?: DimensionQualifier[]): Fact => ({
    id: `f${fid++}`,
    element: REV,
    period: 'p',
    unit: 'u',
    entity: 'e',
    factSet: 'fs',
    value,
    decimals: '-6',
    dimensions,
  })
  const model: NormalizedReport = {
    reportId: 'r',
    reportIri: null,
    entity: { id: 'e', name: 'Co', legalName: null, country: null },
    informationBlocks: [
      {
        id: 'is',
        blockType: 'income_statement',
        factSet: 'fs',
        label: 'Income',
        structureId: 'is',
      },
    ],
    structures: [
      { id: 'is', blockType: 'income_statement', roleUri: null, structureName: 'Income', order: 0 },
    ],
    facts: [f(100), f(60, [seg('us-gaap:ComputeMember')]), f(40, [seg('us-gaap:GraphicsMember')])],
    elements: {
      [REV]: el(REV, { monetary: true, periodType: 'duration', numericKind: 'monetary' }),
      [ISABS]: el(ISABS, { abstract: true }),
    },
    periods: {
      p: {
        id: 'p',
        type: 'duration',
        instant: null,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        end: '2025-12-31',
      },
    },
    units: { u: { id: 'u', measure: 'iso4217:USD', label: 'USD', symbol: '$' } },
    calcAssociations: [],
    // Presentation declares only the line item — no segment axis.
    presAssociations: [{ parent: ISABS, child: REV, order: 1, role: null, structure: 'is' }],
  }

  it('default config does not pivot the undeclared segment axis', () => {
    const cfg = defaultPivotConfig(model, model.informationBlocks[0])
    expect(cfg.columns).toEqual(['period'])
    expect(cfg.slicers).not.toContain(`dim:${SEG}`)
  })

  it('renders the consolidated value only, excluding the segment breakdown', () => {
    const p = buildPivot(model, model.informationBlocks[0])
    expect(p.columns).toHaveLength(1)
    expect(p.rows.every((r) => r.members.length === 0)).toBe(true)
    const rev = p.rows.find((r) => r.element.id === REV && r.members.length === 0)
    expect(rev?.cells[0]?.value).toBe(100)
  })
})

describe('buildPivot — incomplete period columns are dropped', () => {
  // A balance-sheet-shaped section: two dense reporting instants (2024/2023
  // year-ends) plus incidental context dates — a prior-year opening balance and a
  // lone transaction date — which are not real reporting periods. The opening
  // date clears the absolute floor (3 facts) but not the density bar, so it must
  // still be dropped, matching how the SEC renderer keeps only the reporting
  // periods.
  const elements: Record<string, ElementInfo> = {}
  const facts: Fact[] = []
  const mk = (concept: string, periodId: string): void => {
    if (!elements[concept]) {
      elements[concept] = el(concept, {
        monetary: true,
        periodType: 'instant',
        numericKind: 'monetary',
      })
    }
    facts.push({
      id: `bf${fid++}`,
      element: concept,
      period: periodId,
      unit: 'u',
      entity: 'e',
      factSet: 'fs',
      value: 1000,
      decimals: '-3',
    })
  }
  for (let i = 0; i < 20; i++) {
    mk(`x:Line${i}`, 'cur')
    mk(`x:Line${i}`, 'prior')
  }
  for (let i = 0; i < 3; i++) mk(`x:Line${i}`, 'opening') // 3 facts (< 20% of 20)
  mk('x:Line0', 'stub') // 1 fact
  const inst = (id: string, d: string): PeriodInfo => ({
    id,
    type: 'instant',
    instant: d,
    startDate: null,
    endDate: null,
    end: d,
  })
  const model: NormalizedReport = {
    reportId: 'r',
    reportIri: null,
    entity: { id: 'e', name: 'Co', legalName: null, country: null },
    informationBlocks: [
      { id: 'bs', blockType: 'balance_sheet', factSet: 'fs', label: 'BS', structureId: 'bs' },
    ],
    structures: [
      { id: 'bs', blockType: 'balance_sheet', roleUri: null, structureName: 'BS', order: 0 },
    ],
    facts,
    elements,
    periods: {
      cur: inst('cur', '2024-12-31'),
      prior: inst('prior', '2023-12-31'),
      opening: inst('opening', '2022-12-31'),
      stub: inst('stub', '2023-03-09'),
    },
    units: { u: { id: 'u', measure: 'iso4217:USD', label: 'USD', symbol: '$' } },
    calcAssociations: [],
    presAssociations: [],
  }

  it('keeps the two dense reporting instants, drops the opening + transaction dates', () => {
    const p = buildPivot(model, model.informationBlocks[0])
    expect(p.columns.map((c) => c.period?.end)).toEqual(['2023-12-31', '2024-12-31'])
  })
})

describe('buildPivot — a member-only concept gets a heading row (dims as rows)', () => {
  // A detail disclosure: a concept reported only per-member, with no consolidated
  // total. Its member rows must not be orphaned "member-only" labels — a valueless
  // concept heading supplies the concept name above them.
  const AXIS2 = 'us-gaap:DebtInstrumentAxis'
  const DEBT = 'us-gaap:DebtInstrumentFaceAmount'
  const LINES = 'us-gaap:DebtInstrumentLineItems'
  const CREM = 'us-gaap:CremLoanMember'
  const NOTE = 'us-gaap:PromissoryNoteMember'
  const seg = (m: string): DimensionQualifier => ({
    axis: AXIS2,
    member: m,
    axisLabel: 'Debt Instrument',
    memberLabel: m.split(':').pop() ?? m,
    explicit: true,
  })
  const model: NormalizedReport = {
    reportId: 'r',
    reportIri: null,
    entity: { id: 'e', name: 'Co', legalName: null, country: null },
    informationBlocks: [{ id: 'd', blockType: '', factSet: 'fs', label: 'Debt', structureId: 'd' }],
    structures: [{ id: 'd', blockType: '', roleUri: null, structureName: 'Debt', order: 0 }],
    facts: [
      {
        id: 'd1',
        element: DEBT,
        period: 'p',
        unit: 'u',
        entity: 'e',
        factSet: 'fs',
        value: 58700,
        decimals: '-3',
        dimensions: [seg(CREM)],
      },
      {
        id: 'd2',
        element: DEBT,
        period: 'p',
        unit: 'u',
        entity: 'e',
        factSet: 'fs',
        value: 8000,
        decimals: '-3',
        dimensions: [seg(NOTE)],
      },
    ],
    elements: {
      [LINES]: el(LINES, { abstract: true }),
      [DEBT]: el(DEBT, { monetary: true, periodType: 'instant', numericKind: 'monetary' }),
      [AXIS2]: el(AXIS2, { abstract: true }),
      [CREM]: el(CREM, { abstract: true }),
      [NOTE]: el(NOTE, { abstract: true }),
    },
    periods: {
      p: {
        id: 'p',
        type: 'instant',
        instant: '2024-12-31',
        startDate: null,
        endDate: null,
        end: '2024-12-31',
      },
    },
    units: { u: { id: 'u', measure: 'iso4217:USD', label: 'USD', symbol: '$' } },
    calcAssociations: [],
    presAssociations: [
      { parent: LINES, child: AXIS2, order: 0, role: null, structure: 'd' },
      { parent: LINES, child: DEBT, order: 1, role: null, structure: 'd' },
      { parent: AXIS2, child: CREM, order: 1, role: null, structure: 'd' },
      { parent: AXIS2, child: NOTE, order: 2, role: null, structure: 'd' },
    ],
  }

  it('emits a valueless concept heading above the member sub-rows', () => {
    const p = buildPivot(model, model.informationBlocks[0])
    const heading = rowByKey(p, DEBT)
    expect(heading).toBeDefined()
    expect(heading?.members).toEqual([])
    expect(heading?.cells.every((c) => c.value === null && c.fact === null)).toBe(true)
    const crem = rowByKey(p, `${DEBT}␟${AXIS2}=${CREM}`)
    expect(crem?.cells[0]?.value).toBe(58700)
    expect(crem?.depth).toBeGreaterThan(heading?.depth ?? 0)
  })
})

describe('buildPivot — a Details disclosure scopes to its declared members', () => {
  // Sibling "DEBT, X (Details)" networks share one hypercube factset; each
  // presentation declares only its own members. A fact for a member this section
  // does not declare (a sibling disclosure's row) must be excluded.
  const AXIS = 'us-gaap:DebtInstrumentAxis'
  const RATE = 'us-gaap:DebtInstrumentInterestRateStatedPercentage'
  const LINES = 'us-gaap:DebtInstrumentLineItems'
  const DUQUOIN = 'mrmd:DuQuoinMetropolisMortgageMember'
  const SOUTHPORTE = 'mrmd:SouthPorteBankMortgageMember'
  const CREM = 'mrmd:CREMLoanMember' // belongs to a sibling network — not declared here
  const inst = (m: string): DimensionQualifier => ({
    axis: AXIS,
    member: m,
    axisLabel: 'Debt Instrument',
    memberLabel: m.split(':').pop() ?? m,
    explicit: true,
  })
  const rate = (m: string, v: number): Fact => ({
    id: `r${fid++}`,
    element: RATE,
    period: 'p',
    unit: 'u',
    entity: 'e',
    factSet: 'fs',
    value: v,
    decimals: 'INF',
    dimensions: [inst(m)],
  })
  const model: NormalizedReport = {
    reportId: 'r',
    reportIri: null,
    entity: { id: 'e', name: 'MARIMED INC.', legalName: null, country: null },
    informationBlocks: [{ id: 'd', blockType: '', factSet: 'fs', label: 'Debt', structureId: 'd' }],
    structures: [{ id: 'd', blockType: '', roleUri: null, structureName: 'Debt', order: 0 }],
    facts: [rate(DUQUOIN, 0.1125), rate(SOUTHPORTE, 0.095), rate(CREM, 0.0843)],
    elements: {
      [LINES]: el(LINES, { abstract: true }),
      [RATE]: el(RATE, { numericKind: 'percent', periodType: 'instant' }),
      [AXIS]: el(AXIS, { abstract: true }),
      [DUQUOIN]: el(DUQUOIN, { abstract: true }),
      [SOUTHPORTE]: el(SOUTHPORTE, { abstract: true }),
      [CREM]: el(CREM, { abstract: true }),
    },
    periods: {
      p: {
        id: 'p',
        type: 'instant',
        instant: '2026-03-31',
        startDate: null,
        endDate: null,
        end: '2026-03-31',
      },
    },
    units: { u: { id: 'u', measure: 'xbrli:pure', label: 'pure', symbol: null } },
    calcAssociations: [],
    // The presentation declares DuQuoin + SouthPorte, but NOT the CREM sibling.
    presAssociations: [
      { parent: LINES, child: AXIS, order: 0, role: null, structure: 'd' },
      { parent: LINES, child: RATE, order: 1, role: null, structure: 'd' },
      { parent: AXIS, child: DUQUOIN, order: 1, role: null, structure: 'd' },
      { parent: AXIS, child: SOUTHPORTE, order: 2, role: null, structure: 'd' },
    ],
  }

  it('excludes facts for members the presentation does not declare', () => {
    const p = buildPivot(model, model.informationBlocks[0])
    expect(rowByKey(p, `${RATE}␟${AXIS}=${DUQUOIN}`)?.cells[0]?.value).toBe(0.1125)
    expect(rowByKey(p, `${RATE}␟${AXIS}=${SOUTHPORTE}`)?.cells[0]?.value).toBe(0.095)
    // The CREM sibling's row is gone entirely.
    expect(rowByKey(p, `${RATE}␟${AXIS}=${CREM}`)).toBeUndefined()
    expect(p.rows.some((r) => r.members.some((m) => m.member === CREM))).toBe(false)
  })
})
