/**
 * The SEC adapter — reconstructs a report from the live SEC EDGAR graph
 * (`graph_id = "sec"`) via read-only Cypher, one section at a time.
 *
 * A single SEC filing is a large graph: a 10-K is ~90 `Structure`s (the 5 core
 * statements plus dozens of disclosure/document networks), thousands of facts.
 * Loading the whole thing up front is slow, so this module splits the work:
 *
 *  - `fetchSecReportShell` — one fast pass that returns the entity + the ordered
 *    **section list** (each `Structure` with its title, kind, and factset ids).
 *  - `fetchSecSection` — on demand, the facts + presentation/calculation network
 *    for **one** section, assembled into a single-section `NormalizedReport` the
 *    shared projection/components render unchanged.
 *
 * The library stays transport-agnostic: the caller injects a `SecQuery` (a thin
 * wrapper over `POST /v1/graphs/sec/query`); this module owns only the Cypher and
 * the row → model mapping.
 *
 * ── Query rules (load-bearing; verified against the live graph) ────────────────
 * These are not stylistic — violating them turns a ~120 ms query into a ~14 s one:
 *  1. **Anchor on a primary key.** Lead per-section queries with a direct
 *     `{identifier: $id}` match on `FactSet`/`Structure` (indexed). Never expand a
 *     whole `Report`'s facts, and never use `WHERE x.identifier IN [list]` (a scan,
 *     not an index probe) — issue one query per factset instead.
 *  3. **Always carry a `WHERE f.value IS NOT NULL` predicate** on the fact scan and
 *     **always `LIMIT`.** Both flip the planner onto the fast path (~120 ms vs ~7 s).
 *     `value` (the raw string) is present on every fact, so this keeps numeric and
 *     text facts alike.
 *  4. **No `OPTIONAL MATCH`.** An optional unit join alone cost ~12 s; units come
 *     from a separate required-join query, merged client-side.
 *  5. Aggregations must `ORDER BY <alias>` (not `s.number`); `end` is reserved, so
 *     alias every `p.end_date AS end_date`.
 */
import { humanize, qname as toQname } from '../constants'
import { currencySymbolFor } from '../format'
import type {
  CalcAssociation,
  DimensionQualifier,
  ElementInfo,
  EntityInfo,
  Fact,
  InformationBlock,
  NormalizedReport,
  NumericKind,
  PeriodInfo,
  PeriodType,
  PresAssociation,
  StructureInfo,
  UnitInfo,
} from '../model'

/** Injected transport — runs a read-only Cypher query and returns its rows. */
export type SecQuery = (
  cypher: string,
  params?: Record<string, unknown>
) => Promise<Array<Record<string, unknown>>>

/** One navigable section of a filing (a `Structure` + its facts). */
export interface SecSection {
  /** `Structure.identifier` — the section id + the anchor for its associations. */
  id: string
  /** Human title, e.g. "Consolidated Balance Sheets" (definition prefix stripped). */
  title: string
  /** Coarse grouping for the table of contents. */
  kind: 'Statement' | 'Disclosure' | 'Document' | 'Cover' | 'Other'
  /** `canonical_type` when the section is a recognized core statement, else null. */
  canonicalType: string | null
  /** Filing sequence (position in the ordered section list). */
  order: number
  /** `FactSet.identifier`s whose facts belong to this section. */
  factsetIds: string[]
}

/** The fast first read: entity + the ordered section list, no fact bodies. */
export interface SecReportShell {
  reportId: string
  entity: EntityInfo | null
  sections: SecSection[]
}

// ── Cypher ────────────────────────────────────────────────────────────────────

const ENTITY_META_Q = `
MATCH (ent:Entity)-[:ENTITY_HAS_REPORT]->(r:Report {identifier: $rid})
RETURN ent.identifier AS entity_id, ent.name AS entity_name,
       ent.legal_name AS legal_name, ent.cik AS cik, ent.ticker AS ticker,
       r.form AS form, r.report_date AS report_date`

// Structures reachable from this report's facts, with their factsets. Dimensional
// facts belong to the same factsets as their consolidated totals, so no
// `has_dimensions` filter is needed — dropping it also surfaces sections whose
// content is entirely dimensional (e.g. Schedule II). ORDER BY the alias (Kùzu
// requires it once `collect` aggregates).
const SECTIONS_Q = `
MATCH (r:Report {identifier: $rid})-[:REPORT_HAS_FACT]->(f:Fact)<-[:FACT_SET_CONTAINS_FACT]-(fs:FactSet)<-[:STRUCTURE_HAS_FACT_SET]-(s:Structure)
RETURN s.identifier AS sid, s.canonical_type AS canonical_type,
       s.definition AS definition, s.number AS number,
       collect(DISTINCT fs.identifier) AS factsets
ORDER BY number`

