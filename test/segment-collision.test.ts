import { describe, expect, it } from 'vitest'
import type { NormalizedReport } from '../src/model'
import { buildPivots } from '../src/pivot'

// A concept reported both consolidated AND broken down by a segment axis that
// the FACE statement's presentation does NOT declare (MARIMED revenue by product
// on the income statement). The segment facts are out of scope; they must not
// collapse onto — and overwrite — the consolidated cell (the classic dimensional
// last-write-wins collision).
const REV = 'us-gaap:Revenues'
const ABS = 'us-gaap:IncomeStatementAbstract'
const AXIS = 'us-gaap:StatementBusinessSegmentsAxis'
const SEG = 'co:ProductMember'

function report(): NormalizedReport {
  return {
    reportId: 'r',
    reportIri: null,
    entity: { id: 'e', name: 'Co', legalName: null, country: null },
    informationBlocks: [
      { id: 's', blockType: '', factSet: 'fs', label: 'Operations', structureId: 's' },
    ],
    structures: [{ id: 's', blockType: '', roleUri: null, structureName: 'Operations', order: 0 }],
    facts: [
      {
        id: 'consolidated',
        element: REV,
        period: 'p',
        unit: 'u',
        entity: 'e',
        factSet: 'fs',
        value: 100,
        decimals: '-6',
      },
      {
        id: 'segment',
        element: REV,
        period: 'p',
        unit: 'u',
        entity: 'e',
        factSet: 'fs',
        value: 60,
        decimals: '-6',
        dimensions: [
          {
            axis: AXIS,
            member: SEG,
            axisLabel: 'Segments',
            memberLabel: 'Product',
            explicit: true,
          },
        ],
      },
    ],
    elements: {
      [ABS]: {
        id: ABS,
        qname: ABS,
        label: 'Income Statement',
        balance: null,
        periodType: null,
        abstract: true,
        monetary: false,
      },
      [REV]: {
        id: REV,
        qname: REV,
        label: 'Revenues',
        balance: 'credit',
        periodType: 'duration',
        abstract: false,
        monetary: true,
        numericKind: 'monetary',
      },
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
    // The segment AXIS is deliberately NOT a presentation node here.
    presAssociations: [{ parent: ABS, child: REV, order: 1, role: null, structure: 's' }],
  }
}

describe('face statement with an out-of-scope segment breakdown', () => {
  it('shows the consolidated total, not a segment value', () => {
    const table = buildPivots(report())[0]
    const row = table.rows.find((r) => r.element.id === REV)
    expect(row?.cells[0]?.value).toBe(100)
  })
})
