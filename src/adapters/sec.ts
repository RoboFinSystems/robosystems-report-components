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
import { parseStructureDefinition, type SectionKind } from '../sections'

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
  kind: SectionKind
  /** The full role definition (e.g. "9952153 - Statement - …"), for hover/context. */
  definition: string | null
  /** `canonical_type` when the section is a recognized core statement, else null. */
  canonicalType: string | null
  /** Filing sequence (position in the ordered section list). */
  order: number
  /** `FactSet.identifier`s whose facts belong to this section. */
  factsetIds: string[]
}

/**
 * A report's own label linkbase, resolved once at shell time: element URI →
 * (label-role URI → label text). The SEC graph anchors each label to the filer's
 * per-report extension taxonomy and tags the edge with the element it labels
 * (`element_uri`), so this is the exact, report-scoped label set — free of the
 * cross-filer collisions on the shared, content-addressed `Label` pool. Keyed by
 * URI (not qname) so filer-extension elements resolve too.
 */
export interface ReportLabels {
  byElement: Map<string, Map<string, string>>
}

/** The fast first read: entity + the ordered section list + the label dictionary. */
export interface SecReportShell {
  reportId: string
  entity: EntityInfo | null
  sections: SecSection[]
  labels: ReportLabels
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

// The report's own label linkbase — every label its taxonomy defines, tagged
// with the element it labels (`element_uri`) — fetched in two steps.
//
// Why two steps (load-bearing): LadybugDB's planner only PROBES the shared
// `TAXONOMY_HAS_LABEL` table (~80M edges at SEC scale) when the taxonomy is bound
// by its primary key as a plan-time constant. Reaching the taxonomy through the
// report traversal (`(r)-[:REPORT_USES_TAXONOMY]->(:Taxonomy)-[:TAXONOMY_HAS_LABEL]->…`)
// — or carrying it forward via `WITH`/`UNWIND` — makes the planner scan the whole
// edge table instead: a tiny result that nonetheless times out (~25 s+) and fails
// the entire shell load. So resolve the taxonomy id(s) first (report-anchored,
// fast), then pull labels per taxonomy with the id bound as a parameter (a PK
// probe of that one taxonomy's ~few-thousand labels, fast).

// Step 1: the report's taxonomy id(s). PK-anchored on the report.
const LABELS_TAXONOMY_Q = `
MATCH (r:Report {identifier: $rid})-[:REPORT_USES_TAXONOMY]->(t:Taxonomy)
RETURN t.identifier AS tid`

// Step 2: one taxonomy's labels, keyed by the report-scoped `element_uri` join
// key. Bound by the taxonomy PK ($tid) so the planner probes from that one
// taxonomy. `element_uri IS NOT NULL` is safe once anchored; nulls are also
// dropped client-side in buildReportLabels.
const LABELS_Q = `
MATCH (t:Taxonomy {identifier: $tid})-[tl:TAXONOMY_HAS_LABEL]->(l:Label)
WHERE tl.element_uri IS NOT NULL
RETURN tl.element_uri AS element_uri, l.type AS role, l.value AS value`

// Kill switch for the report-scoped label linkbase. When off, the shell skips
// the label fetch and feeds an empty label set, so every `labelFor(...)` returns
// null and display falls back to the humanized qname/element name — the
// pre-label behavior. Typed `boolean` so neither branch is narrowed to dead code.
const LABELS_ENABLED: boolean = true

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
RETURN f.identifier AS fid, e.qname AS qname, e.uri AS euri, e.name AS ename, e.balance AS balance,
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
       pe.qname AS parent, pe.uri AS parent_uri, pe.name AS parent_name, pe.is_abstract AS parent_abstract,
       ce.qname AS child, ce.uri AS child_uri, ce.name AS child_name, ce.is_abstract AS child_abstract`

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

// ── Report-scoped labels ─────────────────────────────────────────────────────

/** XBRL standard label role — the default display label. */
const STANDARD_LABEL_ROLE = 'http://www.xbrl.org/2003/role/label'
/** Terse label role — the fallback when a concept has no standard label. */
const TERSE_LABEL_ROLE = 'http://www.xbrl.org/2003/role/terseLabel'

/**
 * XBRL standard labels tag structural elements with a bracketed role suffix —
 * `Land [Member]`, `Operating Expenses [Abstract]`, and likewise `[Axis]`,
 * `[Table]`, `[Line Items]`, `[Domain]`. That tag is metadata, not part of the
 * display name, so strip a trailing one. If stripping would empty the label
 * (a label that is only the tag), keep the original.
 */
const ROLE_SUFFIX_RE = /\s*\[(?:Abstract|Axis|Member|Table|Line Items|Domain)\]\s*$/
function stripRoleSuffix(label: string): string {
  const stripped = label.replace(ROLE_SUFFIX_RE, '').trim()
  return stripped || label
}

/** Build the report's element-URI → (role → value) label dictionary from LABELS_Q rows. */
function buildReportLabels(rows: Array<Record<string, unknown>>): ReportLabels {
  const byElement = new Map<string, Map<string, string>>()
  for (const row of rows) {
    const uri = str(row, 'element_uri')
    const value = str(row, 'value')
    if (!uri || !value) continue
    const role = str(row, 'role') ?? STANDARD_LABEL_ROLE
    let roles = byElement.get(uri)
    if (!roles) {
      roles = new Map()
      byElement.set(uri, roles)
    }
    roles.set(role, value)
  }
  return { byElement }
}

/**
 * The report's label for an element (by URI), preferring `preferredRole` (a
 * presentation arc's periodStart/periodEnd/total variant) when supplied, then
 * the standard label, then terse — with the XBRL `[Member]`/`[Axis]`/… role tag
 * stripped for display. Returns null when the report defined none — the caller
 * then humanizes the qname as a last resort.
 */
function labelFor(
  labels: ReportLabels,
  uri: string | null,
  preferredRole?: string | null
): string | null {
  if (!uri) return null
  const roles = labels.byElement.get(uri)
  if (!roles) return null
  const resolved =
    (preferredRole ? roles.get(preferredRole) : undefined) ??
    roles.get(STANDARD_LABEL_ROLE) ??
    roles.get(TERSE_LABEL_ROLE)
  return resolved ? stripRoleSuffix(resolved) : null
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
  // A percentItemType stores a decimal fraction (0.10 → 10%); a pureItemType is a
  // bare dimensionless ratio (2.5 debt-to-equity), NOT a percentage.
  if (/percentItemType/i.test(itemType)) return 'percent'
  if (/pureItemType/i.test(itemType)) return 'pure'
  if (/monetaryItemType/i.test(itemType)) return 'monetary'
  if (/integerItemType/i.test(itemType)) return 'integer'
  if (!bool(row, 'is_numeric')) return undefined
  // No item_type (older captures): a debit/credit balance marks a monetary item.
  const balance = str(row, 'balance')
  return balance === 'debit' || balance === 'credit' ? 'monetary' : 'other'
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

/**
 * Fetch a report's label linkbase as `element_uri → role → value` rows, in two
 * taxonomy-anchored steps (see LABELS_TAXONOMY_Q / LABELS_Q for why the split is
 * load-bearing): resolve the taxonomy id(s), then pull each taxonomy's labels
 * with the id bound by PK. Taxonomies are pulled in parallel and flattened.
 */
async function fetchReportLabelRows(
  query: SecQuery,
  reportId: string
): Promise<Array<Record<string, unknown>>> {
  const taxRows = await query(LABELS_TAXONOMY_Q, { rid: reportId })
  const tids = taxRows.map((row) => str(row, 'tid')).filter((tid): tid is string => tid !== null)
  if (tids.length === 0) return []
  const perTaxonomy = await Promise.all(tids.map((tid) => query(LABELS_Q, { tid })))
  return perTaxonomy.flat()
}

/** Fetch the entity + ordered section list for a report (the fast first read). */
export async function fetchSecReportShell(
  query: SecQuery,
  reportId: string
): Promise<SecReportShell> {
  const [entityRows, sectionRows, labelRows] = await Promise.all([
    query(ENTITY_META_Q, { rid: reportId }),
    query(SECTIONS_Q, { rid: reportId }),
    // Report-scoped labels are an enhancement, not a requirement, and are gated
    // by LABELS_ENABLED. When off, feed an empty label set so labels fall back to
    // the humanized qname. When on, fetch them via the two-step taxonomy-anchored
    // path so the planner probes TAXONOMY_HAS_LABEL rather than scanning it. Kept
    // non-fatal: a graph that predates the `TAXONOMY_HAS_LABEL.element_uri` ingest
    // binder-errors on LABELS_Q; swallow that so the shell still loads and labels
    // fall back to the humanized qname.
    LABELS_ENABLED
      ? fetchReportLabelRows(query, reportId).catch(() => [])
      : Promise.resolve<Array<Record<string, unknown>>>([]),
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
        definition: str(row, 'definition'),
        canonicalType: str(row, 'canonical_type'),
        order,
        factsetIds: factsets,
      }
    })
    .filter((s) => s.id && s.factsetIds.length > 0)

  return {
    reportId,
    entity: mapEntity(entityRows[0]),
    sections,
    labels: buildReportLabels(labelRows),
  }
}

// ── Single section ────────────────────────────────────────────────────────────

function accumulateElement(
  elements: Record<string, ElementInfo>,
  row: Record<string, unknown>,
  labels: ReportLabels
) {
  const q = str(row, 'qname')
  if (!q || elements[q]) return
  const balance = str(row, 'balance')
  const ename = str(row, 'ename')
  elements[q] = {
    id: q,
    qname: q,
    // Prefer the report's own label (resolved from its per-report taxonomy);
    // humanizing the element name is the fallback when the report defined none.
    label: labelFor(labels, str(row, 'euri')) ?? (ename ? humanize(ename) : humanize(q)),
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
  uri: string | null,
  name: string | null,
  isAbstract: boolean,
  labels: ReportLabels
): void {
  if (!qname || elements[qname]) return
  // Prefer the report's own label; else humanize the name (abstract headers drop
  // the XBRL `Abstract` suffix: `OperatingExpensesAbstract` → `Operating Expenses`).
  const humanized = name
    ? humanize(isAbstract ? name.replace(/Abstract$/, '') : name)
    : humanize(qname)
  elements[qname] = {
    id: qname,
    qname,
    label: labelFor(labels, uri) ?? humanized,
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
    // Axis/member are elements too — prefer the report's own labels (keyed by the
    // element URI, which matches the dimension's axis_uri/member_uri), humanizing
    // the local name only as a fallback.
    const axisUri = str(row, 'axis_uri')
    const memberUri = str(row, 'member_uri')
    const qual: DimensionQualifier = {
      axis: xbrlQname(axisUri, str(row, 'axis')),
      member: memberLocal ? xbrlQname(memberUri, memberLocal) : null,
      axisLabel: labelFor(shell.labels, axisUri) ?? dimLabel(str(row, 'axis')),
      memberLabel: labelFor(shell.labels, memberUri) ?? dimLabel(memberLocal),
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

    accumulateElement(elements, row, shell.labels)
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
      str(row, 'parent_uri'),
      str(row, 'parent_name'),
      bool(row, 'parent_abstract'),
      shell.labels
    )
    registerPresentationElement(
      elements,
      child,
      str(row, 'child_uri'),
      str(row, 'child_name'),
      bool(row, 'child_abstract'),
      shell.labels
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
    definition: section.definition,
    kind: section.kind,
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
