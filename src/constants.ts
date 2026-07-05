/**
 * RDF vocabulary and display helpers shared across adapters and projection.
 *
 * A report holon mixes several vocabularies: `rs:` for structure, `skos:` for
 * human labels, and the XBRL family (`xlink:` / `xbrli:` / `link:`) for the
 * networks. These constants are the single source of truth for the full IRIs.
 */

export const NS = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rs: 'https://robosystems.ai/vocab/',
  rsgaap: 'https://robosystems.ai/taxonomy/rs-gaap/v1/',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  xlink: 'http://www.w3.org/1999/xlink#',
  xbrli: 'http://www.xbrl.org/2003/instance#',
  link: 'http://www.xbrl.org/2003/linkbase#',
  iso4217: 'http://www.xbrl.org/2003/iso4217#',
} as const

/** Frequently-referenced full IRIs, pre-concatenated for terseness. */
export const IRI = {
  type: NS.rdf + 'type',
  // rs: classes
  Report: NS.rs + 'Report',
  Fact: NS.rs + 'Fact',
  InformationBlock: NS.rs + 'InformationBlock',
  Structure: NS.rs + 'Structure',
  Association: NS.rs + 'Association',
  Element: NS.rs + 'Element',
  Period: NS.rs + 'Period',
  Unit: NS.rs + 'Unit',
  Entity: NS.rs + 'Entity',
  // rs: predicates
  element: NS.rs + 'element',
  period: NS.rs + 'period',
  unit: NS.rs + 'unit',
  entity: NS.rs + 'entity',
  factSet: NS.rs + 'factSet',
  numericValue: NS.rs + 'numericValue',
  decimals: NS.rs + 'decimals',
  blockType: NS.rs + 'blockType',
  associationType: NS.rs + 'associationType',
  hasAssociation: NS.rs + 'hasAssociation',
  roleUri: NS.rs + 'roleUri',
  structureName: NS.rs + 'structureName',
  abstract: NS.rs + 'abstract',
  monetary: NS.rs + 'monetary',
  legalName: NS.rs + 'legalName',
  country: NS.rs + 'country',
  // skos:
  prefLabel: NS.skos + 'prefLabel',
  // xlink:
  from: NS.xlink + 'from',
  to: NS.xlink + 'to',
  role: NS.xlink + 'role',
  // xbrli:
  instant: NS.xbrli + 'instant',
  startDate: NS.xbrli + 'startDate',
  endDate: NS.xbrli + 'endDate',
  periodType: NS.xbrli + 'periodType',
  balance: NS.xbrli + 'balance',
  measure: NS.xbrli + 'measure',
  // link:
  order: NS.link + 'order',
  weight: NS.link + 'weight',
} as const

/**
 * Prefixes for compacting concept IRIs to `prefix:Local`. Order matters — the
 * most specific namespace must come first so `rs-gaap:` wins over `rs:`.
 */
const PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['rs-gaap', NS.rsgaap],
  ['disclosures', 'https://robosystems.ai/taxonomy/rs-gaap/disclosures/v1/'],
  ['us-gaap', 'http://fasb.org/us-gaap/'],
  ['dei', 'http://xbrl.sec.gov/dei/'],
  ['rs', NS.rs],
  ['skos', NS.skos],
  ['xbrli', NS.xbrli],
  ['xlink', NS.xlink],
  ['link', NS.link],
  ['iso4217', NS.iso4217],
]

/** Compact a concept IRI to `prefix:Local` (e.g. `rs-gaap:Assets`). */
export function qname(iri: string): string {
  for (const [prefix, ns] of PREFIXES) {
    if (iri.startsWith(ns)) {
      return `${prefix}:${iri.slice(ns.length)}`
    }
  }
  const slash = iri.lastIndexOf('/')
  const hash = iri.lastIndexOf('#')
  return iri.slice(Math.max(slash, hash) + 1)
}

/**
 * Readable concept name from a local name when no `skos:prefLabel` is present —
 * splits CamelCase into words (`AssetsCurrent` → `Assets Current`). A graceful
 * fallback for bundles that predate label emit.
 */
export function humanize(iri: string): string {
  const local = qname(iri).split(':').pop() ?? iri
  return local.replace(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, ' ')
}

/** Stable display order for the canonical statement blocks; others fall after. */
export const BLOCK_ORDER: Record<string, number> = {
  balance_sheet: 0,
  income_statement: 1,
  cash_flow_statement: 2,
  equity_statement: 3,
}

/** Friendly section headings keyed by block type. */
export const BLOCK_TITLES: Record<string, string> = {
  balance_sheet: 'Balance Sheet',
  income_statement: 'Income Statement',
  cash_flow_statement: 'Cash Flow Statement',
  equity_statement: 'Statement of Changes in Equity',
}
