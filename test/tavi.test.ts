import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { PivotTable } from '../src'
import { detectReportFormat, parseReportDocument } from '../src/adapters/detect'
import { isTaviDocument, parseTavi } from '../src/adapters/tavi'
import { buildPivots, reportSections } from '../src/pivot'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = () =>
  readFileSync(join(here, 'fixtures', 'mmm-fy2024-statements.tavi.json'), 'utf8')

function rowCellAt(p: PivotTable, element: string, end: string): number | null {
  const row = p.rows.find((r) => r.element.id === element && r.members.length === 0)
  const idx = p.columns.findIndex((c) => c.period?.end === end)
  return row && idx >= 0 ? (row.cells[idx]?.value ?? null) : null
}

// A hand-built model in the current emitter's form: dateTime periods with an
// exclusive end, a statement and a disclosure under two groups, a calc network,
// one concept presented in both sections, an explicit and a typed dimension.
const RPT = 'https://robosystems.ai/tavi/report/0000000001-25-000001'
const DOC = {
  documentInfo: {
    documentType: 'https://xbrl.org/PWD/2026-09-01/compiled',
    namespaces: {
      rpt: RPT,
      'us-gaap': 'http://fasb.org/us-gaap/2024',
      dei: 'http://xbrl.sec.gov/dei/2024',
    },
  },
  xbrlModel: {
    name: 'rpt:Report',
    modelType: 'xbrl:report',
    properties: [{ property: 'xbrl:reportFilingDate', value: '2025-02-05' }],
    entities: [{ name: 'rpt:cik-0000000001' }],
    units: [
      { name: 'iso4217:USD', dataType: 'xbrlr:monetary' },
      { name: 'xbrla:shares', dataType: 'xbrla:sharesType' },
      {
        name: 'rpt:unit-3',
        dataType: 'xbrlr:perShare',
        compositeUnitRepresentation: ['iso4217:USD/xbrla:shares'],
      },
    ],
    concepts: [
      {
        name: 'us-gaap:Assets',
        dataType: 'xbrlr:monetary',
        periodType: 'instant',
        properties: [{ property: 'xbrla:balance', value: 'debit' }],
      },
      {
        name: 'us-gaap:Liabilities',
        dataType: 'xbrlr:monetary',
        periodType: 'instant',
        properties: [{ property: 'xbrla:balance', value: 'credit' }],
      },
      {
        name: 'us-gaap:Revenues',
        dataType: 'xbrlr:monetary',
        periodType: 'duration',
        properties: [{ property: 'xbrla:balance', value: 'credit' }],
      },
      { name: 'us-gaap:EarningsPerShareBasic', dataType: 'xbrlr:perShare', periodType: 'duration' },
      { name: 'dei:EntityCommonStockSharesOutstanding', periodType: 'instant' },
      {
        name: 'us-gaap:RevenueRecognitionPolicyTextBlock',
        dataType: 'xbrlr:textBlock',
        periodType: 'duration',
      },
      { name: 'dei:EntityRegistrantName', dataType: 'xs:normalizedString', periodType: 'duration' },
      { name: 'dei:EntityNumberOfEmployees', dataType: 'xs:integer', periodType: 'duration' },
    ],
    headings: [{ name: 'us-gaap:StatementLineItems' }, { name: 'us-gaap:AssetsAbstract' }],
    dimensions: [
      { name: 'us-gaap:StatementBusinessSegmentsAxis', domainClass: 'us-gaap:SegmentDomain' },
      { name: 'us-gaap:DebtInstrumentAxis' },
    ],
    domainClasses: [{ name: 'us-gaap:SegmentDomain' }],
    members: [{ name: 'acme:WidgetsMember', domainClasses: ['us-gaap:SegmentDomain'] }],
    labels: [
      { forObject: 'us-gaap:Assets', labelType: 'xbrl:label', value: 'Assets', language: 'en-US' },
      {
        forObject: 'us-gaap:Assets',
        labelType: 'xbrl:totalLabel',
        value: 'Total assets',
        language: 'en-US',
      },
      {
        forObject: 'us-gaap:Liabilities',
        labelType: 'xbrl:label',
        value: 'Liabilities',
        language: 'en-US',
      },
      {
        forObject: 'us-gaap:Liabilities',
        labelType: 'xbrl:negatedLabel',
        value: 'Less: liabilities',
        language: 'en-US',
      },
      {
        forObject: 'us-gaap:Revenues',
        labelType: 'xbrl:label',
        value: 'Revenues',
        language: 'en-US',
      },
      {
        forObject: 'us-gaap:AssetsAbstract',
        labelType: 'xbrl:label',
        value: 'Assets [Abstract]',
        language: 'en-US',
      },
      {
        forObject: 'us-gaap:StatementBusinessSegmentsAxis',
        labelType: 'xbrl:label',
        value: 'Segments [Axis]',
        language: 'en-US',
      },
      {
        forObject: 'acme:WidgetsMember',
        labelType: 'xbrl:label',
        value: 'Widgets [Member]',
        language: 'en-US',
      },
      {
        forObject: 'rpt:group-0',
        labelType: 'xbrl:label',
        value: '9952153 - Statement - Consolidated Balance Sheets',
        language: 'en',
      },
      {
        forObject: 'rpt:group-1',
        labelType: 'xbrl:label',
        value: '9954471 - Disclosure - Revenue (Details)',
        language: 'en',
      },
    ],
    networks: [
      {
        name: 'rpt:network-presentation-0',
        relationshipTypeName: 'xbrl:parent-child',
        relationships: [
          { source: 'xbrl:rootSource', target: 'us-gaap:StatementLineItems', order: 1 },
          { source: 'us-gaap:StatementLineItems', target: 'us-gaap:AssetsAbstract', order: 1 },
          {
            source: 'us-gaap:AssetsAbstract',
            target: 'us-gaap:Assets',
            order: 1,
            properties: [{ property: 'xbrl:preferredLabel', value: 'xbrl:totalLabel' }],
          },
          {
            source: 'us-gaap:StatementLineItems',
            target: 'us-gaap:Liabilities',
            order: 2,
            properties: [{ property: 'xbrl:preferredLabel', value: 'xbrl:negatedLabel' }],
          },
        ],
        roots: ['us-gaap:StatementLineItems'],
      },
      {
        name: 'rpt:network-calculation-1',
        relationshipTypeName: 'xbrl:summation-item',
        relationships: [
          { source: 'xbrl:rootSource', target: 'us-gaap:Assets', order: 1 },
          {
            source: 'us-gaap:Assets',
            target: 'us-gaap:Liabilities',
            order: 1,
            properties: [{ property: 'xbrl:weight', value: -1 }],
          },
        ],
      },
      {
        name: 'rpt:network-presentation-2',
        relationshipTypeName: 'xbrl:parent-child',
        relationships: [
          { source: 'xbrl:rootSource', target: 'us-gaap:Revenues', order: 1 },
          { source: 'us-gaap:Revenues', target: 'us-gaap:Assets', order: 1 },
          { source: 'us-gaap:Revenues', target: 'us-gaap:StatementBusinessSegmentsAxis', order: 2 },
          {
            source: 'us-gaap:StatementBusinessSegmentsAxis',
            target: 'acme:WidgetsMember',
            order: 1,
          },
        ],
      },
    ],
    groups: [
      { name: 'rpt:group-0', groupURI: 'http://acme.example/role/BalanceSheet' },
      { name: 'rpt:group-1', groupURI: 'http://acme.example/role/RevenueDetails' },
    ],
    groupContents: [
      { groupName: 'rpt:group-0', forObject: 'rpt:network-presentation-0' },
      { groupName: 'rpt:group-0', forObject: 'rpt:network-calculation-1' },
      { groupName: 'rpt:group-1', forObject: 'rpt:network-presentation-2' },
    ],
    facts: [
      {
        name: 'rpt:f-1',
        factDimensions: {
          'xbrl:concept': 'us-gaap:Assets',
          'xbrl:period': '2025-01-01T00:00:00',
          'xbrl:entity': 'rpt:cik-0000000001',
          'xbrl:unit': 'iso4217:USD',
        },
        factValues: [{ value: 1000, decimals: -6 }],
      },
      {
        name: 'rpt:f-2',
        factDimensions: {
          'xbrl:concept': 'us-gaap:Assets',
          'xbrl:period': '2024-01-01T00:00:00',
          'xbrl:entity': 'rpt:cik-0000000001',
          'xbrl:unit': 'iso4217:USD',
        },
        factValues: [{ value: 900, decimals: -6 }],
      },
      {
        name: 'rpt:f-3',
        factDimensions: {
          'xbrl:concept': 'us-gaap:Liabilities',
          'xbrl:period': '2025-01-01T00:00:00',
          'xbrl:entity': 'rpt:cik-0000000001',
          'xbrl:unit': 'iso4217:USD',
        },
        factValues: [{ value: 400, decimals: -6 }],
      },
      {
        name: 'rpt:f-4',
        factDimensions: {
          'xbrl:concept': 'us-gaap:Revenues',
          'xbrl:period': '2024-01-01T00:00:00/2025-01-01T00:00:00',
          'xbrl:entity': 'rpt:cik-0000000001',
          'xbrl:unit': 'iso4217:USD',
        },
        factValues: [{ value: 5000, decimals: -6 }],
      },
      {
        name: 'rpt:f-5',
        factDimensions: {
          'xbrl:concept': 'us-gaap:Revenues',
          'xbrl:period': '2024-01-01T00:00:00/2025-01-01T00:00:00',
          'xbrl:entity': 'rpt:cik-0000000001',
          'xbrl:unit': 'iso4217:USD',
          'us-gaap:StatementBusinessSegmentsAxis': 'acme:WidgetsMember',
        },
        factValues: [{ value: 3000, decimals: -6 }],
      },
      {
        name: 'rpt:f-6',
        factDimensions: {
          'xbrl:concept': 'us-gaap:Revenues',
          'xbrl:period': '2024-01-01/2024-12-31',
          'xbrl:entity': 'rpt:cik-0000000001',
          'xbrl:unit': 'iso4217:USD',
          'us-gaap:DebtInstrumentAxis': 'Note 2029',
        },
        factValues: [{ value: 7, decimals: 0 }],
      },
      {
        name: 'rpt:f-7',
        factDimensions: {
          'xbrl:concept': 'us-gaap:EarningsPerShareBasic',
          'xbrl:period': '2024-01-01T00:00:00/2025-01-01T00:00:00',
          'xbrl:entity': 'rpt:cik-0000000001',
          'xbrl:unit': 'rpt:unit-3',
        },
        factValues: [{ value: 4.93, decimals: 2 }],
      },
      {
        name: 'rpt:f-8',
        factDimensions: {
          'xbrl:concept': 'dei:EntityCommonStockSharesOutstanding',
          'xbrl:period': '2025-02-01T00:00:00',
          'xbrl:entity': 'rpt:cik-0000000001',
          'xbrl:unit': 'xbrla:shares',
        },
        factValues: [{ value: 550000000 }],
      },
      {
        name: 'rpt:f-9',
        factDimensions: {
          'xbrl:concept': 'us-gaap:RevenueRecognitionPolicyTextBlock',
          'xbrl:period': '2024-01-01T00:00:00/2025-01-01T00:00:00',
          'xbrl:entity': 'rpt:cik-0000000001',
        },
        factValues: [{ value: '<p>Revenue is recognized…</p>' }],
      },
      {
        name: 'rpt:f-10',
        factDimensions: {
          'xbrl:concept': 'dei:EntityRegistrantName',
          'xbrl:period': '2024-01-01T00:00:00/2025-01-01T00:00:00',
          'xbrl:entity': 'rpt:cik-0000000001',
        },
        factValues: [{ value: 'ACME CORP' }],
      },
      {
        name: 'rpt:f-11',
        factDimensions: {
          'xbrl:concept': 'dei:EntityNumberOfEmployees',
          'xbrl:period': '2024-01-01T00:00:00/2025-01-01T00:00:00',
          'xbrl:entity': 'rpt:cik-0000000001',
        },
        factValues: [{ value: '61000' }],
      },
    ],
  },
}