// Facts for one factset. Anchored on the factset PK; dimensional and consolidated
// facts alike come through — the pivot engine keys cells by the full aspect
// signature (element + period + dimensional coordinate), so segment/component
// breakdowns no longer collide with the total. Element type signals
// (`item_type`, `is_shares`) drive the value's numeric kind (monetary / per-share
// / shares). `WHERE f.value IS NOT NULL` + `LIMIT` keep it on the fast path and
// retain text facts (Cover Page etc.).
const FACTS_Q = `
MATCH (fs:FactSet {identifier: $fsid})-[:FACT_SET_CONTAINS_FACT]->(f:Fact)-[:FACT_HAS_ELEMENT]->(e:Element),
      (f)-[:FACT_HAS_PERIOD]->(p:Period)
WHERE f.value IS NOT NULL
RETURN f.identifier AS fid, e.qname AS qname, e.name AS ename, e.balance AS balance,
       e.period_type AS e_period_type, e.is_abstract AS is_abstract, e.is_numeric AS is_numeric,
       e.item_type AS item_type, e.is_shares AS is_shares,
       f.numeric_value AS numeric_value, f.value AS raw_value, f.decimals AS decimals,
       p.identifier AS pid, p.period_type AS period_type,
       p.start_date AS start_date, p.end_date AS end_date
LIMIT 2000`

// Unit measures for the same factset, as a separate required-join query — an
// OPTIONAL unit join on the facts query alone cost ~12 s.
const UNITS_Q = `
MATCH (fs:FactSet {identifier: $fsid})-[:FACT_SET_CONTAINS_FACT]->(f:Fact)-[:FACT_HAS_UNIT]->(u:Unit)
WHERE f.value IS NOT NULL
RETURN f.identifier AS fid, u.measure AS unit
LIMIT 2000`

// Dimensional qualifiers for the same factset — again a separate required-join
// query (never OPTIONAL) so a fact with no dimensions simply contributes no rows.
// One row per (fact, axis); a multi-axis fact yields several, merged client-side.
const DIMS_Q = `
MATCH (fs:FactSet {identifier: $fsid})-[:FACT_SET_CONTAINS_FACT]->(f:Fact)-[:FACT_HAS_DIMENSION]->(d:Dimension)
WHERE f.value IS NOT NULL
RETURN f.identifier AS fid, d.axis AS axis, d.member AS member,
       d.axis_uri AS axis_uri, d.member_uri AS member_uri,
       d.is_explicit AS is_explicit, d.is_typed AS is_typed
LIMIT 4000`

// The presentation + calculation networks for one section, anchored on the
// Structure PK. `association_type` is `Presentation` / `Calculation`. Element
// names + `is_abstract` come along so presentation-only nodes (abstract section
// headers, which carry no facts) can be registered — without them the projection
// can't tell a header from a concrete line and mis-orders it.
const ASSOC_Q = `
MATCH (s:Structure {identifier: $sid})-[:STRUCTURE_HAS_ASSOCIATION]->(a:Association),
      (a)-[:ASSOCIATION_HAS_FROM_ELEMENT]->(pe:Element),
      (a)-[:ASSOCIATION_HAS_TO_ELEMENT]->(ce:Element)
RETURN a.association_type AS association_type, a.order_value AS order_value, a.weight AS weight,
       pe.qname AS parent, pe.name AS parent_name, pe.is_abstract AS parent_abstract,
       ce.qname AS child, ce.name AS child_name, ce.is_abstract AS child_abstract`

// ── Row helpers ────────────────────────────────────────────────────────────────

function str(row: Record<string, unknown>, key: string): string | null {
  const v = row[key]
  return typeof v === 'string' && v !== '' ? v : v == null ? null : String(v)
}

function num(row: Record<string, unknown>, key: string): number | null {
  const v = row[key]
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isNaN(n) ? null : n
}

function bool(row: Record<string, unknown>, key: string): boolean {
  const v = row[key]
  return v === true || v === 'true'
}

function periodType(raw: string | null): PeriodType | null {
  return raw === 'instant' || raw === 'duration' ? raw : null
}

/**
 * A prefixed qname for a dimension axis/member from its versioned XBRL IRI + local
 * name (`http://fasb.org/us-gaap/2025#…Member` + `…Member` → `us-gaap:…Member`).
 * The graph gives axis/member as bare local names; this keeps them consistent with
 * the `Element.qname`s used in the presentation network (so member ordering lines
 * up), and cell matching is internally consistent regardless (row + column derive
 * from the same mapping).
 */
