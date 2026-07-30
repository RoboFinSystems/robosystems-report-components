import { describe, expect, it } from 'vitest'
import type { Fact, NormalizedReport } from '../src/model'
import { buildPivots } from '../src/pivot'

// The equity roll-forward shape: the SAME concept appears under two
// presentation arcs — beginning balance (periodStartLabel, top of the network)
// and ending balance (periodEndLabel, bottom) — and each binds a different
// instant inside the duration column: the opening instant is dated the day
// before the duration starts (XBRL/SEC convention), the closing instant shares
// the duration's end date. Standalone opening-instant columns are suppressed —
// their data renders as the beginning-balance row.
const ABS = 'us-gaap:StatementOfStockholdersEquityAbstract'
const SE = 'us-gaap:StockholdersEquity'
const NI = 'us-gaap:NetIncomeLoss'
const START_ROLE = 'http://www.xbrl.org/2003/role/periodStartLabel'
const END_ROLE = 'http://www.xbrl.org/2003/role/periodEndLabel'

const fact = (id: string, element: string, period: string, value: number): Fact => ({
  id,
  element,
  period,
  unit: 'u',
  entity: 'e',
  factSet: 'fs',
  value,
  decimals: '0',
})

function report(): NormalizedReport {
  return {
    reportId: 'r',
    reportIri: null,
    entity: { id: 'e', name: 'Co', legalName: null, country: null },
    informationBlocks: [
      { id: 's', blockType: '', factSet: 'fs', label: 'Equity', structureId: 's' },
    ],
    structures: [{ id: 's', blockType: '', roleUri: null, structureName: 'Equity', order: 0 }],
    facts: [
      // FY2026: 2025-01-27 → 2026-01-25; opening instant 2025-01-26.
      fact('se-open', SE, 'i-open', 100),
      fact('se-close', SE, 'i-close', 150),
      fact('ni', NI, 'd-fy', 50),
    ],
    elements: {
      [ABS]: {
        id: ABS,
        qname: ABS,
        label: 'Statement of Stockholders Equity',
        balance: null,
        periodType: null,
        abstract: true,
        monetary: false,
      },
      [SE]: {
        id: SE,
        qname: SE,
        label: 'Stockholders Equity',
        balance: 'credit',
        periodType: 'instant',
        abstract: false,
        monetary: true,
        numericKind: 'monetary',
      },
      [NI]: {
        id: NI,
        qname: NI,
        label: 'Net Income (Loss)',
        balance: 'credit',
        periodType: 'duration',
        abstract: false,
        monetary: true,
        numericKind: 'monetary',
      },
    },
    periods: {
      'i-open': {
        id: 'i-open',
        type: 'instant',
        instant: '2025-01-26',
        startDate: null,
        endDate: null,
        end: '2025-01-26',
      },
      'i-close': {
        id: 'i-close',
        type: 'instant',
        instant: '2026-01-25',
        startDate: null,
        endDate: null,
        end: '2026-01-25',
      },
      'd-fy': {
        id: 'd-fy',
        type: 'duration',
        instant: null,
        startDate: '2025-01-27',
        endDate: '2026-01-25',
        end: '2026-01-25',
      },
    },
    units: { u: { id: 'u', measure: 'iso4217:USD', label: 'USD', symbol: '$' } },
    calcAssociations: [],
    presAssociations: [
      {
        parent: ABS,
        child: SE,
        order: 1,
        role: null,
        structure: 's',
        preferredLabel: 'Beginning balances',
        preferredLabelRole: START_ROLE,
      },
      { parent: ABS, child: NI, order: 2, role: null, structure: 's' },
      {
        parent: ABS,
        child: SE,
        order: 3,
        role: null,
        structure: 's',
        preferredLabel: 'Ending balances',
        preferredLabelRole: END_ROLE,
      },
    ],
  }
}

describe('roll-forward preferred-label bindings', () => {
  it('renders beginning and ending balance rows for the same concept, in arc order', () => {
    const table = buildPivots(report())[0]
    const se = table.rows.filter((r) => r.element.id === SE)
    expect(se.map((r) => r.label)).toEqual(['Beginning balances', 'Ending balances'])
    const labels = table.rows.filter((r) => !r.header).map((r) => r.label ?? r.element.label)
    expect(labels).toEqual(['Beginning balances', 'Net Income (Loss)', 'Ending balances'])
  })

  it('binds the opening instant (start − 1 day) into the duration column', () => {
    const table = buildPivots(report())[0]
    expect(table.columns).toHaveLength(1)
    expect(table.columns[0].period?.end).toBe('2026-01-25')
    const [beginning, ending] = table.rows.filter((r) => r.element.id === SE)
    expect(beginning.cells[0]?.value).toBe(100)
    expect(beginning.cells[0]?.fact?.id).toBe('se-open')
    expect(ending.cells[0]?.value).toBe(150)
    expect(ending.cells[0]?.fact?.id).toBe('se-close')
  })

  it('suppresses the standalone opening-instant column', () => {
    const table = buildPivots(report())[0]
    expect(table.columns.map((c) => c.period?.end)).not.toContain('2025-01-26')
  })

  it('keeps the roll-forward rows keyed distinctly', () => {
    const table = buildPivots(report())[0]
    const keys = table.rows.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
