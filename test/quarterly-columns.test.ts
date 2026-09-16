import { describe, expect, it } from 'vitest'
import type { ElementInfo, Fact, NormalizedReport, PeriodInfo, PivotTable } from '../src/model'
import { buildPivot } from '../src/pivot'

// A quarterly report puts two durations on the same end date: the quarter and
// the year to date. Keyed by end date alone they collapsed into one column that
// showed whichever fact was indexed last — a six-month figure under a header
// that read as the quarter. The columns must stay distinct, each cell must hold
// the fact of its own span, and a span header must say which is which.
//
// Halvorsen Instruments is a fictional filer.

const ABS = 'us-gaap:IncomeStatementAbstract'
const REV = 'us-gaap:Revenues'
const NI = 'us-gaap:NetIncomeLoss'
const CASH = 'us-gaap:CashAndCashEquivalentsAtCarryingValue'

function element(
  id: string,
  periodType: 'duration' | 'instant' | null,
  abstract = false
): ElementInfo {
  return {
    id,
    qname: id,
    label: id.split(':').pop() ?? id,
    balance: null,
    periodType,
    abstract,
    monetary: !abstract,
    numericKind: abstract ? undefined : 'monetary',
  }
}

function duration(id: string, start: string, end: string): PeriodInfo {
  return { id, type: 'duration', instant: null, startDate: start, endDate: end, end }
}

function instant(id: string, date: string): PeriodInfo {
  return { id, type: 'instant', instant: date, startDate: null, endDate: null, end: date }
}

let seq = 0
function fact(element: string, period: string, value: number): Fact {
  return {
    id: `f${seq++}`,
    element,
    period,
    unit: 'u:usd',
    entity: 'e:hvi',
    factSet: 'fs',
    value,
    decimals: '-3',
  }
}

const PERIODS = {
  q25: duration('q25', '2025-04-01', '2025-06-30'),
  h25: duration('h25', '2025-01-01', '2025-06-30'),
  q26: duration('q26', '2026-04-01', '2026-06-30'),
  h26: duration('h26', '2026-01-01', '2026-06-30'),
  i25: instant('i25', '2025-06-30'),
  i26: instant('i26', '2026-06-30'),
  fy24: duration('fy24', '2024-01-01', '2024-12-31'),
  fy25: duration('fy25', '2025-01-01', '2025-12-31'),
}

function report(facts: Fact[]): NormalizedReport {
  return {
    reportId: 'r',
    reportIri: null,
    entity: { id: 'e:hvi', name: 'Halvorsen Instruments Corp', legalName: null, country: null },
    informationBlocks: [
      {
        id: 's',
        blockType: 'income_statement',
        factSet: 'fs',
        label: 'Operations',
        structureId: 's',
      },
    ],
    structures: [
      {
        id: 's',
        blockType: 'income_statement',
        roleUri: null,
        structureName: 'Statements of Operations',
        order: 0,
      },
    ],
    facts,
    elements: {
      [ABS]: element(ABS, null, true),
      [REV]: element(REV, 'duration'),
      [NI]: element(NI, 'duration'),
      [CASH]: element(CASH, 'instant'),
    },
    periods: PERIODS,
    units: { 'u:usd': { id: 'u:usd', measure: 'iso4217:USD', label: 'USD', symbol: '$' } },
    calcAssociations: [],
    presAssociations: [
      { parent: ABS, child: REV, order: 1, role: null, structure: 's' },
      { parent: ABS, child: NI, order: 2, role: null, structure: 's' },
      { parent: ABS, child: CASH, order: 3, role: null, structure: 's' },
    ],
  }
}

function row(table: PivotTable, element: string) {
  const found = table.rows.find((r) => r.element.id === element && !r.header)
  if (!found) throw new Error(`no row for ${element}`)
  return found
}

function periodIds(table: PivotTable): string[] {
  return table.columns.map((c) => c.period?.id ?? '')
}

describe('buildPivot — a 10-Q reports two spans to one date', () => {
  seq = 0
  const table = buildPivot(
    report([
      fact(REV, 'q25', 210),
      fact(REV, 'h25', 420),
      fact(REV, 'q26', 250),
      fact(REV, 'h26', 500),
      fact(NI, 'q25', -19),
      fact(NI, 'h25', -40),
      fact(NI, 'q26', 13),
      fact(NI, 'h26', 32),
      fact(CASH, 'i25', 240),
      fact(CASH, 'i26', 250),
    ]),
    report([]).informationBlocks[0]
  )

  it('keeps the quarter and the year-to-date as separate columns, quarters first', () => {
    expect(periodIds(table)).toEqual(['q25', 'q26', 'h25', 'h26'])
  })

  it('puts each span’s own fact in its cell', () => {
    expect(row(table, REV).cells.map((c) => c.value)).toEqual([210, 250, 420, 500])
    expect(row(table, NI).cells.map((c) => c.value)).toEqual([-19, 13, -40, 32])
    expect(row(table, REV).cells.map((c) => c.fact?.period)).toEqual(['q25', 'q26', 'h25', 'h26'])
  })

  it('says which columns are the quarter and which the year to date', () => {
    expect(table.columnHeaders).toEqual([
      [
        { label: 'Three months ended', span: 2 },
        { label: 'Six months ended', span: 2 },
      ],
      [
        { label: 'Jun 30, 2025', span: 1 },
        { label: 'Jun 30, 2026', span: 1 },
        { label: 'Jun 30, 2025', span: 1 },
        { label: 'Jun 30, 2026', span: 1 },
      ],
    ])
  })

  it('shows a closing balance under every span that ends on its date', () => {
    expect(row(table, CASH).cells.map((c) => c.value)).toEqual([240, 250, 240, 250])
  })

  it('keys each column by its whole span', () => {
    expect(new Set(table.columns.map((c) => c.key)).size).toBe(4)
  })
})

describe('buildPivot — a flow reported year-to-date only', () => {
  seq = 0
  const table = buildPivot(
    report([
      fact(NI, 'h25', -40),
      fact(NI, 'h26', 32),
      fact(CASH, 'i25', 240),
      fact(CASH, 'i26', 250),
    ]),
    report([]).informationBlocks[0]
  )

  it('names the span even though no date is ambiguous', () => {
    expect(periodIds(table)).toEqual(['h25', 'h26'])
    expect(table.columnHeaders[0]).toEqual([{ label: 'Six months ended', span: 2 }])
  })
})

describe('buildPivot — an annual report is unchanged', () => {
  seq = 0
  const table = buildPivot(
    report([fact(REV, 'fy24', 800), fact(REV, 'fy25', 880)]),
    report([]).informationBlocks[0]
  )

  it('has date headers only, oldest first', () => {
    expect(periodIds(table)).toEqual(['fy24', 'fy25'])
    expect(table.columnHeaders).toEqual([
      [
        { label: 'Dec 31, 2024', span: 1 },
        { label: 'Dec 31, 2025', span: 1 },
      ],
    ])
  })
})
