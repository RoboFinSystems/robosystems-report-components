import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FactInspector } from '../src/components/FactInspector'
import { sha256Hex } from '../src/lineage'
import type { Lineage, NormalizedReport } from '../src/model'
import { buildPivots } from '../src/pivot'

// A figure summed from two entities' accounts, one of them the consolidation
// entity's elimination; one account reaches back before the described span.
const CASH = 'rs-gaap:CashAndCashEquivalentsAtCarryingValue'
const R = 'https://robosystems.ai/report/rpt_1'
const MEMBERS = ['li_1', 'li_2', 'li_3', 'li_6']
const HASH = `sha256:${sha256Hex(MEMBERS.join('\n'))}`

function lineage(): Lineage {
  return {
    contributions: {
      [`${R}/contribution/cash/ent_01/acct_cash`]: {
        id: `${R}/contribution/cash/ent_01/acct_cash`,
        fact: `${R}/fact/cash`,
        entity: `${R}/entity/ent_01`,
        account: `${R}/account/acct_cash`,
        amount: 75,
        frozenAt: '2025-01-05T12:00:00Z',
        windowStart: null,
        windowEnd: '2024-12-31',
        lineCount: 3,
        describedLineCount: 2,
        describedFrom: '2024-01-01',
        priorLineCount: 1,
        priorBalance: 100,
        members: [`${R}/line/li_1`, `${R}/line/li_2`, `${R}/line/li_3`],
      },
      [`${R}/contribution/cash/ent_02/acct_ic`]: {
        id: `${R}/contribution/cash/ent_02/acct_ic`,
        fact: `${R}/fact/cash`,
        entity: `${R}/entity/ent_02`,
        account: `${R}/account/acct_ic`,
        amount: -6,
        frozenAt: '2025-01-05T12:00:00Z',
        windowStart: null,
        windowEnd: '2024-12-31',
        lineCount: 1,
        describedLineCount: 1,
        describedFrom: null,
        priorLineCount: 0,
        priorBalance: null,
        members: [`${R}/line/li_6`],
      },
    },
    lines: {
      [`${R}/line/li_2`]: {
        id: `${R}/line/li_2`,
        entry: `${R}/entry/je_2`,
        account: `${R}/account/acct_cash`,
        entity: `${R}/entity/ent_01`,
        debit: null,
        credit: 25,
        lineOrder: 1,
        description: null,
        flowConcept: 'rs-gaap:PaymentsToSuppliers',
        dimensionMembers: [],
        event: `${R}/event/evt_2`,
      },
      [`${R}/line/li_3`]: {
        id: `${R}/line/li_3`,
        entry: `${R}/entry/je_3`,
        account: `${R}/account/acct_cash`,
        entity: `${R}/entity/ent_01`,
        debit: 5,
        credit: null,
        lineOrder: 1,
        description: 'Deposit keyed twice',
        flowConcept: null,
        dimensionMembers: [],
        event: null,
      },
      [`${R}/line/li_6`]: {
        id: `${R}/line/li_6`,
        entry: `${R}/entry/je_6`,
        account: `${R}/account/acct_ic`,
        entity: `${R}/entity/ent_02`,
        debit: 6,
        credit: null,
        lineOrder: 1,
        description: null,
        flowConcept: null,
        dimensionMembers: ['department=Roastery'],
        event: null,
      },
    },
    entries: {
      [`${R}/entry/je_2`]: {
        id: `${R}/entry/je_2`,
        entity: `${R}/entity/ent_01`,
        number: 'JE-2',
        postingDate: '2024-03-01',
        postedAt: null,
        type: 'standard',
        status: 'posted',
        recordedBy: 'manual_entry',
        memo: 'March rent',
        transaction: `${R}/transaction/txn_2`,
        event: `${R}/event/evt_2`,
        reversalOf: null,
        reversedBy: null,
        adjustmentKind: null,
        adjustsEntity: null,
      },
      [`${R}/entry/je_3`]: {
        id: `${R}/entry/je_3`,
        entity: `${R}/entity/ent_01`,
        number: 'JE-3',
        postingDate: '2024-05-01',
        postedAt: null,
        type: 'standard',
        status: 'reversed',
        recordedBy: 'manual_entry',
        memo: null,
        transaction: null,
        event: null,
        reversalOf: null,
        reversedBy: `${R}/entry/je_4`,
        adjustmentKind: null,
        adjustsEntity: null,
      },
      [`${R}/entry/je_4`]: {
        id: `${R}/entry/je_4`,
        entity: `${R}/entity/ent_01`,
        number: 'JE-4',
        postingDate: '2024-05-02',
        postedAt: null,
        type: 'reversing',
        status: 'posted',
        recordedBy: 'manual_entry',
        memo: null,
        transaction: null,
        event: null,
        reversalOf: `${R}/entry/je_3`,
        reversedBy: null,
        adjustmentKind: null,
        adjustsEntity: null,
      },
      [`${R}/entry/je_6`]: {
        id: `${R}/entry/je_6`,
        entity: `${R}/entity/ent_02`,
        number: 'JE-6',
        postingDate: '2024-12-31',
        postedAt: null,
        type: 'adjusting',
        status: 'posted',
        recordedBy: 'system_computed',
        memo: null,
        transaction: null,
        event: null,
        reversalOf: null,
        reversedBy: null,
        adjustmentKind: 'elimination_intercompany',
        adjustsEntity: `${R}/entity/ent_03`,
      },
    },
    transactions: {
      [`${R}/transaction/txn_2`]: {
        id: `${R}/transaction/txn_2`,
        entity: `${R}/entity/ent_01`,
        type: 'payment',
        category: 'rent',
        amount: 25,
        currency: 'USD',
        date: '2024-03-01',
        dueDate: null,
        merchantName: 'Ballard Industrial Properties',
        referenceNumber: 'INV-9',
        description: null,
        source: 'manual',
        event: `${R}/event/evt_2`,
      },
    },
    events: {
      [`${R}/event/evt_2`]: {
        id: `${R}/event/evt_2`,
        entity: `${R}/entity/ent_01`,
        type: 'bill_paid',
        category: 'purchase',
        eventClass: 'economic',
        action: 'transfer',
        status: 'fulfilled',
        occurredAt: '2024-03-01T00:00:00Z',
        dueDate: null,
        amount: -25,
        currency: 'USD',
        source: 'manual',
        description: null,
        agent: `${R}/agent/agt_1`,
        obligatedBy: null,
        discharges: null,
        replaces: null,
      },
    },
    agents: {
      [`${R}/agent/agt_1`]: {
        id: `${R}/agent/agt_1`,
        name: 'Ballard Industrial Properties',
        type: 'vendor',
      },
    },
    accounts: {
      [`${R}/account/acct_cash`]: {
        id: `${R}/account/acct_cash`,
        name: 'Operating Checking',
        code: '1000',
        balance: 'debit',
        periodType: 'instant',
      },
      [`${R}/account/acct_ic`]: {
        id: `${R}/account/acct_ic`,
        name: 'Intercompany Revenue — Eliminated',
        code: '4900',
        balance: 'credit',
        periodType: 'duration',
      },
    },
    entities: {
      [`${R}/entity/ent_01`]: {
        id: `${R}/entity/ent_01`,
        name: 'Driftline',
        role: 'operating',
        parent: null,
      },
      [`${R}/entity/ent_02`]: {
        id: `${R}/entity/ent_02`,
        name: 'Consolidation Adjustments',
        role: 'consolidation',
        parent: `${R}/entity/ent_01`,
      },
      [`${R}/entity/ent_03`]: {
        id: `${R}/entity/ent_03`,
        name: 'Harbor Café',
        role: 'operating',
        parent: `${R}/entity/ent_01`,
      },
    },
  }
}

