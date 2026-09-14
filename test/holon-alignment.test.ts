import { describe, expect, it } from 'vitest'
import { parseJsonld } from '../src/adapters/jsonld'
import { qname } from '../src/constants'
import { buildPivots } from '../src/pivot'
import { footCheck } from '../src/project'

// The four places a RoboLedger holon and the Tavi projection of the SAME report
// disagreed, each measured on the five demo reports in robosystems/examples
// before it was fixed. A Tavi model carries QNames as strings and its group
// labels pre-parsed, so it was right by construction and the holon route was
// the one to bring into line.
const RS = 'https://robosystems.ai/vocab/'
const SKOS = 'http://www.w3.org/2004/02/skos/core#'
const LINK = 'http://www.xbrl.org/2003/linkbase#'
const XLINK = 'http://www.w3.org/1999/xlink#'
const TENANT = 'https://robosystems.ai/taxonomy/driftline/'
const RSGAAP = 'https://robosystems.ai/taxonomy/rs-gaap/v1/'

describe('qname: a tenant extension namespace', () => {
  it('compacts to the tenant prefix', () => {
    // The prefix table cannot list these — one namespace per tenant, minted
    // with the tenant — so before the generic rule this fell through to the
    // bare local name while Tavi read `driftline:InventoryRawMaterials`.
    expect(qname(`${TENANT}InventoryRawMaterials`)).toBe('driftline:InventoryRawMaterials')
    expect(qname('https://robosystems.ai/taxonomy/cadence/SubscriptionRevenue')).toBe(
      'cadence:SubscriptionRevenue'
    )
  })

  it('leaves the framework namespaces to the table', () => {
    expect(qname(`${RSGAAP}Assets`)).toBe('rs-gaap:Assets')
    expect(qname('https://robosystems.ai/taxonomy/rs-gaap/disclosures/v1/Inventory')).toBe(
      'disclosures:Inventory'
    )
    expect(qname(`${RS}Fact`)).toBe('rs:Fact')
  })

  it('does not invent a prefix for a deeper or shorter path', () => {
    // Three segments under /taxonomy/ is a versioned framework the table owns,
    // not a tenant; one segment names no concept at all.
    expect(qname('https://robosystems.ai/taxonomy/other/v2/Thing')).toBe('Thing')
    expect(qname('https://robosystems.ai/taxonomy/driftline/')).toBe('')
  })
})