function xbrlQname(uri: string | null, local: string | null): string {
  if (local) {
    const ns = (uri ?? '').split('#')[0]
    if (/fasb\.org\/us-gaap/.test(ns)) return `us-gaap:${local}`
    if (/fasb\.org\/srt/.test(ns)) return `srt:${local}`
    if (/xbrl\.sec\.gov\/dei/.test(ns)) return `dei:${local}`
    if (/robosystems\.ai\/taxonomy\/rs-gaap/.test(ns)) return `rs-gaap:${local}`
    return local
  }
  return uri ? toQname(uri) : ''
}

/** Humanize an axis/member local name, dropping the XBRL `Axis`/`Member`/`Domain` suffix. */
function dimLabel(local: string | null): string {
  if (!local) return ''
  return humanize(local.replace(/(Axis|Member|Domain)$/, '')) || humanize(local)
}

/**
 * Classify an element's numeric kind from its XBRL `item_type` (+ `is_shares`).
 * Per-share and share counts opt out of monetary rescaling; strings/text are not
 * numeric. Checked before monetary because share/per-share types are also numeric.
 */
function deriveNumericKind(row: Record<string, unknown>): NumericKind | undefined {
  const itemType = str(row, 'item_type') ?? ''
  if (/perShareItemType/i.test(itemType)) return 'perShare'
  if (/sharesItemType/i.test(itemType) || bool(row, 'is_shares')) return 'shares'
  if (/percentItemType|pureItemType/i.test(itemType)) return 'percent'
  if (/monetaryItemType/i.test(itemType)) return 'monetary'
  if (/integerItemType/i.test(itemType)) return 'integer'
  if (!bool(row, 'is_numeric')) return undefined
  // No item_type (older captures): a debit/credit balance marks a monetary item.
  const balance = str(row, 'balance')
  return balance === 'debit' || balance === 'credit' ? 'monetary' : 'other'
}

/**
 * The primary financial statements. Only these `canonical_type`s belong in the
 * TOC's "Financial Statements" group — other canonical types (rollforwards,
 * hierarchies, `(Details)` networks) are disclosures, classified by their
 * definition's type word instead.
 */
const CORE_STATEMENT_TYPES = new Set([
  'balance_sheet',
  'income_statement',
  'cash_flow_statement',
  'equity_statement',
  'comprehensive_income',
])

/**
 * Split an XBRL `Structure.definition` into a human title + a coarse kind.
 * Definitions look like `"9952153 - Statement - Consolidated Balance Sheets"` or
 * `"0000001 - Document - Cover Page"` — a `"NNNN - <Type> - <Title>"` shape whose
 * middle word (Statement / Disclosure / Document) drives the kind. A core
 * canonical statement always reads as a Statement so the primaries group cleanly.
 */
export function parseStructureDefinition(
  definition: string | null,
  canonicalType: string | null
): { title: string; kind: SecSection['kind'] } {
  const raw = (definition ?? '').trim()
  const parts = raw.split(' - ')
  let type = ''
  let title = raw
  if (parts.length >= 3) {
    type = parts[1].trim()
    title = parts.slice(2).join(' - ').trim()
  } else if (parts.length === 2) {
    title = parts[1].trim()
  }

  let kind: SecSection['kind'] = 'Other'
  if (/cover/i.test(title)) kind = 'Cover'
  else if (type === 'Statement') kind = 'Statement'
  else if (type === 'Disclosure') kind = 'Disclosure'
  else if (type === 'Document') kind = 'Document'
  // A core statement is always a Statement; a non-core canonical type (e.g.
  // GoodwillRollForward) stays whatever its definition type word made it.
  if (canonicalType && CORE_STATEMENT_TYPES.has(canonicalType)) kind = 'Statement'

  return { title: title || raw || canonicalType || 'Section', kind }
}

// ── Shell ───────────────────────────────────────────────────────────────────

function mapEntity(row: Record<string, unknown> | undefined): EntityInfo | null {
  if (!row) return null
  const id = str(row, 'entity_id')
  if (!id) return null
  return {
    id,
    name: str(row, 'entity_name') ?? str(row, 'legal_name') ?? 'Entity',
    legalName: str(row, 'legal_name'),
    country: null,
  }
}