function report(hash: string | null = HASH, withLineage = true): NormalizedReport {
  return {
    reportId: 'rpt_1',
    reportIri: R,
    entity: { id: `${R}/entity/ent_01`, name: 'Driftline', legalName: null, country: null },
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
        id: `${R}/fact/cash`,
        element: CASH,
        period: 'p',
        unit: 'u',
        entity: `${R}/entity/ent_01`,
        factSet: 'fs',
        value: 69,
        decimals: '2',
        provenance: {
          kind: 'pivot',
          source: null,
          contentHash: hash,
          attributedTo: 'posted ledger',
        },
        derivedFrom: [
          `${R}/contribution/cash/ent_01/acct_cash`,
          `${R}/contribution/cash/ent_02/acct_ic`,
        ],
      },
    ],
    elements: {
      [CASH]: {
        id: CASH,
        qname: CASH,
        label: 'Cash',
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
        instant: '2024-12-31',
        startDate: null,
        endDate: null,
        end: '2024-12-31',
      },
    },
    units: { u: { id: 'u', measure: 'iso4217:USD', label: 'USD', symbol: '$' } },
    calcAssociations: [],
    presAssociations: [{ parent: 'root', child: CASH, order: 1, role: null, structure: 's' }],
    ...(withLineage ? { lineage: lineage() } : {}),
  }
}

