import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FactInspector } from '../src/components/FactInspector'
import type { NormalizedReport } from '../src/model'
import { buildPivots } from '../src/pivot'

// A published ledger report says how each figure was made; a filing says
// nothing. The inspector shows the un-entitled projection — origin, asserter,
// hash — and nothing when the fact carries none.
const CASH = 'rs-gaap:CashAndCashEquivalentsAtCarryingValue'
const AR = 'rs-gaap:ReceivablesNetCurrent'
const HASH = 'sha256:680be1460dd6a1c2b3d4e5f60718293a4b5c6d7e8f9012345678901234567890'

function report(): NormalizedReport {
  const concept = (id: string, label: string) => ({
    id,
    qname: id,
    label,
    balance: 'debit' as const,
    periodType: 'instant' as const,
    abstract: false,
    monetary: true,
    numericKind: 'monetary' as const,
  })
  return {
    reportId: 'r',
    reportIri: null,
    entity: { id: 'e', name: 'Driftline', legalName: null, country: null },
    informationBlocks: [
      {
        id: 's',
        blockType: 'balance_sheet',
        factSet: 'fs',
        label: 'Balance Sheet',
        structureId: 's',
      },
    ],
    structures: [
      {
        id: 's',
        blockType: 'balance_sheet',
        roleUri: null,
        structureName: 'Balance Sheet',
        order: 0,
      },
    ],
    facts: [
      {
        id: 'cash',
        element: CASH,
        period: 'p',
        unit: 'u',
        entity: 'e',
        factSet: 'fs',
        value: 97152.59,
        decimals: '2',
        provenance: {
          kind: 'pivot',
          source: null,
          contentHash: HASH,
          attributedTo: 'posted ledger',
        },
      },
      {
        id: 'ar',
        element: AR,
        period: 'p',
        unit: 'u',
        entity: 'e',
        factSet: 'fs',
        value: 100,
        decimals: '2',
      },
    ],
    elements: {
      [CASH]: concept(CASH, 'Cash and Cash Equivalents, at Carrying Value'),
      [AR]: concept(AR, 'Receivables, Net, Current'),
    },
    periods: {
      p: {
        id: 'p',
        type: 'instant',
        instant: '2026-08-31',
        startDate: null,
        endDate: null,
        end: '2026-08-31',
      },
    },
    units: { u: { id: 'u', measure: 'iso4217:USD', label: 'USD', symbol: '$' } },
    calcAssociations: [],
    presAssociations: [
      { parent: 'root', child: CASH, order: 1, role: null, structure: 's' },
      { parent: 'root', child: AR, order: 2, role: null, structure: 's' },
    ],
  }
}

describe('FactInspector — how a figure was made', () => {
  it('shows the origin, the asserter and the hash of a fact that carries them', () => {
    const table = buildPivots(report())[0]
    const row = table.rows.find((r) => r.element.id === CASH)!
    render(<FactInspector report={report()} table={table} row={row} columnIndex={0} />)
    expect(screen.getByTestId('fact-provenance')).toBeTruthy()
    expect(screen.getByText('How it was made')).toBeTruthy()
    expect(screen.getByText("Summed from the ledger's accounts")).toBeTruthy()
    expect(screen.getByText('posted ledger')).toBeTruthy()
    expect(screen.getByText('sha256:680be1460dd6…')).toBeTruthy()
    expect(screen.getByTitle(HASH)).toBeTruthy()
  })

  it('shows nothing for a fact that says nothing', () => {
    const table = buildPivots(report())[0]
    const row = table.rows.find((r) => r.element.id === AR)!
    render(<FactInspector report={report()} table={table} row={row} columnIndex={0} />)
    expect(screen.queryByTestId('fact-provenance')).toBeNull()
    expect(screen.queryByText('How it was made')).toBeNull()
  })
})