/** Fetch the entity + ordered section list for a report (the fast first read). */
export async function fetchSecReportShell(
  query: SecQuery,
  reportId: string
): Promise<SecReportShell> {
  const [entityRows, sectionRows] = await Promise.all([
    query(ENTITY_META_Q, { rid: reportId }),
    query(SECTIONS_Q, { rid: reportId }),
  ])

  const sections: SecSection[] = sectionRows
    .map((row, order): SecSection => {
      const { title, kind } = parseStructureDefinition(
        str(row, 'definition'),
        str(row, 'canonical_type')
      )
      const factsets = Array.isArray(row.factsets)
        ? (row.factsets as unknown[]).filter((v): v is string => typeof v === 'string')
        : []
      return {
        id: str(row, 'sid') ?? '',
        title,
        kind,
        canonicalType: str(row, 'canonical_type'),
        order,
        factsetIds: factsets,
      }
    })
    .filter((s) => s.id && s.factsetIds.length > 0)

  return { reportId, entity: mapEntity(entityRows[0]), sections }
}

// ── Single section ────────────────────────────────────────────────────────────

function accumulateElement(elements: Record<string, ElementInfo>, row: Record<string, unknown>) {
  const q = str(row, 'qname')
  if (!q || elements[q]) return
  const balance = str(row, 'balance')
  elements[q] = {
    id: q,
    qname: q,
    label: str(row, 'ename') ? humanize(str(row, 'ename') as string) : humanize(q),
    balance: balance === 'debit' || balance === 'credit' ? balance : null,
    periodType: periodType(str(row, 'e_period_type')),
    abstract: bool(row, 'is_abstract'),
    monetary: bool(row, 'is_numeric'),
    numericKind: deriveNumericKind(row),
  }
}

/**
 * Register a presentation-network element that has no facts of its own — chiefly
 * an abstract section header. Fact-bearing elements are already registered from
 * the facts query and take precedence (this no-ops on existing keys); this fills
 * in the abstract headers so the projection renders them as headers above their
 * section rather than as empty concrete rows below it. Abstract labels drop the
 * XBRL `Abstract` suffix (`OperatingExpensesAbstract` → `Operating Expenses`).
 */
function registerPresentationElement(
  elements: Record<string, ElementInfo>,
  qname: string | null,
  name: string | null,
  isAbstract: boolean
): void {
  if (!qname || elements[qname]) return
  elements[qname] = {
    id: qname,
    qname,
    label: name ? humanize(isAbstract ? name.replace(/Abstract$/, '') : name) : humanize(qname),
    balance: null,
    periodType: null,
    abstract: isAbstract,
    monetary: false,
  }
}

function accumulatePeriod(periods: Record<string, PeriodInfo>, row: Record<string, unknown>) {
  const id = str(row, 'pid')
  if (!id || periods[id]) return
  const type = periodType(str(row, 'period_type')) ?? 'duration'
  const startDate = str(row, 'start_date')
  const endDate = str(row, 'end_date')
  periods[id] = {
    id,
    type,
    instant: type === 'instant' ? endDate : null,
    startDate,
    endDate,
    end: endDate ?? '',
  }
}

/**
 * Load one section into a single-section `NormalizedReport`. All of the
 * section's facts are re-keyed to the structure id as their `factSet`, so the
 * projection groups them as one Information Block regardless of how many raw
 * FactSets the filing split them across.
 */