function mount(r: NormalizedReport) {
  const table = buildPivots(r)[0]!
  const row = table.rows.find((x) => x.element.id === CASH)!
  return render(<FactInspector report={r} table={table} row={row} columnIndex={0} />)
}

describe('LineageWalk — from a figure to the books', () => {
  it('shows each account, its share, the prior balance and the hash check', () => {
    mount(report())
    expect(screen.getByTestId('fact-lineage')).toBeTruthy()
    expect(screen.getByText('Where it comes from')).toBeTruthy()
    expect(screen.getByText(/✓ hash verified · 4 lines/)).toBeTruthy()
    expect(screen.getAllByTestId('lineage-contribution')).toHaveLength(2)
    expect(screen.getByText('1000 Operating Checking')).toBeTruthy()
    expect(screen.getByText('4900 Intercompany Revenue — Eliminated')).toBeTruthy()
    expect(screen.getByText('$75.00')).toBeTruthy()
    expect(screen.getByText('$(6.00)')).toBeTruthy()
    expect(screen.getByText(/3 lines, 2 shown from Jan 1, 2024/)).toBeTruthy()
    expect(screen.getByText(/Balance at Dec 31, 2023 · 1 earlier line/)).toBeTruthy()
    expect(screen.getByText('$100.00')).toBeTruthy()
  })

  it('names the entities when the figure spans more than one, and the elimination', () => {
    mount(report())
    expect(screen.getByText(/Consolidation Adjustments \(consolidation entity\)/)).toBeTruthy()
    expect(screen.getByText('Intercompany elimination')).toBeTruthy()
    expect(screen.getByText('reversed')).toBeTruthy()
  })

  it('lists the described lines in posting order, with the counterparty', () => {
    mount(report())
    const rows = screen.getAllByTestId('lineage-line')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.textContent).toContain('Mar 1, 2024')
    expect(rows[0]!.textContent).toContain('March rent')
    expect(rows[0]!.textContent).toContain('Ballard Industrial Properties')
    expect(rows[0]!.textContent).toContain('$25.00')
    expect(rows[1]!.textContent).toContain('May 1, 2024')
    expect(rows[1]!.textContent).toContain('Deposit keyed twice')
  })

  it('opens a line onto its entry, event, counterparty and transaction', () => {
    mount(report())
    const rows = screen.getAllByTestId('lineage-line')
    fireEvent.click(rows[0]!)
    const detail = screen.getByTestId('lineage-line-detail')
    expect(detail.textContent).toContain('JE-2')
    expect(detail.textContent).toContain('Manual entry')
    expect(detail.textContent).toContain('bill paid')
    expect(detail.textContent).toContain('Ballard Industrial Properties (vendor)')
    expect(detail.textContent).toContain('INV-9')
    expect(detail.textContent).toContain('rs-gaap:PaymentsToSuppliers')
    fireEvent.click(rows[1]!)
    const details = screen.getAllByTestId('lineage-line-detail')
    expect(details[1]!.textContent).toContain('Reversed by')
    expect(details[1]!.textContent).toContain('JE-4')
    fireEvent.click(rows[2]!)
    expect(screen.getAllByTestId('lineage-line-detail')[2]!.textContent).toContain(
      'Intercompany elimination · adjusts Harbor Café'
    )
    fireEvent.click(rows[0]!)
    expect(screen.getAllByTestId('lineage-line-detail')).toHaveLength(2)
  })

  it('says when the file’s members do not reproduce the report’s hash', () => {
    mount(report('sha256:deadbeef'))
    expect(screen.getByText(/⚠ hash differs/)).toBeTruthy()
  })

  it('renders nothing for a file without lineage', () => {
    mount(report(HASH, false))
    expect(screen.queryByTestId('fact-lineage')).toBeNull()
    expect(screen.getByTestId('fact-provenance')).toBeTruthy()
  })
})