describe('tavi adapter — the model', () => {
  const r = parseTavi(DOC)

  it('names the report and the entity', () => {
    expect(r.reportIri).toBe(RPT)
    expect(r.reportId).toBe('0000000001-25-000001')
    expect(r.entity).toMatchObject({ id: 'rpt:cik-0000000001', name: 'ACME CORP' })
  })

  it('names the entity from its label when there is no registrant-name fact', () => {
    const doc = structuredClone(DOC)
    doc.xbrlModel.entities = [{ name: 'entity:ent_01' }]
    doc.xbrlModel.labels = [
      ...doc.xbrlModel.labels,
      {
        forObject: 'entity:ent_01',
        labelType: 'xbrl:label',
        value: 'Lemonade Stand LLC',
        language: 'en',
      },
    ]
    doc.xbrlModel.facts = doc.xbrlModel.facts.filter(
      (f) => f.factDimensions['xbrl:concept'] !== 'dei:EntityRegistrantName'
    )
    expect(parseTavi(doc).entity).toMatchObject({
      id: 'entity:ent_01',
      name: 'Lemonade Stand LLC',
      legalName: 'Lemonade Stand LLC',
    })
    // The registrant-name fact still wins when a filing carries one.
    expect(parseTavi(DOC).entity?.name).toBe('ACME CORP')
  })

  it('types concepts from their datatype, balance and — for shares — their unit', () => {
    expect(r.elements['us-gaap:Assets']).toMatchObject({
      label: 'Assets',
      balance: 'debit',
      periodType: 'instant',
      monetary: true,
      numericKind: 'monetary',
      abstract: false,
    })
    expect(r.elements['us-gaap:EarningsPerShareBasic']).toMatchObject({
      numericKind: 'perShare',
      monetary: false,
    })
    expect(r.elements['dei:EntityCommonStockSharesOutstanding']).toMatchObject({
      numericKind: 'shares',
      itemType: 'shares',
    })
    expect(r.elements['us-gaap:RevenueRecognitionPolicyTextBlock']).toMatchObject({
      itemType: 'textBlock',
    })
    expect(r.elements['dei:EntityNumberOfEmployees']).toMatchObject({ numericKind: 'integer' })
  })

  it('carries headings, axes and members as abstract elements with role tags stripped', () => {
    expect(r.elements['us-gaap:AssetsAbstract']).toMatchObject({ abstract: true, label: 'Assets' })
    expect(r.elements['us-gaap:StatementBusinessSegmentsAxis']).toMatchObject({
      abstract: true,
      label: 'Segments',
    })
    expect(r.elements['acme:WidgetsMember']).toMatchObject({ abstract: true, label: 'Widgets' })
  })

  it('normalizes exclusive-end dateTimes and inclusive dates to the same human dates', () => {
    expect(r.periods['2025-01-01T00:00:00']).toMatchObject({
      type: 'instant',
      instant: '2024-12-31',
      end: '2024-12-31',
    })
    expect(r.periods['2024-01-01T00:00:00/2025-01-01T00:00:00']).toMatchObject({
      type: 'duration',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      end: '2024-12-31',
    })
    expect(r.periods['2024-01-01/2024-12-31']).toMatchObject({
      type: 'duration',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    })
  })

  it('reads units, composites included', () => {
    expect(r.units['iso4217:USD']).toMatchObject({ measure: 'iso4217:USD', label: 'USD' })
    expect(r.units['rpt:unit-3']).toMatchObject({
      measure: 'iso4217:USD/xbrla:shares',
      label: 'USD/shares',
    })
  })

  it('reads numeric, string-numeric and text values', () => {
    const byId = Object.fromEntries(r.facts.map((f) => [f.id, f]))
    expect(byId['rpt:f-1']).toMatchObject({
      value: 1000,
      decimals: '-6',
      unit: 'iso4217:USD',
      period: '2025-01-01T00:00:00',
    })
    expect(byId['rpt:f-11']).toMatchObject({ value: 61000 })
    expect(byId['rpt:f-9']).toMatchObject({
      value: null,
      textValue: '<p>Revenue is recognized…</p>',
    })
    expect(byId['rpt:f-10']).toMatchObject({ value: null, textValue: 'ACME CORP' })
  })

  it('reads explicit and typed dimensions with their labels', () => {
    const byId = Object.fromEntries(r.facts.map((f) => [f.id, f]))
    expect(byId['rpt:f-5'].dimensions).toEqual([
      {
        axis: 'us-gaap:StatementBusinessSegmentsAxis',
        member: 'acme:WidgetsMember',
        axisLabel: 'Segments',
        memberLabel: 'Widgets',
        explicit: true,
        typedValue: null,
      },
    ])
    expect(byId['rpt:f-6'].dimensions).toEqual([
      {
        axis: 'us-gaap:DebtInstrumentAxis',
        member: null,
        axisLabel: 'Debt Instrument Axis',
        memberLabel: 'Note 2029',
        explicit: false,
        typedValue: 'Note 2029',
      },
    ])
    expect(byId['rpt:f-1'].dimensions).toBeUndefined()
  })

  it('makes a section of each presentation network, titled and ordered by its group definition', () => {
    expect(r.structures.map((s) => [s.id, s.structureName, s.kind, s.order, s.roleUri])).toEqual([
      [
        'rpt:network-presentation-0',
        'Consolidated Balance Sheets',
        'Statement',
        9952153,
        'http://acme.example/role/BalanceSheet',
      ],
      [
        'rpt:network-presentation-2',
        'Revenue (Details)',
        'Disclosure',
        9954471,
        'http://acme.example/role/RevenueDetails',
      ],
    ])
    expect(r.informationBlocks.map((ib) => [ib.id, ib.factSet, ib.structureId, ib.label])).toEqual([
      [
        'rpt:network-presentation-0',
        'rpt:network-presentation-0',
        'rpt:network-presentation-0',
        'Consolidated Balance Sheets',
      ],
      [
        'rpt:network-presentation-2',
        'rpt:network-presentation-2',
        'rpt:network-presentation-2',
        'Revenue (Details)',
      ],
    ])
  })

  it('puts a fact in every section that presents its concept', () => {
    const assets = r.facts.find((f) => f.id === 'rpt:f-1')
    expect(assets?.factSets).toEqual(['rpt:network-presentation-0', 'rpt:network-presentation-2'])
    expect(assets?.factSet).toBe('rpt:network-presentation-0')
    const eps = r.facts.find((f) => f.id === 'rpt:f-7')
    expect(eps?.factSet).toBeNull()
  })

  it('reads presentation arcs with their preferred labels, and calculation arcs with their weights', () => {
    const total = r.presAssociations.find(
      (a) => a.child === 'us-gaap:Assets' && a.structure === 'rpt:network-presentation-0'
    )
    expect(total).toMatchObject({
      parent: 'us-gaap:AssetsAbstract',
      order: 1,
      preferredLabel: 'Total assets',
      preferredLabelRole: 'xbrl:totalLabel',
      role: 'http://acme.example/role/BalanceSheet',
    })
    const negated = r.presAssociations.find((a) => a.child === 'us-gaap:Liabilities')
    expect(negated).toMatchObject({
      preferredLabel: 'Less: liabilities',
      preferredLabelRole: 'xbrl:negatedLabel',
    })
    expect(r.presAssociations.some((a) => a.parent === 'xbrl:rootSource')).toBe(false)
    expect(r.calcAssociations).toEqual([
      {
        parent: 'us-gaap:Assets',
        child: 'us-gaap:Liabilities',
        weight: -1,
        order: 1,
        role: 'http://acme.example/role/BalanceSheet',
        structure: 'rpt:network-presentation-0',
      },
    ])
  })

  it('renders through the pivot like a holon does', () => {
    const [balance] = buildPivots(r).filter((p) => p.kind === 'Statement')
    expect(balance.title).toBe('Consolidated Balance Sheets')
    expect(balance.columns.map((c) => c.period?.end)).toEqual(['2023-12-31', '2024-12-31'])
    expect(rowCellAt(balance, 'us-gaap:Assets', '2024-12-31')).toBe(1000)
    expect(rowCellAt(balance, 'us-gaap:Assets', '2023-12-31')).toBe(900)
    expect(rowCellAt(balance, 'us-gaap:Liabilities', '2024-12-31')).toBe(400)
  })
})