export async function fetchSecSection(
  query: SecQuery,
  shell: SecReportShell,
  section: SecSection
): Promise<NormalizedReport> {
  const [factRowGroups, unitRowGroups, dimRowGroups, assocRows] = await Promise.all([
    Promise.all(section.factsetIds.map((fsid) => query(FACTS_Q, { fsid }))),
    Promise.all(section.factsetIds.map((fsid) => query(UNITS_Q, { fsid }))),
    Promise.all(section.factsetIds.map((fsid) => query(DIMS_Q, { fsid }))),
    query(ASSOC_Q, { sid: section.id }),
  ])

  const unitByFid = new Map<string, string>()
  for (const row of unitRowGroups.flat()) {
    const fid = str(row, 'fid')
    const measure = str(row, 'unit')
    if (fid && measure) unitByFid.set(fid, measure)
  }

  // One fact can carry several axes; collect its qualifiers (ordered by axis).
  const dimsByFid = new Map<string, DimensionQualifier[]>()
  for (const row of dimRowGroups.flat()) {
    const fid = str(row, 'fid')
    if (!fid) continue
    const memberLocal = str(row, 'member')
    const qual: DimensionQualifier = {
      axis: xbrlQname(str(row, 'axis_uri'), str(row, 'axis')),
      member: memberLocal ? xbrlQname(str(row, 'member_uri'), memberLocal) : null,
      axisLabel: dimLabel(str(row, 'axis')),
      memberLabel: dimLabel(memberLocal),
      explicit: bool(row, 'is_explicit'),
      typedValue: bool(row, 'is_typed') ? str(row, 'member') : null,
    }
    const list = dimsByFid.get(fid) ?? []
    list.push(qual)
    dimsByFid.set(fid, list)
  }
  for (const list of dimsByFid.values()) list.sort((a, b) => a.axis.localeCompare(b.axis))

  const elements: Record<string, ElementInfo> = {}
  const periods: Record<string, PeriodInfo> = {}
  const units: Record<string, UnitInfo> = {}
  const facts: Fact[] = []
  const seenFacts = new Set<string>()

  for (const row of factRowGroups.flat()) {
    const fid = str(row, 'fid')
    const element = str(row, 'qname')
    const period = str(row, 'pid')
    if (!fid || !element || !period || seenFacts.has(fid)) continue
    seenFacts.add(fid)

    accumulateElement(elements, row)
    accumulatePeriod(periods, row)

    const measure = unitByFid.get(fid) ?? null
    if (measure && !units[measure]) {
      const compact = toQname(measure)
      units[measure] = {
        id: measure,
        measure: compact,
        label: compact.includes(':') ? (compact.split(':').pop() as string) : compact,
        symbol: currencySymbolFor(compact),
      }
    }

    const value = num(row, 'numeric_value')
    facts.push({
      id: fid,
      element,
      period,
      unit: measure,
      entity: shell.entity?.id ?? null,
      factSet: section.id,
      value,
      decimals: str(row, 'decimals'),
      textValue: value === null ? str(row, 'raw_value') : null,
      dimensions: dimsByFid.get(fid),
    })
  }

  const calcAssociations: CalcAssociation[] = []
  const presAssociations: PresAssociation[] = []
  for (const row of assocRows) {
    const parent = str(row, 'parent')
    const child = str(row, 'child')
    if (!parent || !child) continue
    // Register presentation-only elements (abstract section headers carry no
    // facts, so the facts query never saw them). Fact-bearing elements are
    // already registered and unaffected — registration no-ops on existing keys.
    registerPresentationElement(
      elements,
      parent,
      str(row, 'parent_name'),
      bool(row, 'parent_abstract')
    )
    registerPresentationElement(
      elements,
      child,
      str(row, 'child_name'),
      bool(row, 'child_abstract')
    )
    const order = num(row, 'order_value') ?? 0
    const type = str(row, 'association_type')?.toLowerCase()
    if (type === 'calculation') {
      calcAssociations.push({
        parent,
        child,
        weight: num(row, 'weight') ?? 1,
        order,
        role: null,
        structure: section.id,
      })
    } else if (type === 'presentation') {
      presAssociations.push({ parent, child, order, role: null, structure: section.id })
    }
  }

  const informationBlock: InformationBlock = {
    id: section.id,
    blockType: section.canonicalType ?? '',
    factSet: section.id,
    label: section.title,
    structureId: section.id,
  }
  const structure: StructureInfo = {
    id: section.id,
    blockType: section.canonicalType ?? '',
    roleUri: null,
    structureName: section.title,
    order: section.order,
  }

  return {
    reportId: shell.reportId,
    reportIri: null,
    entity: shell.entity,
    informationBlocks: [informationBlock],
    structures: [structure],
    facts,
    elements,
    periods,
    units,
    calcAssociations,
    presAssociations,
  }
}

/** Merge single-section reports into one whole-report model (order preserved). */
export function mergeSecSections(
  shell: SecReportShell,
  sections: NormalizedReport[]
): NormalizedReport {
  const elements: Record<string, ElementInfo> = {}
  const periods: Record<string, PeriodInfo> = {}
  const units: Record<string, UnitInfo> = {}
  const informationBlocks: InformationBlock[] = []
  const structures: StructureInfo[] = []
  const facts: Fact[] = []
  const calcAssociations: CalcAssociation[] = []
  const presAssociations: PresAssociation[] = []

  for (const part of sections) {
    Object.assign(elements, part.elements)
    Object.assign(periods, part.periods)
    Object.assign(units, part.units)
    informationBlocks.push(...part.informationBlocks)
    structures.push(...part.structures)
    facts.push(...part.facts)
    calcAssociations.push(...part.calcAssociations)
    presAssociations.push(...part.presAssociations)
  }

  return {
    reportId: shell.reportId,
    reportIri: null,
    entity: shell.entity,
    informationBlocks,
    structures,
    facts,
    elements,
    periods,
    units,
    calcAssociations,
    presAssociations,
  }
}