describe('footCheck: a child counted once', () => {
  // A producer that emits the same calculation arc twice on one structure made
  // every tenant disclosure foot to exactly 2x its reported total
  // (robosystems #1395). Fixed there, but a renderer should not be able to
  // double a subtotal because its input repeated an arc.
  const duplicatedArcs = async () =>
    parseJsonld({
      '@graph': [
        {
          '@id': 'http://ex/ib1',
          '@type': `${RS}InformationBlock`,
          [`${RS}structure`]: { '@id': 'http://ex/st1' },
          [`${RS}factSet`]: { '@id': 'http://ex/fs1' },
          [`${SKOS}prefLabel`]: '0101 - Disclosure - Inventory Components',
        },
        {
          '@id': 'http://ex/st1',
          '@type': `${RS}Structure`,
          [`${RS}structureName`]: '0101 - Disclosure - Inventory Components',
          [`${RS}hasAssociation`]: [{ '@id': 'http://ex/pres1' }],
        },
        {
          '@id': 'http://ex/pres1',
          '@type': `${RS}Association`,
          [`${RS}associationType`]: 'presentation',
          [`${XLINK}from`]: { '@id': `${RSGAAP}InventoryNet` },
          [`${XLINK}to`]: { '@id': `${TENANT}InventoryRawMaterials` },
          [`${LINK}order`]: 1,
        },
        // The same arc twice, as the bundle emitted it.
        ...[0, 1].map((i) => ({
          '@id': `http://ex/calc${i}`,
          '@type': `${RS}Association`,
          [`${RS}associationType`]: 'calculation',
          [`${XLINK}from`]: { '@id': `${RSGAAP}InventoryNet` },
          [`${XLINK}to`]: { '@id': `${TENANT}InventoryRawMaterials` },
          [`${LINK}order`]: 1,
          [`${LINK}weight`]: 1,
        })),
        {
          '@id': `${RSGAAP}InventoryNet`,
          '@type': `${RS}Element`,
          [`${SKOS}prefLabel`]: 'Inventory, Net',
          [`${RS}itemType`]: 'monetary',
        },
        {
          '@id': `${TENANT}InventoryRawMaterials`,
          '@type': `${RS}Element`,
          [`${SKOS}prefLabel`]: 'Raw Materials',
          [`${RS}itemType`]: 'monetary',
        },
        {
          '@id': 'http://ex/f1',
          '@type': `${RS}Fact`,
          [`${RS}element`]: { '@id': `${RSGAAP}InventoryNet` },
          [`${RS}factSet`]: { '@id': 'http://ex/fs1' },
          [`${RS}period`]: { '@id': 'http://ex/p1' },
          [`${RS}numericValue`]: 22000,
        },
        {
          '@id': 'http://ex/f2',
          '@type': `${RS}Fact`,
          [`${RS}element`]: { '@id': `${TENANT}InventoryRawMaterials` },
          [`${RS}factSet`]: { '@id': 'http://ex/fs1' },
          [`${RS}period`]: { '@id': 'http://ex/p1' },
          [`${RS}numericValue`]: 22000,
        },
        {
          '@id': 'http://ex/p1',
          '@type': `${RS}Period`,
          'http://www.xbrl.org/2003/instance#instant': '2026-08-31',
        },
      ],
    })

  it('foots a subtotal whose arc was emitted twice', async () => {
    const report = await duplicatedArcs()
    expect(report.calcAssociations).toHaveLength(2)
    const table = buildPivots(report)[0]
    const check = footCheck(report, table, `${RSGAAP}InventoryNet`, 0)
    expect(check).not.toBeNull()
    // One term, not two — and 22,000, not 44,000.
    expect(check?.terms).toHaveLength(1)
    expect(check?.expected).toBe(22000)
    expect(check?.actual).toBe(22000)
    expect(check?.ok).toBe(true)
  })

  it('keeps the same parent-child arc on a second structure', async () => {
    // The SEC adapter stamps every calc arc with its section id, so one concept
    // presented on several sections legitimately repeats. Deduplication is per
    // structure, so those stay distinct.
    const report = await duplicatedArcs()
    report.calcAssociations = [
      { ...report.calcAssociations[0], structure: 'http://ex/st1' },
      { ...report.calcAssociations[0], structure: 'http://ex/st2' },
    ]
    const table = buildPivots(report)[0]
    expect(footCheck(report, table, `${RSGAAP}InventoryNet`, 0)?.terms).toHaveLength(2)
  })
})

describe('InformationBlock.label', () => {
  it('is the section title, not the raw role definition', async () => {
    // A holon's block prefLabel is the role definition verbatim; the Tavi route
    // gives the parsed title for the same block, and `label` is a section title
    // either way.
    const report = await parseJsonld({
      '@graph': [
        {
          '@id': 'http://ex/ib1',
          '@type': `${RS}InformationBlock`,
          [`${SKOS}prefLabel`]: '0001 - Statement - Balance Sheet',
        },
        {
          '@id': 'http://ex/ib2',
          '@type': `${RS}InformationBlock`,
          [`${SKOS}prefLabel`]: 'Inventory Components',
        },
      ],
    })
    const labels = report.informationBlocks.map((b) => b.label).sort()
    // A name that is not SEC-shaped passes through untouched.
    expect(labels).toEqual(['Balance Sheet', 'Inventory Components'])
  })
})

