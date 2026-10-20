import { describe, expect, it } from 'vitest'
import { pivotToCsv } from '../src/csv'
import type { ElementInfo, PivotRow, PivotTable } from '../src/model'

// Harbor Lane Outfitters is a fictional filer.

function element(qname: string, label: string): ElementInfo {
  return {
    id: qname,
    qname,
    label,
    balance: null,
    periodType: 'instant',
    abstract: false,
    monetary: true,
  }
}

function row(over: Partial<PivotRow> & { element: ElementInfo }): PivotRow {
  return {
    key: over.element.qname,
    depth: 0,
    header: false,
    isSubtotal: false,
    members: [],
    cells: [],
    ...over,
  }
}

const cell = (value: number | null, textValue: string | null = null) => ({
  value,
  fact: null,
  textValue,
})

function table(rows: PivotRow[]): PivotTable {
  return {
    rows,
    columns: [
      { key: 'c1', period: null, members: [], label: 'Dec 31, 2025' },
      { key: 'c2', period: null, members: [], label: 'Dec 31, 2026' },
    ],
    columnHeaders: [
      [
        { label: 'Dec 31, 2025', span: 1 },
        { label: 'Dec 31, 2026', span: 1 },
      ],
    ],
    scale: { factor: 1_000_000, label: 'millions', caption: 'In millions' },
  } as unknown as PivotTable
}

describe('pivotToCsv', () => {
  it('writes each line at its depth, full precision, with negated labels flipped', () => {
    const csv = pivotToCsv(
      table([
        row({ element: element('us-gaap:AssetsAbstract', 'Assets'), header: true }),
        row({
          element: element('us-gaap:Cash', 'Cash'),
          depth: 1,
          cells: [cell(1_250_000.5), cell(2_000_000)],
        }),
        row({
          element: element('us-gaap:LongTermDebtCurrent', 'Current portion'),
          label: 'Less current portion',
          depth: 1,
          negated: true,
          cells: [cell(999), cell(null)],
        }),
      ])
    ).split('\n')

    expect(csv).toEqual([
      'Line,Concept,"Dec 31, 2025","Dec 31, 2026"',
      'Assets,us-gaap:AssetsAbstract',
      '  Cash,us-gaap:Cash,1250000.5,2000000',
      '  Less current portion,us-gaap:LongTermDebtCurrent,-999,',
    ])
  })

  it('names a member row by its members, and keeps text as text', () => {
    const csv = pivotToCsv(
      table([
        row({
          element: element('us-gaap:Revenues', 'Revenues'),
          members: [
            {
              axis: 'srt:ProductOrServiceAxis',
              axisLabel: 'Product',
              member: 'hlo:TentsMember',
              memberLabel: 'Tents',
            },
          ] as PivotRow['members'],
          cells: [cell(10), cell(12)],
        }),
        row({
          element: element('dei:EntityRegistrantName', 'Registrant'),
          cells: [cell(null, '=Harbor Lane'), cell(null, 'Harbor Lane')],
        }),
      ])
    ).split('\n')

    expect(csv[1]).toBe('Tents,us-gaap:Revenues,10,12')
    expect(csv[2]).toBe("Registrant,dei:EntityRegistrantName,'=Harbor Lane,Harbor Lane")
  })

  it('heads a nested column with every level above it', () => {
    const t = table([row({ element: element('us-gaap:Cash', 'Cash'), cells: [cell(1), cell(2)] })])
    t.columnHeaders = [
      [{ label: 'FY2026', span: 2 }],
      [
        { label: 'Tents', span: 1 },
        { label: 'Packs', span: 1 },
      ],
    ]
    t.columns = [
      { key: 'a', period: null, members: [], label: 'Tents' },
      { key: 'b', period: null, members: [], label: 'Packs' },
    ]

    expect(pivotToCsv(t).split('\n')[0]).toBe('Line,Concept,FY2026 · Tents,FY2026 · Packs')
  })
})
