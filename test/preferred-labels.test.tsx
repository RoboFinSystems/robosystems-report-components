import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatementTable } from '../src'
import type { NormalizedReport } from '../src/model'
import { buildPivots } from '../src/pivot'

// The NVIDIA Debt-schedule shape: the presentation network's preferred labels
// name the rows ("Less short-term portion", not "Long-Term Debt, Current
// Maturities") and `negated*` roles flip the DISPLAYED sign — the fact is
// tagged +999 but the as-filed table shows (999) so the schedule visually
// foots. The fact value itself must stay untouched.
const ABS = 'us-gaap:DebtDisclosureAbstract'
const LTD = 'us-gaap:LongTermDebt'
const LTDC = 'us-gaap:LongTermDebtCurrent'
const TOTAL_ROLE = 'http://www.xbrl.org/2003/role/totalLabel'
const NEGATED_ROLE = 'http://www.xbrl.org/2009/role/negatedTerseLabel'

const concept = (id: string, label: string) => ({
  id,
  qname: id,
  label,
  balance: 'credit' as const,
  periodType: 'instant' as const,
  abstract: false,
  monetary: true,
  numericKind: 'monetary' as const,
})

function report(): NormalizedReport {
  return {
    reportId: 'r',
    reportIri: null,
    entity: { id: 'e', name: 'Co', legalName: null, country: null },
    informationBlocks: [{ id: 's', blockType: '', factSet: 'fs', label: 'Debt', structureId: 's' }],
    structures: [{ id: 's', blockType: '', roleUri: null, structureName: 'Debt', order: 0 }],
    facts: [
      {
        id: 'ltd',
        element: LTD,
        period: 'p',
        unit: 'u',
        entity: 'e',
        factSet: 'fs',
        value: 8468,
        decimals: '0',
      },
      {
        id: 'ltdc',
        element: LTDC,
        period: 'p',
        unit: 'u',
        entity: 'e',
        factSet: 'fs',
        value: 999,
        decimals: '0',
      },
    ],
    elements: {
      [ABS]: {
        id: ABS,
        qname: ABS,
        label: 'Debt Disclosure',
        balance: null,
        periodType: null,
        abstract: true,
        monetary: false,
      },
      [LTD]: concept(LTD, 'Long-Term Debt'),
      [LTDC]: concept(LTDC, 'Long-Term Debt, Current Maturities'),
    },
    periods: {
      p: {
        id: 'p',
        type: 'instant',
        instant: '2026-01-25',
        startDate: null,
        endDate: null,
        end: '2026-01-25',
      },
    },
    units: { u: { id: 'u', measure: 'iso4217:USD', label: 'USD', symbol: '$' } },
    calcAssociations: [],
    presAssociations: [
      {
        parent: ABS,
        child: LTD,
        order: 1,
        role: null,
        structure: 's',
        preferredLabel: 'Net carrying amount',
        preferredLabelRole: TOTAL_ROLE,
      },
      {
        parent: ABS,
        child: LTDC,
        order: 2,
        role: null,
        structure: 's',
        preferredLabel: 'Less short-term portion',
        preferredLabelRole: NEGATED_ROLE,
      },
    ],
  }
}

describe('presentation-arc preferred labels', () => {
  it('labels rows from the arc and marks negated roles', () => {
    const table = buildPivots(report())[0]
    const ltd = table.rows.find((r) => r.element.id === LTD)
    const ltdc = table.rows.find((r) => r.element.id === LTDC)
    expect(ltd?.label).toBe('Net carrying amount')
    expect(ltd?.negated).toBeUndefined()
    expect(ltdc?.label).toBe('Less short-term portion')
    expect(ltdc?.negated).toBe(true)
  })

  it('renders the preferred label and the display-negated value, keeping the fact raw', () => {
    const table = buildPivots(report())[0]
    render(<StatementTable table={table} />)
    expect(screen.getByText('Less short-term portion')).toBeTruthy()
    expect(screen.getByText('$(999.00)')).toBeTruthy()
    expect(screen.getByText('$8,468.00')).toBeTruthy()
    // Presentation only — the underlying fact keeps its tagged sign.
    const ltdc = table.rows.find((r) => r.element.id === LTDC)
    expect(ltdc?.cells[0]?.fact?.value).toBe(999)
  })
})