describe('a root abstract that restates the section title', () => {
  it('is not rendered as a heading row', async () => {
    // rs-gaap gives the income statement a root `IncomeStatementAbstract` and
    // the other three primaries none, so every RoboLedger report printed
    // "Income Statement" directly under the heading "Income Statement" — and
    // only there.
    const report = await parseJsonld({
      '@graph': [
        {
          '@id': 'http://ex/ib1',
          '@type': `${RS}InformationBlock`,
          [`${RS}structure`]: { '@id': 'http://ex/st1' },
          [`${RS}factSet`]: { '@id': 'http://ex/fs1' },
          [`${RS}blockType`]: 'income_statement',
        },
        {
          '@id': 'http://ex/st1',
          '@type': `${RS}Structure`,
          [`${RS}structureName`]: '0002 - Statement - Income Statement',
          [`${RS}hasAssociation`]: [{ '@id': 'http://ex/pres1' }],
        },
        {
          '@id': 'http://ex/pres1',
          '@type': `${RS}Association`,
          [`${RS}associationType`]: 'presentation',
          [`${XLINK}from`]: { '@id': `${RSGAAP}IncomeStatementAbstract` },
          [`${XLINK}to`]: { '@id': `${RSGAAP}Revenues` },
          [`${LINK}order`]: 1,
        },
        {
          '@id': `${RSGAAP}IncomeStatementAbstract`,
          '@type': `${RS}Element`,
          [`${RS}abstract`]: 'true',
          [`${SKOS}prefLabel`]: 'Income Statement [Abstract]',
        },
        {
          '@id': `${RSGAAP}Revenues`,
          '@type': `${RS}Element`,
          [`${SKOS}prefLabel`]: 'Revenues',
          [`${RS}itemType`]: 'monetary',
        },
        {
          '@id': 'http://ex/f1',
          '@type': `${RS}Fact`,
          [`${RS}element`]: { '@id': `${RSGAAP}Revenues` },
          [`${RS}factSet`]: { '@id': 'http://ex/fs1' },
          [`${RS}period`]: { '@id': 'http://ex/p1' },
          [`${RS}numericValue`]: 1000,
        },
        {
          '@id': 'http://ex/p1',
          '@type': `${RS}Period`,
          'http://www.xbrl.org/2003/instance#endDate': '2026-08-31',
        },
      ],
    })
    const table = buildPivots(report)[0]
    expect(table.title).toBe('Income Statement')
    expect(table.rows.map((r) => r.label ?? r.element.label)).toEqual(['Revenues'])
    // The heading is gone, so its child is not indented under nothing.
    expect(table.rows[0].depth).toBe(0)
  })

  it('keeps a heading that says something the title does not', async () => {
    const report = await parseJsonld({
      '@graph': [
        {
          '@id': 'http://ex/ib1',
          '@type': `${RS}InformationBlock`,
          [`${RS}structure`]: { '@id': 'http://ex/st1' },
          [`${RS}factSet`]: { '@id': 'http://ex/fs1' },
        },
        {
          '@id': 'http://ex/st1',
          '@type': `${RS}Structure`,
          [`${RS}structureName`]: '0002 - Statement - Income Statement',
          [`${RS}hasAssociation`]: [{ '@id': 'http://ex/pres1' }],
        },
        {
          '@id': 'http://ex/pres1',
          '@type': `${RS}Association`,
          [`${RS}associationType`]: 'presentation',
          [`${XLINK}from`]: { '@id': `${RSGAAP}OperatingExpensesAbstract` },
          [`${XLINK}to`]: { '@id': `${RSGAAP}Revenues` },
          [`${LINK}order`]: 1,
        },
        {
          '@id': `${RSGAAP}OperatingExpensesAbstract`,
          '@type': `${RS}Element`,
          [`${RS}abstract`]: 'true',
          [`${SKOS}prefLabel`]: 'Operating Expenses [Abstract]',
        },
        {
          '@id': `${RSGAAP}Revenues`,
          '@type': `${RS}Element`,
          [`${SKOS}prefLabel`]: 'Revenues',
          [`${RS}itemType`]: 'monetary',
        },
        {
          '@id': 'http://ex/f1',
          '@type': `${RS}Fact`,
          [`${RS}element`]: { '@id': `${RSGAAP}Revenues` },
          [`${RS}factSet`]: { '@id': 'http://ex/fs1' },
          [`${RS}period`]: { '@id': 'http://ex/p1' },
          [`${RS}numericValue`]: 1000,
        },
        {
          '@id': 'http://ex/p1',
          '@type': `${RS}Period`,
          'http://www.xbrl.org/2003/instance#endDate': '2026-08-31',
        },
      ],
    })
    const table = buildPivots(report)[0]
    expect(table.rows.map((r) => r.label ?? r.element.label)).toEqual([
      'Operating Expenses',
      'Revenues',
    ])
  })
})