describe('tavi adapter — a real filing', () => {
  it('parses the 3M FY2024 statements and pivots the balance sheet', () => {
    const r = parseTavi(fixture())
    expect(r.entity?.name).toBe('3M COMPANY')
    expect(r.reportId).toBe('0000066740-25-000006')
    expect(reportSections(r).map((s) => [s.title, s.kind])).toEqual([
      ['Consolidated Statement of Income (Loss)', 'Statement'],
      ['Consolidated Balance Sheet', 'Statement'],
    ])
    const balance = buildPivots(r).find((p) => p.title === 'Consolidated Balance Sheet')
    expect(balance).toBeDefined()
    expect(rowCellAt(balance!, 'us-gaap:Assets', '2024-12-31')).toBe(39868000000)
    expect(rowCellAt(balance!, 'us-gaap:Assets', '2023-12-31')).toBe(50580000000)
    expect(r.calcAssociations.length).toBeGreaterThan(0)
  })
})

describe('report format detection', () => {
  it('tells a Tavi model from a holon and from anything else', () => {
    expect(isTaviDocument(DOC)).toBe(true)
    expect(detectReportFormat(DOC)).toBe('tavi')
    expect(detectReportFormat({ '@context': {}, '@graph': [] })).toBe('holon')
    expect(detectReportFormat({ facts: [] })).toBeNull()
    expect(detectReportFormat('text')).toBeNull()
  })

  it('parses either through one door', async () => {
    const tavi = await parseReportDocument(fixture())
    expect(tavi.format).toBe('tavi')
    expect(tavi.report.entity?.name).toBe('3M COMPANY')
    await expect(parseReportDocument('{"facts":[]}')).rejects.toThrow('Not a report document')
  })
})
