import { describe, expect, it } from 'vitest'
import type { NormalizedReport } from '../src/model'
import { buildPivots } from '../src/pivot'

// A summary concept (Total Assets, Net Income) is presented in more than one
// structure, so it carries several factSets. The renderer must select a section's
// facts by factSet MEMBERSHIP, not equality with the single `factSet` — otherwise
// the fact drops out of every section but the first, which is exactly why the
// high-level totals went missing. Here Total Assets' first factSet is a note
// ('fsNotes'); the balance sheet is the second ('fsBS').
const ASSETS = 'us-gaap:Assets'
const ABS = 'us-gaap:StatementOfFinancialPositionAbstract'

function report(): NormalizedReport {
  return {
    reportId: 'r',
    reportIri: null,
    entity: { id: 'e', name: 'Co', legalName: null, country: null },
    informationBlocks: [
      { id: 'bs', blockType: '', factSet: 'fsBS', label: 'Balance Sheet', structureId: 'bs' },
    ],
    structures: [
      { id: 'bs', blockType: '', roleUri: null, structureName: 'Balance Sheet', order: 0 },
    ],
    facts: [
      {
        id: 'assets',
        element: ASSETS,
        period: 'p',
        unit: 'u',
        entity: 'e',
        // First factSet is a note; the balance sheet is the second. The old
        // single-factSet equality (`factSet === ib.factSet`) would drop this.
        factSet: 'fsNotes',
        factSets: ['fsNotes', 'fsBS'],
        value: 900,
        decimals: '-3',
      },
    ],
    elements: {
      [ABS]: {
        id: ABS,
        qname: ABS,
        label: 'Financial Position',
        balance: null,
        periodType: null,
        abstract: true,
        monetary: false,
      },
      [ASSETS]: {
        id: ASSETS,
        qname: ASSETS,
        label: 'Total Assets',
        balance: 'debit',
        periodType: 'instant',
        abstract: false,
        monetary: true,
        numericKind: 'monetary',
      },
    },
    periods: {
      p: {
        id: 'p',
        type: 'instant',
        instant: '2025-12-31',
        startDate: null,
        endDate: null,
        end: '2025-12-31',
      },
    },
    units: { u: { id: 'u', measure: 'iso4217:USD', label: 'USD', symbol: '$' } },
    calcAssociations: [],
    presAssociations: [{ parent: ABS, child: ASSETS, order: 1, role: null, structure: 'bs' }],
  }
}

describe('a summary concept belonging to multiple factSets', () => {
  it('renders in a section matching any of its factSets, not just the first', () => {
    const table = buildPivots(report())[0]
    const row = table.rows.find((r) => r.element.id === ASSETS)
    expect(row?.cells[0]?.value).toBe(900)
  })
})
